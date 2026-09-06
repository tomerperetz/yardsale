'use client'

import { useEffect } from 'react'
import { useCart } from '@/components/CartProvider'

/**
 * Removes an order's items from the cart, on the first screen that proves the
 * reservation actually happened. Nothing else clears the cart, so without this
 * a buyer's own reserved items read back as "נתפס" on /cart — taken, by them,
 * from themselves.
 *
 * Only the ordered ids go: the rest of the cart is still a live wishlist. It
 * waits for `hydrated` because a child's effect runs before the provider's own
 * — removing from the still-empty initial state would write an empty cart back
 * to localStorage and lose the lot.
 */
export function ClearOrderedFromCart({ itemIds }: { itemIds: string[] }) {
  const { hydrated, remove } = useCart()
  // A stable dependency: the array itself is a new object on every render.
  const key = itemIds.join(',')

  useEffect(() => {
    if (!hydrated) return
    for (const id of key.split(',').filter(Boolean)) remove(id)
  }, [hydrated, key, remove])

  return null
}
