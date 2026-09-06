'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

const STORAGE_KEY = 'ys_cart'

type CartContextValue = {
  ids: string[]
  /**
   * False until the stored cart has been read. Anything that *removes* ids on
   * mount must wait for this: child effects run before the provider's own, so
   * removing from the still-empty initial state would write an empty cart back
   * to storage and lose everything the buyer had.
   */
  hydrated: boolean
  add(id: string): void
  remove(id: string): void
  clear(): void
}

const CartContext = createContext<CartContextValue | null>(null)

/**
 * Every item is one-of-a-kind and this cart deliberately never locks
 * anything — it is a wishlist that lives in the buyer's own browser.
 * `localStorage` access is wrapped in try/catch everywhere: a private
 * window or blocked site data must degrade to an in-memory cart for the
 * tab's lifetime, never throw.
 */
function readStoredIds(): string[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

function writeStoredIds(ids: string[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids))
  } catch {
    // Private window or blocked storage: the cart just stays in memory for this tab.
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [ids, setIds] = useState<string[]>([])
  const [hydrated, setHydrated] = useState(false)

  // Read localStorage after mount, not in useState's initializer, so the
  // server-rendered and first client paint both show an empty cart — the
  // stored ids only ever differ on the client, and only after this effect.
  useEffect(() => {
    setIds(readStoredIds())
    setHydrated(true)
  }, [])

  const add = (id: string) => {
    setIds((prev) => {
      if (prev.includes(id)) return prev
      const next = [...prev, id]
      writeStoredIds(next)
      return next
    })
  }

  const remove = (id: string) => {
    setIds((prev) => {
      // Returning `prev` unchanged for an id that isn't there keeps this a
      // true no-op — no needless storage write, and no re-render for a caller
      // that removes the same ids on every render (see ClearOrderedFromCart).
      if (!prev.includes(id)) return prev
      const next = prev.filter((existing) => existing !== id)
      writeStoredIds(next)
      return next
    })
  }

  const clear = () => {
    setIds([])
    writeStoredIds([])
  }

  return <CartContext.Provider value={{ ids, hydrated, add, remove, clear }}>{children}</CartContext.Provider>
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart must be used within a CartProvider')
  return ctx
}
