'use client'

import Link from 'next/link'
import type { Category, Item, Photo } from '@prisma/client'
import { Price } from '@/components/Price'
import { PickupWindow } from '@/components/PickupWindow'
import { useCart } from '@/components/CartProvider'
import { photoUrl } from '@/lib/photo-url'

type CardItem = Item & { category: Category; photos: Photo[] }

/**
 * A grid card.
 *
 * Three states, not two. Available links through and can be added to the cart.
 * Sold stays inline, desaturated, and is never a link — see task-13 brief §7.
 * Reserved sits between them: still a link, because it may come back and
 * because a buyer may want to ask, but with no add button and a badge saying
 * so. Before that badge existed, a reserved item looked exactly like an
 * available one and the refusal arrived at checkout, after the buyer had
 * filled in their name and phone.
 */
export function ItemCard({ item }: { item: CardItem }) {
  const cart = useCart()
  const sold = item.status === 'SOLD'
  const reserved = item.status === 'RESERVED'
  const href = `/item/${item.slug}`
  const photo = item.photos[0] as Photo | undefined
  const photoSrc = photo ? photoUrl(photo.id, 800) : undefined

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
        ) : reserved ? (
          <div className="sold-tag reserved-tag">שמור</div>
        ) : (
          <button
            type="button"
            className="add"
            aria-label={`הוספה מהירה: ${item.name}`}
            onClick={() => cart.add(item.id)}
          >
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
