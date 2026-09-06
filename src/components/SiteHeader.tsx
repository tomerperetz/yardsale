'use client'

import Link from 'next/link'
import { useCart } from '@/components/CartProvider'

/**
 * `shopName` and `tagline` come from the seller's Settings row, seeded empty.
 * Neither ever gets a fallback string — with both unset the brand shows the
 * mark alone, exactly as a shop that has not been configured yet should.
 *
 * The cart count comes from `useCart()` rather than a prop: it's the
 * buyer's own browser-local wishlist, so it can only ever be read on the
 * client, and it has to react live as items are added from any page.
 */
export function SiteHeader({ shopName, tagline }: { shopName: string; tagline: string }) {
  const { ids } = useCart()
  const hasText = shopName !== '' || tagline !== ''

  return (
    <header>
      <div className="wrap bar">
        <div className="brand">
          <div className="mark" />
          {hasText && (
            <div>
              {shopName !== '' && <h1>{shopName}</h1>}
              {tagline !== '' && <span>{tagline}</span>}
            </div>
          )}
        </div>
        <Link href="/admin" className="btn btn-ghost">
          ניהול
        </Link>
        <Link href="/cart" className="btn btn-cart">
          סל <span className="count">{ids.length}</span>
        </Link>
      </div>
    </header>
  )
}
