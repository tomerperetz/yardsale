import type { Metadata } from 'next'
import { photoUrl } from '@/lib/photo-url'

/**
 * What a link to this shop looks like when it is pasted into WhatsApp.
 *
 * Pasted bare, a link is a grey line of URL that says nothing about what is
 * for sale — which is how most of this shop's traffic arrives, because the
 * seller shares it in family and neighbourhood groups. A title, a sentence and
 * a photograph turn the same paste into a card.
 *
 * WhatsApp reads Open Graph tags and takes the FIRST image it finds, so there
 * is only ever one here, and it is a real photograph of a real item rather
 * than a generated banner: rendering Hebrew into an image at request time
 * means shipping a font and a text layout engine to solve a problem a photo of
 * the sofa already solves better.
 */

/** 800px: large enough for WhatsApp's big preview, small enough to fetch fast. */
const SHARE_WIDTH = 800

export type SharePhoto = { id: string; width: number; height: number }

/**
 * The Open Graph and Twitter blocks for one page.
 *
 * `images` is omitted entirely rather than left empty when there is no
 * photograph: an `og:image` pointing at nothing makes WhatsApp render a broken
 * card, which is worse than the plain link it would otherwise show.
 */
export function shareCard({
  title,
  description,
  photo,
  path,
  siteName,
}: {
  title: string
  description: string
  photo: SharePhoto | null
  path: string
  /** The shop's name. Falls back to the title, which is right on the shop's own page. */
  siteName?: string
}): Metadata {
  const images = photo ? [shareImage(photo, title)] : undefined

  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: 'website',
      title,
      description,
      url: path,
      siteName: siteName ?? title,
      locale: 'he_IL',
      ...(images ? { images } : {}),
    },
    twitter: {
      card: images ? 'summary_large_image' : 'summary',
      title,
      description,
      ...(images ? { images } : {}),
    },
  }
}

/**
 * One photo as an OG image, with the dimensions of the variant being served —
 * not the ones on the row.
 *
 * The row records the ORIGINAL size; the file at this URL is the original
 * scaled down to `SHARE_WIDTH`, or the original itself if it was already
 * smaller (`withoutEnlargement`). Declaring the row's numbers would tell
 * WhatsApp a 4032×3024 image is coming and hand it a 800×600 one, which is
 * how a preview ends up cropped or letterboxed.
 */
function shareImage(photo: SharePhoto, alt: string) {
  const width = photo.width > 0 ? Math.min(SHARE_WIDTH, photo.width) : SHARE_WIDTH
  const height = photo.width > 0 ? Math.round((photo.height * width) / photo.width) : width

  return { url: photoUrl(photo.id, SHARE_WIDTH), width, height, alt }
}
