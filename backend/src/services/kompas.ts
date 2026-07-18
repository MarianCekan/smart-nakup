/**
 * kompaszliav.sk scraper
 * Letákové akciové ceny — parsuje JSON-LD zo stránok produktov.
 * Žiadne API, scrape HTML.
 */

import type { ProductGroup, StorePrice } from './cenysk.js'
import { pool } from '../db.js'

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
  'coop':        { companyId: 'coop-jednota', storeName: 'COOP Jednota' },
  'klas':        { companyId: 'klas',         storeName: 'Klas' },
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

// Balenie z názvu produktu: "TAMI maslo 125 g" → 125 g. Ak v názve nie je, jednotku NEPOZNÁME
// (karta ju neuvádza) — vtedy vraciame null a FE nič nezobrazí (žiadne vymyslené "1ks").
function parsePack(name: string): { packageSize: number; unit: string } | null {
  const re = /(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml|ks)(?![\w%])/gi
  let m: RegExpExecArray | null
  let last: { packageSize: number; unit: string } | null = null
  while ((m = re.exec(name)) !== null) {
    last = { packageSize: parseFloat(m[1].replace(',', '.')), unit: m[2].toLowerCase() }
  }
  return last
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

const CF_CHALLENGE = 'Just a moment'

async function fetchDirect(url: string): Promise<string | null> {
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

// r.jina.ai relay — prejde cez Cloudflare challenge ktorý blokuje datacenter IP (Render/Vercel)
async function fetchViaJina(url: string): Promise<string | null> {
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, { headers: { 'X-Return-Format': 'html' } })
    if (!res.ok) {
      console.log(`kompas jina relay ${res.status} — ${url}`)
      return null
    }
    const html = await res.text()
    return html.includes(CF_CHALLENGE) ? null : html
  } catch (e: any) {
    console.log(`kompas jina relay error: ${e.message} — ${url}`)
    return null
  }
}

// HTML cache — jina relay je rate-limitovaný, tá istá stránka sa nesmie fetchovať opakovane
const _htmlCache = new Map<string, { html: string; ts: number }>()
const HTML_TTL = 30 * 60 * 1000

// Jina RATE limiter — free tier je ~20 req/min, burst = 429. Globálne rozostupy 3.2s
// medzi štartmi requestov (~18/min) bez ohľadu na počet súbežných queries.
let _jinaNextAt = 0
async function withJinaSlot<T>(fn: () => Promise<T>): Promise<T> {
  const wait = Math.max(0, _jinaNextAt - Date.now())
  _jinaNextAt = Math.max(Date.now(), _jinaNextAt) + 3200
  if (wait > 0) await new Promise(r => setTimeout(r, wait))
  return fn()
}

// Keď direct fetch narazí na CF challenge, 10 min ho neskúšame (šetrí latenciu)
let _challengedUntil = 0

async function fetchHtml(url: string): Promise<string | null> {
  const cached = _htmlCache.get(url)
  if (cached && Date.now() - cached.ts < HTML_TTL) return cached.html

  let html: string | null = null
  if (Date.now() > _challengedUntil) {
    html = await fetchDirect(url)
    if (html && html.includes(CF_CHALLENGE)) {
      console.log(`kompas: CF challenge, 10 min prepíname na jina — ${url}`)
      _challengedUntil = Date.now() + 10 * 60 * 1000
      html = null
    }
  }
  if (!html) {
    html = await withJinaSlot(() => fetchViaJina(url))
    if (!html) {
      // jina retry raz — 429/timeout býva prechodný
      await new Promise(r => setTimeout(r, 1500))
      html = await withJinaSlot(() => fetchViaJina(url))
    }
  }
  if (html) _htmlCache.set(url, { html, ts: Date.now() })
  return html
}

// Jedna kategória (slug) môže obsahovať viac rôznych produktov/balení —
// klastrujeme podľa normalizovaného názvu, aby sa neporovnávalo 50g balenie s 250g sáčkom
async function fetchProductGroups(slug: string, presetHtml?: string): Promise<ProductGroup[]> {
  const html = presetHtml ?? await fetchHtml(`${BASE}/produkty/${slug}`)
  if (!html) return []

  // Porovnáme podľa dátumu (nie timestamp) — akcia platí celý posledný deň
  const todayStr = new Date().toISOString().slice(0, 10)
  const cards = parseProductCards(html).filter(c => !c.validUntil || c.validUntil >= todayStr)
  if (!cards.length) return []

  const categoryName = slug.replace(/-/g, ' ')

  // Klaster = rovnaký normalizovaný názov produktu naprieč obchodmi
  const clusters = new Map<string, ProductCard[]>()
  for (const c of cards) {
    const k = deaccent(c.productName || categoryName).replace(/\s+/g, ' ')
    const arr = clusters.get(k)
    if (arr) arr.push(c); else clusters.set(k, [c])
  }

  const groups: ProductGroup[] = []
  for (const [key, cs] of clusters) {
    // V rámci klastra: najlacnejšia karta pre každý obchod
    const byStore = new Map<string, ProductCard>()
    for (const c of cs) {
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
    const name = cs[0].productName || categoryName
    const pack = parsePack(name)

    groups.push({
      groupKey: `kompas:${slug}:${key.replace(/[^a-z0-9]+/g, '-')}`,
      name,
      // matching v search score potrebuje aj názov kategórie (query „maslo" vs karta „Tami Tatranské maslo")
      nameLower: deaccent(`${categoryName} ${name}`),
      unit: pack?.unit ?? '',
      packageSize: pack?.packageSize ?? 0,
      stores,
      bestPrice: best.price,
      bestUnitPrice: best.price,
      bestStore: best.storeName,
      bestImageUrl: best.imageUrl,
      // úspora len v rámci TOHO ISTÉHO produktu vo viacerých obchodoch
      worstPrice: stores.length > 1 ? worst.price : undefined,
      worstStore: stores.length > 1 ? worst.storeName : undefined,
    })
  }

  groups.sort((a, b) => a.bestPrice - b.bestPrice)
  // groupKey cache — potrebné pre optimize (getKompasFromCache) a approval flow
  for (const g of groups) _cache.set(g.groupKey, g)
  return groups
}

// Všetky produkty (klastre) jednej kategórie — na hľadanie alternatív toho istého druhu
export async function getKompasCategoryGroups(slug: string): Promise<ProductGroup[]> {
  return fetchProductGroups(slug)
}

// Session cache: groupKey → ProductGroup
const _cache = new Map<string, ProductGroup>()

// In-flight searches: query key → promise (dedupe súbežných volaní)
const _inflight = new Map<string, Promise<ProductGroup[]>>()

// Query cache: query → { results, ts }
const _queryCache = new Map<string, { results: ProductGroup[]; ts: number }>()
const QUERY_TTL = 2 * 60 * 60 * 1000  // 2 hodiny — letákové ceny sa menia raz za týždeň

// Query → slug: "múka hladká" → "muka-hladka"
function queryToSlug(query: string): string {
  return deaccent(query.trim()).replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
}

async function _doSearch(query: string, limit: number): Promise<ProductGroup[]> {
  const baseSlug = queryToSlug(query)

  // Najprv len primárny slug — typicky stačí (1 stránka/query šetrí jina relay budget)
  const primaryHtml = await fetchHtml(`${BASE}/produkty/${baseSlug}`)
  const primaryHasCards = primaryHtml ? primaryHtml.includes('class="product-card') : false

  const allHtmls: Array<{ slug: string; html: string }> = []
  if (primaryHtml) allHtmls.push({ slug: baseSlug, html: primaryHtml })

  // /hladaj + extra kategórie LEN keď primárna kategória nemá karty
  if (!primaryHasCards) {
    const searchHtml = await fetchHtml(`${BASE}/hladaj?f=${encodeURIComponent(query)}`)
    if (searchHtml) {
      const extraSlugs = extractSlugs(searchHtml).filter(s => s !== baseSlug).slice(0, 3)
      const extraHtmls = await Promise.all(extraSlugs.map(async s => {
        const h = await fetchHtml(`${BASE}/produkty/${s}`)
        return h ? { slug: s, html: h } : null
      }))
      for (const e of extraHtmls) if (e) allHtmls.push(e)
    }
  }

  // Každú kategóriu sparsuj na klastre produktov (HTML už máme — žiadny druhý fetch)
  const nested = await Promise.all(allHtmls.map(({ slug, html }) => fetchProductGroups(slug, html)))
  // Dedup — ten istý produkt sa objavuje vo viacerých kategóriách (slugoch)
  const seen = new Set<string>()
  let valid = nested.flat().filter(g => {
    const k = `${deaccent(g.name)}|${g.bestPrice}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })

  // Neúplné slovo ("mlie" namiesto "mlieko") nemá vlastnú kategóriu na kompase, takže
  // priamy fetch aj /hladaj vrátia buď prázdno, alebo len nesúvisiace produkty. Prilej
  // do mixu aj produkty, ktoré už poznáme z predošlých hľadaní/warm-upu — skórovanie
  // nižšie si aj tak vyberie len relevantné zhody, netreba čakať kým dopíše celé slovo.
  const qDeaccent = deaccent(query.trim())
  for (const g of _cache.values()) {
    if (!deaccent(g.name).includes(qDeaccent)) continue
    const k = `${deaccent(g.name)}|${g.bestPrice}`
    if (seen.has(k)) continue
    seen.add(k)
    valid.push(g)
  }

  const q = deaccent(query.trim())
  const qWords = q.split(/\s+/).filter(w => w.length > 1)
  const scored = valid.map(g => {
    // Primárne skóruj podľa NÁZVU PRODUKTU — inak query "cesnak" vyhrá
    // najlacnejšia "Syrová nátierka s cesnakom" z kategórie cesnak.
    // Všetky plné name-matche majú ROVNAKÉ skóre → medzi nimi rozhoduje cena
    // (exact "Cibuľa" za 2.45 nesmie poraziť "Clever cibuľa" za 0.59).
    const prod = deaccent(g.name)
    const cat = (g.groupKey.split(':')[1] ?? '').replace(/-/g, ' ')
    let score = 0
    if (qWords.length && qWords.every(w => prod.includes(w))) score = 80
    else if (qWords.length && qWords.filter(w => prod.includes(w)).length / qWords.length >= 0.5) score = 60
    else if (cat === q) score = 40        // kategória sedí, ale názov produktu query neobsahuje
    else if (cat.includes(q) || q.includes(cat)) score = 30
    else {
      const hits = qWords.filter(w => g.nameLower.includes(w))
      if (hits.length) score = (hits.length / qWords.length) * 25
    }
    return { g, score }
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score || a.g.bestPrice - b.g.bestPrice)

  // matchScore pre callerov (recipes/optimize vyžadujú name-match ≥ 50, dropdown berie všetko)
  for (const x of scored) (x.g as any).matchScore = x.score

  const results = scored.slice(0, limit).map(x => x.g)
  for (const g of results) _cache.set(g.groupKey, g)
  return results
}

// Perzistentná query cache v Postgrese — prežije reštart/sleep Rendera,
// takže studený štart nemusí nič scrapovať (jina je rate-limitovaná)
let _dbCacheReady: Promise<void> | null = null
function ensureDbCache(): Promise<void> {
  if (!_dbCacheReady) {
    _dbCacheReady = pool.query(
      `CREATE TABLE IF NOT EXISTS kompas_cache (key TEXT PRIMARY KEY, results JSONB NOT NULL, ts TIMESTAMPTZ NOT NULL DEFAULT now())`
    ).then(() => undefined).catch(e => { console.log('kompas_cache init error:', e.message); _dbCacheReady = null })
  }
  return _dbCacheReady ?? Promise.resolve()
}

async function dbCacheGet(key: string): Promise<ProductGroup[] | null> {
  try {
    await ensureDbCache()
    const { rows } = await pool.query(
      `SELECT results FROM kompas_cache WHERE key = $1 AND ts > now() - interval '2 hours'`, [key]
    )
    return rows.length ? rows[0].results as ProductGroup[] : null
  } catch { return null }
}

function dbCacheSet(key: string, results: ProductGroup[]) {
  ensureDbCache().then(() => pool.query(
    `INSERT INTO kompas_cache (key, results, ts) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET results = $2, ts = now()`,
    [key, JSON.stringify(results)]
  )).catch(e => console.log('kompas_cache write error:', e.message))
}

export async function searchKompas(query: string, limit = 6, timeoutMs = 10000): Promise<ProductGroup[]> {
  if (query.trim().length < 2) return []

  const key = deaccent(query.trim())

  // 1. pamäťová cache
  const cached = _queryCache.get(key)
  if (cached && Date.now() - cached.ts < QUERY_TTL) return cached.results

  // 2. Postgres cache (prežila reštart) — hydratuj aj pamäťovú a groupKey cache
  const fromDb = await dbCacheGet(key)
  if (fromDb && fromDb.length) {
    _queryCache.set(key, { results: fromDb, ts: Date.now() })
    for (const g of fromDb) _cache.set(g.groupKey, g)
    return fromDb
  }

  // 3. scrape — dedupe súbežných požiadaviek + zapíš cache aj keď race timeoutne
  // (FE retry potom nájde výsledky v cache namiesto nového scrape-u)
  let inflight = _inflight.get(key)
  if (!inflight) {
    inflight = _doSearch(query, limit)
      .then(results => {
        if (results.length) {
          _queryCache.set(key, { results, ts: Date.now() })
          dbCacheSet(key, results)
        }
        return results
      })
      .finally(() => _inflight.delete(key))
    _inflight.set(key, inflight)
  }

  const start = Date.now()
  const timeout = new Promise<ProductGroup[]>(resolve => setTimeout(() => resolve([]), timeoutMs))
  const results = await Promise.race([inflight, timeout])
  const elapsed = Date.now() - start

  if (results.length) {
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
