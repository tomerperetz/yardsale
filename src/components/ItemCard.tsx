import Link from 'next/link'
import type { Category, Item, Photo } from '@prisma/client'
import { Price } from '@/components/Price'
import { PickupWindow } from '@/components/PickupWindow'

type CardItem = Item & { category: Category; photos: Photo[] }

/**
 * A grid card. Available and reserved items link through to the item page;
 * sold items stay inline, desaturated, and are never links — see task-13 brief §7.
 */
export function ItemCard({ item }: { item: CardItem }) {
  const sold = item.status === 'SOLD'
  const href = `/item/${item.slug}`
  const photo = item.photos[0] as Photo | undefined
  const photoSrc = photo ? `/img/${item.id}/${photo.id}-800.webp` : undefined

  return (
    <article className={sold ? 'card sold' : 'card'}>
      <div className="ph" style={photo ? { backgroundImage: `url(${photo.lqip})`, backgroundSize: 'cover' } : undefined}>
        {photoSrc &&
          (sold ? (
            <img src={photoSrc} alt="" loading="lazy" />
          ) : (
            <Link href={href} aria-label={item.name}>
              <img src={photoSrc} alt="" loading="lazy" />
            </Link>
          ))}
        <span className="cat">{item.category.name}</span>
        {sold ? (
          <div className="sold-tag">נמכר</div>
        ) : (
          <button type="button" className="add" aria-label={`הוספה מהירה: ${item.name}`}>
            +
          </button>
        )}
      </div>

      {sold ? (
        <div className="body">
          <h3 className="name">{item.name}</h3>
          <p className="desc">{item.description}</p>
          <div className="foot">
            <Price agorot={item.priceAgorot} className="price" />
            <span className="pick">—</span>
          </div>
        </div>
      ) : (
        <Link href={href} className="body">
          <h3 className="name">{item.name}</h3>
          <p className="desc">{item.description}</p>
          <div className="foot">
            <Price agorot={item.priceAgorot} className="price" />
            <span className="pick">
              איסוף <PickupWindow from={item.pickupFrom} to={item.pickupTo} />
            </span>
          </div>
        </Link>
      )}
    </article>
  )
}
