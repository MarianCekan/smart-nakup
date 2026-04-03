import { Router } from 'express'
import { z } from 'zod'
import { getCache, searchProducts, optimizeCart, COMPANY_NAMES } from '../services/cenysk.js'
import { searchPriceo, getPriceoFromCache, ensurePriceoGroup } from '../services/priceo.js'
import { searchKompas, getKompasFromCache, getKompasQueryCache } from '../services/kompas.js'

export const router = Router()

// CompanyIds pokryté priceo.sk (Tesco, Kaufland, Lidl)
const PRICEO_COMPANY_IDS = new Set(['31321828', '35790164', '35793783'])
// CompanyIds len v cenyslovensko (Terno, Billa, Fresh)
const CENYSK_ONLY_IDS = new Set(['50020188', '36183181', '36644871', '31347037', '36483492'])

router.get('/status', async (_req, res) => {
  try {
    const cache = await getCache()
    res.json({ ok: true, rawProducts: cache.totalRaw, groups: cache.groups.length, loadedAt: new Date(cache.loadedAt).toISOString(), ageMinutes: Math.round((Date.now() - cache.loadedAt) / 60000) })
  } catch {
    res.json({ ok: true, rawProducts: 0, groups: 0, ageMinutes: 0 })
  }
})

// Hardcoded store list — no external API needed
const STORES = [
  { name: 'Billa',     companyIds: ['31347037'] },
  { name: 'Fresh',     companyIds: ['36644871'] },
  { name: 'Kaufland',  companyIds: ['35790164'] },
  { name: 'Lidl',      companyIds: ['35793783'] },
  { name: 'Terno',     companyIds: ['36183181'] },
  { name: 'Tesco',     companyIds: ['31321828'] },
]

router.get('/stores', (_req, res) => {
  res.json(STORES)
})

function toHit(g: ReturnType<typeof Object.assign>, source: 'priceo' | 'cenysk' | 'kompas') {
  return {
    groupKey: g.groupKey,
    name: g.name,
    unit: g.unit,
    packageSize: g.packageSize,
    imageUrl: g.bestImageUrl,
    bestPrice: g.bestPrice,
    bestStore: g.bestStore,
    bestUnitPrice: g.bestUnitPrice,
    storeCount: g.stores.length,
    storeNames: Array.from(new Set<string>(g.stores.map((s: any) => s.storeName))),
    source,
  }
}

// Zjednodušenie query na hľadanie alternatív — prvé 1-2 zmysluplné slová
function simplifyQuery(name: string): string {
  const stop = new Set(['z', 'a', 'v', 'na', 'do', 'zo', 'pre', 'pri', 'po', 'so', 'ku', 'i'])
  const words = name.toLowerCase()
    .replace(/\d+\s*(ks|g|kg|ml|l|%|cm|mm)/gi, '') // odstráň množstvá
    .split(/[\s,+&/]+/)
    .filter(w => w.length > 2 && !stop.has(w))
  return words.slice(0, 2).join(' ').trim()
}

// Merge kompas promo stores into a priceo/cenysk group — lower price always wins
function mergeKompasIntoGroup(group: any, kompasResults: any[]): any {
  const kMatch = kompasResults.find(k => {
    const a = k.nameLower, b = group.nameLower
    if (a === b) return true
    // Vyžaduj aspoň 2 zmysluplné slová v kompas názve — generické single-word kategórie (napr. "mlieko")
    // nesmú matchovať všetky varianty (polotučné vs plnotučné sú iné produkty)
    const aWords = a.split(/[\s,+%/]+/).filter((w: string) => w.length > 3 && !/^\d/.test(w))
    const bWords = b.split(/[\s,+%/]+/).filter((w: string) => w.length > 3 && !/^\d/.test(w))
    if (!aWords.length || !bWords.length) return false
    // Ak kompas má 1 slovo (napr. "Mrkva"), matchuj len ak prvé slovo priceo produktu súhlasí
    // A druhé slovo (ak existuje) NIE JE variant-descriptor (tučné/polotučné/plnotučné...)
    // 1-slovné kompas názvy (napr. "Mrkva", "Mlieko") sú príliš generické na merge —
    // jeden slug pokrýva desiatky variant produktov → mergovanie by kazilo ceny všetkých
    if (aWords.length === 1) return false
    const shorter = aWords.length <= bWords.length ? aWords : bWords
    const longer  = aWords.length <= bWords.length ? bWords : aWords
    return shorter.every((w: string) => longer.some((lw: string) => lw.includes(w) || w.includes(lw)))
  })
  if (!kMatch) return group

  console.log(`🔀 kompas merge: "${kMatch.name}" → priceo "${group.name}" | kompas stores: ${kMatch.stores.map((s: any) => `${s.storeName}:${s.price}`).join(', ')}`)

  const stores = [...group.stores]
  for (const ks of kMatch.stores) {
    const idx = stores.findIndex((s: any) => s.companyId === ks.companyId)
    if (idx >= 0) {
      // Aktualizuj cenu ak je kompas lacnejší
      if (ks.price < stores[idx].price) stores[idx] = { ...stores[idx], price: ks.price, unitPrice: ks.price, isPromo: true }
    } else {
      // Pridaj obchod z kompas ktorý nie je v priceo/cenysk
      stores.push({ ...ks, isPromo: true })
    }
  }
  stores.sort((a: any, b: any) => a.price - b.price)
  const best = stores[0]
  return { ...group, stores, bestPrice: best.price, bestUnitPrice: best.unitPrice, bestStore: best.storeName, bestImageUrl: group.bestImageUrl || best.imageUrl }
}

router.get('/products/search', async (req, res) => {
  const q = String(req.query.q ?? '').trim()
  if (q.length < 2) return res.json([])
  try {
    // LEN KOMPAS — priceo aj cenysk zakomentované
    const kompasResults = getKompasQueryCache(q) ?? await searchKompas(q, 20).catch(() => [])
    if (!kompasResults.length) searchKompas(q, 20).catch(() => {})

    const merged = kompasResults
      .map(g => toHit(g, 'kompas'))
      .slice(0, 20)

    res.json(merged)
  } catch (e: any) { res.status(502).json({ error: e.message }) }
})

router.post('/recipes/check', async (req, res) => {
  const { ingredients } = req.body as { ingredients: string[] }
  if (!Array.isArray(ingredients) || ingredients.length === 0) return res.json({})
  const results: Record<string, ReturnType<typeof toHit> | null> = {}
  await Promise.all(ingredients.map(async q => {
    try {
      const hits = getKompasQueryCache(q) ?? await searchKompas(q, 3).catch(() => [])
      results[q] = hits.length > 0 ? toHit(hits[0], 'kompas') : null
    } catch { results[q] = null }
  }))
  res.json(results)
})

const OptimizeSchema = z.object({
  items: z.array(z.object({ query: z.string().min(1), groupKey: z.string().optional() })).min(1).max(50),
  company_ids: z.array(z.string()).optional().default([]),
})

router.post('/optimize', async (req, res) => {
  const parsed = OptimizeSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

  const { items, company_ids } = parsed.data
  const allowedPriceo = company_ids.filter(id => PRICEO_COMPANY_IDS.has(id))
  const allowedCenysk = company_ids.filter(id => CENYSK_ONLY_IDS.has(id))

  console.log(`📦 optimize items: ${items.map(i => `${i.query}[${i.groupKey ?? 'no-key'}]`).join(', ')}`)

  try {
    // LEN KOMPAS — všetky items cez kompas
    const allowedAll = [...allowedPriceo, ...allowedCenysk]
    const kompasStoreMap = new Map<string, { storeName: string; companyId: string; items: any[]; subtotal: number }>()
    const kompasUnmatched: string[] = []

    for (const item of items) {
      let group = item.groupKey ? getKompasFromCache(item.groupKey) : undefined
      if (!group) {
        const results = await searchKompas(item.query, 5)
        group = item.groupKey ? results.find(g => g.groupKey === item.groupKey) : results[0]
      }
      if (!group) { kompasUnmatched.push(item.query); continue }

      const eligible = (allowedAll.length > 0
        ? group.stores.filter((s: any) => allowedAll.includes(s.companyId))
        : group.stores
      ).sort((a: any, b: any) => a.price - b.price)
      if (!eligible.length) { kompasUnmatched.push(item.query); continue }

      const chosen = eligible[0]
      console.log(`🛒 kompas optimize "${group.name}": chosen ${chosen.storeName}:${chosen.price}`)
      if (!kompasStoreMap.has(chosen.companyId)) {
        kompasStoreMap.set(chosen.companyId, { storeName: chosen.storeName, companyId: chosen.companyId, items: [], subtotal: 0 })
      }
      const grp = kompasStoreMap.get(chosen.companyId)!
      grp.items.push({ query: item.query, name: group.name, groupKey: group.groupKey, packageSize: group.packageSize, unit: group.unit, price: chosen.price, unitPrice: chosen.unitPrice, isPromo: true, imageUrl: chosen.imageUrl ?? group.bestImageUrl, allStores: group.stores })
      grp.subtotal = parseFloat((grp.subtotal + chosen.price).toFixed(2))
    }

    const allStores = Array.from(kompasStoreMap.values()).sort((a, b) => b.subtotal - a.subtotal)
    const total_optimized = parseFloat(allStores.reduce((s, g) => s + g.subtotal, 0).toFixed(2))
    const total_worst = total_optimized // kompas má len jednu cenu → žiadna úspora

    res.json({
      stores: allStores,
      total_optimized,
      total_worst,
      total_saving: 0,
      unmatched: kompasUnmatched,
      needsApproval: [],
    })
  } catch (e: any) { res.status(502).json({ error: e.message }) }
})
