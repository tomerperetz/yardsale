import { db } from '@/lib/db'
import { getPublicCategories } from '@/lib/items'
import { getSettings } from '@/lib/settings'
import { releaseExpiredHolds } from '@/lib/orders/sweep'
import { itemsOrderBy, itemsWhere, parseGridParams } from '@/lib/grid'
import { SiteHeader } from '@/components/SiteHeader'
import { Filters } from '@/components/Filters'
import { ItemCard } from '@/components/ItemCard'

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  // Returns any lapsed hold's items to AVAILABLE before we read the grid — the
  // project has no scheduler, so every read path opens with this instead.
  await releaseExpiredHolds()

  const params = parseGridParams(await searchParams)
  const [settings, categories, items] = await Promise.all([
    getSettings(),
    getPublicCategories(),
    db.item.findMany({
      where: itemsWhere(params),
      orderBy: itemsOrderBy(params),
      include: { category: true, photos: { orderBy: { position: 'asc' }, take: 1 } },
    }),
  ])

  const availableCount = items.filter((item) => item.status !== 'SOLD').length
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
            <span className="meta">איסוף עצמי בלבד</span>
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
