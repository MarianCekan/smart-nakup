/**
 * cenyslovensko.sk API klient
 *
 * Používame endpoint s groupByVendor=true — API samo grupuje produkty
 * podľa EAN a vracia vendors[] pole s cenami naprieč obchodmi.
 */

import axios from 'axios'

const BASE = 'https://api.cenyslovensko.sk/api'
const IMG_BASE = 'https://img.cenyslovensko.sk'

const HEADERS = {
  'Accept': 'application/json',
  'Origin': 'https://cenyslovensko.sk',
  'Referer': 'https://cenyslovensko.sk/',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/144.0.0.0 Safari/537.36',
}

async function get<T>(path: string): Promise<T> {
  const res = await axios.get<T>(`${BASE}${path}`, { headers: HEADERS, timeout: 4000 })
  return res.data
}

// ─── Mapovanie companyId → názov + img slug ────────────────────────────────
// vendorName z API je uppercase — mapujeme podľa toho

export const COMPANY_NAMES: Record<string, string> = {
  '35793783': 'Lidl',
  '35790164': 'Kaufland',
  '31321828': 'Tesco',
  '31347037': 'Billa',
  '36483492': 'Billa',
  '36183181': 'Fresh',
  '36644871': 'Fresh',
  '50020188': 'Terno',
}

// vendorName (uppercase z API) → img slug
const VENDOR_IMG_SLUG: Record<string, string> = {
  'LIDL':     'lidl',
  'KAUFLAND': 'kaufland',
  'TESCO':    'tesco',
  'BILLA':    'billa',
  'FRESH':    'labas',
  'TERNO':    'terno',
}

// companyId → img slug (fallback)
const COMPANY_IMG_SLUG: Record<string, string> = {
  '35793783': 'lidl',
  '35790164': 'kaufland',
  '31321828': 'tesco',
  '31347037': 'billa',
  '36483492': 'billa',
  '36183181': 'labas',
  '36644871': 'labas',
  '50020188': 'terno',
}

function buildImageUrl(picture: string | null, companyId: string, vendorName?: string): string | null {
  if (!picture) return null
  const slug = (vendorName && VENDOR_IMG_SLUG[vendorName.toUpperCase()])
    || COMPANY_IMG_SLUG[companyId]
  if (!slug) return null
  // Lidl má v picture už 'lidl/' prefix (napr. "lidl/1282.jpg")
  if (slug === 'lidl') {
    const pic = picture.startsWith('lidl/') ? picture.slice(5) : picture
    return `${IMG_BASE}/lidl/lidl/${pic}`
  }
  return `${IMG_BASE}/${slug}/${picture}`
}

function vendorDisplayName(companyId: string, vendorName?: string): string {
  if (vendorName) {
    const cap = vendorName.charAt(0) + vendorName.slice(1).toLowerCase()
    return cap
  }
  return COMPANY_NAMES[companyId] ?? `Obchod ${companyId}`
}

// ─── Raw typy z API (groupByVendor=true) ──────────────────────────────────────

type RawVendor = {
  companyId: string
  minPrice: number
  maxPrice: number
  minUnitPrice: number
  maxUnitPrice: number
  promoFrom: string | null
  promoTo: string | null
}

type RawGroupedProduct = {
  companyId: string           // primárny vlastník záznamu
  productKey: string
  ean: string | null
  internalId: string
  productDetails: {
    productName: string
    unit: string
    packageSize: number
    picture: string | null
    productUrl: string | null
  }
  vendors: RawVendor[]        // ceny naprieč obchodmi
}

// ─── Naše normalizované typy ──────────────────────────────────────────────────

export type StorePrice = {
  companyId: string
  storeName: string
  price: number
  unitPrice: number
  isPromo: boolean
  imageUrl: string | null
}

export type ProductGroup = {
  groupKey: string
  name: string
  nameLower: string
  unit: string
  packageSize: number
  stores: StorePrice[]        // zoradené podľa unitPrice ASC
  bestPrice: number
  bestUnitPrice: number
  bestStore: string
  bestImageUrl: string | null
}

// ─── Normalizácia ─────────────────────────────────────────────────────────────

function deaccent(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

function normalize(raw: RawGroupedProduct): ProductGroup {
  const detail = raw.productDetails

  // Každý vendor = jeden obchod s min cenou
  const stores: StorePrice[] = raw.vendors.map(v => ({
    companyId: v.companyId,
    storeName: COMPANY_NAMES[v.companyId] ?? `Obchod ${v.companyId}`,
    price: v.minPrice,
    unitPrice: v.minUnitPrice,
    isPromo: !!v.promoFrom,
    imageUrl: buildImageUrl(detail.picture, v.companyId),
  })).sort((a, b) => a.unitPrice - b.unitPrice)

  const best = stores[0]

  return {
    groupKey: raw.productKey,
    name: detail.productName,
    nameLower: deaccent(detail.productName),
    unit: detail.unit,
    packageSize: detail.packageSize,
    stores,
    bestPrice: best?.price ?? 0,
    bestUnitPrice: best?.unitPrice ?? 0,
    bestStore: best?.storeName ?? '',
    bestImageUrl: best?.imageUrl ?? null,
  }
}

// ─── Cache ────────────────────────────────────────────────────────────────────

type Cache = {
  groups: ProductGroup[]
  loadedAt: number
  totalRaw: number
}

let _cache: Cache | null = null
let _loading: Promise<Cache> | null = null

async function fetchPage(page: number, size = 100): Promise<{ count: number; content: RawGroupedProduct[] }> {
  return get(
    `/product-prices/current-day?orderBy=unit_price&sortOrder=asc&groupByVendor=true&page=${page}&size=${size}`
  )
}

async function loadAll(): Promise<Cache> {
  const first = await fetchPage(0, 100)
  const total = first.count
  const pages = Math.ceil(total / 100)
  console.log(`📦 Načítavam ${total} produktov (${pages} stránok, groupByVendor=true)...`)

  const allRaw: RawGroupedProduct[] = [...first.content]

  for (let batch = 0; batch < Math.ceil((pages - 1) / 5); batch++) {
    const batchPages = Array.from({ length: 5 }, (_, i) => batch * 5 + i + 1).filter(p => p < pages)
    const results = await Promise.all(batchPages.map(p => fetchPage(p, 100)))
    allRaw.push(...results.flatMap(r => r.content))
  }

  const groups = allRaw.map(normalize)
  console.log(`✅ Cache: ${allRaw.length} produktov načítaných`)

  return { groups, loadedAt: Date.now(), totalRaw: allRaw.length }
}

export async function getCache(): Promise<Cache> {
  const TTL = 6 * 60 * 60 * 1000
  if (_cache && Date.now() - _cache.loadedAt < TTL) return _cache
  if (!_loading) {
    _loading = loadAll()
      .then(c => { _cache = c; _loading = null; return c })
      .catch(e => { _loading = null; throw e })
  }
  return _loading
}

// ─── Circuit breaker — skip cenysk for 5 min after failure ───────────────────
let _cenyskDownUntil = 0

// ─── Search ───────────────────────────────────────────────────────────────────

export async function searchProducts(query: string, limit = 12): Promise<ProductGroup[]> {
  if (Date.now() < _cenyskDownUntil) return []
  let groups: ProductGroup[]
  try {
    const cache = await getCache()
    groups = cache.groups
  } catch {
    _cenyskDownUntil = Date.now() + 5 * 60 * 1000
    return []
  }
  const q = deaccent(query.trim())
  if (q.length < 2) return []

  return groups
    .map(g => {
      let score = 0
      if (g.nameLower === q) score = 100
      else if (g.nameLower.startsWith(q)) score = 80
      else if (g.nameLower.includes(q)) score = 50
      else {
        const words = q.split(/\s+/).filter(w => w.length > 1)
        const hits = words.filter(w => g.nameLower.includes(w))
        if (hits.length) score = (hits.length / words.length) * 40
      }
      return { g, score }
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || a.g.bestUnitPrice - b.g.bestUnitPrice)
    .slice(0, limit)
    .map(x => x.g)
}

// ─── Optimize ─────────────────────────────────────────────────────────────────

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

export async function optimizeCart(
  items: { query: string; groupKey?: string }[],
  allowedCompanyIds: string[]
) {
  const { groups } = await getCache()
  const unmatched: string[] = []
  const needsApproval: NeedsApproval[] = []

  type Matched = { query: string; group: ProductGroup; chosen: StorePrice }
  const matched: Matched[] = []

  for (const item of items) {
    let group = item.groupKey ? groups.find(g => g.groupKey === item.groupKey) : undefined
    if (!group) {
      const r = await searchProducts(item.query, 1)
      group = r[0]
    }
    if (!group) { unmatched.push(item.query); continue }

    const eligible = allowedCompanyIds.length > 0
      ? group.stores.filter(s => allowedCompanyIds.includes(s.companyId))
      : group.stores

    if (!eligible.length) {
      // Produkt nie je v zvolených obchodoch — hľadáme alternatívu
      if (allowedCompanyIds.length > 0) {
        const alternatives = await searchProducts(item.query, 20)
        const alt = alternatives.find(a =>
          a.groupKey !== group!.groupKey &&
          a.stores.some(s => allowedCompanyIds.includes(s.companyId))
        )
        if (alt) {
          const bestAltStore = alt.stores.find(s => allowedCompanyIds.includes(s.companyId))!
          needsApproval.push({
            originalQuery: item.query,
            originalGroupKey: item.groupKey,
            suggested: {
              groupKey: alt.groupKey,
              name: alt.name,
              unit: alt.unit,
              packageSize: alt.packageSize,
              imageUrl: bestAltStore.imageUrl ?? alt.bestImageUrl,
              price: bestAltStore.price,
              unitPrice: bestAltStore.unitPrice,
              storeName: bestAltStore.storeName,
              isPromo: bestAltStore.isPromo,
            },
          })
          continue
        }
      }
      unmatched.push(item.query)
      continue
    }

    const chosen = eligible[0] // already sorted by unitPrice ASC
    matched.push({ query: item.query, group, chosen })
  }

  // Zoskup po obchodoch
  const storeMap = new Map<string, { storeName: string; companyId: string; items: any[]; subtotal: number }>()
  for (const { query, group, chosen } of matched) {
    if (!storeMap.has(chosen.companyId)) {
      storeMap.set(chosen.companyId, { storeName: chosen.storeName, companyId: chosen.companyId, items: [], subtotal: 0 })
    }
    const grp = storeMap.get(chosen.companyId)!
    grp.items.push({
      query,
      name: group.name,
      groupKey: group.groupKey,
      packageSize: group.packageSize,
      unit: group.unit,
      price: chosen.price,
      unitPrice: chosen.unitPrice,
      isPromo: chosen.isPromo,
      imageUrl: chosen.imageUrl ?? group.bestImageUrl,
      allStores: group.stores,
    })
    grp.subtotal = parseFloat((grp.subtotal + chosen.price).toFixed(2))
  }

  const stores = Array.from(storeMap.values()).sort((a, b) => b.subtotal - a.subtotal)
  const total_optimized = parseFloat(stores.reduce((s, g) => s + g.subtotal, 0).toFixed(2))
  const total_worst = parseFloat(
    matched.reduce((s, { group, chosen }) => {
      const eligible = allowedCompanyIds.length > 0
        ? group.stores.filter(x => allowedCompanyIds.includes(x.companyId))
        : group.stores
      const worst = eligible.length ? eligible[eligible.length - 1].price : chosen.price
      return s + worst
    }, 0).toFixed(2)
  )

  return {
    stores,
    total_optimized,
    total_worst,
    total_saving: parseFloat((total_worst - total_optimized).toFixed(2)),
    unmatched,
    needsApproval,
  }
}
