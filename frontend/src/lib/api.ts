const BASE = (import.meta.env.VITE_API_URL ?? 'http://localhost:3001') + '/api/v1'

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: { 'Content-Type': 'application/json' }, ...init })
  if (!res.ok) throw new Error(`API ${res.status}`)
  return res.json()
}

export type Store = { name: string; companyIds: string[] }

export type ProductHit = {
  groupKey: string
  name: string
  unit: string
  packageSize: number
  imageUrl: string | null
  bestPrice: number
  bestStore: string
  bestUnitPrice: number
  storeCount: number
  storeNames: string[]
}

export type StorePrice = {
  companyId: string
  storeName: string
  price: number
  unitPrice: number
  isPromo: boolean
  imageUrl: string | null
}

export type NeedsApproval = {
  originalQuery: string
  originalGroupKey?: string
  suggested: {
    groupKey: string
    name: string
    unit: string
    packageSize: number
    imageUrl: string | null
    price: number
    unitPrice: number
    storeName: string
    isPromo: boolean
  }
}

export type OptimizeResult = {
  stores: {
    storeName: string
    companyId: string
    items: {
      query: string
      name: string
      groupKey: string
      packageSize: number
      unit: string
      price: number
      unitPrice: number
      isPromo: boolean
      imageUrl: string | null
      allStores: StorePrice[]
    }[]
    subtotal: number
  }[]
  total_optimized: number
  total_worst: number
  total_saving: number
  unmatched: string[]
  needsApproval: NeedsApproval[]
}

export const api = {
  stores: () => fetchJson<Store[]>('/stores'),
  search: (q: string) => fetchJson<ProductHit[]>(`/products/search?q=${encodeURIComponent(q)}`),
  status: () => fetchJson<{ ok: boolean; rawProducts: number; groups: number; ageMinutes: number }>('/status'),
  optimize: (items: { query: string; groupKey?: string }[], company_ids: string[]) =>
    fetchJson<OptimizeResult>('/optimize', { method: 'POST', body: JSON.stringify({ items, company_ids }) }),
}
