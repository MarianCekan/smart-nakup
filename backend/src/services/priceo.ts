/**
 * priceo.sk API klient
 * Pokrýva Tesco, Kaufland, Lidl s plným katalógom (nie len akciové).
 * Ceny sú v centoch (139 = 1.39€), 0 = produkt nie je v danom obchode.
 */

import { COMPANY_NAMES } from './cenysk.js'
import type { ProductGroup, StorePrice } from './cenysk.js'

const BASE = 'https://priceo.sk'

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Referer': 'https://priceo.sk/',
  'Accept': 'application/json',
}

// priceo field → companyId
const PRICEO_STORES: { field: 'tesco' | 'kauf' | 'lidl'; companyId: string }[] = [
  { field: 'tesco', companyId: '31321828' },
  { field: 'kauf',  companyId: '35790164' },
  { field: 'lidl',  companyId: '35793783' },
]

type PriceoProduct = {
  id: string
  name: string
  tesco: string
  kauf: string
  lidl: string
  imageurl: string
  mnozstvo: string
  jednotka: string
  vyrobca: string
  original_tesco: string
  original_kauf: string
  original_lidl: string
  valid_to_tesco: string | null
  valid_to_kauf: string | null
  valid_to_lidl: string | null
}

function deaccent(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

function toProductGroup(p: PriceoProduct): ProductGroup | null {
  const stores: StorePrice[] = []
  const packageSize = parseFloat(p.mnozstvo) || 1

  for (const { field, companyId } of PRICEO_STORES) {
    const price = parseInt(p[field])
    if (!price || price <= 1) continue  // 0 = nie je v obchode, 1 = placeholder
    const originalPrice = parseInt((p as any)[`original_${field}`]) || price
    const isPromo = originalPrice > price && price > 1 // price=1 = placeholder v DB
    stores.push({
      companyId,
      storeName: COMPANY_NAMES[companyId] ?? 'Iný obchod',
      price: price / 100,
      unitPrice: parseFloat((price / 100 / packageSize).toFixed(3)),
      isPromo,
      imageUrl: `${BASE}/${p.imageurl}`,
    })
  }

  if (!stores.length) return null
  stores.sort((a, b) => a.unitPrice - b.unitPrice)
  const best = stores[0]

  return {
    groupKey: `priceo:${p.id}`,
    name: p.name,
    nameLower: deaccent(p.name),
    unit: p.jednotka,
    packageSize,
    stores,
    bestPrice: best.price,
    bestUnitPrice: best.unitPrice,
    bestStore: best.storeName,
    bestImageUrl: best.imageUrl,
  }
}

import axios from 'axios'

// Session cache: groupKey → ProductGroup (platné po dobu behu servera)
const _sessionCache = new Map<string, ProductGroup>()

// Query cache: query → výsledky (10 minút)
const _queryCache = new Map<string, { results: ProductGroup[]; ts: number }>()
const QUERY_TTL = 10 * 60 * 1000

export async function searchPriceo(query: string, limit = 12): Promise<ProductGroup[]> {
  if (query.trim().length < 2) return []

  const key = query.trim().toLowerCase()
  const cached = _queryCache.get(key)
  if (cached && Date.now() - cached.ts < QUERY_TTL) return cached.results.slice(0, limit)

  const url = `${BASE}/search.php?search=${encodeURIComponent(query)}&include_discounts=1`
  let raw: PriceoProduct[]
  try {
    const res = await axios.get<PriceoProduct[]>(url, { headers: HEADERS, timeout: 5000 })
    raw = res.data
  } catch {
    return []
  }

  const results: ProductGroup[] = []
  for (const p of raw.slice(0, limit * 2)) {
    const group = toProductGroup(p)
    if (!group) continue
    _sessionCache.set(group.groupKey, group)
    results.push(group)
  }

  const sliced = results.slice(0, limit)
  if (sliced.length) _queryCache.set(key, { results: sliced, ts: Date.now() })
  return sliced
}

export function getPriceoFromCache(groupKey: string): ProductGroup | undefined {
  return _sessionCache.get(groupKey)
}

export async function getPriceoById(groupKey: string): Promise<ProductGroup | undefined> {
  // Skús cache
  const cached = _sessionCache.get(groupKey)
  if (cached) return cached

  // Extrakt názov z groupKey nie je možný → re-search nie je možný bez query
  // Caller musí poskytnúť query
  return undefined
}

export async function ensurePriceoGroup(groupKey: string, fallbackQuery: string): Promise<ProductGroup | undefined> {
  const cached = _sessionCache.get(groupKey)
  if (cached) return cached

  // Re-search pomocou fallback query
  const results = await searchPriceo(fallbackQuery, 20)
  return results.find(g => g.groupKey === groupKey)
}
