import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE, readSession } from '@/lib/auth'

// Runs on the Node.js runtime, not Edge: readSession uses node:crypto
// (createHmac/timingSafeEqual), which the Edge runtime cannot bundle.
export const runtime = 'nodejs'

export function middleware(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith('/admin/login')) return NextResponse.next()
  if (readSession(req.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next()
  // /api/upload and /api/import are fetch/XHR endpoints, not page navigations,
  // so an unauthenticated caller gets a 401 rather than a redirect to the
  // login page.
  if (req.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  return NextResponse.redirect(new URL('/admin/login', req.url))
}

// A literal list, not a pattern: a route is unauthenticated until it is named
// here. Both /api entries write files to the seller's disk, so a new one must
// join this list in the same change that creates it.
export const config = { matcher: ['/admin/:path*', '/api/upload', '/api/import'] }
