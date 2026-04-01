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
    // Ak kompas má 1 slovo, matchuj len ak je to prvé slovo aj priceo produktu
    if (aWords.length === 1) return bWords[0] === aWords[0]
    const shorter = aWords.length <= bWords.length ? aWords : bWords
    const longer  = aWords.length <= bWords.length ? bWords : aWords
    return shorter.every((w: string) => longer.some((lw: string) => lw.includes(w) || w.includes(lw)))
  })
  if (!kMatch) return group

  const stores = [...group.stores]
  for (const ks of kMatch.stores) {
    const idx = stores.findIndex((s: any) => s.companyId === ks.companyId)
    // Len updatni cenu ak obchod už existuje v priceo — nepridávaj nové obchody
    // (kompas "mlieko" kategória má ceny za rôzne druhy mlieka, nie konkrétny produkt)
    if (idx >= 0 && ks.price < stores[idx].price) {
      stores[idx] = { ...ks, isPromo: true }
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
    // Paralelne dotaz na priceo + cenysk
    const [priceoResults, cenyskResults] = await Promise.all([
      searchPriceo(q, 12).catch(() => []),
      searchProducts(q, 12).catch(() => []),
    ])

    // Kompas: ak je v cache → použij hneď; inak spusti na pozadí (rýchla odozva)
    const kompasResults = getKompasQueryCache(q) ?? []
    if (!kompasResults.length) searchKompas(q, 6).catch(() => {})

    // priceo → Tesco/Kaufland/Lidl (stále ceny)
    // cenyslovensko → filtruj len Terno/Billa/Fresh (ostatné pokrýva priceo)
    const cenyskFiltered = cenyskResults
      .map(g => ({ ...g, stores: g.stores.filter(s => CENYSK_ONLY_IDS.has(s.companyId)) }))
      .filter(g => g.stores.length > 0)
      .map(g => {
        const best = g.stores[0]
        return { ...g, bestPrice: best.price, bestUnitPrice: best.unitPrice, bestStore: best.storeName, bestImageUrl: best.imageUrl }
      })

    // Merge kompas promo ceny do priceo/cenysk výsledkov (nižšia cena vyhráva)
    const priceoMerged = priceoResults.map(g => mergeKompasIntoGroup(g, kompasResults))
    const cenyskMerged = cenyskFiltered.map(g => mergeKompasIntoGroup(g, kompasResults))

    // Kompas produkty ktoré nie sú v priceo/cenysk → zobraz samostatne
    const allMergedNames = new Set([...priceoMerged, ...cenyskMerged].map(g => g.nameLower))
    const kompasOnly = kompasResults.filter(k => {
      return ![...allMergedNames].some(n => n === k.nameLower || n.includes(k.nameLower) || k.nameLower.includes(n))
    })

    const merged = [
      ...priceoMerged.map(g => toHit(g, 'priceo')),
      ...cenyskMerged.map(g => toHit(g, 'cenysk')),
      ...kompasOnly.map(g => toHit(g, 'kompas')),
    ].slice(0, 20)

    res.json(merged)
  } catch (e: any) { res.status(502).json({ error: e.message }) }
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

  try {
    // Rozdeľ items na priceo vs cenysk vs kompas podľa groupKey
    const priceoItems: typeof items = []
    const cenyskItems: typeof items = []
    const kompasItems: typeof items = []
    const mixedItems: typeof items = [] // bez groupKey → hľadáme vo všetkých

    for (const item of items) {
      if (item.groupKey?.startsWith('priceo:')) {
        priceoItems.push(item)
      } else if (item.groupKey?.startsWith('kompas:')) {
        kompasItems.push(item)
      } else if (item.groupKey) {
        cenyskItems.push(item)
      } else {
        mixedItems.push(item)
      }
    }

    // Vyreš mixed items: hľadáme v priceo aj cenysk, vyberieme podľa toho aké obchody sú allowed
    for (const item of mixedItems) {
      const wantPriceo = allowedPriceo.length > 0 || company_ids.length === 0
      const wantCenysk = allowedCenysk.length > 0 || company_ids.length === 0
      if (wantPriceo) priceoItems.push(item)
      if (wantCenysk) cenyskItems.push(item)
    }

    // Resolve priceo items — načítaj ProductGroup z cache alebo re-search
    type ResolvedItem = { query: string; groupKey?: string; group: any; source: 'priceo' | 'cenysk' }
    const resolvedPriceo: ResolvedItem[] = []
    const priceoUnresolvedUnmatched: string[] = []
    for (const item of priceoItems) {
      let group = item.groupKey ? getPriceoFromCache(item.groupKey) : undefined
      if (!group) {
        const results = await searchPriceo(item.query, 5)
        group = item.groupKey ? results.find(g => g.groupKey === item.groupKey) : results[0]
      }
      if (group) {
        resolvedPriceo.push({ query: item.query, groupKey: item.groupKey, group, source: 'priceo' })
      } else {
        priceoUnresolvedUnmatched.push(item.query)
      }
    }

    // Vyreš cenysk items cez existujúci optimizeCart ale len s CENYSK_ONLY obchodmi
    const effectiveCenyskIds = company_ids.length === 0
      ? [...CENYSK_ONLY_IDS]
      : allowedCenysk

    const cenyskResult = cenyskItems.length > 0
      ? await optimizeCart(cenyskItems, effectiveCenyskIds)
      : { stores: [], total_optimized: 0, total_worst: 0, total_saving: 0, unmatched: [], needsApproval: [] }

    // Teraz optimalizuj priceo items manuálne
    const priceoStoreMap = new Map<string, { storeName: string; companyId: string; items: any[]; subtotal: number }>()
    const priceoUnmatched: string[] = []
    const priceoNeedsApproval: any[] = []

    for (const { query, groupKey, group: rawGroup } of resolvedPriceo) {
      // Kompas lookup: skús prvé slovo názvu produktu (najpravdepodobnejšie čo user hľadal)
      // Napr. "Mlieko polotučné 1,5% 1l" → "mlieko" → cache hit z predchádzajúceho searchu
      const kompasQuery = simplifyQuery(rawGroup.nameLower)
      const kompasForItem = await searchKompas(kompasQuery, 3).catch(() => [])
      const group = mergeKompasIntoGroup(rawGroup, kompasForItem)

      const eligible = (company_ids.length === 0
        ? group.stores  // žiadny filter → všetky obchody
        : allowedPriceo.length > 0
          ? group.stores.filter((s: any) => allowedPriceo.includes(s.companyId))
          : [])  // user vybral len cenysk obchody → priceo položka tam nie je

      if (!eligible.length) {
        // Hľadaj alternatívu
        if (company_ids.length > 0) {
          const findAlt = (results: any[]) =>
            results.find((a: any) => a.groupKey !== group.groupKey && a.stores.some((s: any) => allowedPriceo.includes(s.companyId)))

          // 1. skús plný názov, 2. fallback na zjednodušený (napr. "vajcia" namiesto "vajcia z podstielkového chovu M a L 10ks")
          let alts = await searchPriceo(group.name, 10)
          let alt = findAlt(alts)
          if (!alt) {
            const simple = simplifyQuery(group.name)
            if (simple && simple !== group.nameLower) {
              alts = await searchPriceo(simple, 10)
              alt = findAlt(alts)
            }
          }
          if (alt) {
            const bestAlt = alt.stores.find((s: any) => allowedPriceo.includes(s.companyId))!
            priceoNeedsApproval.push({ originalQuery: query, originalGroupKey: groupKey, suggested: { groupKey: alt.groupKey, name: alt.name, unit: alt.unit, packageSize: alt.packageSize, imageUrl: bestAlt.imageUrl ?? alt.bestImageUrl, price: bestAlt.price, unitPrice: bestAlt.unitPrice, storeName: bestAlt.storeName, isPromo: bestAlt.isPromo } })
            continue
          }
        }
        priceoUnmatched.push(query)
        continue
      }

      const chosen = eligible[0]
      if (!priceoStoreMap.has(chosen.companyId)) {
        priceoStoreMap.set(chosen.companyId, { storeName: chosen.storeName, companyId: chosen.companyId, items: [], subtotal: 0 })
      }
      const grp = priceoStoreMap.get(chosen.companyId)!
      grp.items.push({ query, name: group.name, groupKey: group.groupKey, packageSize: group.packageSize, unit: group.unit, price: chosen.price, unitPrice: chosen.unitPrice, isPromo: chosen.isPromo, imageUrl: chosen.imageUrl ?? group.bestImageUrl, allStores: group.stores })
      grp.subtotal = parseFloat((grp.subtotal + chosen.price).toFixed(2))
    }

    // Resolve + optimalizuj kompas items
    const kompasStoreMap = new Map<string, { storeName: string; companyId: string; items: any[]; subtotal: number }>()
    const kompasUnmatched: string[] = []
    const allowedAll = [...allowedPriceo, ...allowedCenysk]

    for (const item of kompasItems) {
      let group = item.groupKey ? getKompasFromCache(item.groupKey) : undefined
      if (!group) {
        const results = await searchKompas(item.query, 5)
        group = item.groupKey ? results.find(g => g.groupKey === item.groupKey) : results[0]
      }
      if (!group) { kompasUnmatched.push(item.query); continue }

      const eligible = allowedAll.length > 0
        ? group.stores.filter((s: any) => allowedAll.includes(s.companyId))
        : group.stores
      if (!eligible.length) { kompasUnmatched.push(item.query); continue }

      const chosen = eligible[0]
      if (!kompasStoreMap.has(chosen.companyId)) {
        kompasStoreMap.set(chosen.companyId, { storeName: chosen.storeName, companyId: chosen.companyId, items: [], subtotal: 0 })
      }
      const grp = kompasStoreMap.get(chosen.companyId)!
      grp.items.push({ query: item.query, name: group.name, groupKey: group.groupKey, packageSize: group.packageSize, unit: group.unit, price: chosen.price, unitPrice: chosen.unitPrice, isPromo: true, imageUrl: chosen.imageUrl ?? group.bestImageUrl, allStores: group.stores })
      grp.subtotal = parseFloat((grp.subtotal + chosen.price).toFixed(2))
    }

    // Zlúč priceo + cenysk + kompas stores (merge podľa companyId)
    const storeMapFinal = new Map<string, { storeName: string; companyId: string; items: any[]; subtotal: number }>()
    for (const s of [...Array.from(priceoStoreMap.values()), ...cenyskResult.stores, ...Array.from(kompasStoreMap.values())]) {
      if (!storeMapFinal.has(s.companyId)) {
        storeMapFinal.set(s.companyId, { storeName: s.storeName, companyId: s.companyId, items: [], subtotal: 0 })
      }
      const entry = storeMapFinal.get(s.companyId)!
      entry.items.push(...s.items)
      entry.subtotal = parseFloat((entry.subtotal + s.subtotal).toFixed(2))
    }
    const allStores = Array.from(storeMapFinal.values()).sort((a, b) => b.subtotal - a.subtotal)

    const total_optimized = parseFloat(allStores.reduce((s, g) => s + g.subtotal, 0).toFixed(2))
    const total_worst = parseFloat((
      [...resolvedPriceo.map(({ group }) => {
        const eligible = allowedPriceo.length > 0 ? group.stores.filter((s: any) => allowedPriceo.includes(s.companyId)) : group.stores
        return eligible.length ? eligible[eligible.length - 1].price : 0
      }),
      ].reduce((a, b) => a + b, 0) + cenyskResult.total_worst
    ).toFixed(2))

    res.json({
      stores: allStores,
      total_optimized,
      total_worst,
      total_saving: parseFloat((total_worst - total_optimized).toFixed(2)),
      unmatched: [...priceoUnresolvedUnmatched, ...priceoUnmatched, ...cenyskResult.unmatched, ...kompasUnmatched],
      needsApproval: [...priceoNeedsApproval, ...cenyskResult.needsApproval],
    })
  } catch (e: any) { res.status(502).json({ error: e.message }) }
})
