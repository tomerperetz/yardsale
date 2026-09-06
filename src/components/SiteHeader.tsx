import Link from 'next/link'

/**
 * `shopName` and `tagline` come from the seller's Settings row, seeded empty.
 * Neither ever gets a fallback string — with both unset the brand shows the
 * mark alone, exactly as a shop that has not been configured yet should.
 */
export function SiteHeader({
  shopName,
  tagline,
  cartCount = 0,
}: {
  shopName: string
  tagline: string
  cartCount?: number
}) {
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
        <button type="button" className="btn btn-cart">
          סל <span className="count">{cartCount}</span>
        </button>
      </div>
    </header>
  )
}
