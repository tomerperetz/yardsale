# Yard Sale Shop

A small, self-hosted online shop for selling household items in bulk — a Hebrew
(RTL), mobile-first storefront for buyers plus an admin area for the seller to
list items, manage orders and take payment by BIT transfer. There is no
shop name, phone number or address baked into the code: the database seeds an
empty `Settings` row on purpose, and the first thing a seller does after
deploying is fill it in through `/admin`. This document covers everything
needed to run the project locally and to put it on Railway.

## Local setup

You need Node 22+ and a Postgres database. Everything else is `npm install`
away.

```bash
npm install
```

### Database

The project ships a `docker-compose.yml` that starts Postgres on port 5433
with a user, password and database all named `yardsale`:

```bash
npm run db:up
```

That is the documented path, but it has not actually been exercised on the
machine this project was built on — that machine has no Docker installed, so
treat `npm run db:up` as correct-on-paper rather than proven. If it doesn't
work for you, or you simply don't want Docker, start Postgres directly
instead. This is the path that was actually used during development, and it
gets you the same database on the same port:

```bash
initdb -D .superpowers/pgdata -U yardsale --auth=trust -E UTF8
pg_ctl -D .superpowers/pgdata -o "-p 5433 -k /tmp -c listen_addresses=127.0.0.1" -l .superpowers/pg.log start
createdb -h 127.0.0.1 -p 5433 -U yardsale yardsale
```

Either way, once Postgres is listening on 5433, copy `.env.example` to `.env`
and check that `DATABASE_URL` matches (it already points at
`postgresql://yardsale:yardsale@localhost:5433/yardsale`, which is exactly
what both paths above produce). Then run the migrations and seed the
database:

```bash
cp .env.example .env
npm run db:migrate
npm run db:seed
```

`db:seed` is a plain `upsert` with an empty `update: {}` — it inserts the
singleton `Settings` row the first time and does nothing if that row already
exists. It never overwrites settings you've already entered through the admin
screen, which is why it's safe to run again later (and why the Railway config
below runs it on every deploy without a second thought).

### The admin password

Nothing about the admin login ships with a default password. Generate one
yourself:

```bash
npm run admin:password
```

It asks for a password (at least 12 characters) and prints an argon2id hash.
That hash — not the password — is what goes into `ADMIN_PASSWORD_HASH`.

Here is the one trap in this whole setup that will cost you an hour if you
don't know about it going in: an argon2id hash looks like
`$argon2id$v=19$m=65536,t=3,p=4$<salt>$<hash>`, and Next.js's `.env` loader
performs shell-style `$VAR` interpolation. Paste that hash into a `.env` file
as-is and it gets silently mangled — every `$name`-looking segment gets
"expanded" against whatever environment variable of that name does or
doesn't exist. There is no error. The only symptom is that the correct
password is rejected forever, because the hash actually stored is not the
hash you generated. **In a `.env` file, escape every `$` in the hash as
`\$`** — `npm run admin:password` prints this reminder for exactly this
reason. If you ever do end up with a corrupted hash despite the warning, it
won't fail silently a second time: the login code checks that the stored
value starts with `$argon2`, and throws a specific error naming the `.env`
interpolation issue if it doesn't, rather than just rejecting the password
with no explanation.

This escaping is **only** a `.env`-file problem. On Railway (see below),
environment variables are injected straight into the process — they never
pass through dotenv parsing — so you paste the hash there completely
unescaped, exactly as `admin:password` printed it.

Set `SESSION_SECRET` to any long random string, e.g. `openssl rand -base64
32`, and leave `UPLOAD_DIR` as `./.uploads` for local development.

`ANTHROPIC_API_KEY` is the one variable in `.env.example` that is genuinely
optional. It turns on the photo import described below — Claude grouping a
drop of photos by what is in them and writing the Hebrew name and description
for each group. Leave it empty and the app boots exactly as it does now, the
storefront is untouched, and `/admin/items` keeps today's capture-time
uploader instead. Nothing about the shop depends on it, which is why
`src/instrumentation.ts` does not list it among the variables whose absence
stops the server.

`UPLOAD_DIR` is resolved against the working directory, and the standalone
build's `server.js` changes it to `.next/standalone/` before it runs. So a
relative path means one directory under `npm run dev` and a different one if
you run the standalone server by hand locally — photos will 404 with nothing
in the log. Use an absolute path if you do that. It never bites on Railway,
where `UPLOAD_DIR` is the absolute `/data/uploads`.

### Running it

```bash
npm run dev
```

Then open `http://localhost:3000/admin`, log in with the password you
generated, and see "First run" below for what to do next.

## First run

The seed deliberately leaves every shop detail blank — no name, tagline, BIT
number, address, city or pickup hours exist anywhere until the seller enters
them. The very first session after a fresh deploy (or a fresh local database)
looks like this:

1. Open `/admin` and log in with the password behind `ADMIN_PASSWORD_HASH`.
2. Go to Settings and fill in the shop name, tagline, BIT phone number,
   address, city, and the three pickup slot hour ranges (morning, afternoon,
   evening).
3. Upload items — drop the photos on `/admin/items`, which is built for
   uploading straight from a phone's photo gallery. There is one screen for
   this and no mode to pick: dropping a single photo is how you add a single
   item.
4. The shop is now live at `/`.

Step 2 is not optional, and one part of it is enforced rather than just
suggested: **the shop refuses to take orders until the BIT phone number is
set.** This isn't a UI nicety that a determined buyer could work around —
`reserveItems` itself returns a `SHOP_NOT_OPEN` result at the data layer if
`bitPhone` is empty, and the cart page surfaces that as a plain message. If
you deploy and immediately try to check out as a test buyer before touching
Settings, seeing the shop refuse the order is expected behaviour, not a bug.

## The five states an item can be in

Four of them the shop manages on its own; one is yours.

| State | Buyer sees | How it gets there |
| --- | --- | --- |
| `DRAFT` (טיוטה) | nothing | the entry form's working row, before you publish |
| `AVAILABLE` (זמין) | in the grid, buyable | you publish it |
| `RESERVED` (שמור) | in the grid, held | a buyer checked out; a 15-minute hold is running |
| `SOLD` (נמכר) | in the grid, dimmed | you confirmed payment — or marked it sold by hand |
| `HIDDEN` (מוסתר) | nothing | **you** took it off the shop |

**Hidden** is the one to know about. Edit any published item and you get three
buttons — זמין למכירה / מוסתר / נמכר. Hiding pulls the item from the grid and
makes its URL 404, but keeps the row, its photos and, crucially, **its slug**.
Unhide it and the link anyone already shared into WhatsApp works again. That is
the whole reason hidden is its own state rather than a trip back through draft:
a draft's slug is regenerated whenever you rename it, so unpublishing that way
would quietly recycle a URL people already have.

Two changes the seller cannot make by hand, both so an item never moves out
from under an order counting on it:

- An item a **live order** is holding (`RESERVED`) shows an explanation instead
  of buttons. Cancel the order in the orders screen to release it.
- An item **sold through a paid order** cannot be reopened. Orders that were
  cancelled or expired have released their claim, so items that only appear on
  those are yours to move again.

Marking sold by hand is for the neighbour who turns up and pays cash. Hiding is
for "not today". Deleting is still there for removing an item outright, and is
refused for anything attached to an order.

## A note on photos and HEIC

iPhones shoot photos in HEIC by default, and the image processing this
project uses (`sharp`) cannot decode HEIC — it reads the container fine and
then fails on the actual pixel data. Three things work together to keep this
from being a problem in practice:

- iOS Safari itself transcodes HEIC to JPEG before handing a file to any
  `<input type="file" accept="image/*">`, which is most of what makes this a
  non-issue at all.
- A browser-side canvas conversion step catches most of what slips through
  that first layer.
- If a HEIC file still reaches the server, the upload endpoint returns a
  specific Hebrew error message rather than a generic failure.

The important consequence for anyone touching this code later: **never
narrow `accept="image/*"` to something more specific.** It looks like a
harmless tightening — nothing about it screams "this will break uploads" —
but it's exactly what disables iOS's free HEIC-to-JPEG transcoding and pushes
every iPhone upload onto the two weaker fallback layers instead. All three
upload components (the import drop, the capture-time bulk queue, and the edit
screen's photo drop) currently use the unnarrowed `accept="image/*"` on
purpose.

## Importing a whole sale's worth of photos

With `ANTHROPIC_API_KEY` set, `/admin/items` becomes an import screen: the
seller drops up to 60 photos at once, Claude groups them by
what is in them — twelve shots of one sofa are one item, not twelve — and
writes a Hebrew headline and description for each group. That lands the
seller on a review screen at `/admin/items/import/<batch>`, which is where
the real work happens:

- a card per proposed item, with its photo strip and its fields;
- per photo, **remove** and **move to…** — the grouping is a proposal, and
  correcting one photo that went to the wrong item is a two-tap fix;
- a bulk bar over the selected cards that sets **price**, **category** or the
  **pickup window** across all of them in one action, then publishes them;
- **discard the whole import**, which is the only control that also reaches
  photos that never made it onto an item.

Nothing is published until the seller says so. Every proposed item is a
`DRAFT`, and closing the tab loses nothing — the drafts are in
`/admin/items`, and the review screen's URL still works.

**The photos upload in chunks of six, one request after another.** This is
worth knowing before changing anything in that path. A single request
carrying sixty phone photos means a quarter of a gigabyte held in memory
before any per-file check can run, plus `sharp`'s working memory on top;
platforms also cap request bodies well below that. Six at a time bounds the
memory whatever the seller drops, makes the photos land visibly as they go,
and costs one chunk rather than the whole drop when a connection dies. The
requests must stay **sequential**: each one numbers its photos from what the
batch already holds, so two in flight read the same count and hand out
colliding positions. Nothing is lost when that happens, which is what makes
it nasty — the batch is simply in the wrong order, and every item's cover
photo is whatever ended up first.

### When the AI account runs out of credit

It will happen without warning, mid-import, and it must not look like a
crash. The client classifies the API's "no credit" answers (a `400`
`invalid_request_error` naming credit, or a `429`) into a single outcome, and
the import then:

- **keeps every photo** — they are already uploaded and they keep their
  batch;
- falls back to grouping by **capture time**, so the seller still gets items
  and still reaches the review screen with every photo accounted for;
- skips the copy entirely rather than trying it per item — sixty doomed calls
  in a row is the wrong way to discover a dead key;
- says so in **one plain Hebrew line** on the review screen: automatic naming
  is unavailable because the AI account has no credit, and everything else
  works normally;
- retries nothing. Topping the account up works on the next import, with no
  restart — the latch is per batch, not global.

The same capture-time fallback catches a clustering call that fails or comes
back malformed; the only difference is which line the seller reads. The shop
itself is never on this path: nothing here runs for a buyer.

## Deploying to Railway

The project deploys with Railway's Nixpacks builder — there is intentionally
no `Dockerfile` in this repository. If you add one, Railway will prefer it
over Nixpacks and silently stop following the setup described here, so don't.
`railway.json` at the repository root already configures the build:

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": { "builder": "NIXPACKS" },
  "deploy": {
    "preDeployCommand": "npx prisma migrate deploy && npx tsx prisma/seed.ts",
    "startCommand": "npm start",
    "restartPolicyType": "ON_FAILURE"
  }
}
```

Nixpacks runs `npm install` and `npm run build` (which also runs the
`postbuild` step that copies `.next/static` and `public/` into
`.next/standalone/` — Next's standalone output does not do this on its own,
and skipping it means the deployed app renders HTML with every JavaScript
chunk 404ing and nothing on the page clickable). `preDeployCommand` then
applies any pending migrations and runs the idempotent seed before the new
version takes traffic, and `startCommand` runs `npm start`, which is
`prisma migrate deploy && node .next/standalone/server.js`.

The migration appears twice on purpose. `preDeployCommand` is the documented
Railway hook, but it is not always honoured — on this project's own first
deploy Railway ran the Nixpacks default `npm start` and never read
`railway.json` at all, so the migrations never ran and every page that touches
the database returned 500 with `P2021: table does not exist`. Running them
from `npm start` too costs nothing (`prisma migrate deploy` prints "No pending
migrations to apply." on a current database) and does not depend on the
platform reading a config file.

To set the project up on Railway:

1. Create a new Railway service from this repository.
2. Add Railway's Postgres plugin to the project, and let it provide
   `DATABASE_URL` (Railway will template a reference for you — use it rather
   than copying the value in manually, so it stays correct if the database
   ever moves).
3. **Attach a volume to the service, mounted at `/data`.** This step is not
   optional. Railway's container filesystem is ephemeral — anything written
   to disk outside a volume is gone on the next deploy. Without this volume,
   every photo a seller uploads survives exactly until the next deploy, at
   which point the files disappear while the `Photo` rows in the database do
   not: the shop keeps rendering `<img>` tags that point at files that no
   longer exist, so items silently show broken images instead of the
   deployment failing loudly. There is no error to notice — the shop just
   looks broken to buyers.
4. Set the following service variables:
   - `DATABASE_URL` — from the Postgres plugin, as above.
   - `ADMIN_PASSWORD_HASH` — from `npm run admin:password`, pasted in
     unescaped (see the `$`-escaping section above; it does not apply here).
   - `SESSION_SECRET` — a long random string, e.g. `openssl rand -base64 32`.
   - `UPLOAD_DIR` — set to `/data/uploads`, i.e. inside the volume from step
     3.
   - `ANTHROPIC_API_KEY` — **optional.** Set it to turn on the photo import
     (see above). Leaving it out is a supported configuration, not a broken
     one: the app boots, the shop works, and `/admin/items` falls back to
     grouping photos by capture time.
5. Deploy. **If this service already has photos from a version before
   the photo-storage change, do "Upgrading an instance that already has
   photos" below first** — deploying without it leaves every photo on the
   shop 404ing.

`src/instrumentation.ts` backs this up with a fail-fast check: on server
startup in production it exits with a clear message if `DATABASE_URL`,
`ADMIN_PASSWORD_HASH` or `SESSION_SECRET` is missing, rather than letting the
app come up with (for example) no real password check on the admin area.

That check deliberately does **not** live in `next.config.js`, where it
started out and where it was wrong in both directions. `next build` loads that
file, so a build failed for want of a database it never touches — this really
happened, on the first Railway deploy. And the standalone server never loads
it at all: `next build` inlines the resolved config into
`.next/standalone/server.js` as a JSON literal, so the guard that existed to
stop a badly-configured app from serving was not running when the app served.
It only blocked builds. Next calls `register()` in `instrumentation.ts` once
per server process and bundles it into the standalone output, which is the
moment the check is actually about.

After the first deploy, go through "First run" above: log into `/admin`, fill
in Settings (the shop will not take orders until the BIT number is set), and
upload items. From then on, every future deploy re-runs the migration and
the seed automatically via `preDeployCommand` — the seed's `upsert` never
touches an existing Settings row, so this is safe on every single deploy,
including the very first one.

### Upgrading an instance that already has photos

Photo storage changed shape. Files used to live at
`<UPLOAD_DIR>/<itemId>/<photoId>-<width>.webp` and now live at
`<UPLOAD_DIR>/<photoId>/<width>.webp`, which is what lets a photo exist before
it has an item (the import flow) and lets one move between items without
touching disk. **Nothing does this move for you.** It is not a Prisma
migration, so `preDeployCommand` does not run it, and a fresh service with no
photos can skip this section entirely.

If you deploy without it, **every photo on the shop 404s**. The `Photo` rows
are intact and the app does not fail — buyers simply see a broken image on
every item, and the seller sees them on every admin screen, until the
migration is run. There is no error anywhere to notice; there are only broken
pictures.

Run both passes **on the service**, from its shell (`railway ssh`, or the
service shell in Railway's dashboard), so `UPLOAD_DIR` points at the volume
holding the photos. Not `railway run`: that runs the command on your own
machine with the service's variables injected, so `UPLOAD_DIR` would resolve to
`/data/uploads` on your laptop and every photo would be reported as having no
files. It destroys nothing and fails loudly, but it tells you nothing true.

1. **Before deploying**, with the old version still serving:
   ```bash
   npm run migrate:photos
   ```
   This pass only copies; it removes nothing. Both layouts end up on disk at
   once, the running old version goes on serving from the old one, and no
   photo is unreadable at any instant. It exits non-zero if any photo row is
   missing files on disk, so read what it printed before moving on.
2. **Deploy.** The new version reads the new layout, which is now populated.
   Check that photos render on the shop before going further.
3. **Afterwards**, reclaim the space:
   ```bash
   npm run migrate:photos -- --cleanup
   ```
   This removes an original only where the copy is in place and the same size,
   and refuses — loudly, exiting non-zero — where it is not. Skipping this
   pass costs disk space and nothing else, so there is no hurry: leave it
   until the shop is confirmed working.

Both passes are idempotent; running either one twice is a no-op.

## Testing

```bash
npm run test        # vitest, unit and integration tests
npm run typecheck    # tsc --noEmit
npm run e2e          # Playwright, builds and boots the real standalone server
```

The Playwright suite runs against the built standalone server rather than
`next dev` — see the comment at the top of `playwright.config.ts` for why —
and runs the same full journey twice, once under a desktop viewport and once
under a phone-sized touch viewport, since the product requirement is that
both buyers and sellers (including bulk photo uploads) work properly on a
phone, not just a desktop browser.

That suite boots the server with `ANTHROPIC_API_KEY` **blanked**, whatever
your `.env` holds, and `e2e/import.spec.ts` exercises the import along the
no-key path on purpose. It is a specified path rather than a degraded one,
and it is the only one a test can assert against: a real clustering call
decides which photo belongs with which from the photographs themselves, so no
fixture could say in advance what the review screen should show. It also
keeps the suite off the network and off the API bill. The prompts themselves
are checked against a model instead, by hand.

With one exception, which is worth knowing if you run the suite with a key in
your environment: Playwright reuses a server you already have on port 3000
rather than starting its own, and a reused server keeps **its** environment,
key included. So the import spec runs in serial mode and its first test is a
guard that asserts the feature is off — against a keyed server that test
fails and every test after it is skipped, before any of them can click
"cluster these photos" and spend real API credit. If you see that spec
skipped, stop the dev server on 3000 and run it again.

The two suites share that one Postgres and treat it very differently, and
only one of them destroys what is in it. `npm test` **empties every table** —
items, photos, orders, categories and settings — before each database test,
so it takes your demo data with it; reseed with `npm run db:seed` (or your
own demo seed) afterwards. `npm run e2e` does not: it deletes only the rows
it created, so a seed survives it. It does overwrite the single `Settings`
row with its own test shop, so expect the shop name, tagline and BIT number
to be the suite's when it finishes.
