import { Router } from 'express'
import { z } from 'zod'
import { getCache, searchProducts, optimizeCart, COMPANY_NAMES } from '../services/cenysk.js'
import { searchPriceo, getPriceoFromCache, ensurePriceoGroup } from '../services/priceo.js'
import { searchKompas, getKompasFromCache, getKompasQueryCache, getKompasCategoryGroups } from '../services/kompas.js'

export const router = Router()

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
  { name: 'Billa',        companyIds: ['31347037'] },
  { name: 'COOP Jednota', companyIds: ['coop-jednota'] },
  { name: 'Fresh',        companyIds: ['36644871'] },
  { name: 'Kaufland',     companyIds: ['35790164'] },
  { name: 'Klas',         companyIds: ['klas'] },
  { name: 'Lidl',         companyIds: ['35793783'] },
  { name: 'Terno',        companyIds: ['36183181'] },
  { name: 'Tesco',        companyIds: ['31321828'] },
]

router.get('/stores', (_req, res) => {
  res.json(STORES)
})

// Cena za jednotku — normalizuje na €/kg alebo €/l bez ohľadu na veľkosť balenia,
// aby sa dali férovo porovnať rôzne balenia toho istého produktu naprieč obchodmi.
// Bez rozpoznanej gramáže (unit 'ks' alebo packageSize 0) nemá zmysel — vraciame null.
function computeUnitPrice(price: number, packageSize: number, unit: string): { value: number; label: 'kg' | 'l' } | null {
  if (!packageSize || packageSize <= 0) return null
  switch (unit.toLowerCase()) {
    case 'kg': return { value: price / packageSize, label: 'kg' }
    case 'g':  return { value: price / (packageSize / 1000), label: 'kg' }
    case 'l':  return { value: price / packageSize, label: 'l' }
    case 'ml': return { value: price / (packageSize / 1000), label: 'l' }
    default:   return null
  }
}

function toHit(g: ReturnType<typeof Object.assign>, source: 'priceo' | 'cenysk' | 'kompas') {
  const bestStore = (g.stores as any[])?.find(s => s.storeName === g.bestStore)
  const saving = g.worstPrice && g.worstPrice > g.bestPrice
    ? parseFloat((g.worstPrice - g.bestPrice).toFixed(2))
    : null
  const norm = computeUnitPrice(g.bestPrice, g.packageSize, g.unit)
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
    promoFrom: bestStore?.validFrom ?? null,
    promoUntil: bestStore?.validUntil ?? null,
    saving,
    worstStore: g.worstStore ?? null,
    normPrice: norm?.value ?? null,
    normUnit: norm?.label ?? null,
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
      const hits = getKompasQueryCache(q) ?? await searchKompas(q, 3, 60000).catch(() => [])
      // len PLNÉ name-matche (všetky slová dopytu v názve) — "paprika mletá" nesmie
      // vrátiť "Biela paprika" (zelenina ≠ korenie), "kyslá kapusta" nie "Kapusta červená"
      const strong = hits.find(h => ((h as any).matchScore ?? 0) >= 70)
      results[q] = strong ? toHit(strong, 'kompas') : null
    } catch { results[q] = null }
  }))
  res.json(results)
})

// ─── Plány podľa počtu obchodov ───────────────────────────────────────────────
// Každá matchnutá položka nesie zoznam „eligible" obchodov (zvolené obchody, ktoré
// produkt majú), zoradený od najlacnejšieho. Pre limit K obchodov hľadáme najlacnejšie
// pokrytie CELÉHO zoznamu podmnožinou ≤K obchodov (bruteforce — max 8 obchodov, triviálne).
type Matched = { query: string; group: any; eligible: any[] }
const round2 = (n: number) => parseFloat(n.toFixed(2))

function makePlanItem(m: Matched, chosen: any) {
  const group = m.group
  const worstPrice = group.worstPrice
  const saving = worstPrice && worstPrice > chosen.price ? round2(worstPrice - chosen.price) : null
  const norm = computeUnitPrice(chosen.price, group.packageSize, group.unit)
  return {
    query: m.query, name: chosen.productName ?? group.name, groupKey: group.groupKey,
    packageSize: group.packageSize, unit: group.unit, price: chosen.price, unitPrice: chosen.unitPrice,
    isPromo: true, imageUrl: chosen.imageUrl ?? group.bestImageUrl, allStores: group.stores,
    promoFrom: chosen.validFrom ?? null, promoUntil: chosen.validUntil ?? null,
    saving, worstStore: group.worstStore ?? null, normPrice: norm?.value ?? null, normUnit: norm?.label ?? null,
  }
}

function groupAssignments(assign: { m: Matched; chosen: any }[]) {
  const map = new Map<string, { storeName: string; companyId: string; items: any[]; subtotal: number }>()
  for (const { m, chosen } of assign) {
    if (!map.has(chosen.companyId)) map.set(chosen.companyId, { storeName: chosen.storeName, companyId: chosen.companyId, items: [], subtotal: 0 })
    const g = map.get(chosen.companyId)!
    g.items.push(makePlanItem(m, chosen))
    g.subtotal = round2(g.subtotal + chosen.price)
  }
  return Array.from(map.values()).sort((a, b) => b.subtotal - a.subtotal)
}

// Všetky podmnožiny veľkosti 1..k
function subsetsUpTo(arr: string[], k: number): string[][] {
  const res: string[][] = []
  const maxK = Math.min(k, arr.length)
  const rec = (start: number, cur: string[]) => {
    if (cur.length) res.push([...cur])
    if (cur.length === maxK) return
    for (let i = start; i < arr.length; i++) rec(i + 1, [...cur, arr[i]])
  }
  rec(0, [])
  return res
}

// Najlacnejšie pokrytie celého zoznamu ≤k obchodmi, alebo null ak sa to nedá
function bestFullCover(matched: Matched[], k: number): { m: Matched; chosen: any }[] | null {
  const universe = [...new Set(matched.flatMap(m => m.eligible.map((s: any) => s.companyId)))]
  let best: { assign: { m: Matched; chosen: any }[]; total: number } | null = null
  for (const subset of subsetsUpTo(universe, k)) {
    const set = new Set(subset)
    const assign: { m: Matched; chosen: any }[] = []
    let total = 0, ok = true
    for (const m of matched) {
      const opt = m.eligible.find((s: any) => set.has(s.companyId)) // eligible je zoradené vzostupne
      if (!opt) { ok = false; break }
      assign.push({ m, chosen: opt }); total += opt.price
    }
    if (ok && (!best || total < best.total)) best = { assign, total }
  }
  return best ? best.assign : null
}

const sigOf = (assign: { chosen: any }[]) => [...new Set(assign.map(a => a.chosen.companyId))].sort().join(',')
const planFrom = (key: string, label: string, assign: { m: Matched; chosen: any }[]) => ({
  key, label,
  storeCount: new Set(assign.map(a => a.chosen.companyId)).size,
  total: round2(assign.reduce((s, a) => s + a.chosen.price, 0)),
  stores: groupAssignments(assign),
})

// Vráti zoznam plánov: najlacnejší (bez limitu) + varianty 1/2/3 obchody, ktoré sa líšia
function computePlans(matched: Matched[]) {
  if (!matched.length) return []
  const bestAssign = matched.map(m => ({ m, chosen: m.eligible[0] })) // najlacnejší obchod na položku
  const plans = [planFrom('best', 'Najnižšia cena', bestAssign)]
  const seen = new Set([sigOf(bestAssign)])
  for (const k of [1, 2, 3]) {
    const assign = bestFullCover(matched, k)
    if (!assign) continue
    const sig = sigOf(assign)
    if (seen.has(sig)) continue
    seen.add(sig)
    plans.push(planFrom(`k${k}`, k === 1 ? '1 obchod' : `Max ${k} obchody`, assign))
  }
  return plans.sort((a, b) => a.total - b.total || a.storeCount - b.storeCount)
}

const OptimizeSchema = z.object({
  items: z.array(z.object({ query: z.string().min(1), groupKey: z.string().optional() })).min(1).max(50),
  company_ids: z.array(z.string()).optional().default([]),
})

router.post('/optimize', async (req, res) => {
  const parsed = OptimizeSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

  const { items, company_ids } = parsed.data

  console.log(`📦 optimize items: ${items.map(i => `${i.query}[${i.groupKey ?? 'no-key'}]`).join(', ')}`)

  try {
    // LEN KOMPAS — filtrujeme priamo podľa zvolených company_ids (prázdne = všetky obchody)
    const allowedAll = company_ids
    const matched: Matched[] = []
    const kompasUnmatched: string[] = []
    const needsApproval: any[] = []

    // Vyrieš všetky items PARALELNE s dlhším timeoutom — studená cache cez jina relay
    // môže trvať >10s a sekvenčné čakanie by hádzalo falošné "Nenájdené"
    const resolved = await Promise.all(items.map(async item => {
      let group = item.groupKey ? getKompasFromCache(item.groupKey) : undefined
      if (!group) {
        const results = await searchKompas(item.query, 5, 25000).catch(() => [])
        // stale groupKey (reštart BE / zmenené kľúče) → fallback len na PLNÝ name-match
        // (všetky slová dopytu v názve); čiastočné zhody radšej ako "Nenájdené" neponúkame
        group = (item.groupKey ? results.find(g => g.groupKey === item.groupKey) : undefined)
          ?? results.find(g => ((g as any).matchScore ?? 0) >= 70)
      }
      return { item, group }
    }))

    for (const { item, group } of resolved) {
      if (!group) { kompasUnmatched.push(item.query); continue }

      const eligible = (allowedAll.length > 0
        ? group.stores.filter((s: any) => allowedAll.includes(s.companyId))
        : group.stores
      ).sort((a: any, b: any) => a.price - b.price)

      if (!eligible.length) {
        // Vybraný produkt nie je vo zvolených obchodoch — ponúkni VIAC náhrad z tej istej
        // kategórie (aj drahšie), s cenou, nech si user vyberie sám v ApprovalPanel-i.
        const isAllowed = (id: string) => allowedAll.length === 0 || allowedAll.includes(id)
        const slug = group.groupKey.split(':')[1]
        const siblings = slug ? await getKompasCategoryGroups(slug).catch(() => []) : []
        const opts: { g: any; s: any }[] = []
        for (const sib of siblings) {
          if (sib.groupKey === group.groupKey) continue
          // najlacnejší obchod daného náhradného produktu spomedzi zvolených
          let best: any = null
          for (const st of sib.stores) {
            if (!isAllowed(st.companyId)) continue
            if (!best || st.price < best.price) best = st
          }
          if (best) opts.push({ g: sib, s: best })
        }
        opts.sort((a, b) => a.s.price - b.s.price)
        const suggestions = opts.slice(0, 4).map(({ g, s }) => {
          const norm = computeUnitPrice(s.price, g.packageSize, g.unit)
          return {
            groupKey: g.groupKey, name: g.name, unit: g.unit, packageSize: g.packageSize,
            imageUrl: s.imageUrl ?? g.bestImageUrl, price: s.price, unitPrice: s.unitPrice,
            storeName: s.storeName, isPromo: true,
            normPrice: norm?.value ?? null, normUnit: norm?.label ?? null,
          }
        })
        if (suggestions.length) {
          needsApproval.push({ originalQuery: item.query, originalGroupKey: group.groupKey, suggestions })
          continue
        }
        kompasUnmatched.push(item.query)
        continue
      }

      // Položka je matchnutá — všetky eligible obchody si necháme pre výpočet plánov
      matched.push({ query: item.query, group, eligible })
    }

    // Plány podľa počtu obchodov (najlacnejší + varianty 1/2/3 obchody)
    const plans = computePlans(matched)
    const defaultPlan = plans[0]  // najlacnejší = predvolený

    res.json({
      plans,
      stores: defaultPlan?.stores ?? [],
      total_optimized: defaultPlan?.total ?? 0,
      total_worst: defaultPlan?.total ?? 0,
      total_saving: 0,
      unmatched: kompasUnmatched,
      needsApproval,
    })
  } catch (e: any) { res.status(502).json({ error: e.message }) }
})
