import { redirect } from 'next/navigation'

/**
 * The public header's "ניהול" button links to /admin — there is no screen
 * here of its own, only items/orders/categories/settings. Middleware
 * already redirects a signed-out visitor to /admin/login, so this route
 * only ever runs for a signed-in seller; send them straight to the screen
 * they actually land on day to day.
 */
export default function AdminIndexPage(): never {
  redirect('/admin/items')
}
