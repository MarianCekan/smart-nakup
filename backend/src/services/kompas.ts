/**
 * kompaszliav.sk scraper
 * Letákové akciové ceny — parsuje JSON-LD zo stránok produktov.
 * Žiadne API, scrape HTML.
 */

import type { ProductGroup, StorePrice } from './cenysk.js'

const BASE = 'https://kompaszliav.sk'

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'sk-SK,sk;q=0.9',
}

// Mapovanie názvov obchodov z kompas → companyId
const STORE_MAP: Record<string, { companyId: string; storeName: string }> = {
  'tesco':       { companyId: '31321828', storeName: 'Tesco' },
  'kaufland':    { companyId: '35790164', storeName: 'Kaufland' },
  'lidl':        { companyId: '35793783', storeName: 'Lidl' },
  'billa':       { companyId: '31347037', storeName: 'Billa' },
  'terno':       { companyId: '36183181', storeName: 'Terno' },
  'fresh':       { companyId: '36644871', storeName: 'Fresh' },
}

function matchStore(name: string): { companyId: string; storeName: string } | null {
  const lower = name.toLowerCase()
  for (const [key, val] of Object.entries(STORE_MAP)) {
    if (lower.includes(key)) return val
  }
  return null
}

function deaccent(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

// Jednoduchý regex extract JSON-LD z HTML
function extractJsonLd(html: string): any[] {
  const results: any[] = []
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    try { results.push(JSON.parse(m[1])) } catch { /* skip malformed */ }
  }
  return results
}

// Extrakcia product slugov zo search stránky
function extractSlugs(html: string): string[] {
  const slugs: string[] = []
  const re = /href=["']\/produkty\/([^"'?#]+)["']/g
  let m: RegExpExecArray | null
  const seen = new Set<string>()
  while ((m = re.exec(html)) !== null) {
    if (!seen.has(m[1])) { seen.add(m[1]); slugs.push(m[1]) }
  }
  return slugs
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: HEADERS })
    if (!res.ok) {
      console.log(`kompas fetchHtml ${res.status} ${res.statusText} — ${url}`)
      return null
    }
    return res.text()
  } catch (e: any) {
    console.log(`kompas fetchHtml error: ${e.message} — ${url}`)
    return null
  }
}

async function fetchProductGroup(slug: string): Promise<ProductGroup | null> {
  const html = await fetchHtml(`${BASE}/produkty/${slug}`)
  if (!html) return null

  const schemas = extractJsonLd(html)
  const product = schemas.find(s => s['@type'] === 'Product' && s.offers)
  if (!product) return null

  // Porovnáme podľa dátumu (nie timestamp) — akcia platí celý posledný deň
  const todayStr = new Date().toISOString().slice(0, 10)
  const stores: StorePrice[] = []

  for (const offer of (product.offers ?? [])) {
    if (offer['@type'] === 'AggregateOffer') continue  // preskočiť súhrn
    const validUntilStr = offer.priceValidUntil ? offer.priceValidUntil.slice(0, 10) : '9999-12-31'
    if (validUntilStr < todayStr) continue  // vypršaná akcia

    const storeName = offer.offeredBy?.name ?? ''
    const matched = matchStore(storeName)
    if (!matched) continue  // neznámy obchod — preskočíme

    const price = parseFloat(offer.price)
    if (!price || isNaN(price)) continue

    stores.push({
      companyId: matched.companyId,
      storeName: matched.storeName,
      price,
      unitPrice: price,  // kompas nemá jednotkové ceny
      isPromo: true,     // vždy akciová cena
      imageUrl: product.image ?? null,
    })
  }

  if (!stores.length) return null
  stores.sort((a, b) => a.price - b.price)
  const best = stores[0]

  return {
    groupKey: `kompas:${slug}`,
    name: product.name ?? slug,
    nameLower: deaccent(product.name ?? slug),
    unit: 'ks',
    packageSize: 1,
    stores,
    bestPrice: best.price,
    bestUnitPrice: best.price,
    bestStore: best.storeName,
    bestImageUrl: best.imageUrl,
  }
}

// Session cache: groupKey → ProductGroup
const _cache = new Map<string, ProductGroup>()

// Query cache: query → { results, ts }
const _queryCache = new Map<string, { results: ProductGroup[]; ts: number }>()
const QUERY_TTL = 10 * 60 * 1000  // 10 min

async function _doSearch(query: string, limit: number): Promise<ProductGroup[]> {
  const searchUrl = `${BASE}/hladaj?f=${encodeURIComponent(query)}`
  const html = await fetchHtml(searchUrl)
  if (!html) return []

  const slugs = extractSlugs(html).slice(0, limit * 2)
  if (!slugs.length) return []

  const groups = await Promise.all(slugs.map(s => fetchProductGroup(s)))
  const valid = groups.filter((g): g is ProductGroup => g !== null)

  const q = deaccent(query.trim())
  const scored = valid.map(g => {
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
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score)

  const results = scored.slice(0, limit).map(x => x.g)
  for (const g of results) _cache.set(g.groupKey, g)
  return results
}

export async function searchKompas(query: string, limit = 6): Promise<ProductGroup[]> {
  if (query.trim().length < 2) return []

  const key = deaccent(query.trim())

  // Query cache hit
  const cached = _queryCache.get(key)
  if (cached && Date.now() - cached.ts < QUERY_TTL) return cached.results

  // Race: scrape vs timeout 1.5s
  const start = Date.now()
  const timeout = new Promise<ProductGroup[]>(resolve => setTimeout(() => resolve([]), 5000))
  const results = await Promise.race([_doSearch(query, limit), timeout])
  const elapsed = Date.now() - start

  if (results.length) {
    _queryCache.set(key, { results, ts: Date.now() })
    console.log(`✅ kompas "${query}": ${results.length} výsledkov za ${elapsed}ms`)
  } else {
    console.log(`⏱️ kompas "${query}": timeout/no results po ${elapsed}ms`)
  }
  return results
}

export function getKompasFromCache(groupKey: string): ProductGroup | undefined {
  return _cache.get(groupKey)
}
