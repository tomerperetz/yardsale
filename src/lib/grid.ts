import { ItemStatus, type Prisma } from '@prisma/client'

export type GridSort = 'new' | 'price-asc' | 'price-desc'
export type GridParams = { category?: string; maxPrice?: number; sort: GridSort }

const SORTS: GridSort[] = ['new', 'price-asc', 'price-desc']

const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v)

export function parseGridParams(sp: Record<string, string | string[] | undefined>): GridParams {
  const params: GridParams = { sort: 'new' }

  const category = one(sp.category)?.trim()
  if (category) params.category = category

  const rawMax = Number(one(sp.maxPrice))
  if (Number.isFinite(rawMax) && rawMax > 0) params.maxPrice = Math.round(rawMax * 100)

  const sort = one(sp.sort)
  if (sort && (SORTS as string[]).includes(sort)) params.sort = sort as GridSort

  return params
}

/** Drafts are never public. Sold items stay in the grid, dimmed — see spec §7. */
export function itemsWhere(p: GridParams): Prisma.ItemWhereInput {
  const where: Prisma.ItemWhereInput = { status: { not: ItemStatus.DRAFT } }
  if (p.category) where.category = { name: p.category }
  if (p.maxPrice !== undefined) where.priceAgorot = { lte: p.maxPrice }
  return where
}

export function itemsOrderBy(p: GridParams): Prisma.ItemOrderByWithRelationInput[] {
  if (p.sort === 'price-asc') return [{ priceAgorot: 'asc' }]
  if (p.sort === 'price-desc') return [{ priceAgorot: 'desc' }]
  return [{ sortIndex: 'asc' }, { createdAt: 'desc' }]
}

export function filterHref(current: GridParams, patch: Partial<GridParams>): string {
  const next = { ...current, ...patch }
  const qs = new URLSearchParams()
  if (next.category) qs.set('category', next.category)
  if (next.maxPrice !== undefined) qs.set('maxPrice', String(next.maxPrice / 100))
  if (next.sort !== 'new') qs.set('sort', next.sort)
  const s = qs.toString()
  return s ? `/?${s}` : '/'
}
