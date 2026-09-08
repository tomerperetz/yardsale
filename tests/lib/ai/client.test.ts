import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The SDK is mocked here and nowhere else, because `src/lib/ai/client.ts` is
 * the only file that imports it (spec §9). No test in this project may reach
 * the real API: the product owner pays for every call.
 */
const { create, constructed } = vi.hoisted(() => ({ create: vi.fn(), constructed: [] as unknown[] }))

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create }
    constructor(options: unknown) {
      constructed.push(options)
    }
  },
}))

import { aiEnabled, captionItem, clusterPhotos } from '@/lib/ai/client'
import { CAPTION_SYSTEM, CLUSTER_SYSTEM } from '@/lib/ai/prompts'

const photo = (id: string, bytes: string) => ({ id, webp: Buffer.from(bytes) })

const toolCall = (name: string, input: unknown) => ({ content: [{ type: 'tool_use', id: 'toolu_1', name, input }] })
const groupsCall = (groups: unknown) => toolCall('return_groups', { groups })
const listingCall = (input: unknown) => toolCall('return_listing', input)

/** The one request the mocked SDK was asked to make. */
const request = () => create.mock.calls[0][0]
const userContent = () => request().messages[0].content as { type: string; text?: string; source?: { data: string } }[]

const apiError = (status: number | undefined, message: string, body?: unknown) =>
  Object.assign(new Error(message), { status, error: body })

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = 'test-key'
  create.mockReset()
  constructed.length = 0
})

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY
  vi.restoreAllMocks()
})

describe('aiEnabled', () => {
  it('is on when a key is configured', () => {
    expect(aiEnabled()).toBe(true)
  })

  it('is off when the key is unset, so the app boots and the import degrades', () => {
    delete process.env.ANTHROPIC_API_KEY
    expect(aiEnabled()).toBe(false)
  })

  it('is off for a blank key, which is what .env.example ships', () => {
    process.env.ANTHROPIC_API_KEY = '   '
    expect(aiEnabled()).toBe(false)
  })
})

describe('clusterPhotos', () => {
  it('reports NO_KEY without calling the API', async () => {
    delete process.env.ANTHROPIC_API_KEY
    expect(await clusterPhotos([photo('a', 'x')])).toEqual({ ok: false, reason: 'NO_KEY' })
    expect(create).not.toHaveBeenCalled()
  })

  it('returns groups of photo ids, never the indices the model answered in', async () => {
    create.mockResolvedValue(groupsCall([[1, 0], [2]]))
    const result = await clusterPhotos([photo('a', 'A'), photo('b', 'B'), photo('c', 'C')])
    expect(result).toEqual({ ok: true, value: [['b', 'a'], ['c']] })
  })

  /**
   * The failure this signature exists to prevent: if the array the image
   * blocks are built from were ever a different ordering from the ids the
   * response is resolved against, every index would address the wrong photo
   * while the accounting invariant stayed perfectly satisfied. Nothing
   * downstream can catch that, so it is pinned here, at the boundary.
   */
  it('sends one image block per photo in the given order, so index i is photo i', async () => {
    create.mockResolvedValue(groupsCall([[0], [1], [2]]))
    const photos = [photo('a', 'first'), photo('b', 'second'), photo('c', 'third')]
    await clusterPhotos(photos)

    const content = userContent()
    expect(content).toHaveLength(4)
    photos.forEach((p, index) => {
      expect(content[index]).toEqual({
        type: 'image',
        source: { type: 'base64', media_type: 'image/webp', data: p.webp.toString('base64') },
      })
    })
    expect(content[3].type).toBe('text')
    expect(content[3].text).toContain('Here are 3 photographs, numbered 0 to 2')
  })

  /**
   * The same failure again, with time as the gap instead of the code path.
   * `photos` belongs to the caller and stays writable while the model thinks,
   * so any derivation left until after the await is a derivation from an
   * array that may no longer be the one the images came from — and, once
   * more, the accounting invariant would hold over the wrong photos.
   */
  it('resolves the response against the photos it sent, even if the caller reorders the array mid-call', async () => {
    const photos = [photo('a', 'AAA'), photo('b', 'BBB'), photo('c', 'CCC')]
    create.mockImplementation(async () => {
      await Promise.resolve()
      photos.reverse()
      return groupsCall([[0], [1], [2]])
    })

    const result = await clusterPhotos(photos)

    const content = userContent()
    expect(content[0].source?.data).toBe(Buffer.from('AAA').toString('base64'))
    expect(result).toEqual({ ok: true, value: [['a'], ['b'], ['c']] })
  })

  it('gives a photo the model omitted a group of its own', async () => {
    create.mockResolvedValue(groupsCall([[0]]))
    const result = await clusterPhotos([photo('a', 'A'), photo('b', 'B'), photo('c', 'C')])
    expect(result).toEqual({ ok: true, value: [['a'], ['b'], ['c']] })
  })

  it('reports FAILED and logs the raw response when the grouping is rejected', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    create.mockResolvedValue(groupsCall('all of them'))

    expect(await clusterPhotos([photo('a', 'A')])).toEqual({ ok: false, reason: 'FAILED' })
    // A rejection is silent for the seller — the batch just falls back — so
    // the raw response is the only evidence a prompt regression leaves.
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('clustering response rejected'), '"all of them"')
  })

  it('reports FAILED and logs when the model answered in prose instead of the tool', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    create.mockResolvedValue({ content: [{ type: 'text', text: 'I grouped them by colour.' }] })

    expect(await clusterPhotos([photo('a', 'A')])).toEqual({ ok: false, reason: 'FAILED' })
    expect(logged).toHaveBeenCalled()
  })

  it('reports OUT_OF_CREDIT for a 400 naming credit', async () => {
    create.mockRejectedValue(apiError(400, 'Your credit balance is too low'))
    expect(await clusterPhotos([photo('a', 'x')])).toEqual({ ok: false, reason: 'OUT_OF_CREDIT' })
  })

  it('reports OUT_OF_CREDIT for the shape @anthropic-ai/sdk actually throws', async () => {
    // Verified against 0.124.0: APIError.generate folds the serialised body
    // into `message` and sets `status` from the HTTP code.
    const body = {
      type: 'error',
      error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' },
    }
    create.mockRejectedValue(apiError(400, `400 ${JSON.stringify(body)}`, body))
    expect(await clusterPhotos([photo('a', 'x')])).toEqual({ ok: false, reason: 'OUT_OF_CREDIT' })
  })

  it('reports OUT_OF_CREDIT when only the parsed body names the money', async () => {
    const body = { type: 'error', error: { type: 'invalid_request_error', message: 'Insufficient credit.' } }
    create.mockRejectedValue(apiError(400, 'Request failed', body))
    expect(await clusterPhotos([photo('a', 'x')])).toEqual({ ok: false, reason: 'OUT_OF_CREDIT' })
  })

  it('reports OUT_OF_CREDIT for a 429', async () => {
    create.mockRejectedValue(apiError(429, 'rate limit'))
    expect(await clusterPhotos([photo('a', 'x')])).toEqual({ ok: false, reason: 'OUT_OF_CREDIT' })
  })

  it('reports FAILED for anything else', async () => {
    create.mockRejectedValue(apiError(500, 'boom'))
    expect(await clusterPhotos([photo('a', 'x')])).toEqual({ ok: false, reason: 'FAILED' })
  })

  it('reports FAILED for a 400 that is not about money', async () => {
    create.mockRejectedValue(apiError(400, 'messages.0.content.0.image: image does not match media_type'))
    expect(await clusterPhotos([photo('a', 'x')])).toEqual({ ok: false, reason: 'FAILED' })
  })

  it('reports FAILED for a connection error, which carries no status', async () => {
    create.mockRejectedValue(apiError(undefined, 'Connection error.'))
    expect(await clusterPhotos([photo('a', 'x')])).toEqual({ ok: false, reason: 'FAILED' })
  })

  it('groups an empty batch without a call — no photos is a grouping, not a failure', async () => {
    expect(await clusterPhotos([])).toEqual({ ok: true, value: [] })
    expect(create).not.toHaveBeenCalled()
  })

  it('asks the pinned model for the tool whose arguments it then reads', async () => {
    create.mockResolvedValue(groupsCall([[0]]))
    await clusterPhotos([photo('a', 'A')])

    const sent = request()
    expect(sent.model).toBe('claude-sonnet-5')
    expect(sent.system).toBe(CLUSTER_SYSTEM)
    expect(sent.tools).toHaveLength(1)
    expect(sent.tools[0].name).toBe('return_groups')
    expect(sent.tool_choice).toEqual({ type: 'tool', name: 'return_groups' })
  })

  it('passes the configured key, so an ambient CLI login cannot turn the feature on', async () => {
    create.mockResolvedValue(groupsCall([[0]]))
    await clusterPhotos([photo('a', 'A')])
    expect(constructed[0]).toMatchObject({ apiKey: 'test-key' })
  })
})

describe('captionItem', () => {
  it('reports NO_KEY without calling the API', async () => {
    delete process.env.ANTHROPIC_API_KEY
    expect(await captionItem([Buffer.from('x')], ['ריהוט'])).toEqual({ ok: false, reason: 'NO_KEY' })
    expect(create).not.toHaveBeenCalled()
  })

  it('falls back to an empty category when the model returns one not on the list', async () => {
    create.mockResolvedValue(listingCall({ headline: 'ספה', description: 'בד אפור.', category: 'לא קיים' }))
    const result = await captionItem([Buffer.from('x')], ['ריהוט'])
    expect(result).toEqual({ ok: true, value: { headline: 'ספה', description: 'בד אפור.', category: '' } })
  })

  it('keeps a category the seller actually has, verbatim', async () => {
    create.mockResolvedValue(listingCall({ headline: 'ספה', description: 'בד אפור.', category: 'ריהוט' }))
    const result = await captionItem([Buffer.from('x')], ['ריהוט', 'מטבח'])
    expect(result).toEqual({ ok: true, value: { headline: 'ספה', description: 'בד אפור.', category: 'ריהוט' } })
  })

  it('checks the category against the list it offered the model, not a list changed mid-call', async () => {
    const categories = ['ריהוט']
    create.mockImplementation(async () => {
      await Promise.resolve()
      categories[0] = 'מטבח'
      return listingCall({ headline: 'ספה', description: 'בד אפור.', category: 'ריהוט' })
    })

    const result = await captionItem([Buffer.from('x')], categories)
    expect(result).toEqual({ ok: true, value: { headline: 'ספה', description: 'בד אפור.', category: 'ריהוט' } })
  })

  it('trims the copy, so stray whitespace never reaches the item name', async () => {
    create.mockResolvedValue(listingCall({ headline: '  ספה  ', description: '\nבד אפור.\n', category: ' ריהוט ' }))
    const result = await captionItem([Buffer.from('x')], ['ריהוט'])
    expect(result).toEqual({ ok: true, value: { headline: 'ספה', description: 'בד אפור.', category: 'ריהוט' } })
  })

  it('reports FAILED when the response is not a listing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    create.mockResolvedValue(listingCall({ headline: 42, description: 'בד אפור.', category: '' }))
    expect(await captionItem([Buffer.from('x')], ['ריהוט'])).toEqual({ ok: false, reason: 'FAILED' })
  })

  it('reports FAILED without a call when the item has no photographs', async () => {
    expect(await captionItem([], ['ריהוט'])).toEqual({ ok: false, reason: 'FAILED' })
    expect(create).not.toHaveBeenCalled()
  })

  it('shows the model every photo of the item and names the seller categories', async () => {
    create.mockResolvedValue(listingCall({ headline: 'ספה', description: 'בד אפור.', category: '' }))
    await captionItem([Buffer.from('one'), Buffer.from('two')], ['ריהוט', 'מטבח'])

    const sent = request()
    expect(sent.system).toBe(CAPTION_SYSTEM)
    expect(sent.tool_choice).toEqual({ type: 'tool', name: 'return_listing' })

    const content = userContent()
    expect(content.map((block) => block.type)).toEqual(['image', 'image', 'text'])
    expect(content[2].text).toContain('Categories to choose from: ריהוט, מטבח')
  })

  it('reports OUT_OF_CREDIT for a 429, the same as clustering', async () => {
    create.mockRejectedValue(apiError(429, 'rate limit'))
    expect(await captionItem([Buffer.from('x')], ['ריהוט'])).toEqual({ ok: false, reason: 'OUT_OF_CREDIT' })
  })
})
