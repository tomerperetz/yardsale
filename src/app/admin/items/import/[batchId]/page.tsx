import Link from 'next/link'
import { ItemStatus, OrderStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { startOfUtcDay } from '@/lib/dates'
import { AdminNav } from '@/components/admin/AdminNav'
import { ImportReview, type ReviewItem, type ReviewPhoto } from './ImportReview'
import type { ImportNotice } from '@/lib/import/batch'
import adminStyles from '@/components/admin/admin.module.css'
import styles from '../../items.module.css'

/**
 * The review screen (spec §7.3), and the screen the whole feature exists to
 * deliver: everything before it is plumbing that puts photos on drafts, and
 * this is where the seller corrects the grouping, fills in what only they
 * know, and publishes.
 *
 * It shows the batch's DRAFT items. An item that has already been published
 * has left the review — it is a real listing now, and it lives in
 * /admin/items — but it is still counted below so the seller can see that a
 * reload did not lose it.
 */
export const dynamic = 'force-dynamic'

/** Matches the /admin/items default when a shop has no items to carry forward. */
const DEFAULT_WINDOW_DAYS = 6
const DAY_MS = 86_400_000

function toDateInput(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * The notice `clusterBatchAction` returned, carried here in the URL by
 * ImportDrop so that it survives the navigation and a later reload. Anything
 * else — a hand-typed value, a stale link — reads as no notice at all.
 */
function readNotice(raw: string | string[] | undefined): ImportNotice {
  return raw === 'NO_COPY' || raw === 'OUT_OF_CREDIT' ? raw : 'NONE'
}

export default async function ImportReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ batchId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { batchId } = await params
  const notice = readNotice((await searchParams).notice)

  const [items, loosePhotos, categories, newCategories, published, itemCount, categoryCount, claimedCount] =
    await Promise.all([
    db.item.findMany({
      where: { importBatchId: batchId, status: ItemStatus.DRAFT },
      orderBy: { createdAt: 'asc' },
      include: { category: true, photos: { orderBy: { position: 'asc' } } },
    }),
    // `itemId: null` explicitly: importBatchId is provenance and is never
    // cleared, so the batch id alone names every photo of the batch, attached
    // or not (spec §7.3). These are the ones no item — and so no item-keyed
    // discard — can reach.
    db.photo.findMany({
      where: { importBatchId: batchId, itemId: null },
      orderBy: { position: 'asc' },
      select: { id: true, lqip: true },
    }),
    db.category.findMany({ orderBy: { name: 'asc' }, select: { name: true } }),
    // Categories that exist only because of this import. A category every one
    // of whose items belongs to this batch is one the shop did not have before
    // the seller dropped these photos — which is exactly what "new" means to
    // them. Computed rather than stored: it needs no column, and it stops
    // being true the moment the category earns an item of its own, which is
    // also the moment it stops being worth flagging.
    db.category.findMany({
      where: {
        items: { some: { importBatchId: batchId } },
        NOT: { items: { some: { importBatchId: { not: batchId } } } },
      },
      select: { name: true },
    }),
    db.item.count({ where: { importBatchId: batchId, status: { not: ItemStatus.DRAFT } } }),
    db.item.count(),
    db.category.count(),
    db.order.count({ where: { status: OrderStatus.CLAIMED_PAID } }),
  ])

  const reviewItems: ReviewItem[] = items.map((item) => ({
    id: item.id,
    name: item.name,
    description: item.description,
    // 0 agorot is "the seller has not priced this yet" — the price every
    // imported draft is created with — so it opens as an empty field rather
    // than as a ₪0 the seller might publish without noticing.
    price: item.priceAgorot === 0 ? '' : String(item.priceAgorot / 100),
    categoryName: item.category.name,
    pickupFrom: toDateInput(item.pickupFrom),
    pickupTo: toDateInput(item.pickupTo),
    photos: item.photos.map((photo): ReviewPhoto => ({ id: photo.id, lqip: photo.lqip })),
  }))

  // What a card minted mid-review (movePhoto(photoId, 'new')) opens with. The
  // server picks these with `carriedForward()` — the most recent item's
  // category and window — and the most recent item is the last of this batch,
  // so the last card here is the same answer without a second write.
  const last = reviewItems[reviewItems.length - 1]
  const today = startOfUtcDay(new Date())
  const defaults = {
    categoryName: last?.categoryName ?? categories[0]?.name ?? '',
    pickupFrom: last?.pickupFrom ?? toDateInput(today),
    pickupTo: last?.pickupTo ?? toDateInput(new Date(today.getTime() + DEFAULT_WINDOW_DAYS * DAY_MS)),
  }

  return (
    <>
      <header>
        <div className="wrap bar">
          <div className="brand">
            <div className="mark" />
            <h1>ייבוא תמונות</h1>
          </div>
          <Link href="/admin/items" className="btn btn-ghost">
            חזרה לפריטים
          </Link>
        </div>
      </header>

      <div className="wrap">
        <div className={adminStyles.shell}>
          <AdminNav
            active="items"
            itemCount={itemCount}
            ordersAlertCount={claimedCount}
            categoryCount={categoryCount}
          />

          <main className={styles.shell}>
            <section className={styles.panel}>
              <div className={styles.ptitle}>
                <h2>בדיקת הייבוא</h2>
                {published > 0 && (
                  <span className={adminStyles.carry}>
                    {published === 1 ? 'פריט אחד כבר פורסם' : `${published} פריטים כבר פורסמו`}
                  </span>
                )}
              </div>
              <p className={styles.psub}>
                אלה הפריטים שהצענו מהתמונות שהעליתם. אפשר לתקן שם, תיאור ומחיר, להעביר תמונה לפריט אחר, ולסמן כמה
                פריטים כדי לקבוע להם תאריכים או קטגוריה בבת אחת.
              </p>

              <ImportReview
                batchId={batchId}
                items={reviewItems}
                categories={categories.map((category) => category.name)}
                newCategories={newCategories.map((category) => category.name)}
                loosePhotos={loosePhotos}
                notice={notice}
                defaults={defaults}
              />
            </section>
          </main>
        </div>
      </div>
    </>
  )
}
