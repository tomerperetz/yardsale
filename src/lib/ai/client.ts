import Anthropic from '@anthropic-ai/sdk'
import { normalizeClusters } from './clusters'
import { CAPTION_SYSTEM, CLUSTER_SYSTEM, captionUser, clusterUser } from './prompts'
import type { AiFailure, AiResult, Caption } from './types'

/**
 * The only file in the app that imports the Anthropic SDK (spec §9). Every
 * consumer and every test mocks this one seam, and nothing here throws: a
 * caller on the import path degrades, it does not fail (spec §7.4).
 */

/** Spec §9 pins the model for both passes. */
const MODEL = 'claude-sonnet-5'

/**
 * A cap, not a target — the tool call itself is tiny. It is generous because
 * the model thinks before answering and thinking counts against this: a cap
 * hit mid-thought returns no tool block at all, which this file can only read
 * as a failed response, discarding a whole batch's clustering.
 */
const MAX_TOKENS = 16_000

/**
 * The import is synchronous and a seller is watching it. The SDK's default is
 * ten minutes, which on a hung connection would hold the request open long
 * past the point where the seller has given up and reloaded.
 */
const TIMEOUT_MS = 120_000

/** The 400px webp already on disk, and the id of the photo it is a copy of. */
export type ClusterPhoto = { id: string; webp: Buffer }

const CLUSTER_TOOL: Anthropic.Tool = {
  name: 'return_groups',
  description: 'Return the grouping of the photographs, one group per physical object.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      groups: {
        type: 'array',
        description:
          'One entry per object being sold, holding the indices of the images that show it. Every image index appears exactly once across all groups.',
        items: { type: 'array', items: { type: 'integer' } },
      },
    },
    required: ['groups'],
    additionalProperties: false,
  },
}

const CAPTION_TOOL: Anthropic.Tool = {
  name: 'return_listing',
  description: 'Return the Hebrew listing for the item shown in the photographs.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      headline: { type: 'string', description: 'A short Hebrew noun phrase naming the object.' },
      description: { type: 'string', description: 'Two or three Hebrew sentences, including any visible flaw.' },
      category: {
        type: 'string',
        description: 'One of the supplied category names, copied verbatim, or an empty string if none fits.',
      },
    },
    required: ['headline', 'description', 'category'],
    additionalProperties: false,
  },
}

/** Whether the feature is configured at all. Read live: a caller may check between requests. */
export function aiEnabled(): boolean {
  return apiKey() !== ''
}

function apiKey(): string {
  return (process.env.ANTHROPIC_API_KEY ?? '').trim()
}

/**
 * Built per call rather than once at module load, so that `aiEnabled()` and
 * the client cannot disagree about a key that changed, and so that importing
 * this module is free for the buyer-facing pages that never call it.
 *
 * The key is passed explicitly. Left to itself the SDK would also accept a
 * logged-in CLI profile from the machine's home directory, which would make
 * the feature quietly live on a developer's laptop while `aiEnabled()` — the
 * thing the UI shows the seller — said it was off.
 */
function client(): Anthropic | null {
  const key = apiKey()
  if (key === '') return null
  return new Anthropic({ apiKey: key, timeout: TIMEOUT_MS })
}

function imageBlock(webp: Buffer): Anthropic.ImageBlockParam {
  return { type: 'image', source: { type: 'base64', media_type: 'image/webp', data: webp.toString('base64') } }
}

/** The arguments of the named tool call, or undefined if the model did not make one. */
function toolInput(message: Anthropic.Message, name: string): unknown {
  for (const block of message.content) {
    if (block.type === 'tool_use' && block.name === name) return block.input
  }
  return undefined
}

/**
 * Which of the three failures an SDK error is. Spec §7.4: credit exhaustion
 * is its own outcome, because it is latched for the batch while a network
 * error is not.
 *
 * Duck-typed on `status` rather than `instanceof Anthropic.APIError`, so that
 * a test can express an error shape without constructing SDK internals — the
 * SDK is mocked in every test that reaches this. Verified against
 * @anthropic-ai/sdk 0.124.0: `APIError.generate` sets `status` from the HTTP
 * code, folds the response body into `message`, and leaves `status` undefined
 * on APIConnectionError, which lands here as FAILED.
 *
 * A 429 is rate limiting as often as it is a spent quota, and this calls both
 * OUT_OF_CREDIT — spec §7.4's table says so. The cost of being wrong is one
 * import that says "no credit" when it meant "too fast"; the seller keeps
 * every photo either way, and the next import tries again.
 */
function classify(err: unknown): AiFailure {
  const status = (err as { status?: number } | null | undefined)?.status
  if (status === 429) return 'OUT_OF_CREDIT'
  const text = errorText(err).toLowerCase()
  if (status === 400 && (text.includes('credit') || text.includes('quota') || text.includes('billing'))) {
    return 'OUT_OF_CREDIT'
  }
  return 'FAILED'
}

/**
 * Both places the API's own wording can be. `message` carries the whole
 * serialised body today; `error` is the parsed body, and is where the wording
 * would still be if that ever stopped being true.
 */
function errorText(err: unknown): string {
  const e = err as { message?: unknown; error?: { error?: { message?: unknown } } } | null | undefined
  const parts = [e?.message, e?.error?.error?.message]
  return parts.filter((part) => typeof part === 'string').join(' ')
}

/**
 * Groups a batch's photos by the object they show, returning groups of photo
 * **ids**.
 *
 * The single parameter is the whole point of the signature. The model answers
 * in indices into the images it was shown, and `normalizeClusters` cannot
 * tell whether the ids it is given are the same list in the same order — it
 * would happily certify that every photo appears exactly once while every
 * index addressed the wrong one, and every seller would get every photo on
 * the wrong product with nothing in the output to notice it. So the image
 * blocks and the ids are both derived here, from `photos`, and no index ever
 * leaves this function.
 *
 * Never throws. `FAILED` covers both a call that errored and a response that
 * did not account for the photos; either way the caller falls back to
 * capture-time grouping (spec §7.4).
 */
export async function clusterPhotos(photos: ClusterPhoto[]): Promise<AiResult<string[][]>> {
  const anthropic = client()
  if (anthropic === null) return { ok: false, reason: 'NO_KEY' }
  // Not a failure and not worth a call: no photos is a grouping of no groups.
  if (photos.length === 0) return { ok: true, value: [] }

  let raw: unknown
  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: CLUSTER_SYSTEM,
      tools: [CLUSTER_TOOL],
      tool_choice: { type: 'tool', name: CLUSTER_TOOL.name },
      messages: [
        {
          role: 'user',
          // The images carry their own numbering: index i is photos[i], which
          // is the correspondence the prompt promises ("in the order given").
          content: [
            ...photos.map((photo) => imageBlock(photo.webp)),
            { type: 'text', text: clusterUser(photos.length) },
          ],
        },
      ],
    })
    raw = (toolInput(message, CLUSTER_TOOL.name) as { groups?: unknown } | undefined)?.groups
  } catch (err) {
    return { ok: false, reason: classify(err) }
  }

  const groups = normalizeClusters(
    raw,
    photos.map((photo) => photo.id),
  )
  if (groups === null) {
    // A rejection is otherwise silent: the batch falls back to capture-time
    // grouping and the seller is told only that copy was not generated. A
    // prompt or model change that started tripping this would degrade every
    // import from then on with nothing anywhere to look at.
    console.error('[ai] clustering response rejected:', JSON.stringify(raw))
    return { ok: false, reason: 'FAILED' }
  }
  return { ok: true, value: groups }
}

/**
 * Writes the Hebrew headline and description for one item, and picks its
 * category from the seller's own list.
 *
 * `category` comes back as `''` unless the model returned one of `categories`
 * verbatim (spec §3.5) — an invented category is not an error, it is simply
 * no category, and the caller's carried-forward default takes over.
 */
export async function captionItem(images: Buffer[], categories: string[]): Promise<AiResult<Caption>> {
  const anthropic = client()
  if (anthropic === null) return { ok: false, reason: 'NO_KEY' }
  // Nothing to look at, so nothing to say. The caller's handling of a failed
  // caption — an empty name and description — is already the right outcome.
  if (images.length === 0) return { ok: false, reason: 'FAILED' }

  let raw: unknown
  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: CAPTION_SYSTEM,
      tools: [CAPTION_TOOL],
      tool_choice: { type: 'tool', name: CAPTION_TOOL.name },
      messages: [
        {
          role: 'user',
          content: [...images.map(imageBlock), { type: 'text', text: captionUser(categories) }],
        },
      ],
    })
    raw = toolInput(message, CAPTION_TOOL.name)
  } catch (err) {
    return { ok: false, reason: classify(err) }
  }

  const listing = raw as { headline?: unknown; description?: unknown; category?: unknown } | null | undefined
  if (typeof listing?.headline !== 'string' || typeof listing.description !== 'string') {
    console.error('[ai] caption response rejected:', JSON.stringify(raw))
    return { ok: false, reason: 'FAILED' }
  }

  const category = typeof listing.category === 'string' ? listing.category.trim() : ''
  return {
    ok: true,
    value: {
      headline: listing.headline.trim(),
      description: listing.description.trim(),
      category: categories.includes(category) ? category : '',
    },
  }
}
