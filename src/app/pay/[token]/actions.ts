'use server'

import { revalidatePath } from 'next/cache'
import { claimPaid } from '@/lib/orders/transitions'

export async function declarePaid(_prev: string | null, formData: FormData): Promise<string | null> {
  const token = String(formData.get('token') ?? '')
  const result = await claimPaid(token)
  if (result.ok) {
    revalidatePath(`/pay/${token}`)
    return null
  }
  if (result.reason === 'EXPIRED') return 'ההזמנה פגה. הפריטים חזרו למכירה.'
  if (result.reason === 'NOT_FOUND') return 'לא מצאנו את ההזמנה.'
  return 'כבר קיבלנו את ההודעה שלכם.'
}
