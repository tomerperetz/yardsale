# AI photo import — clustering, Hebrew copy, and bulk edit

**Status:** approved, ready for an implementation plan
**Supersedes:** nothing. Extends `2026-09-06-yardsale-design.md` §8 (`/admin/items` — bulk queue).
**Depends on:** the shipped shop at `main`.

The seller drops a pile of photos from one afternoon of shooting. Some are the
object in the house, some are Google screenshots kept as a price note. Today
they are grouped by EXIF capture time and the seller types a name for each
group, one at a time. This replaces that with vision clustering and generated
Hebrew copy, and gives the seller a review screen where corrections are cheap:
move a photo to the right product, edit a headline, select six items and set
one pickup window across all of them.

---

## 1. Goals

1. Group a batch of photos by **what is in them**, not when they were taken, so
   a Google reference shot of a sofa lands with that sofa's own photos.
2. Write a Hebrew headline and description for each group.
3. Leave **price and pickup dates entirely to the seller**, and make setting
   them across many items at once a single action.
4. Let the seller correct clustering per photo: remove a photo, or move it to a
   different product.
5. Degrade to something useful when the API key is absent or the API fails.

## 2. Non-goals

- **No reference-photo detection.** A Google screenshot is an ordinary photo.
  It may become an item's cover image; the seller fixes that with the photo
  controls. Decided explicitly — see §3.1.
- **No price suggestion**, from reference images or anything else. The seller
  types every price.
- **No brand, model, dimensions or age** in generated copy unless legible in
  the photo. See §3.2.
- **No background job queue.** The flow is synchronous. See §3.3.
- No re-clustering of items that already exist outside the current batch.
- No change to the buyer-facing shop beyond photo URLs (§5).

## 3. Decisions

These were settled with the product owner before design. They are binding; an
implementer who thinks one is wrong should raise it rather than reinterpret it.

### 3.1 Reference photos are ordinary photos

No AI judgement about which photos are "real". The clustering pass still groups
a reference shot with the product it depicts — that is the point — but nothing
is hidden, dropped, or flagged. The seller controls placement and cover image
through the per-photo controls in §7.

### 3.2 Copy claims only what is visible

The caption pass describes the type of object, colour, material, and visible
condition or wear. It must not state brand, model, dimensions, age, or original
price unless that text is legible in the image. Rationale: a buyer arriving at
the door should find what the listing said.

### 3.3 Synchronous, capped at 60 photos per import

Expected volume is 20–60 photos per drop. One clustering call plus parallel
caption calls finishes well inside a minute, so there is no job table, no
polling, and no resumable background work. Imports over 60 photos are rejected
with a Hebrew message telling the seller to split the drop.

### 3.4 Items are created before review, not on publish

Clustering creates DRAFT items immediately. Closing the tab loses nothing, and
photos have a home. The cost is draft rows if an import is abandoned; §7's
"discard batch" removes them, and drafts are already invisible to buyers.

### 3.5 Claude assigns the category from the existing set

The caption pass receives the seller's current category names and must return
one of them verbatim, or the empty string when none fits. It never invents a
category. When it returns empty, the item takes the carried-forward default.
The seller can bulk-override (§7). Rationale: categories are a closed set the
seller already curates, so this is a classification, not a creative act.

### 3.6 Two Claude passes, not one

Clustering and captioning are separate calls. The seller will correct clusters;
after moving a photo, only that one item's copy needs regenerating. One
combined call would waste captions on groups that are about to change.

---

## 4. Architecture

```
drop  ──►  POST /api/import        ──►  Photo rows, no item, batchId
                                        (sharp: 3 widths + lqip, as today)
           clusterBatch(batchId)   ──►  pass 1: cluster  ──► DRAFT Items
                                        pass 2: caption  ──► name, description,
                                                             category
           /admin/items/import/[batchId]
                                   ──►  review, correct, bulk edit, publish
```

Nothing here touches the buyer-facing shop except photo URLs.

### Why photos become item-independent

Photos are stored today under the item that owns them
(`<UPLOAD_DIR>/<itemId>/<photoId>-<width>.webp`, served as
`/img/<itemId>/<file>`). Clustering cannot work that way: Claude must see the
photos to decide which product they belong to, but a photo cannot be stored
without already knowing its product.

Moving a photo between products — a core requirement, not an edge case — would
also mean moving files on disk on every correction, a multi-step operation that
can fail halfway and leave a `Photo` row pointing at a file that is not there.
That failure renders as a broken image in the shop rather than failing loudly.

So storage becomes keyed by photo. Reassignment is then one `UPDATE` with no
file I/O and nothing to half-fail.

---

## 5. Data model changes

```prisma
model Photo {
  id            String   @id @default(cuid())
  itemId        String?  // nullable: uploaded photos have no product yet
  item          Item?    @relation(fields: [itemId], references: [id], onDelete: Cascade)
  importBatchId String?  // groups one drop; null for photos added the old way
  width         Int
  height        Int
  lqip          String
  position      Int      @default(0)
  takenAt       DateTime?

  @@index([itemId, position])
  @@index([importBatchId])
}

model Item {
  // ... unchanged ...
  importBatchId String?

  @@index([importBatchId])
}
```

No `ImportBatch` table. The batch id is a cuid the server mints; the flow is
synchronous and nothing needs batch-level state.

**Migration:** one Prisma migration making `Photo.itemId` nullable and adding
the two columns and indexes. It alters no existing row's data.

**Storage migration:** a one-shot `scripts/migrate-photo-layout.ts` that walks
every `Photo` and moves its files from `<itemId>/<photoId>-<width>.webp` to
`<photoId>/<width>.webp`. It must be idempotent (safe to re-run), must not
delete a source file until the destination exists, and must report any photo
whose files are already missing rather than throwing. Production holds no
photos today; it will by the time this ships.

---

## 6. Storage and URL layout

| | Before | After |
| --- | --- | --- |
| Disk | `<UPLOAD_DIR>/<itemId>/<photoId>-<width>.webp` | `<UPLOAD_DIR>/<photoId>/<width>.webp` |
| URL | `/img/<itemId>/<photoId>-400.webp` | `/img/<photoId>/400.webp` |
| Builder | `photoUrl(itemId, photoId, width)` | `photoUrl(photoId, width)` |
| Filename | `photoFilename(photoId, width)` | `photoFilename(width)` |

`WIDTHS`, `MAX_BYTES`, `MAX_PHOTOS_PER_ITEM` and `MAX_REQUEST_BYTES` stay in
`src/lib/photo-url.ts` and keep their values. The route moves from
`src/app/img/[itemId]/[file]/route.ts` to `src/app/img/[photoId]/[file]/route.ts`,
and its filename regex tightens to exactly `^(400|800|1600)\.webp$`.

Every caller of `photoUrl` or `photoFilename`, enumerated from the tree so none
is missed:

`src/lib/images.ts`, `src/lib/photo-url.ts`, `src/app/api/upload/route.ts`,
`src/app/admin/items/page.tsx`, `src/app/admin/orders/page.tsx`,
`src/app/cart/actions.ts`, `src/app/cart/page.tsx`,
`src/app/checkout/page.tsx`, `src/app/o/[token]/page.tsx`,
`src/components/ItemCard.tsx`, `src/components/ItemDetail.tsx`,
`src/components/admin/PhotoDrop.tsx`, plus the tests
`tests/lib/images.test.ts` and `tests/lib/photo-url.test.ts`.

`src/components/admin/BulkQueue.tsx` imports the limits but not the URL
builders; it still needs review because the import flow replaces its grouping
stage.

### The per-item photo cap does not apply to a cluster

`MAX_PHOTOS_PER_ITEM` (10) bounds what the manual `PhotoDrop` will attach to
one item, and `/api/upload` enforces it. A cluster is different: a seller who
took twelve shots of one sofa must not have two of them silently dropped or
split into a phantom second item. The import path bounds the **batch** (60,
§3.3) and places no cap on a single cluster. `/api/upload` and `PhotoDrop` keep
their existing cap unchanged.

---

## 7. The import flow

### 7.1 `POST /api/import`

Multipart.

**Rate limiting** uses a new `import` namespace, added to `GLOBAL_CEILINGS` in
`src/lib/rate-limit.ts` with a ceiling of `60`. That file's existing namespaces
are `login`, `checkout` and `default`, and `bucketFor` silently routes an
unknown name to `default` rather than failing — so passing a namespace that was
never declared looks like it works while quietly sharing another feature's
budget. The namespace must be declared in the same change that uses it.

**The route must ship guarded.** Authentication comes from `src/middleware.ts`,
whose matcher is currently `['/admin/:path*', '/api/upload']` — a literal list,
so `/api/import` is unauthenticated until it is added there. Adding it belongs
in the same task that creates the route, never a later one: an unguarded upload
endpoint lets anyone on the internet write files to the seller's disk.

1. Reject a batch of more than **60** files with `יותר מדי תמונות בבת אחת. אפשר עד 60.`
2. Each file goes through the existing sharp pipeline: three widths plus lqip,
   HEIC handled exactly as today (§`A note on photos and HEIC` in the README).
3. Insert `Photo` rows with `importBatchId` set and `itemId` null.
4. Respond `{ batchId, photos: [{ id, lqip, width, height }], errors: [...] }`
   so the client renders thumbnails before clustering starts.

Per-file failures are reported per file and do not fail the batch, as today.

### The client uploads in chunks

A sixty-photo drop is not one request. `request.formData()` buffers the entire
multipart body before any per-file check can run, so a single request carrying
sixty phone photos means a quarter of a gigabyte resident at once — plus sharp's
working memory per photo — on a container whose memory limit is not ours to
assume. An OOM kill there costs the seller the whole drop, and many platforms
independently cap request bodies well below that.

So the client posts **6 photos per request**. Worst case per request is
6 × `MAX_BYTES` = 72 MB, typical is nearer 24 MB.

- The first request carries no batch id and the response mints one.
- Every subsequent request sends that batch id and its photos join it.
- A request that fails takes its six photos with it, not the batch: the client
  reports which failed and the rest stand.

Three things follow, and all three are wins rather than costs. Memory is
bounded regardless of drop size or container. The seller sees photos land as
they go instead of watching one long silence. And a dropped connection costs
one chunk rather than everything.

The per-key rate limit must therefore be **per namespace**, not module-wide:
one drop is now up to ten requests, and the shared 10-per-15-minutes budget
would refuse the seller's second import of the day.

### 7.2 `clusterBatch(batchId)` — server action

1. Load the batch's photos. If none, return an error.
2. **Pass 1 — cluster.** One call, all photos at width 400, each labelled with
   its index. Returns groups of indices only.
3. **Validate the response** (§8). Every photo lands in exactly one group.
4. Create one DRAFT `Item` per group, carrying `importBatchId`, with:
   - `name` — a placeholder until pass 2 returns
   - `priceAgorot` 0
   - `categoryId` — the carried-forward default (last item's category)
   - `pickupFrom` / `pickupTo` — the carried-forward window
   - `slug` — from the placeholder name; drafts regenerate their slug on save,
     so editing the headline before publishing updates the URL, and it freezes
     on publish. No new slug logic.
5. Assign each group's photos: set `itemId` and `position` in group order.
6. **Pass 2 — caption.** One call per item, in parallel, each receiving that
   item's photos and the seller's category names. Returns
   `{ headline, description, category }`. Apply to the item.
7. Return the items for rendering.

### 7.3 `/admin/items/import/[batchId]` — the review screen

Per item, a card showing:

- the photo strip, first photo first
- editable **headline** and **description**
- **price** input, **category** control, **pickup window** inputs
- a selection checkbox

Per photo, two controls:

- **remove** — deletes the `Photo` row and its files
- **move to…** — a menu of the other items in this batch, plus *new item*

Bulk bar over the selected items:

- set **pickup dates**
- set **category**
- set **price**
- **publish** the selection
- **discard** the selection (deletes the items and their photos)

### Discarding the batch, not just its items

Selection-based discard is keyed by item, and that is not enough. Between
`/api/import` writing photos and `clusterBatch` attaching them, a photo belongs
to no item at all. If clustering hard-fails, or the seller closes the tab in
that window, those rows and their files persist with nothing item-keyed able to
reach them — a leak that grows with every abandoned import and that no screen
can show.

So the review screen also offers **discard the whole import**, backed by
`discardBatch(batchId)`, which deletes the batch's items, the batch's photos
whether or not they were ever attached, and their files. `@@index([importBatchId])`
makes it a single indexed sweep.

`importBatchId` is **provenance and is never cleared** once a photo is
attached — it records which drop a photo arrived in. Anything meaning "not yet
assigned to a product" must therefore say `itemId: null` explicitly rather than
relying on the batch id alone.

Publishing runs the existing `updateItem` path so validation is unchanged: an
item with no price or no name is refused with the message it already has.

### 7.4 Degradation

| Condition | Behaviour |
| --- | --- |
| `ANTHROPIC_API_KEY` unset | The bulk tab says the feature is off and falls back to today's EXIF grouping. No call attempted. |
| **Credit or quota exhausted** | See below — treated as its own case, not a generic error. |
| Clustering call fails or is invalid | Fall back to `groupByCaptureTime`, create items, skip captions, tell the seller copy was not generated. |
| One caption call fails | That item gets an empty name and description. Other items unaffected. |
| A photo has no group after validation | It becomes its own single-photo item. |

### Running out of credit

The account behind `ANTHROPIC_API_KEY` will eventually hit a spending limit or
run dry, and it will do so without warning, mid-import. This must not look like
a crash and must not cost the seller their upload.

The API signals it distinctly — HTTP `400` with an `invalid_request_error`
whose message names credit, or HTTP `429` for rate/quota. The client in
`src/lib/ai/` classifies these into a single `OUT_OF_CREDIT` outcome, separate
from network errors and malformed responses, and:

1. The **photos are already uploaded and keep their batch** — nothing is lost.
2. Clustering falls back to `groupByCaptureTime`, so the seller still gets
   items and still reaches the review screen with every photo accounted for.
3. Captions are skipped entirely rather than attempted per item — sixty
   doomed calls in a row is the wrong way to discover a dead key.
4. The review screen shows one plain Hebrew message saying automatic naming is
   unavailable because the AI account has no credit, and that everything else
   works normally.
5. Nothing retries automatically.

Once a batch has seen `OUT_OF_CREDIT`, no further calls are made for that
batch. This is a per-batch latch, not a global one — a topped-up key works on
the next import with no restart.

The shop must never be blocked by this feature. Nothing here runs on a
buyer-facing path.

---

## 8. Validating the clustering response

The single most likely production failure is a well-formed-looking response
that mis-accounts for photos. The validator takes the model's groups and the
batch's photo ids and must guarantee:

- every photo id appears in **exactly one** output group
- an index repeated across groups is kept in the first and dropped from the rest
- an index outside `0..n-1` is discarded
- any photo the model omitted becomes its own single-photo group
- a group that ends up empty is dropped
- malformed JSON, or a response that is not an array of arrays of integers,
  is treated as total failure and triggers the EXIF fallback

This is pure logic over ids, with no I/O, so it is unit-tested directly and
exhaustively.

---

## 9. Claude usage

- SDK: `@anthropic-ai/sdk`
- Model: `claude-sonnet-5` for both passes
- Key: `ANTHROPIC_API_KEY`, server-only, never sent to the browser
- Images: the 400px webp variants already generated, base64 in the request
- Structured output: both passes use a tool schema so the response shape is
  enforced rather than parsed out of prose
- The client lives in `src/lib/ai/` behind a narrow interface
  (`clusterPhotos`, `captionItem`) so every consumer and every test mocks one
  seam. No component or route calls the SDK directly.

Caption prompt requirements (binding):

- Hebrew only
- headline: a short noun phrase naming the object, no marketing language
- description: two to three sentences, including visible flaws
- category: exactly one of the supplied names, or `""`
- state nothing not visible in the photos (§3.2)

---

## 10. Testing

**Unit**
- `photoUrl` / `photoFilename` / disk-path helpers under the new layout
- the clustering validator, against: repeated indices, out-of-range indices,
  omitted photos, empty groups, non-array responses, malformed JSON
- the caption response parser, including a category not in the supplied set
  (must fall back to `""`)

**Database**
- photo reassignment moves `itemId` and leaves files untouched
- removing a photo deletes its row and its files
- discarding a batch deletes its items and photos
- bulk edit applies to exactly the selected items and no others
- publishing a selection refuses items with no price, and publishes the rest

**End-to-end**
- with a stubbed clustering response: drop photos → review screen → move a
  photo between items → bulk-set dates → publish → items appear in the shop
  with the right photos

**Contract**
- one test that the AI client sends images and parses a well-formed response.
  Everything else mocks `src/lib/ai/`.
- `OUT_OF_CREDIT` classification, driven from recorded error shapes: a 400
  `invalid_request_error` naming credit, and a 429. Both must produce the
  latched fallback of §7.4, not a generic failure.

**Prompt quality, without spending API credit**

The two prompts are the part most likely to be quietly bad — a clustering
prompt that splits one sofa across two groups, or a caption prompt that writes
stilted Hebrew or states things it cannot see. Neither is caught by a mocked
test, because the mock returns whatever the test author expected.

So the prompts are exercised against a **subagent standing in for the API**:
the exact system and user prompt the client would send, with real photographs,
answered by a model rather than a fixture. What that run is checking:

- clustering: does one object's photos come back as one group, and do two
  similar objects stay apart
- captions: is the Hebrew natural, is the headline a noun phrase rather than
  marketing copy, does the description mention visible flaws, and does the
  category come back verbatim from the supplied set
- does the response satisfy §8's validator without special pleading

Findings feed back into the prompt text. The fixtures recorded from these runs
then become the mocked responses used by the automated tests, so the suite is
checking behaviour against output a model actually produced rather than output
we imagined it would produce.

**Regression**
- the existing suite must stay green through the storage change. The photo URL
  change touches the buyer-facing grid, item page and cart, all of which have
  coverage today.

---

## 11. Environment

| Variable | Required | Notes |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | no | Absent disables the feature (§7.4), it does not stop the app booting. Not added to the `src/instrumentation.ts` required list. |

`.env.example` and the README's Railway section gain the variable with that
explanation.
