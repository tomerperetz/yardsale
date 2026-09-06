import Link from 'next/link'
import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { EditItemForm } from './EditItemForm'
import styles from '../items.module.css'

function toDateInput(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export default async function EditItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const [item, categories] = await Promise.all([
    db.item.findUnique({ where: { id }, include: { category: true, photos: { orderBy: { position: 'asc' } } } }),
    db.category.findMany({ orderBy: { name: 'asc' } }),
  ])
  if (!item) notFound()

  return (
    <>
      <header>
        <div className="wrap bar">
          <div className="brand">
            <div className="mark" />
            <h1>ניהול פריטים</h1>
          </div>
          <Link href="/" className="btn btn-ghost">
            צפייה בחנות ↗
          </Link>
        </div>
      </header>

      <div className={`wrap ${styles.shell}`}>
        <section className={styles.panel}>
          <div className={styles.editHead}>
            <h2>עריכת פריט</h2>
            <Link href="/admin/items" className={styles.back}>
              → חזרה לרשימת הפריטים
            </Link>
          </div>

          <EditItemForm
            item={{
              id: item.id,
              name: item.name,
              description: item.description,
              price: String(item.priceAgorot / 100),
              status: item.status,
              categoryName: item.category.name,
              pickupFrom: toDateInput(item.pickupFrom),
              pickupTo: toDateInput(item.pickupTo),
              photos: item.photos.map((p) => ({ id: p.id, width: p.width, height: p.height, lqip: p.lqip, position: p.position })),
            }}
            categories={categories.map((c) => c.name)}
          />
        </section>
      </div>
    </>
  )
}
