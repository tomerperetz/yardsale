import type { Metadata } from 'next'
import { ItemStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { getPublicCategories } from '@/lib/items'
import { NOT_PUBLIC_STATUSES, publicItemWhere } from '@/lib/visibility'
import { shareCard } from '@/lib/share-card'
import { getSettings } from '@/lib/settings'
import { releaseExpiredHolds } from '@/lib/orders/sweep'
import { itemsOrderBy, itemsWhere, parseGridParams } from '@/lib/grid'
import { SiteHeader } from '@/components/SiteHeader'
import { Filters } from '@/components/Filters'
import { ItemCard } from '@/components/ItemCard'

/**
 * The shop is never prerendered. It lists live inventory, runs the expiry
 * sweep, and reads Settings — none of which may be frozen at build time.
 *
 * `await searchParams` below would eventually mark this route dynamic on its
 * own, but only *after* the prerender attempt has already run
 * `releaseExpiredHolds()` against a database. That is fine locally, where one
 * happens to be reachable; on Railway the build has no DATABASE_URL and the
 * deploy failed outright while prerendering this page. Declaring it up front
 * means the attempt never happens — the same reason the admin pages carry
 * this export.
 */
export const dynamic = 'force-dynamic'

/**
 * What the shop's own link looks like when the seller pastes it into a family
 * or neighbourhood WhatsApp group — which is where nearly all of this shop's
 * traffic comes from.
 *
 * The photograph is the newest available item's, not a fixed banner. It costs
 * nothing to keep current, it shows a buyer something actually for sale right
 * now, and re-sharing the same link after a week previews the week's new
 * things rather than last week's.
 */
export async function generateMetadata(): Promise<Metadata> {
  const [settings, newest] = await Promise.all([
    getSettings(),
    db.item.findFirst({
      where: publicItemWhere,
      orderBy: { createdAt: 'desc' },
      select: { photos: { orderBy: { position: 'asc' }, take: 1 } },
    }),
  ])

  const cover = newest?.photos[0] ?? null
  // Falls back to a description of the shop rather than to the seller's name:
  // a first-run shop has neither filled in, and an empty og:title previews as
  // the bare URL all over again.
  const title = settings.shopName.trim() !== '' ? settings.shopName : 'מכירת חצר'
  const tagline = settings.tagline.trim()

  return shareCard({
    title,
    description:
      tagline !== ''
        ? tagline
        : `רהיטים, מכשירים וספרים שכבר לא בשימוש${settings.city.trim() !== '' ? `, לאיסוף מ${settings.city.trim()}` : ''}.`,
    photo: cover && { id: cover.id, width: cover.width, height: cover.height },
    path: '/',
  })
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  // Returns any lapsed hold's items to AVAILABLE before we read the grid — the
  // project has no scheduler, so every read path opens with this instead.
  await releaseExpiredHolds()

  const params = parseGridParams(await searchParams)
  const [settings, categories, items, availableCount] = await Promise.all([
    getSettings(),
    getPublicCategories(),
    db.item.findMany({
      where: itemsWhere(params),
      orderBy: itemsOrderBy(params),
      include: { category: true, photos: { orderBy: { position: 'asc' }, take: 1 } },
    }),
    // The hero's count describes the shop, not the current filter. Counting the
    // filtered list put "0 פריטים זמינים" at the top of a shop holding fifty of
    // them, directly above a panel inviting the buyer to widen their filter.
    // Same predicate the filtered version used — everything the grid can show
    // that isn't already sold — just without the filter applied.
    db.item.count({ where: { status: { notIn: [...NOT_PUBLIC_STATUSES, ItemStatus.SOLD] } } }),
  ])

  const filtered = params.category !== undefined || params.maxPrice !== undefined

  return (
    <>
      <SiteHeader shopName={settings.shopName} tagline={settings.tagline} />

      <div className="wrap">
        <section className="hero">
          <h2>
            הבית מתרוקן,
            <br />
            הדברים מחפשים בית חדש.
          </h2>
          <p>
            רהיטים, מכשירים וספרים שכבר לא בשימוש — במחירים סופיים. בוחרים, משלמים בביט, ואוספים
            {settings.city !== '' ? ` מ${settings.city}` : ''} בתיאום.
          </p>
          <div className="meta-row">
            <span className="meta">
              <span className="dot" />
              {availableCount} פריטים זמינים
            </span>
            <span className="meta">תשלום בביט</span>
            {/* Names the city, the same way the sentence above it does: "pickup
                only" told a buyer what the shop would not do, and the thing
                they actually need to know before paying is where they are
                driving. Falls back to the bare claim while `city` is unset —
                inventing a city the seller never typed is worse than vague. */}
            <span className="meta">{settings.city !== '' ? `איסוף עצמי מ${settings.city}` : 'איסוף עצמי בלבד'}</span>
          </div>
        </section>

        <Filters categories={categories} current={params} />

        {items.length > 0 ? (
          <main className="grid">
            {items.map((item) => (
              <ItemCard key={item.id} item={item} />
            ))}
          </main>
        ) : (
          // Without this the page just stops below the filters, and a buyer who
          // drags the price slider too low cannot tell a filter that matched
          // nothing from a broken page. The two cases read differently on
          // purpose: an empty shop is the seller's first screen after deploying.
          <main className="grid-empty">
            {filtered ? (
              <>
                <p className="grid-empty-title">אין פריטים שמתאימים לסינון</p>
                <p>נסו להעלות את טווח המחיר או לבחור קטגוריה אחרת.</p>
                <a className="grid-empty-reset" href="/">
                  ניקוי הסינון
                </a>
              </>
            ) : (
              <>
                <p className="grid-empty-title">עדיין אין פריטים למכירה</p>
                <p>ברגע שיעלו פריטים ראשונים הם יופיעו כאן.</p>
              </>
            )}
          </main>
        )}
      </div>
    </>
  )
}
