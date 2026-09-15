/**
 * The shop's own origin, which link previews cannot do without.
 *
 * A WhatsApp preview is fetched by WhatsApp's servers, not by the browser that
 * has the page open, so every URL in the metadata has to be absolute — a
 * relative `og:image` resolves against nothing and the preview arrives as a
 * bare link. Next will resolve relative metadata URLs for us, but only against
 * a `metadataBase`, which is what this supplies.
 *
 * Read at request time rather than at build: the deployed domain is not known
 * when the image is built, and inlining a localhost fallback into a production
 * bundle is how a shop ends up sharing links that preview nothing.
 */

/**
 * Preference order, and why:
 *
 * 1. `SITE_URL` — the seller's own domain, once they have one. Set by hand,
 *    so it wins over anything the platform guesses.
 * 2. `RAILWAY_PUBLIC_DOMAIN` — set by Railway on every deploy, and correct
 *    without anyone configuring anything. This is what makes previews work
 *    out of the box.
 * 3. Nothing. Development, where there is no public URL to preview from and
 *    Next's own localhost default is the honest answer.
 */
export function siteUrl(): URL | undefined {
  const explicit = (process.env.SITE_URL ?? '').trim()
  if (explicit !== '') {
    const url = parse(explicit)
    if (url) return url
  }

  const railway = (process.env.RAILWAY_PUBLIC_DOMAIN ?? '').trim()
  if (railway !== '') return parse(`https://${railway}`)

  return undefined
}

/**
 * A malformed value is treated as unset rather than thrown: a typo in an
 * environment variable must cost the shop its link previews, not its ability
 * to render a page.
 */
function parse(raw: string): URL | undefined {
  try {
    return new URL(raw.startsWith('http') ? raw : `https://${raw}`)
  } catch {
    console.error('[metadata] ignoring an unparseable site URL:', raw)
    return undefined
  }
}
