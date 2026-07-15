// V produkcii ide API cez Vercel rewrite (same-origin) — session cookie z /api/auth
// je viazaná na vercel.app doménu, priame volanie na onrender.com by ju neposlalo
const isProd = typeof window !== 'undefined' && !window.location.hostname.includes('localhost')
const BASE = (isProd ? window.location.origin : (import.meta.env.VITE_API_URL ?? 'http://localhost:3001')) + '/api/v1'

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: { 'Content-Type': 'application/json' }, credentials: 'include', ...init })
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
  promoFrom?: string | null
  promoUntil?: string | null
  saving?: number | null
  worstStore?: string | null
  normPrice?: number | null
  normUnit?: 'kg' | 'l' | null
}

export type StorePrice = {
  companyId: string
  storeName: string
  price: number
  unitPrice: number
  isPromo: boolean
  imageUrl: string | null
}

export type Suggestion = {
  groupKey: string
  name: string
  unit: string
  packageSize: number
  imageUrl: string | null
  price: number
  unitPrice: number
  storeName: string
  isPromo: boolean
  normPrice?: number | null
  normUnit?: 'kg' | 'l' | null
}

export type NeedsApproval = {
  originalQuery: string
  originalGroupKey?: string
  suggestions: Suggestion[]
}

export type StoreGroup = {
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
    promoFrom?: string | null
    promoUntil?: string | null
    saving?: number | null
    worstStore?: string | null
    normPrice?: number | null
    normUnit?: 'kg' | 'l' | null
    qty?: number
    note?: string
  }[]
  subtotal: number
}

export type Plan = {
  key: string
  label: string
  storeCount: number
  total: number
  stores: StoreGroup[]
}

export type OptimizeResult = {
  plans?: Plan[]
  stores: StoreGroup[]
  total_optimized: number
  total_worst: number
  total_saving: number
  unmatched: string[]
  needsApproval: NeedsApproval[]
}

export type FavoriteDto = {
  id: string
  query: string
  groupKey?: string | null
  displayName: string
  imageUrl?: string | null
  createdAt: string
}

export type SavingsEntry = { amount: number; listName: string | null; recordedAt: string }
export type MealPlanEntry = { date: string; recipeId: string }

export type SavedListDto = {
  id: string
  name: string
  savedAt: string
  stores: OptimizeResult['stores']
  unmatched: string[]
}

export const api = {
  getLists: () => fetchJson<SavedListDto[]>('/lists'),
  saveList: (name: string, stores: OptimizeResult['stores'], unmatched: string[]) =>
    fetchJson<SavedListDto>('/lists', { method: 'POST', body: JSON.stringify({ name, stores, unmatched }) }),
  deleteList: (id: string) => fetchJson<{ ok: boolean }>(`/lists/${id}`, { method: 'DELETE' }),
  renameList: (id: string, name: string) => fetchJson<{ ok: boolean; name: string }>(`/lists/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  stores: () => fetchJson<Store[]>('/stores'),
  search: (q: string) => fetchJson<ProductHit[]>(`/products/search?q=${encodeURIComponent(q)}`),
  status: () => fetchJson<{ ok: boolean; rawProducts: number; groups: number; ageMinutes: number }>('/status'),
  optimize: (items: { query: string; groupKey?: string }[], company_ids: string[]) =>
    fetchJson<OptimizeResult>('/optimize', { method: 'POST', body: JSON.stringify({ items, company_ids }) }),
  checkIngredients: (ingredients: string[]) =>
    fetchJson<Record<string, ProductHit | null>>('/recipes/check', { method: 'POST', body: JSON.stringify({ ingredients }) }),
  getFavorites: () => fetchJson<FavoriteDto[]>('/favorites'),
  addFavorite: (item: { query: string; groupKey?: string; displayName: string; imageUrl?: string | null }) =>
    fetchJson<FavoriteDto>('/favorites', { method: 'POST', body: JSON.stringify(item) }),
  removeFavorite: (query: string) => fetchJson<{ ok: boolean }>(`/favorites/${encodeURIComponent(query)}`, { method: 'DELETE' }),
  getStats: () => fetchJson<SavingsEntry[]>('/stats'),
  recordSaving: (amount: number, listName?: string) =>
    fetchJson<{ ok: boolean }>('/stats', { method: 'POST', body: JSON.stringify({ amount, listName }) }),
  getMealPlan: () => fetchJson<MealPlanEntry[]>('/mealplan'),
  planMeal: (date: string, recipeId: string) =>
    fetchJson<{ ok: boolean }>('/mealplan', { method: 'POST', body: JSON.stringify({ date, recipeId }) }),
  unplanMeal: (date: string) => fetchJson<{ ok: boolean }>(`/mealplan/${date}`, { method: 'DELETE' }),
}
