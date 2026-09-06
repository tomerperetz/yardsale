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
3. Upload items — either the single-item form, or the bulk uploader, which is
   built for uploading straight from a phone's photo gallery.
4. The shop is now live at `/`.

Step 2 is not optional, and one part of it is enforced rather than just
suggested: **the shop refuses to take orders until the BIT phone number is
set.** This isn't a UI nicety that a determined buyer could work around —
`reserveItems` itself returns a `SHOP_NOT_OPEN` result at the data layer if
`bitPhone` is empty, and the cart page surfaces that as a plain message. If
you deploy and immediately try to check out as a test buyer before touching
Settings, seeing the shop refuse the order is expected behaviour, not a bug.

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
every iPhone upload onto the two weaker fallback layers instead. Both upload
components (the single-item photo drop and the bulk queue) currently use the
unnarrowed `accept="image/*"` on purpose.

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
    "startCommand": "node .next/standalone/server.js",
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
version takes traffic, and `startCommand` runs the standalone server
directly.

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
5. Deploy.

`next.config.js` backs this up with a fail-fast check: in production, it
throws before the app starts if `DATABASE_URL`, `ADMIN_PASSWORD_HASH` or
`SESSION_SECRET` is missing, rather than letting the app come up with (for
example) no real password check on the admin area. In practice this check
runs as part of `next build`, so on Railway it catches a missing variable
during the build step of a deploy and fails that deploy outright, before any
bad configuration goes live — which is the point of running it in
`next.config.js` rather than only inside the routes that use those secrets.

After the first deploy, go through "First run" above: log into `/admin`, fill
in Settings (the shop will not take orders until the BIT number is set), and
upload items. From then on, every future deploy re-runs the migration and
the seed automatically via `preDeployCommand` — the seed's `upsert` never
touches an existing Settings row, so this is safe on every single deploy,
including the very first one.

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
