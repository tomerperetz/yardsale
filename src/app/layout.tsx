import './globals.css'
import type { ReactNode } from 'react'
import type { Metadata } from 'next'
import { CartProvider } from '@/components/CartProvider'
import { siteUrl } from '@/lib/site-url'

/**
 * The origin every page's link preview resolves against.
 *
 * WhatsApp fetches a shared link from its own servers, so a relative
 * `og:image` resolves against nothing and the card arrives as a bare URL.
 * Next turns the relative paths the pages declare into absolute ones, but only
 * against this — and it is a function, not a constant, because the deployed
 * domain is not known at build time.
 *
 * Undefined in development, which is Next's own localhost default and the
 * honest answer: there is nothing out there to preview from.
 */
export function generateMetadata(): Metadata {
  return { metadataBase: siteUrl() }
}

export default function RootLayout({
  children,
  modal,
}: {
  children: ReactNode
  modal: ReactNode
}) {
  return (
    <html lang="he" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Assistant:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <CartProvider>
          {children}
          {modal}
        </CartProvider>
      </body>
    </html>
  )
}
