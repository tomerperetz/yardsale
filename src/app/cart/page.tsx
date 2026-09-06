'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useCart } from '@/components/CartProvider'
import { Price } from '@/components/Price'
import { SiteHeader } from '@/components/SiteHeader'
import { getCartData, type CartLine } from './actions'

/**
 * The cart is a wishlist, not a hold — nothing here is reserved. It reads
 * `useCart()` for the ids and re-fetches the items on every visit (see
 * `getCartData`), so a cart left open overnight always shows current
 * price and availability instead of whatever was true when it was added.
 */
export default function CartPage() {
  const { ids, remove } = useCart()
  const [lines, setLines] = useState<CartLine[]>([])
  const [shopOpen, setShopOpen] = useState(true)
  const [shop, setShop] = useState({ shopName: '', tagline: '' })
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading')
  const [retryCount, setRetryCount] = useState(0)

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    getCartData(ids)
      .then((data) => {
        if (cancelled) return
        setLines(data.items)
        setShopOpen(data.shopOpen)
        setShop({ shopName: data.shopName, tagline: data.tagline })
        setStatus('loaded')
      })
      .catch(() => {
        if (cancelled) return
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [ids, retryCount])

  const available = lines.filter((line) => line.status === 'AVAILABLE')
  const totalAgorot = available.reduce((sum, line) => sum + line.priceAgorot, 0)
  const checkoutHref = `/checkout?items=${available.map((line) => line.id).join(',')}`

  return (
    <>
      <SiteHeader shopName={shop.shopName} tagline={shop.tagline} />
      <div className="wrap cart-page">
        <div className="cart-card">
          <h2>הסל שלך</h2>

          {status === 'loading' && <p className="empty-cart">טוען את הסל…</p>}

          {status === 'error' && (
            <div className="cart-load-error">
              <p>לא הצלחנו לטעון את הסל. בדקו את החיבור ונסו שוב.</p>
              <button type="button" className="btn-primary" onClick={() => setRetryCount((n) => n + 1)}>
                ניסיון נוסף
              </button>
            </div>
          )}

          {status === 'loaded' && ids.length === 0 && <p className="empty-cart">הסל ריק — עדיין לא הוספתם פריטים.</p>}

          {status === 'loaded' && ids.length > 0 && (
            <>
              <div className="cart-lines">
                {lines.map((line) => (
                  <div key={line.id} className="mini">
                    {line.photoUrl && <img src={line.photoUrl} alt="" />}
                    <span className="n">{line.name}</span>
                    {line.status === 'AVAILABLE' ? (
                      <Price agorot={line.priceAgorot} className="p" />
                    ) : (
                      <span className="p sold">הפריט נמכר בינתיים</span>
                    )}
                    <button
                      type="button"
                      className="mini-remove"
                      aria-label={`הסרה מהסל: ${line.name}`}
                      onClick={() => remove(line.id)}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>

              <div className="total">
                <span>{available.length} פריטים</span>
                <Price agorot={totalAgorot} className="total-price" />
              </div>

              {available.length === 0 ? (
                <p className="empty-cart">כל הפריטים בסל כבר לא זמינים.</p>
              ) : (
                <div className="foot-btn">
                  {shopOpen ? (
                    <Link href={checkoutHref} className="btn-primary">
                      המשך לפרטים ואיסוף
                    </Link>
                  ) : (
                    <button type="button" className="btn-primary" disabled>
                      החנות עדיין לא פתוחה להזמנות
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}
