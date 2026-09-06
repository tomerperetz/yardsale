# Single-seller yard sale shop

**Date:** 2026-09-06
**Status:** Design approved, ready for implementation planning

A Hebrew (RTL) web shop for one seller to clear out a household: one person uploads
used items with photos, many buyers browse, filter, fill a cart, reserve, pay by BIT
transfer, and collect in person. Deployed as a single Railway service.

---

## 1. Goals

- The seller can photograph and list ~40 items in one sitting without the tool
  getting in the way.
- A buyer on a phone can find things, understand the price and the pickup window,
  and reserve in under a minute, with no account.
- Two buyers can never be sold the same object.
- The seller always knows which orders need action, and can reach any buyer in one tap.

## 2. Non-goals

Explicitly out of scope. Each is a deliberate exclusion, not an oversight:

- Buyer accounts, login, or order history.
- Shipping or delivery. Everything is collected in person.
- Offers, haggling, or auctions. Prices are fixed.
- Quantity greater than 1. Every listing is one unique object; a set of six chairs
  is listed as one lot or as six listings.
- Automated payment verification. BIT has no merchant API for a private seller, so
  the seller confirms every payment by eye.
- Email and SMS. Notification is the admin badge plus a WhatsApp deep link.
- Free-text search. Filtering is by category and price only.
- Any language other than Hebrew, and any currency other than ILS.
- Multiple sellers.
- Analytics.

## 3. Decisions

| Area | Decision |
| --- | --- |
| Stack | Next.js (App Router) + TypeScript + Postgres + Prisma, one service |
| Payment | Reserve → buyer declares paid → seller confirms. BIT number, exact amount and a payment code shown to the buyer |
| Contention | Cart is a local wishlist; items lock only at checkout; first checkout wins |
| Hold | Two-stage. 15 minutes of silence releases the items; once the buyer taps שילמתי בביט the clock stops and the order waits for the seller indefinitely |
| Buyer auth | None. Name + phone at checkout |
| Admin auth | Single password from env, argon2id hash, signed httpOnly session cookie, rate-limited |
| Images | Railway persistent volume at `/data`, re-encoded to WebP at three widths |
| Pickup | Per-item date range; one pickup day + slot chosen at checkout inside the intersection of the cart's ranges |
| Pickup slots | Three named slots — בוקר / אחה״צ / ערב — with hour labels editable in settings |
| Categories | Created by typing; offered as chips afterwards; rename and merge in admin |
| Quantity | Always 1 |
| Pricing | Fixed, integer agorot |
| Item detail | Quick-look overlay via an intercepting route, with a real shareable URL |
| Upload | Both a single-item form and a bulk queue |
| Bulk grouping | Photos auto-grouped by EXIF capture time, correctable by hand |
| Sold items | Stay inline in the grid, desaturated, marked נמכר |
| Shop name & address | Not in the spec or the code. Set by the seller in admin settings; the address renders publicly once set |
| Visual direction | "Arc Canonical" — see §11 |

## 4. Architecture

One Next.js application serves everything:

- `/` and the buyer routes — server components, with filter state in `searchParams`
  so filters are shareable and the back button behaves.
- `/admin/*` — password-gated.
- Route handlers for uploads and image serving.

One Railway service, plus the Postgres plugin and one volume mounted at `/data`.
No scheduler, no queue, no object storage, no third-party account.

```
Browser ──► Next.js (single service on Railway)
              ├── buyer routes      ──► Prisma ──► Postgres (Railway plugin)
              ├── /admin routes     ──► Prisma ──► Postgres
              ├── POST /api/upload  ──► sharp ──► /data/uploads/<itemId>/
              └── GET  /img/...     ──► /data/uploads (immutable cache headers)
```

### Why a lazy sweep instead of a cron

Reservations expire after 15 minutes. Rather than run a scheduler, `releaseExpiredHolds()`
runs at the start of every code path that reads or changes item availability: the grid,
the item page, the checkout transaction, and the admin orders page. Under any traffic at
all this is indistinguishable from a cron, and it removes a moving part from the deploy.

## 5. Data model

Prisma, Postgres. Money is integer **agorot** everywhere — never a float, never a decimal
string. Formatting to `₪850` happens only at render time.

```prisma
model Item {
  id          String     @id @default(cuid())
  slug        String     @unique          // see §7; Hebrew name, hyphenated, + 6-char suffix
  name        String
  description String
  priceAgorot Int
  categoryId  String
  category    Category   @relation(fields: [categoryId], references: [id])
  pickupFrom  DateTime   @db.Date
  pickupTo    DateTime   @db.Date
  status      ItemStatus @default(DRAFT)
  sortIndex   Int        @default(0)
  photos      Photo[]
  orderItems  OrderItem[]
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt

  @@index([status, sortIndex])
  @@index([categoryId])
}

model Photo {
  id       String   @id @default(cuid())
  itemId   String
  item     Item     @relation(fields: [itemId], references: [id], onDelete: Cascade)
  width    Int
  height   Int
  lqip     String                          // base64 data URI, ~20 bytes of blur
  position Int      @default(0)
  takenAt  DateTime?                       // EXIF DateTimeOriginal, used for bulk grouping

  @@index([itemId, position])
}

model Category {
  id    String @id @default(cuid())
  name  String @unique
  slug  String @unique
  items Item[]
}

model Order {
  id            String      @id @default(cuid())
  code          String      @unique         // short, human-typeable: "YS-4821"
  token         String      @unique         // 22-char url-safe random, used in URLs
  buyerName     String
  buyerPhone    String
  status        OrderStatus @default(PENDING_PAYMENT)
  pickupDate    DateTime    @db.Date
  pickupSlot    PickupSlot
  totalAgorot   Int
  holdExpiresAt DateTime?                   // null once the buyer declares payment
  claimedAt     DateTime?
  confirmedAt   DateTime?
  cancelledAt   DateTime?
  items         OrderItem[]
  createdAt     DateTime    @default(now())

  @@index([status, createdAt])
}

model OrderItem {
  id          String @id @default(cuid())
  orderId     String
  order       Order  @relation(fields: [orderId], references: [id], onDelete: Cascade)
  itemId      String
  item        Item   @relation(fields: [itemId], references: [id])
  priceAgorot Int                           // snapshot; editing the item never alters a placed order

  @@unique([orderId, itemId])
  @@index([itemId])
}

model Settings {
  id           Int    @id @default(1)       // singleton row, always id = 1
  shopName     String
  tagline      String
  bitPhone     String
  addressLine  String
  city         String
  slotMorning  String                       // e.g. "09:00–12:00"
  slotAfternoon String
  slotEvening  String
  holdMinutes  Int      @default(15)
  dismissedMerges String[] @default([])     // "<idA>:<idB>", ids sorted; see §8
}

enum ItemStatus  { DRAFT AVAILABLE RESERVED SOLD }
enum OrderStatus { PENDING_PAYMENT CLAIMED_PAID PAID EXPIRED CANCELLED }
enum PickupSlot  { MORNING AFTERNOON EVENING }
```

`code` and `token` are separate on purpose. `code` is short because the buyer has to
type it into a BIT transfer note; that makes it guessable, so it must never grant access
to anything. `token` is long and random and is what appears in `/pay/<token>` and `/o/<token>`.

## 6. State machines

### Item

```
DRAFT ──────► AVAILABLE ──────► RESERVED ──────► SOLD
                  ▲                 │
                  └─────────────────┘
                    expiry or cancel
```

### Order

```
                  buyer taps            seller confirms
                שילמתי בביט              payment received
PENDING_PAYMENT ──────────► CLAIMED_PAID ──────────► PAID
      │                          │                     (its items → SOLD)
      │ 15 min of silence        │
      ▼                          │
   EXPIRED                       │
 (items → AVAILABLE)             │
                                 ▼
                            CANCELLED  ◄── seller, from any non-PAID state
                          (items → AVAILABLE)
```

`holdExpiresAt` is set to `now() + Settings.holdMinutes` at checkout and set to `null`
on the transition to `CLAIMED_PAID`. Only `PENDING_PAYMENT` orders are ever swept.

### Reserving atomically

This is the only place concurrency matters, and it is one statement:

```sql
UPDATE items SET status = 'RESERVED'
WHERE id IN (:ids) AND status = 'AVAILABLE'
```

Inside a single transaction: sweep expired holds, run the update, and assert that the
affected row count equals the number of items in the cart. If it is lower, another buyer
got there first — roll back, re-read which of the requested items are no longer
`AVAILABLE`, and return them so the checkout screen can mark exactly those lines as
נמכר and offer to continue with the rest.

## 7. Buyer flows

### `/` — the grid

Server component. Reads `?category=`, `?maxPrice=`, `?sort=` from `searchParams`.
Sticky glass header (shop name, cart with count, ניהול button), a hero carrying the
tagline, address and "תשלום בביט · איסוף עצמי" — each rendered only if set, see §10 —
then a sticky filter bar of category
chips, a max-price slider and a sort select.

Items render as cards: photo, name, two-line description, price, category, pickup window,
and an add-to-cart affordance on hover. Sold items stay in place, desaturated, with a
`נמכר` pill; they are never clickable through to checkout.

Default sort is newest first.

### `/item/[slug]` — quick look

The slug keeps the Hebrew name: whitespace becomes hyphens, anything outside Hebrew
letters, Latin letters, digits and hyphens is dropped, and a 6-character base36 suffix
guarantees uniqueness. Hebrew characters are legal in a URL path and the browser
percent-encodes them, so `/item/ספה-תלת-מושבית-k3f9tq` pastes into WhatsApp as readable
Hebrew and resolves correctly.

An **intercepting route**. Clicked from the grid it opens as an overlay — full photo set
with a thumbnail strip, complete description, pickup window, address, and הוספה לסל —
while the grid stays behind it. Opened directly, or refreshed, or shared into a WhatsApp
group, the same URL renders as a full standalone page.

### `/cart`

Entirely client-side, backed by `localStorage`. Holds item ids; item data is re-fetched
on load so a cart left open overnight shows current availability and prices. Items that
have since sold are shown struck through with a note, and are dropped from the total.

### `/checkout`

Cart lines and total, name, phone, then the pickup picker.

The selectable days are the intersection of every cart item's `[pickupFrom, pickupTo]`,
i.e. `[max(pickupFrom), min(pickupTo)]`, further clamped to exclude days in the past.
Days outside it are rendered struck through and disabled, with a line explaining which
items narrowed the window. If the intersection is empty, the screen names the conflicting
item and offers to split the cart into two orders rather than failing.

Then one slot: בוקר / אחה״צ / ערב, applying to the whole order.

Submitting runs the reservation transaction from §6 and redirects to `/pay/<token>`.

Server-side validation, all of it re-checked regardless of what the client sent:
every item still `AVAILABLE`; `pickupDate` inside the intersection and not in the past;
`pickupSlot` in the enum; name non-empty; phone matching an Israeli mobile pattern.

### `/pay/[token]`

A live countdown to `holdExpiresAt`. The BIT phone number, the exact amount, and the
payment `code`, each with a copy button. Three numbered instructions. A שילמתי בביט
button that transitions the order to `CLAIMED_PAID`, stops the clock, and explains that
the items stay held until the seller confirms.

If the hold has already expired the page says so plainly and links back to the grid.

### `/o/[token]`

Order status for the buyer afterwards: what they bought, the total, the pickup day and
slot, the address, and the current state in Hebrew.

## 8. Admin flows

### `/admin/login`

Password only. Argon2id verify against `ADMIN_PASSWORD_HASH`, constant-time. Rate-limited
per IP — 10 attempts per 15 minutes — then a signed httpOnly, `SameSite=Lax`, `Secure`
session cookie with a 30-day lifetime.

### `/admin/items` — single form

Drag-and-drop photo zone: photos reorderable, the first marked ראשי, each removable.
Name, description, category, price, pickup range. On save the form clears but **carries
forward the category and the pickup range**, because those repeat across a sitting.
Primary action is שמירה והפריט הבא; שמירה כטיוטה leaves the item in `DRAFT`, invisible
to buyers.

### `/admin/items` — bulk queue

Drop many photos at once. In the browser, `exifr` reads `DateTimeOriginal` from each
file; photos are sorted by that timestamp and any two within **30 seconds** of each other
are grouped as one item. Fallbacks, in order: `File.lastModified`; then, if neither is
available, each photo becomes its own group.

The grouping is a proposal, not a commitment — the queue shows each group as a stack and
lets the seller split a group or merge two adjacent groups before anything is written.

Then a filmstrip with done / current markers, a "פריט 13 מתוך 38" counter, and a compact
row asking only for what changes: name, price, category. Category and pickup range carry
forward from the previous item.

### `/admin/orders`

Stat tiles: awaiting your confirmation, awaiting payment, total paid, items sold.
A table of orders — code, buyer, item thumbnails, amount, pickup, status — with tabs for
all / awaiting confirmation / paid / expired. `CLAIMED_PAID` rows are highlighted, since
those are the ones needing action.

Per row: a **וואטסאפ** button (a `wa.me` deep link with a pre-written Hebrew message that
varies by order state), **אישור תשלום** which moves the order to `PAID` and its items to
`SOLD`, and **ביטול** which releases the items.

The sidebar badge counts orders in `CLAIMED_PAID`.

### `/admin/categories`

Every category with its item count, rename, and merge. Merge reassigns every item and
deletes the empty category. Merge suggestions are surfaced when two categories, after
trimming and collapsing whitespace and stripping a leading "ה", are equal, or one contains
the other as a whole word, or they are within an edit distance of 2 — which catches both
"ריהוט" vs "ריהוט לבית" and a plain typo. A suggestion can be applied or dismissed, and a
dismissed pair is not offered again.

### `/admin/settings`

The `Settings` singleton: shop name, tagline, BIT phone, address, city, the three slot
hour labels, and hold minutes.

## 9. Images

Upload → `sharp` → WebP at widths 400, 800 and 1600 (never upscaled past the original) →
`/data/uploads/<itemId>/<photoId>-<width>.webp`. EXIF orientation is applied and then all
metadata is stripped, which also removes GPS coordinates from phone photos. A 20-byte
blur placeholder is stored on the row as `lqip` for a smooth grid load.

Served by a route handler at `/img/<itemId>/<photoId>-<width>.webp` with
`Cache-Control: public, max-age=31536000, immutable` — safe because a `photoId` is never
reused for different content.

Limits: 12 MB per file, 10 photos per item, `image/jpeg|png|webp|heic` only, verified by
sniffing the file's magic bytes rather than trusting the declared MIME type. Deleting an
item deletes its directory.

## 10. Configuration

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Railway Postgres plugin |
| `ADMIN_PASSWORD_HASH` | argon2id hash, produced by `npm run admin:password` |
| `SESSION_SECRET` | signs the admin session cookie |
| `UPLOAD_DIR` | defaults to `/data/uploads` |

`PORT` is supplied by Railway. The app refuses to start if `ADMIN_PASSWORD_HASH` or
`SESSION_SECRET` is missing, rather than booting with an open admin.

Seller-facing values — shop name, tagline, BIT number, address, city — are **not**
environment variables, are **not** seeded with sample content, and appear nowhere in the
codebase. They live in the `Settings` row and exist only once the seller types them into
`/admin/settings`. The seed inserts the row with empty strings.

First-run behaviour follows from that:

- Every one of these fields renders only when non-empty. An unset tagline, address or
  city simply produces no element — never a placeholder, never a fallback string.
- With `shopName` unset the header shows the mark alone.
- **Checkout is blocked while `bitPhone` is unset**, because a buyer would otherwise
  reserve items with no way to pay. The grid stays browsable; the cart says the shop is
  not open for orders yet.
- `/admin` shows a first-run checklist of what is still unset, with `bitPhone` flagged as
  the one that blocks selling.

## 11. Visual direction — "Arc Canonical"

Chosen from three mockups. The approved screens are committed as static HTML in
`docs/design/mockups/` and are the visual reference for implementation —
`01-shop.html`, `02-buyer-flow.html`, `03-admin-items.html`, `04-admin-orders.html`.
The two rejected directions are kept alongside them as `alt-gallery.html` and
`alt-nightfall.html`. Their photos are random `picsum.photos` placeholders and the shop
name, tagline and address in them are illustrative only — those come from settings at
runtime. Only the layout, colour and typography are normative.

- A fixed, warm mesh-gradient ground — peach, lilac, pale sky, low saturation, no hard
  edges — with content floating above it.
- Pure white cards, 26px radii, soft wide shadows. Depth comes from light, never borders.
- Sticky glass header and filter bar (`backdrop-filter: blur(20px) saturate(180%)`).
- Ink `#1B1917`, secondary `#57504A`, tertiary `#8C837B`, accent `#E2593A`.
- Assistant (Google Fonts), weights 300–700, `letter-spacing: -.02em` on headings.
- Low density and generous whitespace; a gentle lift on card hover.
- Sold items recede rather than shout: photo desaturated, card drops its shadow, a dark
  pill reads `נמכר`.

## 12. Hebrew and RTL

`<html lang="he" dir="rtl">`. CSS **logical properties everywhere** —
`margin-inline-start`, `inset-inline-end`, `padding-block` — never `left`/`right`.

**The bidi rule.** Any numeric range must be wrapped in `dir="ltr"`. A bare `12–18` inside
an RTL paragraph renders as `18–12`: Unicode bidi resolves a neutral character between two
numbers as right-to-left, splitting the range into two separately-ordered runs. This was
hit while building the mockups and it is silent — nothing errors, the dates are simply
wrong. It lives in a single shared `<Range from to />` component so it cannot be forgotten,
and no other code emits a range.

Prices are formatted with `Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS',
maximumFractionDigits: 0 })` from the agorot integer.

Phone numbers are stored as typed and rendered `dir="ltr"`, and converted to `+972`
international form only when building a `wa.me` link.

## 13. Testing

Pure logic, Vitest:

- Pickup-window intersection: normal overlap, single-day overlap, empty intersection,
  ranges partly in the past, a one-item cart.
- Order state machine: every legal transition, and every illegal one rejected.
- Sweep: expires only `PENDING_PAYMENT`, never `CLAIMED_PAID`; releases exactly that
  order's items.
- Price formatting and the bidi `<Range>` output.
- EXIF grouping: a 30-second gap groups, 31 seconds splits, missing EXIF falls back to
  mtime, missing both yields one group per photo.

Integration, Prisma against a throwaway Postgres:

- Reservation transaction reserves all items or none.
- Cancel and expiry both return items to `AVAILABLE`.
- Confirming payment moves items to `SOLD`.

End-to-end, Playwright:

- **The race.** Two checkouts submitted simultaneously for one item: exactly one
  succeeds, the other is told that item is gone and keeps its remaining lines.
- Admin login rejects a wrong password and rate-limits after 10 attempts.
- A buyer can browse, filter by category, add to cart, check out, and reach `/pay`.

## 14. Deployment

`next.config.js` sets `output: 'standalone'`. Railway builds with Nixpacks; the start
command is `node server.js`, and a pre-deploy step runs `prisma migrate deploy`.

Required Railway setup: the Postgres plugin, a volume mounted at `/data`, and the four
environment variables from §10. The first deploy runs the seed, which creates the
`Settings` row with empty strings and no items.

The seller's first session is: open `/admin`, log in, set the shop name, BIT number and
address in settings — until the BIT number is set the shop cannot take orders — then
bulk-upload photos.
