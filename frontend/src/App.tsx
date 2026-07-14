import { useState, useEffect, useRef, useCallback, createContext, useContext } from 'react'
import {
  Search, Menu, ChevronLeft, ChevronUp, ChevronDown, Check, X, Minus, Heart, Repeat2,
  ShoppingCart, CookingPot, Clock, ClipboardList, LogOut, Mail, Sun, Moon, Monitor, RefreshCw,
} from 'lucide-react'
import { api, Store, ProductHit, OptimizeResult, NeedsApproval, FavoriteDto } from './lib/api'
import { useDebounce } from './hooks/useDebounce'
import { authClient } from './lib/authClient'
import { Theme, ThemeMode, useThemeMode, storeBrand, storeInk } from './theme'

// ─── Theme context ────────────────────────────────────────────────────────────
const ThemeCtx = createContext<{ t: Theme; mode: ThemeMode; setMode: (m: ThemeMode) => void }>(null as any)
const useT = () => useContext(ThemeCtx)

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtDate(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${parseInt(d)}.${parseInt(m)}.`
}
function promoDateLabel(from?: string | null, until?: string | null): { text: string; upcoming: boolean } | null {
  if (!from && !until) return null
  const today = new Date().toISOString().slice(0, 10)
  const upcoming = !!from && from > today
  if (from && until) return { text: `${fmtDate(from)} – ${fmtDate(until)}`, upcoming }
  if (until) return { text: `do ${fmtDate(until)}`, upcoming: false }
  return null
}

// Cena za jednotku — "3.00 €/kg", aby sa dali férovo porovnať rôzne balenia
function formatNormPrice(normPrice?: number | null, normUnit?: 'kg' | 'l' | null): string | null {
  if (!normPrice || !normUnit) return null
  return `${normPrice.toFixed(2)} €/${normUnit}`
}

function PromoBadge({ from, until }: { from?: string | null; until?: string | null }) {
  const { t } = useT()
  const d = promoDateLabel(from, until)
  if (!d) return null
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, fontFamily: t.font,
      background: d.upcoming ? t.upcomingBg : t.promoBg,
      color: d.upcoming ? t.upcomingText : t.promoText,
      border: `1px solid ${d.upcoming ? t.upcomingBorder : t.promoBorder}`,
      borderRadius: 999, padding: '2px 8px', whiteSpace: 'nowrap',
    }}>
      {d.upcoming ? '⚠ ' : ''}{d.text}
    </span>
  )
}

const STORE_LOGO_FILE: Record<string, string> = {
  'Lidl': 'lidl.png', 'Kaufland': 'kaufland.png', 'Billa': 'billa.png', 'Terno': 'terno.png',
  'Tesco': 'tesco.png', 'Fresh': 'fresh.png', 'COOP Jednota': 'coop.svg', 'Klas': 'klas.svg',
}

// Lettermark — kruh s brandovou farbou + skratka (fallback keď logo chýba)
function StoreLogo({ name, size = 22, muted = false }: { name: string; size?: number; muted?: boolean }) {
  const b = storeBrand(name)
  const file = STORE_LOGO_FILE[name]
  const [imgFailed, setImgFailed] = useState(false)

  if (file && !imgFailed) {
    return (
      <img
        src={`/stores/${file}`}
        alt={name}
        style={{ width: size, height: size, objectFit: 'contain', flexShrink: 0, borderRadius: 3, opacity: muted ? 0.45 : 1, filter: muted ? 'grayscale(1)' : 'none' }}
        onError={() => setImgFailed(true)}
      />
    )
  }

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: size, height: size, borderRadius: '50%',
      background: muted ? '#8fa09355' : b.main,
      color: b.text ?? '#fff',
      fontWeight: 800, fontSize: size * 0.42, flexShrink: 0, fontFamily: "'Sora', sans-serif",
    }}>{b.abbr}</span>
  )
}

function ProductImg({ src, size = 36, radius = 11 }: { src: string | null | undefined; size?: number; radius?: number }) {
  const { t } = useT()
  const [failed, setFailed] = useState(false)
  const base = { width: size, height: size, objectFit: 'contain' as const, borderRadius: radius, flexShrink: 0, background: t.surface2 }
  if (src && !failed) {
    return <img src={src} alt="" style={{ ...base, border: `1px solid ${t.hairline}` }} onError={() => setFailed(true)} />
  }
  return <img src="/stores/food-placeholder.svg" alt="" style={{ ...base, opacity: 0.4, padding: 4 }} />
}

// Sekčný nadpis: 11/700 UPPERCASE
function SectionLabel({ children }: { children: React.ReactNode }) {
  const { t } = useT()
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color: t.textMuted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12, fontFamily: t.font }}>
      {children}
    </div>
  )
}

// Hlavička obrazovky: back tlačidlo 40×40 + H1
function ScreenHeader({ title, onBack }: { title: string; onBack: () => void }) {
  const { t } = useT()
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
      <button onClick={onBack} style={{
        width: 40, height: 40, borderRadius: 12, background: t.surface, border: `1px solid ${t.border}`,
        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: t.textSec, flexShrink: 0,
      }}><ChevronLeft size={20} /></button>
      <h1 style={{ margin: 0, fontSize: 23, fontWeight: 800, color: t.text, fontFamily: t.fontHead, letterSpacing: '-0.02em' }}>{title}</h1>
    </div>
  )
}

type CartItem = { query: string; groupKey?: string; displayName: string; imageUrl?: string | null }

type SavedList = {
  id: string
  name: string
  savedAt: string
  stores: OptimizeResult['stores']
  unmatched: string[]
}

function formatDate(d: Date) {
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`
}

function loadSavedLists(): SavedList[] {
  try { return JSON.parse(localStorage.getItem('smartnakup_lists') ?? '[]') } catch { return [] }
}

const LOADING_PHRASES = [
  'Prehľadávam letáky…',
  'Porovnávam ceny…',
  'Hľadám kde ušetríš…',
  'Prechádzam akcie obchodov…',
  'Kompas býva pomalší, chvíľku…',
  'Takmer tam…',
]

// ─── TypeaheadInput ───────────────────────────────────────────────────────────
function TypeaheadInput({ onAdd }: { onAdd: (item: CartItem) => void }) {
  const { t } = useT()
  const [value, setValue] = useState('')
  const [suggestions, setSuggestions] = useState<ProductHit[]>([])
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const [loading, setLoading] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [hoveredKey, setHoveredKey] = useState<string | null>(null)
  const [hoverPos, setHoverPos] = useState<{ right: number; top: number }>({ right: 0, top: 0 })
  const [phraseIdx, setPhraseIdx] = useState(0)
  const debouncedQ = useDebounce(value, 280)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Close dropdown only when tapping/clicking outside the whole component
  useEffect(() => {
    const handleOutside = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    document.addEventListener('touchstart', handleOutside, { passive: true })
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      document.removeEventListener('touchstart', handleOutside)
    }
  }, [])

  // Cyklovanie fráz počas loading-u
  useEffect(() => {
    if (!loading) return
    setPhraseIdx(0)
    const t2 = setInterval(() => setPhraseIdx(i => (i + 1) % LOADING_PHRASES.length), 1800)
    return () => clearInterval(t2)
  }, [loading])

  useEffect(() => {
    if (debouncedQ.length < 2) { setSuggestions([]); setOpen(false); setRetrying(false); return }
    let cancelled = false
    setLoading(true)
    setRetrying(false)
    const sortByPrice = (hits: ProductHit[]) => [...hits].sort((a, b) => a.bestPrice - b.bestPrice)
    api.search(debouncedQ)
      .then(hits => {
        if (!cancelled) {
          setSuggestions(sortByPrice(hits))
          setActiveIdx(-1)
          if (hits.length > 0) {
            setOpen(true)
            setRetrying(false)
          } else {
            // Prvý výsledok prázdny — kompas ešte načítava, zostaneme otvorení a skúsime znova
            setOpen(true)
            setRetrying(true)
          }
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    // Retry po 6s a 14s — kompas scrape trvá 3-8s, cez jina relay aj dlhšie
    const mkRetry = (delay: number, last: boolean) => setTimeout(() => {
      if (cancelled) return
      api.search(debouncedQ)
        .then(hits => {
          if (!cancelled) {
            setSuggestions(sortByPrice(hits))
            if (hits.length > 0) { setOpen(true); setRetrying(false) }
            else if (last) setRetrying(false)
          }
        })
        .catch(() => { if (!cancelled && last) setRetrying(false) })
    }, delay)
    const r1 = mkRetry(6000, false)
    const r2 = mkRetry(14000, true)
    return () => { cancelled = true; clearTimeout(r1); clearTimeout(r2) }
  }, [debouncedQ])

  const commit = useCallback((item: CartItem) => {
    onAdd(item); setValue(''); setSuggestions([]); setOpen(false)
    inputRef.current?.blur() // skryje klávesnicu na mobile
  }, [onAdd])

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, suggestions.length - 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, -1)) }
    if (e.key === 'Enter') {
      e.preventDefault()
      const s = suggestions[activeIdx]
      if (s) commit({ query: s.name, groupKey: s.groupKey, displayName: s.name, imageUrl: s.imageUrl })
      else if (value.trim()) commit({ query: value.trim(), displayName: value.trim() })
    }
    if (e.key === 'Escape') setOpen(false)
  }

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <div>
        <div style={{ position: 'relative' }}>
          <Search size={18} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: t.textFaint, pointerEvents: 'none' }} />
          <input
            ref={inputRef} value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={handleKey}
            onFocus={() => {
              if (suggestions.length > 0) setOpen(true)
              setTimeout(() => inputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300)
            }}
            placeholder="Napr. mlieko, vajcia, gouda…"
            autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
            enterKeyHint="search"
            style={{
              width: '100%', padding: '13px 14px 13px 42px', fontSize: 16,
              border: `1px solid ${t.border}`, borderRadius: 14, outline: 'none',
              fontFamily: t.font, boxSizing: 'border-box', color: t.text, background: t.inputBg,
              transition: 'border-color 0.15s',
            }}
            onFocusCapture={e => e.currentTarget.style.borderColor = t.accent}
            onBlurCapture={e => e.currentTarget.style.borderColor = t.border as string}
          />
          {loading && <span style={{
            position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)',
            width: 8, height: 8, borderRadius: '50%', background: t.accent, animation: 'pulse 1.2s infinite',
          }} />}
        </div>
      </div>

      {(open && suggestions.length > 0) || (loading && debouncedQ.length >= 2) || (retrying && debouncedQ.length >= 2) ? (
        <ul
          onMouseDown={e => e.preventDefault()}
          onTouchMove={() => { inputRef.current?.blur() /* hide keyboard, keep dropdown open */ }}
          style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 200,
          background: t.surface, border: `1px solid ${t.border}`, borderRadius: 16,
          padding: 6, margin: 0, listStyle: 'none',
          boxShadow: t.shadowDrop,
          maxHeight: '240px', overflowY: 'auto',
        }}>
          {(loading || retrying) && suggestions.length === 0 && (
            <>
              <li style={{ padding: '12px 14px', fontSize: 14, color: t.textSec, fontWeight: 500, textAlign: 'center', animation: 'shimmer 1.8s infinite', fontFamily: t.font }}>
                {retrying ? 'Čakám na výsledky…' : LOADING_PHRASES[phraseIdx]}
              </li>
              {[0,1,2].map(i => (
                <li key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px' }}>
                  <div style={{ width: 42, height: 42, borderRadius: 11, background: t.surface2, flexShrink: 0, animation: 'shimmer 1.2s infinite' }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ height: 13, borderRadius: 6, background: t.surface2, marginBottom: 6, width: `${65 + i * 10}%`, animation: 'shimmer 1.2s infinite' }} />
                    <div style={{ height: 11, borderRadius: 6, background: t.surface2, width: '40%', animation: 'shimmer 1.2s infinite' }} />
                  </div>
                </li>
              ))}
            </>
          )}
          {suggestions.map((hit, i) => {
            const ink = storeInk(hit.bestStore, t.isDark)
            return (
              <li key={hit.groupKey}
                onClick={() => commit({ query: hit.name, groupKey: hit.groupKey, displayName: hit.name, imageUrl: hit.imageUrl })}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 12, cursor: 'pointer', background: i === activeIdx ? t.rowActive : 'transparent', transition: 'background 0.12s' }}>
                <ProductImg src={hit.imageUrl} size={42} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: t.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: t.font }}>{hit.name}</div>
                  <div style={{ fontSize: 12, color: t.textSec, fontFamily: t.font }}>
                    {hit.packageSize > 0 && `${hit.packageSize}${hit.unit} · `}
                    od <strong style={{ color: t.accentInk }}>{hit.bestPrice.toFixed(2)} €</strong>
                    {formatNormPrice(hit.normPrice, hit.normUnit) && <span style={{ color: t.textMuted, marginLeft: 4 }}>({formatNormPrice(hit.normPrice, hit.normUnit)})</span>}
                    {hit.saving && hit.saving > 0 && <span style={{ marginLeft: 6, fontSize: 11, color: t.accentInk, fontWeight: 600 }}>−{hit.saving.toFixed(2)} € vs {hit.worstStore}</span>}
                  </div>
                </div>
                <div style={{ flexShrink: 0, textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}
                  onMouseEnter={e => {
                    const r = e.currentTarget.getBoundingClientRect()
                    setHoveredKey(hit.groupKey)
                    setHoverPos({ right: window.innerWidth - r.right, top: r.bottom + 4 })
                  }}
                  onMouseLeave={() => setHoveredKey(null)}>
                  <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: `${storeBrand(hit.bestStore).main}${t.isDark ? '22' : '18'}`, color: ink, fontWeight: 700, whiteSpace: 'nowrap', cursor: hit.storeCount > 1 ? 'default' : undefined, fontFamily: t.font }}>
                    {hit.bestStore}{hit.storeCount > 1 ? ` +${hit.storeCount - 1}` : ''}
                  </span>
                  {(hit.promoFrom || hit.promoUntil) && <PromoBadge from={hit.promoFrom} until={hit.promoUntil} />}
                  {hoveredKey === hit.groupKey && hit.storeNames && hit.storeNames.length > 1 && (
                    <div style={{
                      // fixed → unikne overflow klipu scrollovateľného dropdownu
                      position: 'fixed', right: hoverPos.right, top: hoverPos.top, zIndex: 400,
                      background: t.tooltipBg, color: t.tooltipText, borderRadius: 10, padding: '6px 10px',
                      fontSize: 11, whiteSpace: 'nowrap', boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
                      pointerEvents: 'none', textAlign: 'left', fontFamily: t.font,
                    }}>
                      {hit.storeNames.map(n => (
                        <div key={n} style={{ padding: '1px 0' }}>{n}</div>
                      ))}
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}

// ─── ResultCard ───────────────────────────────────────────────────────────────
function ResultCard({ group }: { group: OptimizeResult['stores'][0] }) {
  const { t } = useT()
  const b = storeBrand(group.storeName)
  const ink = storeInk(group.storeName, t.isDark)
  const headText = b.text ?? '#fff'
  return (
    <div style={{ borderRadius: 18, overflow: 'hidden', border: `1px solid ${t.border}`, background: t.surface, boxShadow: t.shadowCard }}>
      <div style={{ background: b.main, padding: '13px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <StoreLogo name={group.storeName} size={24} />
          <span style={{ color: headText, fontWeight: 800, fontSize: 17, fontFamily: t.fontHead, letterSpacing: '-0.02em' }}>{group.storeName}</span>
        </div>
        <span style={{ color: headText, fontWeight: 800, fontSize: 20, fontFamily: t.fontHead }}>{group.subtotal.toFixed(2)} €</span>
      </div>
      <div style={{ padding: '4px 14px' }}>
        {group.items.map((item, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 11, padding: '11px 2px',
            borderBottom: i < group.items.length - 1 ? `1px solid ${t.hairline}` : 'none',
          }}>
            <ProductImg src={item.imageUrl} size={36} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14, color: t.text, fontFamily: t.font }}>{item.query}</div>
              {(item.name !== item.query || item.packageSize > 0) && (
                <div style={{ fontSize: 12, color: t.textSec, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: t.font }}>
                  {item.name !== item.query ? item.name : ''}
                  {item.name !== item.query && item.packageSize > 0 ? ' · ' : ''}
                  {item.packageSize > 0 ? `${item.packageSize}${item.unit}` : ''}
                </div>
              )}
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontWeight: 800, color: ink, fontSize: 17, fontFamily: t.fontHead }}>{item.price.toFixed(2)} €</div>
              {formatNormPrice(item.normPrice, item.normUnit) && (
                <div style={{ fontSize: 11, color: t.textMuted, fontFamily: t.font }}>{formatNormPrice(item.normPrice, item.normUnit)}</div>
              )}
              {(item as any).saving > 0 && (
                <div style={{ fontSize: 11, color: t.accentInk, fontWeight: 600, marginTop: 1, fontFamily: t.font }}>
                  ušetríš {((item as any).saving as number).toFixed(2)} € vs {(item as any).worstStore}
                </div>
              )}
              <div style={{ marginTop: 3 }}><PromoBadge from={(item as any).promoFrom} until={(item as any).promoUntil} /></div>
              {item.allStores.length > 1 && (
                <div style={{ fontSize: 11, marginTop: 3, display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end', fontFamily: t.font }}>
                  {item.allStores
                    .filter((s: any) => s.storeName !== group.storeName)
                    .slice(0, 2)
                    .map((s: any) => {
                      const diff = parseFloat((s.price - item.price).toFixed(2))
                      const plus = diff > 0
                      return (
                        <span key={s.storeName} style={{ color: plus ? t.diffPlus : t.diffMinus }}>
                          {s.storeName} {plus ? '+' : ''}{diff.toFixed(2)}€
                        </span>
                      )
                    })}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── StoreComparisonTable ─────────────────────────────────────────────────────
// Čo by celý nákup stál, keby si všetko kúpil v jednom obchode — porovnanie oproti
// rozdelenému nákupu. Počíta sa z už načítaných allStores na položkách, žiadny extra fetch.
function buildStoreComparison(result: OptimizeResult, stores: Store[], selectedNames: string[]) {
  const items = result.stores.flatMap(s => s.items)
  if (!items.length) return []
  const allSel = stores.length > 0 && stores.every(s => selectedNames.includes(s.name))
  const allowedIds = allSel ? null : new Set(stores.filter(s => selectedNames.includes(s.name)).flatMap(s => s.companyIds))
  const perStore = new Map<string, { storeName: string; companyId: string; total: number; count: number }>()
  for (const item of items) {
    for (const s of item.allStores) {
      if (allowedIds && !allowedIds.has(s.companyId)) continue
      const e = perStore.get(s.companyId) ?? { storeName: s.storeName, companyId: s.companyId, total: 0, count: 0 }
      e.total += s.price
      e.count += 1
      perStore.set(s.companyId, e)
    }
  }
  return [...perStore.values()]
    .map(e => ({ ...e, total: parseFloat(e.total.toFixed(2)), complete: e.count === items.length }))
    .sort((a, b) => a.total - b.total)
}

function StoreComparisonTable({ result, stores, selectedNames }: { result: OptimizeResult; stores: Store[]; selectedNames: string[] }) {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const rows = buildStoreComparison(result, stores, selectedNames)
  const splitTotal = result.stores.reduce((s, g) => s + g.subtotal, 0)
  const cheapestComplete = rows.find(r => r.complete)

  if (rows.length < 2) return null

  return (
    <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 16, marginBottom: 12, boxShadow: t.shadowCard, overflow: 'hidden' }}>
      <div onClick={() => setOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', cursor: 'pointer', userSelect: 'none' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: t.text, fontFamily: t.fontHead, letterSpacing: '-0.02em' }}>Porovnanie obchodov</div>
          <div style={{ fontSize: 12, color: t.textSec, marginTop: 2 }}>
            Rozdelený nákup: <strong style={{ color: t.accentInk }}>{splitTotal.toFixed(2)} €</strong>
            {cheapestComplete && cheapestComplete.total > splitTotal + 0.01 && (
              <span> · celé v {cheapestComplete.storeName}: {cheapestComplete.total.toFixed(2)} €</span>
            )}
          </div>
        </div>
        <span style={{ color: t.textMuted, display: 'flex' }}>{open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}</span>
      </div>
      {open && (
        <div style={{ borderTop: `1px solid ${t.hairline}` }}>
          {rows.map((r, i) => {
            const ink = storeInk(r.storeName, t.isDark)
            const isCheapestComplete = r.complete && cheapestComplete?.companyId === r.companyId
            return (
              <div key={r.companyId} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px',
                borderBottom: i < rows.length - 1 ? `1px solid ${t.hairline}` : 'none',
                background: isCheapestComplete ? t.accentSoftBg : 'transparent',
              }}>
                <StoreLogo name={r.storeName} size={20} />
                <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: ink }}>{r.storeName}</span>
                {!r.complete && (
                  <span style={{ fontSize: 11, color: t.textMuted }}>{r.count}/{result.stores.flatMap(s => s.items).length} položiek</span>
                )}
                <span style={{ fontSize: 14, fontWeight: 700, color: isCheapestComplete ? t.accentInk : t.text, fontFamily: t.fontHead }}>{r.total.toFixed(2)} €</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── ApprovalPanel ────────────────────────────────────────────────────────────
type Toast = { query: string; originalQuery: string; name: string }

function ApprovalPanel({
  approvals,
  onDecide,
}: {
  approvals: NeedsApproval[]
  onDecide: (decisions: { approval: NeedsApproval; accepted: boolean }[]) => void
}) {
  const { t } = useT()
  const [accepted, setAccepted] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(approvals.map(a => [a.originalQuery, true]))
  )
  const [toasts, setToasts] = useState<Toast[]>([])
  const timerRefs = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  const removeToast = (query: string) =>
    setToasts(prev => prev.filter(tt => tt.query !== query))

  const reject = (query: string, name: string) => {
    setAccepted(prev => ({ ...prev, [query]: false }))
    setToasts(prev => [...prev.filter(tt => tt.query !== query), { query, originalQuery: query, name }])
    if (timerRefs.current[query]) clearTimeout(timerRefs.current[query])
    timerRefs.current[query] = setTimeout(() => removeToast(query), 5000)
  }

  const undo = (query: string) => {
    if (timerRefs.current[query]) clearTimeout(timerRefs.current[query])
    setAccepted(prev => ({ ...prev, [query]: true }))
    removeToast(query)
  }

  const confirm = () => {
    Object.values(timerRefs.current).forEach(clearTimeout)
    onDecide(approvals.map(a => ({ approval: a, accepted: accepted[a.originalQuery] })))
  }

  const visible = approvals.filter(a => accepted[a.originalQuery])

  return (
    <div style={{ marginBottom: 16, fontFamily: t.font }}>
      {/* Stacked toasts */}
      {toasts.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
          {toasts.map(tt => (
            <div key={tt.query} style={{
              background: t.tooltipBg, color: t.tooltipText, borderRadius: 14, padding: '12px 16px',
              display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
              fontSize: 13, boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            }}>
              <div>
                <div>„{tt.name}" odstránené zo zoznamu</div>
                <div style={{ fontSize: 12, opacity: 0.65, marginTop: 3 }}>
                  Produkt nie je dostupný vo zvolených obchodoch — zvážte pridanie ďalšieho obchodu
                </div>
              </div>
              <button onClick={() => undo(tt.query)} style={{
                background: t.tooltipText, color: t.tooltipBg, border: 'none', borderRadius: 8,
                padding: '5px 12px', fontWeight: 700, cursor: 'pointer', fontSize: 13,
                marginLeft: 14, flexShrink: 0, fontFamily: t.font,
              }}>Späť</button>
            </div>
          ))}
        </div>
      )}

      {/* Panel */}
      <div style={{ background: t.warnBg, border: `1px solid ${t.warnBorder}`, borderRadius: 18, padding: 18 }}>
        <div style={{ fontWeight: 700, color: t.warnText, fontSize: 14, marginBottom: 4, fontFamily: t.fontHead }}>
          Niektoré produkty nie sú v tvojich obchodoch
        </div>
        <div style={{ fontSize: 13, color: t.warnText, opacity: 0.8, marginBottom: 14 }}>
          Našli sme alternatívy — zamietnuť ich môžeš krížikom
        </div>

        {visible.length === 0 && (
          <div style={{ fontSize: 13, color: t.warnText, textAlign: 'center', padding: '10px 0' }}>
            Všetky náhrady zamietnuté
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {visible.map(a => {
            const s = a.suggested
            const ink = storeInk(s.storeName, t.isDark)
            return (
              <div key={a.originalQuery} style={{
                background: t.surface, borderRadius: 14, padding: '12px 14px',
                border: `1px solid ${t.border}`,
                display: 'flex', alignItems: 'center', gap: 12,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 10, color: t.textMuted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>Hľadaný</div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: t.text }}>„{a.originalQuery}"</div>
                  <div style={{ fontSize: 12, color: t.errorText }}>Nie je v zvolených obchodoch</div>
                </div>

                <div style={{ color: t.textFaint, fontSize: 18, flexShrink: 0 }}>→</div>

                <div style={{ flex: 2, minWidth: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <ProductImg src={s.imageUrl} size={44} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: t.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</div>
                    <div style={{ fontSize: 12, color: t.textSec }}>
                      {s.packageSize > 0 ? `${s.packageSize}${s.unit} · ` : ''}<strong style={{ color: t.accentInk }}>{s.price.toFixed(2)} €</strong>
                    </div>
                    <span style={{ fontSize: 11, padding: '1px 8px', borderRadius: 999, background: `${storeBrand(s.storeName).main}${t.isDark ? '22' : '18'}`, color: ink, fontWeight: 700 }}>{s.storeName}</span>
                  </div>
                </div>

                <button onClick={() => reject(a.originalQuery, s.name)} style={{
                  flexShrink: 0, width: 32, height: 32, borderRadius: '50%',
                  border: `1px solid ${t.promoBorder}`, background: t.promoBg,
                  color: t.promoText, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}><X size={15} strokeWidth={2.4} /></button>
              </div>
            )
          })}
        </div>

        <button onClick={confirm} style={{
          marginTop: 14, width: '100%', padding: '13px', fontSize: 15, fontWeight: 800,
          background: t.accent, color: t.accentOn, border: 'none', borderRadius: 14, cursor: 'pointer',
          fontFamily: t.fontHead, boxShadow: t.shadowCta,
        }}>
          Potvrdiť a prepočítať
        </button>
      </div>
    </div>
  )
}

// ─── SavedListCard ────────────────────────────────────────────────────────────
function SavedListCard({ list, onDelete, onRename, onReuse }: { list: SavedList; onDelete: () => void; onRename: (name: string) => void; onReuse: () => void }) {
  const { t } = useT()
  // checked: Set of "companyId:query" keys
  const [checked, setChecked] = useState<Set<string>>(new Set())
  // Explicitný open/close zámer používateľa (má prednosť pred auto-collapse). undefined = auto
  const [openOverride, setOpenOverride] = useState<Record<string, boolean>>({})
  // Inline premenovanie názvu zoznamu
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(list.name)

  const commitRename = () => {
    setEditing(false)
    const next = draft.trim()
    if (next && next !== list.name) onRename(next)
    else setDraft(list.name)
  }

  const toggleItem = (companyId: string, query: string) => {
    const key = `${companyId}:${query}`
    setChecked(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  const isItemChecked = (companyId: string, query: string) => checked.has(`${companyId}:${query}`)

  const isStoreDone = (store: SavedList['stores'][0]) =>
    store.items.every(item => isItemChecked(store.companyId, item.query))

  const allDone = list.stores.every(isStoreDone)

  // Predvolene otvorené, dokončený obchod sa auto-zbalí — ale explicitný klik má vždy prednosť
  const isStoreOpen = (store: SavedList['stores'][0]) =>
    store.companyId in openOverride ? openOverride[store.companyId] : !isStoreDone(store)

  const toggleCollapse = (companyId: string, currentlyOpen: boolean) => {
    setOpenOverride(prev => ({ ...prev, [companyId]: !currentlyOpen }))
  }

  return (
    <div style={{
      background: allDone ? t.doneBg : t.surface,
      border: `1px solid ${allDone ? t.accent + '55' : t.border}`,
      borderRadius: 18, padding: 16, boxShadow: t.shadowCard, transition: 'background 0.2s', fontFamily: t.font,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {editing ? (
              <input
                autoFocus value={draft}
                onChange={e => setDraft(e.target.value)}
                onBlur={commitRename}
                onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') { setDraft(list.name); setEditing(false) } }}
                style={{
                  fontWeight: 700, fontSize: 15, color: t.text, fontFamily: t.fontHead, letterSpacing: '-0.02em',
                  background: t.surface2, border: `1px solid ${t.accent}`, borderRadius: 8, padding: '3px 8px',
                  outline: 'none', width: '100%', maxWidth: 240,
                }}
              />
            ) : (
              <span onClick={() => { setDraft(list.name); setEditing(true) }} title="Kliknutím premenuješ"
                style={{ fontWeight: 700, fontSize: 15, color: allDone ? t.doneText : t.text, fontFamily: t.fontHead, letterSpacing: '-0.02em', cursor: 'pointer' }}>
                {list.name}
              </span>
            )}
            {allDone && !editing && <span style={{ fontSize: 11, fontWeight: 700, color: t.accentSoftText, background: t.accentSoftBg, padding: '2px 9px', borderRadius: 999, flexShrink: 0 }}>Hotové</span>}
          </div>
          <div style={{ fontSize: 12, color: t.textMuted, marginTop: 2 }}>{new Date(list.savedAt).toLocaleString('sk-SK')}</div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button onClick={onReuse} title="Použiť ako šablónu pre nový nákup"
            style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: `1px solid ${t.border}`, borderRadius: 10, padding: '5px 12px', cursor: 'pointer', color: t.accentInk, fontSize: 12, fontWeight: 600, fontFamily: t.font }}>
            <Repeat2 size={13} strokeWidth={2.2} /> Použiť znova
          </button>
          <button onClick={onDelete} style={{ background: 'none', border: `1px solid ${t.errorBorder}`, borderRadius: 10, padding: '5px 12px', cursor: 'pointer', color: t.errorText, fontSize: 12, fontWeight: 600, fontFamily: t.font }}>Zmazať</button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {list.stores.map(store => {
          const done = isStoreDone(store)
          const open = isStoreOpen(store)
          const ink = storeInk(store.storeName, t.isDark)
          return (
            <div key={store.companyId} style={{
              borderRadius: 12, overflow: 'hidden',
              border: `1px solid ${done ? t.accent + '44' : t.border}`,
              background: done ? t.accentSoftBg : t.surface2,
            }}>
              <div
                onClick={() => toggleCollapse(store.companyId, open)}
                style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 12px', cursor: 'pointer', userSelect: 'none' }}>
                <StoreLogo name={store.storeName} size={20} />
                <span style={{ fontWeight: 700, fontSize: 14, color: ink, textDecoration: done ? 'line-through' : 'none', opacity: done ? 0.6 : 1, fontFamily: t.fontHead, letterSpacing: '-0.02em' }}>{store.storeName}</span>
                <span style={{ marginLeft: 'auto', fontWeight: 700, fontSize: 13, color: done ? t.doneText : t.textSec, textDecoration: done ? 'line-through' : 'none', opacity: done ? 0.6 : 1 }}>{store.subtotal.toFixed(2)} €</span>
                <span style={{ color: t.textMuted, marginLeft: 4, display: 'flex' }}>{open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</span>
              </div>
              {open && (
                <div style={{ borderTop: `1px solid ${t.hairline}` }}>
                  {store.items.map(item => {
                    const itemDone = isItemChecked(store.companyId, item.query)
                    return (
                      <div
                        key={item.query}
                        onClick={() => toggleItem(store.companyId, item.query)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          padding: '8px 12px', cursor: 'pointer',
                          background: itemDone ? t.accentSoftBg + '88' : 'transparent',
                          borderBottom: `1px solid ${t.hairline}`,
                        }}>
                        <div style={{
                          width: 18, height: 18, borderRadius: 5, flexShrink: 0,
                          border: `2px solid ${itemDone ? t.accent : t.textFaint}`,
                          background: itemDone ? t.accent : 'transparent',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          {itemDone && <Check size={12} strokeWidth={3.2} color={t.accentOn} />}
                        </div>
                        <span style={{ flex: 1, fontSize: 13, color: itemDone ? t.textMuted : t.text, textDecoration: itemDone ? 'line-through' : 'none' }}>{item.name}</span>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: itemDone ? t.textMuted : t.text, textDecoration: itemDone ? 'line-through' : 'none' }}>{item.price.toFixed(2)} €</span>
                          {!itemDone && <PromoBadge from={(item as any).promoFrom} until={(item as any).promoUntil} />}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {list.unmatched.length > 0 && (
        <div style={{ fontSize: 12, color: t.warnText, background: t.warnBg, border: `1px solid ${t.warnBorder}`, borderRadius: 10, padding: '6px 10px', marginTop: 10 }}>
          Nenájdené: {list.unmatched.join(', ')}
        </div>
      )}
    </div>
  )
}

// Zoznam ako šablóna — vytiahni položky späť do CartItem[] pre nový nákup (dedup podľa query)
function buildCartItemsFromList(list: SavedList): CartItem[] {
  const seen = new Set<string>()
  const items: CartItem[] = []
  for (const item of list.stores.flatMap(s => s.items)) {
    if (seen.has(item.query)) continue
    seen.add(item.query)
    items.push({ query: item.query, groupKey: item.groupKey, displayName: item.name || item.query, imageUrl: item.imageUrl })
  }
  return items
}

// ─── SavedListsScreen ─────────────────────────────────────────────────────────
function SavedListsScreen({ onBack, onReuse }: { onBack: () => void; onReuse: (items: CartItem[]) => void }) {
  const { t } = useT()
  const [lists, setLists] = useState<SavedList[]>([])
  const [loading, setLoading] = useState(true)

  // Vždy zoradené od najnovšieho po najstaršie podľa dátumu vytvorenia
  const byDateDesc = (arr: SavedList[]) => [...arr].sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime())

  useEffect(() => {
    api.getLists()
      .then(dbLists => {
        // Jednorazová migrácia starých zoznamov z localStorage do DB
        const local = loadSavedLists()
        if (local.length > 0) {
          Promise.all(local.map(l => api.saveList(l.name, l.stores, l.unmatched).catch(() => null)))
            .then(saved => {
              localStorage.removeItem('smartnakup_lists')
              setLists(byDateDesc([...saved.filter((s): s is NonNullable<typeof s> => s !== null), ...dbLists]))
            })
        } else {
          setLists(byDateDesc(dbLists))
        }
      })
      .catch(() => setLists(byDateDesc(loadSavedLists())))  // offline/neprihlásený fallback
      .finally(() => setLoading(false))
  }, [])

  const deleteList = (id: string) => {
    setLists(prev => prev.filter(l => l.id !== id))
    api.deleteList(id).catch(() => {})
  }

  const renameList = (id: string, name: string) => {
    setLists(prev => prev.map(l => l.id === id ? { ...l, name } : l))
    api.renameList(id, name).catch(() => {})
  }

  return (
    <div style={{ minHeight: '100vh', background: t.bg, fontFamily: t.font }}>
      <div style={{ maxWidth: 660, margin: '0 auto', padding: '28px 16px 64px' }}>
        <ScreenHeader title="Uložené zoznamy" onBack={onBack} />

        {loading ? (
          <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 18, padding: 32, textAlign: 'center', color: t.textMuted, boxShadow: t.shadowCard, animation: 'shimmer 1.2s infinite' }}>
            Načítavam zoznamy…
          </div>
        ) : lists.length === 0 ? (
          <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 18, padding: 36, textAlign: 'center', color: t.textMuted, boxShadow: t.shadowCard }}>
            <ClipboardList size={36} style={{ marginBottom: 12, opacity: 0.5 }} />
            <div style={{ fontWeight: 700, fontSize: 15, color: t.textSec, fontFamily: t.fontHead }}>Žiadne uložené zoznamy</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>Vytvor nákupný zoznam a uložíš ho sem</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {lists.map(list => (
              <SavedListCard key={list.id} list={list} onDelete={() => deleteList(list.id)} onRename={name => renameList(list.id, name)} onReuse={() => onReuse(buildCartItemsFromList(list))} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
function AuthInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { t } = useT()
  return (
    <input {...props} style={{
      width: '100%', padding: '14px 16px', fontSize: 15,
      border: `1px solid ${t.border}`, borderRadius: 12, outline: 'none',
      fontFamily: t.font, boxSizing: 'border-box', color: t.text, background: t.inputBg,
      ...props.style,
    }} />
  )
}

function AuthShell({ children }: { children: React.ReactNode }) {
  const { t } = useT()
  return (
    <div style={{ minHeight: '100vh', background: t.bg, fontFamily: t.font, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: 400, padding: '24px 16px' }}>
        <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 20, padding: 32, boxShadow: t.shadowCard }}>
          {children}
        </div>
      </div>
    </div>
  )
}

function AuthLogo() {
  const { t } = useT()
  return (
    <div style={{
      width: 60, height: 60, borderRadius: 18, background: t.accent, color: t.accentOn,
      display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 18,
      boxShadow: t.shadowCta,
    }}><ShoppingCart size={28} strokeWidth={2.2} /></div>
  )
}

function AuthCta({ loading, label, loadingLabel }: { loading: boolean; label: string; loadingLabel: string }) {
  const { t } = useT()
  return (
    <button type="submit" disabled={loading} style={{
      padding: '14px', fontSize: 16, fontWeight: 800, fontFamily: t.fontHead,
      background: loading ? t.ctaDisabledBg : t.accent, color: loading ? t.ctaDisabledText : t.accentOn,
      border: 'none', borderRadius: 12, cursor: loading ? 'not-allowed' : 'pointer', marginTop: 4,
      boxShadow: loading ? 'none' : t.shadowCta,
    }}>{loading ? loadingLabel : label}</button>
  )
}

function AuthSecondary({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  const { t } = useT()
  return (
    <button onClick={onClick} style={{
      marginTop: 14, width: '100%', padding: '12px', fontSize: 14, fontWeight: 600,
      background: 'transparent', color: t.textSec, border: `1px solid ${t.border}`, borderRadius: 12,
      cursor: 'pointer', fontFamily: t.font,
    }}>{children}</button>
  )
}

// ─── LoginScreen ──────────────────────────────────────────────────────────────
function LoginScreen({ onSwitch, onBack, onSuccess }: { onSwitch: () => void; onBack: () => void; onSuccess: () => void }) {
  const { t } = useT()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true); setError('')
    const res = await authClient.signIn.email({ email, password })
    setLoading(false)
    if (res.error) setError(res.error.message ?? 'Prihlásenie zlyhalo')
    else onSuccess()
  }

  return (
    <AuthShell>
      <AuthLogo />
      <h2 style={{ margin: '0 0 6px', fontSize: 26, fontWeight: 800, color: t.text, fontFamily: t.fontHead, letterSpacing: '-0.02em' }}>Vitaj späť</h2>
      <p style={{ margin: '0 0 24px', color: t.textSec, fontSize: 14 }}>Prihlás sa a ukladaj zoznamy do cloudu</p>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <AuthInput type="email" placeholder="E-mail" value={email} onChange={e => setEmail(e.target.value)} required />
        <AuthInput type="password" placeholder="Heslo" value={password} onChange={e => setPassword(e.target.value)} required />
        {error && <div style={{ color: t.errorText, fontSize: 13, background: t.errorBg, border: `1px solid ${t.errorBorder}`, padding: '8px 12px', borderRadius: 10 }}>{error}</div>}
        <AuthCta loading={loading} label="Prihlásiť sa" loadingLabel="Prihlasujem…" />
      </form>
      <div style={{ marginTop: 20, textAlign: 'center', fontSize: 14, color: t.textSec }}>
        Nemáš účet?{' '}
        <button onClick={onSwitch} style={{ background: 'none', border: 'none', color: t.accentInk, cursor: 'pointer', fontWeight: 700, fontSize: 14, padding: 0, fontFamily: t.font }}>
          Zaregistruj sa
        </button>
      </div>
      <AuthSecondary onClick={onBack}>Pokračovať bez prihlásenia</AuthSecondary>
    </AuthShell>
  )
}

// ─── RegisterScreen ───────────────────────────────────────────────────────────
function RegisterScreen({ onSwitch, onBack, onVerify }: { onSwitch: () => void; onBack: () => void; onVerify: (email: string) => void }) {
  const { t } = useT()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password.length < 8) { setError('Heslo musí mať aspoň 8 znakov'); return }
    setLoading(true); setError('')
    const res = await authClient.signUp.email({ email, password, name })
    setLoading(false)
    if (res.error) setError(res.error.message ?? 'Registrácia zlyhala')
    else onVerify(email)
  }

  return (
    <AuthShell>
      <AuthLogo />
      <h2 style={{ margin: '0 0 6px', fontSize: 26, fontWeight: 800, color: t.text, fontFamily: t.fontHead, letterSpacing: '-0.02em' }}>Vytvor si účet</h2>
      <p style={{ margin: '0 0 24px', color: t.textSec, fontSize: 14 }}>Registrácia je bezplatná</p>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <AuthInput type="text" placeholder="Meno" value={name} onChange={e => setName(e.target.value)} required />
        <AuthInput type="email" placeholder="E-mail" value={email} onChange={e => setEmail(e.target.value)} required />
        <AuthInput type="password" placeholder="Heslo (min. 8 znakov)" value={password} onChange={e => setPassword(e.target.value)} required />
        {error && <div style={{ color: t.errorText, fontSize: 13, background: t.errorBg, border: `1px solid ${t.errorBorder}`, padding: '8px 12px', borderRadius: 10 }}>{error}</div>}
        <AuthCta loading={loading} label="Vytvoriť účet" loadingLabel="Registrujem…" />
      </form>
      <div style={{ marginTop: 20, textAlign: 'center', fontSize: 14, color: t.textSec }}>
        Už máš účet?{' '}
        <button onClick={onSwitch} style={{ background: 'none', border: 'none', color: t.accentInk, cursor: 'pointer', fontWeight: 700, fontSize: 14, padding: 0, fontFamily: t.font }}>
          Prihlásiť sa
        </button>
      </div>
      <AuthSecondary onClick={onBack}>Pokračovať bez prihlásenia</AuthSecondary>
    </AuthShell>
  )
}

// ─── VerifyEmailScreen ────────────────────────────────────────────────────────
function VerifyEmailScreen({ email, onBack }: { email: string; onBack: () => void }) {
  const { t } = useT()
  return (
    <AuthShell>
      <div style={{ textAlign: 'center' }}>
        <div style={{
          width: 60, height: 60, borderRadius: 18, background: t.accentSoftBg, color: t.accentSoftText,
          display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 18px',
        }}><Mail size={28} strokeWidth={2} /></div>
        <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 800, color: t.text, fontFamily: t.fontHead, letterSpacing: '-0.02em' }}>Skontroluj e-mail</h2>
        <p style={{ color: t.textSec, fontSize: 14, marginBottom: 8 }}>
          Poslali sme overovací link na:
        </p>
        <p style={{ fontWeight: 700, color: t.text, marginBottom: 24 }}>{email}</p>
        <p style={{ color: t.textMuted, fontSize: 13, marginBottom: 8 }}>
          Po overení sa môžeš prihlásiť a ukladať nákupné zoznamy do cloudu.
        </p>
        <AuthSecondary onClick={onBack}>Pokračovať bez prihlásenia</AuthSecondary>
      </div>
    </AuthShell>
  )
}

// ─── Recepty ──────────────────────────────────────────────────────────────────
type Recipe = { id: string; name: string; time: string; ingredients: string[] }

const RECIPES: Recipe[] = [
  {
    id: 'bolognese',
    name: 'Spaghetti bolognese',
    time: '40 min',
    ingredients: ['mleté mäso', 'cestoviny', 'paradajková omáčka', 'cibuľa', 'mrkva', 'cesnak'],
  },
  {
    id: 'sosovica',
    name: 'Šošovicový prívarok s vajcom',
    time: '35 min',
    ingredients: ['červená šošovica', 'klobása', 'cibuľa', 'mrkva', 'zemiaky', 'vajcia', 'kyslá smotana'],
  },
  {
    id: 'segedin',
    name: 'Segedínsky guláš',
    time: '60 min',
    ingredients: ['bravčové mäso', 'kyslá kapusta', 'cibuľa', 'kyslá smotana', 'paprika mletá', 'ryža'],
  },
  {
    id: 'polievka',
    name: 'Kuracia polievka s rezancami',
    time: '50 min',
    ingredients: ['kuracie prsia', 'mrkva', 'zeler', 'cibuľa', 'rezance', 'petržlen'],
  },
  {
    id: 'rizoto',
    name: 'Rizoto so šampiňónmi',
    time: '30 min',
    ingredients: ['ryža', 'šampiňóny', 'maslo', 'cibuľa', 'cesnak', 'smotana na varenie'],
  },
  {
    id: 'vajcia-zemiaky',
    name: 'Zemiaky s praženicou',
    time: '25 min',
    ingredients: ['zemiaky', 'vajcia', 'cibuľa', 'slanina', 'maslo'],
  },
  {
    id: 'tunak-cestoviny',
    name: 'Cestoviny s tuniakom',
    time: '20 min',
    ingredients: ['cestoviny', 'tuniak', 'paradajková omáčka', 'cibuľa', 'cesnak', 'syr'],
  },
  {
    id: 'kuracie-ryza',
    name: 'Kuracie so zeleninou a ryžou',
    time: '30 min',
    ingredients: ['kuracie prsia', 'ryža', 'mrkva', 'hrášok', 'cibuľa', 'sójová omáčka'],
  },
  {
    id: 'gulas',
    name: 'Bravčový guláš',
    time: '70 min',
    ingredients: ['bravčové mäso', 'cibuľa', 'zemiaky', 'paprika mletá', 'paprika', 'cesnak'],
  },
  {
    id: 'palacinky',
    name: 'Palacinky',
    time: '25 min',
    ingredients: ['múka', 'mlieko', 'vajcia', 'cukor', 'džem'],
  },
  {
    id: 'francuzske-zemiaky',
    name: 'Francúzske zemiaky',
    time: '55 min',
    ingredients: ['zemiaky', 'vajcia', 'klobása', 'cibuľa', 'kyslá smotana', 'syr'],
  },
]

function RecipesScreen({ onBack, onAddToCart }: {
  onBack: () => void
  onAddToCart: (items: { query: string; groupKey?: string; displayName: string; imageUrl?: string | null }[]) => void
}) {
  const { t } = useT()
  const [hits, setHits] = useState<Record<string, import('./lib/api').ProductHit | null> | null>(null)
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const toggleRecipe = (id: string) => setExpanded(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const checkAvailability = () => {
    setLoading(true)
    const all = [...new Set(RECIPES.flatMap(r => r.ingredients))]
    api.checkIngredients(all)
      .then(r => {
        setHits(r)
        // Ak niečo chýba (BE cache sa možno ešte len zohrieva), skús raz potichu znova
        const missing = all.filter(q => !r[q])
        if (missing.length > 0 && !retryTimer.current) {
          retryTimer.current = setTimeout(() => {
            api.checkIngredients(all).then(r2 => setHits(r2)).catch(() => {})
          }, 12000)
        }
      })
      .catch(() => setHits({}))
      .finally(() => setLoading(false))
  }

  useEffect(() => () => { if (retryTimer.current) clearTimeout(retryTimer.current) }, [])

  return (
    <div style={{ minHeight: '100vh', background: t.bg, fontFamily: t.font }}>
      <div style={{ maxWidth: 660, margin: '0 auto', padding: '28px 16px 64px' }}>
        <ScreenHeader title="Recepty z akcií" onBack={onBack} />

        {!hits && (
          <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 18, padding: 26, marginBottom: 20, boxShadow: t.shadowCard, textAlign: 'center' }}>
            <div style={{
              width: 48, height: 48, borderRadius: 14, background: t.accentSoftBg, color: t.accentSoftText,
              display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px',
            }}><CookingPot size={24} strokeWidth={2} /></div>
            <div style={{ fontSize: 15, color: t.textSec, marginBottom: 18, lineHeight: 1.5 }}>
              Zistíme ktoré suroviny sú práve v akcii a vypočítame orientačnú cenu nákupu.
            </div>
            <button onClick={checkAvailability} disabled={loading} style={{
              padding: '13px 26px', fontSize: 15, fontWeight: 800, fontFamily: t.fontHead,
              background: t.accent, color: t.accentOn, border: 'none',
              borderRadius: 14, cursor: 'pointer', boxShadow: t.shadowCta,
            }}>
              {loading ? 'Kontrolujem akcie…' : 'Zistiť dostupnosť a orientačnú cenu'}
            </button>
          </div>
        )}

        {hits && RECIPES.map(recipe => {
          const onSale = recipe.ingredients.filter(i => hits[i])
          const salePrice = onSale.reduce((s, i) => s + (hits[i]?.bestPrice ?? 0), 0)
          const open = expanded.has(recipe.id)

          return (
            <div key={recipe.id} style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 18, padding: 18, marginBottom: 12, boxShadow: t.shadowCard }}>
              <div onClick={() => toggleRecipe(recipe.id)} style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', userSelect: 'none' }}>
                <div style={{
                  width: 48, height: 48, borderRadius: 14, background: t.accentSoftBg, color: t.accentSoftText,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}><CookingPot size={23} strokeWidth={2} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 17, color: t.text, fontFamily: t.fontHead, letterSpacing: '-0.02em' }}>{recipe.name}</div>
                  <div style={{ fontSize: 12, color: t.textMuted, marginTop: 3, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Clock size={12} strokeWidth={2.2} /> {recipe.time}</span>
                    <span>· {onSale.length}/{recipe.ingredients.length} v akcii</span>
                  </div>
                </div>
                {salePrice > 0 && (
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 11, color: t.textMuted }}>akciové suroviny</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: t.accentInk, fontFamily: t.fontHead }}>~{salePrice.toFixed(2)} €</div>
                  </div>
                )}
                <span style={{ color: t.textMuted, display: 'flex', flexShrink: 0 }}>{open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}</span>
              </div>

              {open && (
                <>
                  {/* Suroviny — zoznam so zarovnanými cenami */}
                  <div style={{ border: `1px solid ${t.hairline}`, borderRadius: 12, overflow: 'hidden', margin: '14px 0' }}>
                    {recipe.ingredients.map((ing, idx) => {
                      const hit = hits[ing]
                      return (
                        <div key={ing} style={{
                          display: 'flex', alignItems: 'center', gap: 9, padding: '10px 12px',
                          borderBottom: idx < recipe.ingredients.length - 1 ? `1px solid ${t.hairline}` : 'none',
                        }}>
                          {hit
                            ? <Check size={15} strokeWidth={2.6} color={t.accent} style={{ flexShrink: 0 }} />
                            : <Minus size={15} strokeWidth={2.2} color={t.textFaint} style={{ flexShrink: 0 }} />}
                          <span style={{ flex: 1, fontSize: 13.5, fontWeight: 500, color: hit ? t.text : t.textMuted }}>{ing}</span>
                          {hit
                            ? <span style={{ fontSize: 13.5, fontWeight: 700, color: t.accentInk }}>{hit.bestPrice.toFixed(2)} €</span>
                            : <span style={{ fontSize: 12.5, fontWeight: 500, color: t.textFaint }}>nie v akcii</span>}
                        </div>
                      )
                    })}
                  </div>

                  <button
                    onClick={() => {
                      const items = recipe.ingredients.map(ing => {
                        const hit = hits[ing]
                        return { query: ing, groupKey: hit?.groupKey, displayName: hit?.name ?? ing, imageUrl: hit?.imageUrl }
                      })
                      onAddToCart(items)
                      onBack()
                    }}
                    style={{
                      width: '100%', padding: '12px', fontSize: 14, fontWeight: 800, fontFamily: t.fontHead,
                      background: t.accent, color: t.accentOn, border: 'none',
                      borderRadius: 12, cursor: 'pointer',
                    }}
                  >
                    Pridať suroviny do zoznamu
                  </button>
                </>
              )}
            </div>
          )
        })}

        {hits && (
          <button onClick={checkAvailability} disabled={loading} style={{
            width: '100%', padding: '11px', fontSize: 13, fontWeight: 600,
            background: t.surface, color: t.textSec, border: `1px solid ${t.border}`,
            borderRadius: 12, cursor: 'pointer', marginTop: 4, fontFamily: t.font,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
          }}>
            <RefreshCw size={14} /> {loading ? 'Kontrolujem…' : 'Obnoviť ceny'}
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Drawer (bočné menu) ──────────────────────────────────────────────────────
function Drawer({ screen, session, onNavigate, onClose, onLogout }: {
  screen: string
  session: { user: { email: string; name?: string | null } }
  onNavigate: (s: 'main' | 'recipes' | 'saved') => void
  onClose: () => void
  onLogout: () => void
}) {
  const { t, mode, setMode } = useT()
  const initial = (session.user.name || session.user.email || '?')[0].toUpperCase()

  const NAV: { label: string; screen: 'main' | 'recipes' | 'saved'; icon: React.ReactNode }[] = [
    { label: 'Nákup', screen: 'main', icon: <ShoppingCart size={18} strokeWidth={2} /> },
    { label: 'Recepty', screen: 'recipes', icon: <CookingPot size={18} strokeWidth={2} /> },
    { label: 'Moje zoznamy', screen: 'saved', icon: <ClipboardList size={18} strokeWidth={2} /> },
  ]

  const MODES: { m: ThemeMode; label: string; icon: React.ReactNode }[] = [
    { m: 'light', label: 'Svetlý', icon: <Sun size={15} strokeWidth={2.2} /> },
    { m: 'dark', label: 'Tmavý', icon: <Moon size={15} strokeWidth={2.2} /> },
    { m: 'system', label: 'Systém', icon: <Monitor size={15} strokeWidth={2.2} /> },
  ]

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: t.scrim }}>
      <div onClick={e => e.stopPropagation()} style={{
        position: 'absolute', top: 12, right: 12, bottom: 12, width: 280,
        background: t.surface, boxShadow: t.shadowDrawer, borderRadius: 28,
        display: 'flex', flexDirection: 'column', padding: 22, fontFamily: t.font,
      }}>
        {/* Profil */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 26, paddingTop: 6 }}>
          <div style={{
            width: 38, height: 38, borderRadius: '50%', background: t.accentSoftBg, color: t.accentSoftText,
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 16,
            fontFamily: t.fontHead, flexShrink: 0,
          }}>{initial}</div>
          <div style={{ minWidth: 0 }}>
            {session.user.name && <div style={{ fontSize: 14, fontWeight: 700, color: t.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{session.user.name}</div>}
            <div style={{ fontSize: 12, color: t.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{session.user.email}</div>
          </div>
        </div>

        {/* Navigácia */}
        {NAV.map(item => {
          const active = screen === item.screen
          return (
            <button key={item.screen} onClick={() => onNavigate(item.screen)} style={{
              background: active ? t.accentSoftBg : 'none', border: 'none', textAlign: 'left',
              padding: '12px 12px', margin: '2px -6px', borderRadius: 12,
              fontSize: 15, fontWeight: active ? 700 : 600, fontFamily: t.font,
              color: active ? t.accentSoftText : t.text, cursor: 'pointer', width: 'calc(100% + 12px)',
              display: 'flex', alignItems: 'center', gap: 11,
            }}>
              <span style={{ color: active ? t.accentSoftText : t.textMuted, display: 'flex' }}>{item.icon}</span>
              {item.label}
            </button>
          )
        })}

        <div style={{ flex: 1 }} />

        {/* Prepínač témy */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: t.textMuted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Vzhľad</div>
          <div style={{ display: 'flex', gap: 4, background: t.surface2, borderRadius: 12, padding: 4 }}>
            {MODES.map(({ m, label, icon }) => {
              const active = mode === m
              return (
                <button key={m} onClick={() => setMode(m)} style={{
                  flex: 1, padding: '8px 4px', borderRadius: 9, border: 'none', cursor: 'pointer',
                  background: active ? t.surface : 'transparent',
                  color: active ? t.text : t.textMuted,
                  fontSize: 11, fontWeight: active ? 700 : 500, fontFamily: t.font,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
                  boxShadow: active ? '0 1px 4px rgba(0,0,0,0.12)' : 'none',
                }}>
                  {icon}{label}
                </button>
              )
            })}
          </div>
        </div>

        <button onClick={onLogout} style={{
          background: t.surface2, border: 'none', borderRadius: 12, padding: '11px 14px',
          cursor: 'pointer', fontSize: 13, fontWeight: 600, color: t.textSec, width: '100%',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontFamily: t.font,
        }}><LogOut size={15} strokeWidth={2.2} /> Odhlásiť sa</button>
      </div>
    </div>
  )
}

// ─── AppInner ─────────────────────────────────────────────────────────────────
function AppInner() {
  const { t } = useT()
  const [screen, setScreen] = useState<'main' | 'saved' | 'login' | 'register' | 'verify' | 'recipes'>('main')
  const [menuOpen, setMenuOpen] = useState(false)
  const [verifyEmail, setVerifyEmail] = useState('')
  const { data: session, isPending: sessionLoading } = authClient.useSession()
  const [stores, setStores] = useState<Store[]>([])
  const [selectedNames, setSelectedNames] = useState<string[]>([])
  const [cartItems, setCartItems] = useState<CartItem[]>([])
  const [result, setResult] = useState<OptimizeResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingApprovals, setPendingApprovals] = useState<NeedsApproval[]>([])
  const [pendingItems, setPendingItems] = useState<CartItem[]>([])
  // Vstupné sekcie (vyhľadávanie + obchody) sa po vytvorení zoznamu zbalia, aby ušetrili miesto
  const [inputsCollapsed, setInputsCollapsed] = useState(false)
  const [favorites, setFavorites] = useState<FavoriteDto[]>([])

  // Pozadie dokumentu (overscroll) podľa témy
  useEffect(() => { document.body.style.background = t.bg }, [t.bg])

  // Obľúbené položky sú viazané na účet — načítaj po prihlásení, vyprázdni po odhlásení
  useEffect(() => {
    if (session) api.getFavorites().then(setFavorites).catch(() => {})
    else setFavorites([])
  }, [session])

  const isFavorite = useCallback((query: string) => favorites.some(f => f.query === query), [favorites])

  const toggleFavorite = (item: CartItem) => {
    if (isFavorite(item.query)) {
      setFavorites(prev => prev.filter(f => f.query !== item.query))
      api.removeFavorite(item.query).catch(() => {})
    } else {
      setFavorites(prev => [{ id: `local-${item.query}`, query: item.query, groupKey: item.groupKey, displayName: item.displayName, imageUrl: item.imageUrl, createdAt: new Date().toISOString() }, ...prev])
      api.addFavorite({ query: item.query, groupKey: item.groupKey, displayName: item.displayName, imageUrl: item.imageUrl })
        .then(saved => setFavorites(prev => prev.map(f => f.query === saved.query ? saved : f)))
        .catch(() => setFavorites(prev => prev.filter(f => f.query !== item.query)))
    }
  }

  // Prázdny košík → vstupné sekcie vždy rozbalené
  useEffect(() => { if (cartItems.length === 0) setInputsCollapsed(false) }, [cartItems.length])

  const saveResult = async () => {
    if (!result) return
    const storeNames = result.stores
      .sort((a, b) => b.items.length - a.items.length)
      .map(s => s.storeName)
    const name = `${formatDate(new Date())} - ${storeNames.join(', ')}`
    try {
      await api.saveList(name, result.stores, result.unmatched)
    } catch {
      setError('Zoznam sa nepodarilo uložiť — skús znova')
      return
    }
    setCartItems([])
    setResult(null)
    setPendingApprovals([])
    setPendingItems([])
    setError(null)
    setSelectedNames(stores.map(s => s.name))
    setScreen('saved')
  }

  useEffect(() => {
    api.stores().then(data => { setStores(data); setSelectedNames(data.map(s => s.name)) }).catch(() => {})
  }, [])

  const addItem = useCallback((item: CartItem) => {
    setCartItems(prev => prev.some(i => i.query === item.query) ? prev : [...prev, item])
  }, [])

  const runOptimize = async (items: CartItem[]) => {
    setLoading(true); setError(null)
    try {
      const allSelected = stores.length > 0 && stores.every(s => selectedNames.includes(s.name))
      const company_ids = allSelected
        ? []
        : stores.filter(s => selectedNames.includes(s.name)).flatMap(s => s.companyIds)
      const res = await api.optimize(items.map(i => ({ query: i.query, groupKey: i.groupKey })), company_ids)
      if (res.needsApproval.length > 0) {
        setPendingApprovals(res.needsApproval)
        setPendingItems(items)
        setResult(res) // čiastočný výsledok (bez položiek čakajúcich na schválenie)
      } else {
        setPendingApprovals([])
        setPendingItems([])
        setResult(res)
      }
    } catch { setError('Backend nedostupný — spusti: npm run dev:backend') }
    finally { setLoading(false) }
  }

  const optimize = () => { if (cartItems.length) { setInputsCollapsed(true); runOptimize(cartItems) } }

  const approveAll = async (decisions: { approval: NeedsApproval; accepted: boolean }[]) => {
    const rejectedQueries = new Set(decisions.filter(d => !d.accepted).map(d => d.approval.originalQuery))
    const approvedMap = new Map(decisions.filter(d => d.accepted).map(d => [d.approval.originalQuery, d.approval]))

    // Vychádza z aktuálnych cartItems (rešpektuje odobrané položky počas approval)
    const newItems = cartItems
      .filter(i => !rejectedQueries.has(i.query))
      .map(i => {
        const approval = approvedMap.get(i.query)
        if (approval) return { ...i, groupKey: approval.suggested.groupKey }
        return i
      })

    if (rejectedQueries.size > 0) setCartItems(prev => prev.filter(i => !rejectedQueries.has(i.query)))

    setPendingApprovals([])
    setPendingItems([])
    await runOptimize(newItems)
  }

  if (screen === 'login') return <LoginScreen onSwitch={() => setScreen('register')} onBack={() => { setCartItems([]); setResult(null); setScreen('main') }} onSuccess={() => setScreen('main')} />
  if (screen === 'register') return <RegisterScreen onSwitch={() => setScreen('login')} onBack={() => { setCartItems([]); setResult(null); setScreen('main') }} onVerify={email => { setVerifyEmail(email); setScreen('verify') }} />
  if (screen === 'verify') return <VerifyEmailScreen email={verifyEmail} onBack={() => setScreen('main')} />
  if (screen === 'saved') return (
    <>
      <SavedListsScreen onBack={() => setScreen('main')} onReuse={items => {
        setCartItems(items); setResult(null); setPendingApprovals([]); setPendingItems([]); setInputsCollapsed(false); setScreen('main')
      }} />
      {menuOpen && session && (
        <Drawer screen={screen} session={session} onClose={() => setMenuOpen(false)}
          onNavigate={s => { setScreen(s); setMenuOpen(false) }}
          onLogout={() => { authClient.signOut(); setMenuOpen(false); setCartItems([]); setResult(null); setScreen('main') }} />
      )}
    </>
  )
  if (screen === 'recipes') return (
    <>
      <RecipesScreen
        onBack={() => setScreen('main')}
        onAddToCart={items => {
          items.forEach(item => setCartItems(prev => prev.some(i => i.query === item.query) ? prev : [...prev, item]))
        }}
      />
      {menuOpen && session && (
        <Drawer screen={screen} session={session} onClose={() => setMenuOpen(false)}
          onNavigate={s => { setScreen(s); setMenuOpen(false) }}
          onLogout={() => { authClient.signOut(); setMenuOpen(false); setCartItems([]); setResult(null); setScreen('main') }} />
      )}
    </>
  )

  const allSel = stores.length > 0 && stores.every(s => selectedNames.includes(s.name))

  return (
    <div style={{ minHeight: '100vh', background: t.bg, fontFamily: t.font }}>
      <div style={{ maxWidth: 660, margin: '0 auto', padding: '28px 16px 64px' }}>

        {/* Bočné menu — len pre prihlásených */}
        {menuOpen && session && (
          <Drawer screen={screen} session={session} onClose={() => setMenuOpen(false)}
            onNavigate={s => { setScreen(s); setMenuOpen(false) }}
            onLogout={() => { authClient.signOut(); setMenuOpen(false); setCartItems([]); setResult(null); setScreen('main') }} />
        )}

        {/* Hlavička — sticky */}
        <div style={{
          position: 'sticky', top: 0, zIndex: 100, background: t.bg,
          padding: '10px 0 14px', marginBottom: 10,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: t.text, fontFamily: t.fontHead, letterSpacing: '-0.02em' }}>SmartNákup</h1>
          {/* Vpravo: buď Prihlásiť sa (neprihlásený) alebo menu (prihlásený) */}
          {!sessionLoading && (
            session
              ? <button onClick={() => setMenuOpen(true)} style={{
                  width: 42, height: 42, borderRadius: '50%', background: t.surface, border: `1px solid ${t.border}`,
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: t.textSec,
                }}><Menu size={19} strokeWidth={2} /></button>
              : <button onClick={() => setScreen('login')} style={{
                  background: t.surface, border: `1px solid ${t.border}`, borderRadius: 12, padding: '9px 16px',
                  cursor: 'pointer', fontSize: 13, fontWeight: 700, color: t.accentInk, whiteSpace: 'nowrap', fontFamily: t.font,
                }}>Prihlásiť sa</button>
          )}
        </div>

        {/* Po vytvorení zoznamu sa vstupné sekcie zbalia do kompaktného pruhu */}
        {inputsCollapsed ? (
          <div onClick={() => setInputsCollapsed(false)} style={{
            background: t.surface, border: `1px solid ${t.border}`, borderRadius: 18, padding: '14px 18px',
            marginBottom: 12, boxShadow: t.shadowCard, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: t.text, fontFamily: t.fontHead, letterSpacing: '-0.02em' }}>Upraviť nákup</div>
              <div style={{ fontSize: 12, color: t.textSec, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {cartItems.length} {cartItems.length === 1 ? 'položka' : cartItems.length < 5 ? 'položky' : 'položiek'}
                {' · '}{allSel ? 'všetky obchody' : `${selectedNames.length} ${selectedNames.length === 1 ? 'obchod' : selectedNames.length < 5 ? 'obchody' : 'obchodov'}`}
              </div>
            </div>
            <ChevronDown size={20} color={t.textMuted} style={{ flexShrink: 0 }} />
          </div>
        ) : (
        <>
        {/* Vyhľadávanie + košík */}
        <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 18, padding: 20, marginBottom: 12, boxShadow: t.shadowCard }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <SectionLabel>Čo chceš kúpiť?</SectionLabel>
            {result && (
              <button onClick={() => setInputsCollapsed(true)} title="Zbaliť" style={{
                background: 'none', border: 'none', cursor: 'pointer', color: t.textMuted,
                display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600,
                fontFamily: t.font, padding: 0, marginTop: -8,
              }}>Zbaliť <ChevronUp size={16} /></button>
            )}
          </div>
          <TypeaheadInput onAdd={addItem} />
          {cartItems.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <SectionLabel>V košíku · {cartItems.length} {cartItems.length === 1 ? 'položka' : cartItems.length < 5 ? 'položky' : 'položiek'}</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {cartItems.map(item => (
                  <div key={item.query} style={{
                    display: 'flex', alignItems: 'center', gap: 10, background: t.surface2,
                    border: `1px solid ${t.hairline}`, padding: '8px 12px', borderRadius: 12,
                  }}>
                    <ProductImg src={item.imageUrl} size={30} radius={8} />
                    <span style={{ flex: 1, fontSize: 14, fontWeight: 500, color: t.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.displayName}</span>
                    {session && (
                      <button onClick={() => toggleFavorite(item)} title={isFavorite(item.query) ? 'Odobrať z obľúbených' : 'Pridať medzi obľúbené'}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: isFavorite(item.query) ? t.promoText : t.textFaint, padding: 2, display: 'flex' }}>
                        <Heart size={15} strokeWidth={2.2} fill={isFavorite(item.query) ? 'currentColor' : 'none'} />
                      </button>
                    )}
                    <button onClick={() => { setCartItems(p => p.filter(i => i.query !== item.query)); setResult(null) }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: t.textFaint, padding: 2, display: 'flex' }}>
                      <X size={16} strokeWidth={2.4} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {session && favorites.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <SectionLabel>Obľúbené</SectionLabel>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {favorites.map(f => (
                  <div key={f.query} onClick={() => addItem({ query: f.query, groupKey: f.groupKey ?? undefined, displayName: f.displayName, imageUrl: f.imageUrl })}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 7, background: t.surface2, border: `1px solid ${t.hairline}`,
                      borderRadius: 999, padding: '5px 8px 5px 6px', cursor: 'pointer', maxWidth: 200,
                    }}>
                    <ProductImg src={f.imageUrl} size={22} radius={999} />
                    <span style={{ fontSize: 13, fontWeight: 500, color: t.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.displayName}</span>
                    <button onClick={e => { e.stopPropagation(); setFavorites(prev => prev.filter(x => x.query !== f.query)); api.removeFavorite(f.query).catch(() => {}) }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: t.textFaint, padding: 0, display: 'flex', flexShrink: 0 }}>
                      <X size={13} strokeWidth={2.4} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Výber obchodov — mriežka: Všetky cez celú šírku, potom 2/riadok */}
        <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 18, padding: 20, marginBottom: 12, boxShadow: t.shadowCard }}>
          <SectionLabel>Obchody</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
            <button onClick={() => { setSelectedNames(allSel ? [] : stores.map(s => s.name)); setResult(null) }} style={{
              gridColumn: '1 / -1',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
              padding: '11px 12px', borderRadius: 13,
              border: `1.5px solid ${allSel ? t.accent : t.border}`,
              background: allSel ? t.accentTileBg : 'transparent',
              color: allSel ? t.accentInk : t.textMuted,
              fontWeight: 700, cursor: 'pointer', fontSize: 13.5, fontFamily: t.font, transition: 'all 0.15s',
            }}>
              Všetky obchody
              {allSel && <Check size={15} strokeWidth={2.6} />}
            </button>
            {stores.map(s => {
              const sel = selectedNames.includes(s.name)
              const b = storeBrand(s.name)
              const ink = storeInk(s.name, t.isDark)
              return (
                <button key={s.name} onClick={() => {
                  setSelectedNames(prev => prev.includes(s.name) ? prev.filter(x => x !== s.name) : [...prev, s.name])
                  setResult(null)
                }} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '10px 12px', borderRadius: 13, minWidth: 0,
                  border: `1.5px solid ${sel ? ink : t.border}`,
                  background: sel ? `${b.main}${t.isDark ? '22' : '18'}` : 'transparent',
                  color: sel ? ink : t.textMuted,
                  fontWeight: 700, cursor: 'pointer', fontSize: 13.5, fontFamily: t.font, transition: 'all 0.15s',
                }}>
                  <StoreLogo name={s.name} size={22} muted={!sel} />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}>{s.name}</span>
                  {sel && <Check size={15} strokeWidth={2.6} style={{ flexShrink: 0 }} />}
                </button>
              )
            })}
          </div>
        </div>
        </>
        )}

        {/* CTA */}
        <button onClick={optimize} disabled={!cartItems.length || loading} style={{
          width: '100%', padding: '15px', fontSize: 16, fontWeight: 800, fontFamily: t.fontHead,
          background: !cartItems.length ? t.ctaDisabledBg : t.accent,
          color: !cartItems.length ? t.ctaDisabledText : t.accentOn,
          border: 'none', borderRadius: 14,
          cursor: !cartItems.length ? 'not-allowed' : 'pointer',
          marginBottom: 20,
          boxShadow: !cartItems.length ? 'none' : t.shadowCta,
        }}>
          {loading ? 'Hľadám najlepšie ceny…' : 'Vytvoriť nákupné zoznamy'}
        </button>

        {error && <div style={{ background: t.errorBg, border: `1px solid ${t.errorBorder}`, borderRadius: 12, padding: 14, marginBottom: 14, color: t.errorText, fontSize: 13 }}>{error}</div>}

        {/* Approval panel */}
        {pendingApprovals.length > 0 && (
          <ApprovalPanel approvals={pendingApprovals} onDecide={approveAll} />
        )}

        {result && (
          <div>
            {(() => {
              const totalSaving = result.stores.flatMap(s => s.items).reduce((sum, item) => sum + (((item as any).saving as number) || 0), 0)
              return totalSaving >= 0.01 ? (
                <div style={{
                  background: t.savingBg, border: `1px solid ${t.savingBorder}`,
                  borderLeft: t.savingStripe ? `3px solid ${t.savingStripe}` : `1px solid ${t.savingBorder}`,
                  borderRadius: 16, padding: '15px 18px', marginBottom: 12,
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <div>
                    <div style={{ fontWeight: 700, color: t.savingText, fontSize: 15, fontFamily: t.fontHead, letterSpacing: '-0.02em' }}>Celková úspora</div>
                    <div style={{ fontSize: 12, color: t.savingSub, marginTop: 2 }}>oproti najdrahšiemu obchodu pre každú položku</div>
                  </div>
                  <div style={{ fontSize: 30, fontWeight: 800, color: t.savingText, fontFamily: t.fontHead, letterSpacing: '-0.02em' }}>{totalSaving.toFixed(2)} €</div>
                </div>
              ) : null
            })()}
            <StoreComparisonTable result={result} stores={stores} selectedNames={selectedNames} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {result.stores.map(g => <ResultCard key={g.companyId} group={g} />)}
            </div>
            {result.unmatched.length > 0 && (
              <div style={{ marginTop: 10, background: t.warnBg, border: `1px solid ${t.warnBorder}`, borderRadius: 12, padding: 14, fontSize: 13 }}>
                <strong style={{ color: t.warnText }}>Nenájdené:</strong>
                <span style={{ marginLeft: 8, color: t.warnText, opacity: 0.8 }}>{result.unmatched.join(', ')}</span>
              </div>
            )}
            {result.stores.length > 0 && (
              <button onClick={session ? saveResult : () => setScreen('login')} style={{
                marginTop: 14, width: '100%', padding: '14px', fontSize: 15, fontWeight: 800, fontFamily: t.fontHead,
                background: 'transparent',
                color: session ? t.accentInk : t.textMuted,
                border: `1.5px solid ${session ? t.accent : t.border}`,
                borderRadius: 14, cursor: 'pointer',
              }}>
                {session ? 'Uložiť nákupné zoznamy' : 'Prihlásiť sa pre uloženie zoznamov'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── App (theme provider) ─────────────────────────────────────────────────────
export default function App() {
  const { mode, setMode, theme } = useThemeMode()
  return (
    <ThemeCtx.Provider value={{ t: theme, mode, setMode }}>
      <AppInner />
    </ThemeCtx.Provider>
  )
}
