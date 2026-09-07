'use client'

import { useState } from 'react'
import type { Category, Item, Photo, Settings } from '@prisma/client'
import { Price } from '@/components/Price'
import { PickupWindow } from '@/components/PickupWindow'
import { useCart } from '@/components/CartProvider'
import { photoUrl } from '@/lib/photo-url'

export type DetailItem = Item & { category: Category; photos: Photo[] }

// Larger than the grid's 800 — this is the close-up view.
const PHOTO_WIDTH = 1600
const THUMB_WIDTH = 400

/**
 * The shared body for both the standalone item page and the quick-look
 * overlay — see task-14 brief. Rendered identically from both routes so
 * they can never drift apart.
 *
 * Styling lifted from docs/design/mockups/02-buyer-flow.html, panel 1
 * ("מבט מהיר"): the photo with its thumbnail strip, the name/price row,
 * the description, and the facts list.
 */
export function ItemDetail({
  item,
  settings,
}: {
  item: DetailItem
  settings: Pick<Settings, 'addressLine' | 'city'>
}) {
  const cart = useCart()
  const [activeIndex, setActiveIndex] = useState(0)
  const sold = item.status === 'SOLD'
  const photos = item.photos
  const active = photos[activeIndex] ?? photos[0]

  // addressLine and city each render only when set — see task-14 brief;
  // never a placeholder for either.
  const location = [settings.addressLine, settings.city].filter((s) => s !== '').join(' · ')

  return (
    <div className={sold ? 'detail sold' : 'detail'}>
      <div
        className="ql-photo"
        style={active ? { backgroundImage: `url(${active.lqip})`, backgroundSize: 'cover' } : undefined}
      >
        {active && <img src={photoUrl(active.id, PHOTO_WIDTH)} alt="" />}
        <span className="ql-cat">{item.category.name}</span>
      </div>

      {photos.length > 1 && (
        <div className="strip">
          {photos.map((photo, i) => (
            <button
              key={photo.id}
              type="button"
              className={i === activeIndex ? 'thumb on' : 'thumb'}
              onClick={() => setActiveIndex(i)}
              aria-label={`תמונה ${i + 1}`}
            >
              <img src={photoUrl(photo.id, THUMB_WIDTH)} alt="" />
            </button>
          ))}
        </div>
      )}

      <div className="ql-body">
        <div className="ql-top">
          <h2 id={`item-name-${item.slug}`}>{item.name}</h2>
          <Price agorot={item.priceAgorot} className="ql-price" />
        </div>
        <p className="ql-desc">{item.description}</p>

        <div className="facts">
          <div className="fact">
            <i aria-hidden="true">◷</i>
            <span>
              איסוף בין{' '}
              <b>
                <PickupWindow from={item.pickupFrom} to={item.pickupTo} />
              </b>
            </span>
          </div>
          {location !== '' && (
            <div className="fact">
              <i aria-hidden="true">◎</i>
              <span>{location}</span>
            </div>
          )}
          <div className="fact">
            <i aria-hidden="true">₪</i>
            <span>תשלום בביט · פריט יחיד, אין כמות</span>
          </div>
        </div>
      </div>

      <div className="foot-btn">
        {sold ? (
          <p className="sold-note">הפריט נמכר</p>
        ) : (
          <button type="button" className="btn-primary btn-accent" onClick={() => cart.add(item.id)}>
            הוספה לסל
          </button>
        )}
      </div>
    </div>
  )
}
