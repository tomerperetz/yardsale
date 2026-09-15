import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE, readSession } from '@/lib/auth'
import { VISITOR_COOKIE, VISITOR_MAX_AGE_SECONDS, newVisitorId, readVisitorId } from '@/lib/analytics/visitor'

// Runs on the Node.js runtime, not Edge: readSession uses node:crypto
// (createHmac/timingSafeEqual), which the Edge runtime cannot bundle.
export const runtime = 'nodejs'

/**
 * Which paths this file guards, keyed on the path itself rather than on the
 * matcher below.
 *
 * The matcher decides whether middleware RUNS; this decides what it does when
 * it does. Keeping them separate is what let the visitor cookie be added to
 * public pages without anything under /admin becoming reachable by widening a
 * list — a public path is public because it is not this, not because it was
 * left off a list.
 */
function needsAuth(pathname: string): boolean {
  return pathname.startsWith('/admin') || pathname === '/api/upload' || pathname === '/api/import'
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (needsAuth(pathname)) {
    if (pathname.startsWith('/admin/login')) return NextResponse.next()
    if (readSession(req.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next()
    // /api/upload and /api/import are fetch/XHR endpoints, not page navigations,
    // so an unauthenticated caller gets a 401 rather than a redirect to the
    // login page.
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    return NextResponse.redirect(new URL('/admin/login', req.url))
  }

  return withVisitorCookie(req)
}

/**
 * Gives a public page a visitor id if it does not already have one.
 *
 * Here and not in the page, because a server component cannot set a cookie —
 * only middleware, a route handler or a server action can. A page that read a
 * missing cookie would have to mint an id it could never persist, and every
 * request from that browser would look like a new person.
 *
 * `httpOnly`, because nothing in the browser needs to read it: the events are
 * recorded server-side. `sameSite: 'lax'`, so it survives a click from a
 * WhatsApp message, which is how most buyers arrive. `secure` off in
 * development, where there is no https to be secure about.
 */
function withVisitorCookie(req: NextRequest): NextResponse {
  const response = NextResponse.next()
  if (readVisitorId(req.cookies.get(VISITOR_COOKIE)?.value) !== null) return response

  response.cookies.set(VISITOR_COOKIE, newVisitorId(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: VISITOR_MAX_AGE_SECONDS,
  })
  return response
}

// A literal list, not a pattern: a route is unauthenticated until `needsAuth`
// says otherwise AND this list makes middleware run for it. Both /api entries
// write files to the seller's disk, so a new one must join this list in the
// same change that creates it.
//
// The public entries are here for the visitor cookie only. `/img` is
// deliberately absent — it serves photo files, and a request for one is not a
// person arriving.
export const config = {
  matcher: ['/admin/:path*', '/api/upload', '/api/import', '/', '/item/:path*', '/cart', '/checkout'],
}
