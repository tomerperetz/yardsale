'use server'

import { EventKind } from '@prisma/client'
import { record } from './record'

/**
 * Records that a buyer put an item in their cart.
 *
 * A server action rather than a route handler because it needs nothing a
 * server action does not already give it — the visitor cookie and the user
 * agent both arrive with the request — and because there is no response worth
 * shaping. It returns nothing and the caller does not wait for it.
 *
 * `record` swallows its own failures, so this cannot break the click that
 * triggered it. The item id is unvalidated on purpose: a bad one fails the
 * foreign key, `record` logs it, and the cart still works. Validating it here
 * would cost a query on every add to protect a number.
 */
export async function recordAddToCart(itemId: string): Promise<void> {
  await record(EventKind.ADD_TO_CART, itemId)
}
