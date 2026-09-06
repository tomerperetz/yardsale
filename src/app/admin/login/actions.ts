'use server'

import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { SESSION_COOKIE, signSession, verifyAdminPassword } from '@/lib/auth'
import { hit } from '@/lib/rate-limit'

export async function login(_prev: string | null, formData: FormData): Promise<string | null> {
  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local'
  // Its own namespace: buyer traffic at checkout must never be able to spend
  // the budget the seller needs to get in here (see src/lib/rate-limit.ts).
  if (!hit(ip, Date.now(), 'login').allowed) return 'יותר מדי ניסיונות. נסו שוב בעוד רבע שעה.'

  const password = String(formData.get('password') ?? '')
  if (!(await verifyAdminPassword(password))) return 'סיסמה שגויה.'

  ;(await cookies()).set(SESSION_COOKIE, signSession(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 30 * 86_400,
  })
  redirect('/admin/items')
}
