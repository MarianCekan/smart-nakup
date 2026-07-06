/**
 * kompaszliav.sk scraper
 * Letákové akciové ceny — parsuje JSON-LD zo stránok produktov.
 * Žiadne API, scrape HTML.
 */

import type { ProductGroup, StorePrice } from './cenysk.js'

const BASE = 'https://kompaszliav.sk'

// Ak KOMPAS_PROXY je nastavené, fetchujeme cez Vercel proxy (obchádza IP blokovanie)
const PROXY = process.env.KOMPAS_PROXY ?? ''  // napr. https://smart-nakup.vercel.app/api/kompas-proxy

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

// Produktová karta z HTML — každá ponuka má vlastný produkt, obrázok, obchod, cenu a dátumy
type ProductCard = {
  companyId: string
  storeName: string
  productName: string
  imageUrl: string | null
  price: number
  validFrom: string | null
  validUntil: string | null
}

// "16.6. - 13.7.2026" alebo "27.6.2026 - 13.7.2026" → ISO dátumy
function parseAvailability(text: string): { from: string | null; until: string | null } {
  const m = /(\d{1,2})\.(\d{1,2})\.(\d{4})?\s*-\s*(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(text)
  if (!m) return { from: null, until: null }
  const pad = (n: string) => n.padStart(2, '0')
  const untilY = m[6]
  const fromY = m[3] ?? untilY
  let from = `${fromY}-${pad(m[2])}-${pad(m[1])}`
  const until = `${untilY}-${pad(m[5])}-${pad(m[4])}`
  if (from > until) from = `${parseInt(fromY) - 1}-${pad(m[2])}-${pad(m[1])}`
  return { from, until }
}

function parseProductCards(html: string): ProductCard[] {
  const cards: ProductCard[] = []
  const re = /<a href="[^"]*" class="product-card[^"]*">([\s\S]*?)<\/a>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const body = m[1]
    const storeName = /class="product-store">\s*([^<]+?)\s*</.exec(body)?.[1] ?? ''
    const matched = matchStore(storeName)
    if (!matched) continue  // obchod mimo našej ponuky (Metro, Klas, COOP…)

    const priceStr = /class="product-price">\s*([\d.,]+)/.exec(body)?.[1]
    const price = priceStr ? parseFloat(priceStr.replace(',', '.')) : NaN
    if (!price || isNaN(price)) continue

    const avail = /class="product-availability">\s*([^<]+?)\s*</.exec(body)?.[1] ?? ''
    const { from, until } = parseAvailability(avail)
    const imgRaw = /src="((?:https:\/\/kompaszliav\.sk)?\/public\/gimg\/[^"]+--\d+\.(?:jpe?g|png))"/i.exec(body)?.[1] ?? null
    const productName = /monitoring-data">\s*<span>\s*([^<]+?)\s*</.exec(body)?.[1] ?? ''

    cards.push({
      ...matched,
      productName,
      imageUrl: imgRaw ? (imgRaw.startsWith('http') ? imgRaw : `${BASE}${imgRaw}`) : null,
      price,
      validFrom: from,
      validUntil: until,
    })
  }
  return cards
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
    const fetchUrl = PROXY ? `${PROXY}?url=${encodeURIComponent(url)}` : url
    const res = await fetch(fetchUrl, { headers: PROXY ? {} : HEADERS })
    if (!res.ok) {
      console.log(`kompas fetchHtml ${res.status} — ${url}`)
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

  // Porovnáme podľa dátumu (nie timestamp) — akcia platí celý posledný deň
  const todayStr = new Date().toISOString().slice(0, 10)
  const cards = parseProductCards(html).filter(c => !c.validUntil || c.validUntil >= todayStr)
  if (!cards.length) return null

  // Pre každý obchod nechaj najlacnejšiu kartu — každá si nesie VLASTNÝ obrázok, názov a dátumy
  const byStore = new Map<string, ProductCard>()
  for (const c of cards) {
    const existing = byStore.get(c.companyId)
    if (!existing || c.price < existing.price) byStore.set(c.companyId, c)
  }

  const stores: StorePrice[] = [...byStore.values()].map(c => ({
    companyId: c.companyId,
    storeName: c.storeName,
    price: c.price,
    unitPrice: c.price,
    isPromo: true,
    imageUrl: c.imageUrl,
    validFrom: c.validFrom,
    validUntil: c.validUntil,
    productName: c.productName || undefined,
  }))

  stores.sort((a, b) => a.price - b.price)

  const best = stores[0]
  const worst = stores[stores.length - 1]
  const categoryName = slug.replace(/-/g, ' ')
  const bestName = (best as any).productName ?? categoryName

  return {
    groupKey: `kompas:${slug}`,
    name: bestName,
    // matching v search score potrebuje aj názov kategórie (query „maslo" vs karta „Tami Tatranské maslo")
    nameLower: deaccent(`${categoryName} ${bestName}`),
    unit: 'ks',
    packageSize: 1,
    stores,
    bestPrice: best.price,
    bestUnitPrice: best.price,
    bestStore: best.storeName,
    bestImageUrl: best.imageUrl,
    worstPrice: stores.length > 1 ? worst.price : undefined,
    worstStore: stores.length > 1 ? worst.storeName : undefined,
  }
}

// Session cache: groupKey → ProductGroup
const _cache = new Map<string, ProductGroup>()

// Query cache: query → { results, ts }
const _queryCache = new Map<string, { results: ProductGroup[]; ts: number }>()
const QUERY_TTL = 2 * 60 * 60 * 1000  // 2 hodiny — letákové ceny sa menia raz za týždeň

// Query → slug: "múka hladká" → "muka-hladka"
function queryToSlug(query: string): string {
  return deaccent(query.trim()).replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
}

async function _doSearch(query: string, limit: number): Promise<ProductGroup[]> {
  const baseSlug = queryToSlug(query)

  // Paralelne: /produkty/{slug} + /hladaj?f=query (pre extra slug varianty)
  const [primaryHtml, searchHtml] = await Promise.all([
    fetchHtml(`${BASE}/produkty/${baseSlug}`),
    fetchHtml(`${BASE}/hladaj?f=${encodeURIComponent(query)}`),
  ])

  // Zo search stránky vyber ďalšie kategórie slugy (napr. muka-hladka, muka-polohruba)
  const extraSlugs = searchHtml
    ? extractSlugs(searchHtml).filter(s => s !== baseSlug).slice(0, 3)
    : []

  // Fetch extra kategórií paralelne
  const allHtmls: Array<{ slug: string; html: string }> = []
  if (primaryHtml) allHtmls.push({ slug: baseSlug, html: primaryHtml })
  const extraHtmls = await Promise.all(extraSlugs.map(async s => {
    const h = await fetchHtml(`${BASE}/produkty/${s}`)
    return h ? { slug: s, html: h } : null
  }))
  for (const e of extraHtmls) if (e) allHtmls.push(e)

  // Každú kategóriu sparsuj cez fetchProductGroup (JSON-LD)
  const groups = await Promise.all(allHtmls.map(({ slug }) => fetchProductGroup(slug)))
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
  const timeout = new Promise<ProductGroup[]>(resolve => setTimeout(() => resolve([]), 10000))
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

// Vráti cache-ované výsledky pre query ak existujú, inak undefined
export function getKompasQueryCache(query: string): ProductGroup[] | undefined {
  const key = deaccent(query.trim())
  const cached = _queryCache.get(key)
  if (cached && Date.now() - cached.ts < QUERY_TTL) return cached.results
  return undefined
}
