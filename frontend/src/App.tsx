import { useState, useEffect, useRef, useCallback } from 'react'
import { api, Store, ProductHit, OptimizeResult, NeedsApproval } from './lib/api'
import { useDebounce } from './hooks/useDebounce'
import { authClient } from './lib/authClient'

const COLORS: Record<string, { main: string; bg: string; text?: string; abbr: string }> = {
  'Lidl':     { main: '#0050AA', bg: '#e8f0fb', abbr: 'L' },
  'Kaufland': { main: '#cc0000', bg: '#fde8e8', abbr: 'K' },
  'Tesco':    { main: '#003DA5', bg: '#e8edf8', abbr: 'T' },
  'Billa':    { main: '#FFC72C', bg: '#fff8e1', text: '#1a1a1a', abbr: 'B' },
  'Terno':    { main: '#ff6600', bg: '#fff3e0', abbr: 'Tn' },
  'Fresh':    { main: '#5aaa3c', bg: '#edf7e8', abbr: 'F' },
}
function col(name: string) { return COLORS[name] ?? { main: '#475569', bg: '#f8fafc', abbr: name[0] ?? '?' } }

const STORE_LOGO_EXT: Record<string, string> = {
  'Lidl': 'png', 'Kaufland': 'png', 'Billa': 'png', 'Terno': 'png',
  'Tesco': 'png', 'Fresh': 'png',
}

function StoreLogo({ name, size = 22 }: { name: string; size?: number }) {
  const c = col(name)
  const ext = STORE_LOGO_EXT[name]
  const [imgFailed, setImgFailed] = useState(false)

  if (ext && !imgFailed) {
    return (
      <img
        src={`/stores/${name.toLowerCase()}.${ext}`}
        alt={name}
        style={{ width: size, height: size, objectFit: 'contain', flexShrink: 0, borderRadius: 3 }}
        onError={() => setImgFailed(true)}
      />
    )
  }

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: size, height: size, borderRadius: '50%',
      background: c.text ? c.main : '#ffffff33',
      color: c.text ?? '#fff',
      fontWeight: 800, fontSize: size * 0.45, flexShrink: 0,
      border: c.text ? `1.5px solid ${c.main}` : 'none',
    }}>{c.abbr}</span>
  )
}

function ProductImg({ src, size = 36 }: { src: string | null | undefined; size?: number }) {
  const [failed, setFailed] = useState(false)
  if (src && !failed) {
    return (
      <img src={src} alt="" style={{ width: size, height: size, objectFit: 'contain', borderRadius: 6, flexShrink: 0, border: '1px solid #f0f0f0' }}
        onError={() => setFailed(true)} />
    )
  }
  return (
    <img src="/stores/food-placeholder.svg" alt="" style={{ width: size, height: size, objectFit: 'contain', borderRadius: 6, flexShrink: 0, opacity: 0.5 }} />
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

function saveLists(lists: SavedList[]) {
  localStorage.setItem('smartnakup_lists', JSON.stringify(lists))
}

// ─── TypeaheadInput ───────────────────────────────────────────────────────────
function TypeaheadInput({ onAdd }: { onAdd: (item: CartItem) => void }) {
  const [value, setValue] = useState('')
  const [suggestions, setSuggestions] = useState<ProductHit[]>([])
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const [loading, setLoading] = useState(false)
  const [hoveredKey, setHoveredKey] = useState<string | null>(null)
  const debouncedQ = useDebounce(value, 280)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (debouncedQ.length < 2) { setSuggestions([]); setOpen(false); return }
    setLoading(true)
    api.search(debouncedQ)
      .then(hits => { setSuggestions(hits); setOpen(hits.length > 0); setActiveIdx(-1) })
      .catch(() => {})
      .finally(() => setLoading(false))
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
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <input
            ref={inputRef} value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={handleKey}
            onBlur={() => setTimeout(() => setOpen(false), 200)}
            onFocus={() => suggestions.length > 0 && setOpen(true)}
            placeholder="Napr. mlieko, vajcia, gouda..."
            autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
            enterKeyHint="search"
            style={{
              width: '100%', padding: '13px 40px 13px 16px', fontSize: 16,
              border: '2px solid #e2e8f0', borderRadius: 12, outline: 'none',
              fontFamily: 'inherit', boxSizing: 'border-box', color: '#1a202c',
            }}
            onFocusCapture={e => e.currentTarget.style.borderColor = '#3b82f6'}
            onBlurCapture={e => e.currentTarget.style.borderColor = '#e2e8f0'}
          />
          {loading && <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)' }}>⏳</span>}
        </div>
        <button onClick={() => value.trim() && commit({ query: value.trim(), displayName: value.trim() })}
          style={{ padding: '13px 22px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 12, fontSize: 20, fontWeight: 700, cursor: 'pointer' }}>+</button>
      </div>

      {open && suggestions.length > 0 && (
        <ul
          onMouseDown={e => e.preventDefault()}
          onTouchMove={() => inputRef.current?.blur()}
          style={{
          position: 'absolute', bottom: 'calc(100% + 8px)', left: 0, right: 0, zIndex: 200,
          background: '#fff', border: '2px solid #3b82f6', borderRadius: 14,
          padding: 6, margin: 0, listStyle: 'none',
          boxShadow: '0 -4px 32px rgba(0,0,0,0.13)',
          maxHeight: 'min(340px, 45vh)', overflowY: 'auto',
        }}>
          {suggestions.map((hit, i) => {
            const c = col(hit.bestStore)
            const unitLabel = hit.unit === 'g' ? 'kg' : hit.unit === 'ml' ? 'l' : hit.unit
            return (
              <li key={hit.groupKey}
                onClick={() => commit({ query: hit.name, groupKey: hit.groupKey, displayName: hit.name, imageUrl: hit.imageUrl })}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 9, cursor: 'pointer', background: i === activeIdx ? '#eff6ff' : 'transparent' }}>
                <ProductImg src={hit.imageUrl} size={40} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{hit.name}</div>
                  <div style={{ fontSize: 12, color: '#64748b' }}>
                    {hit.packageSize}{hit.unit}
                    {' · '}od <strong style={{ color: '#16a34a' }}>{hit.bestPrice.toFixed(2)} €</strong>
                    <span style={{ color: '#94a3b8', marginLeft: 4 }}>({hit.bestUnitPrice.toFixed(2)} €/{unitLabel})</span>
                  </div>
                </div>
                <div style={{ flexShrink: 0, textAlign: 'right', position: 'relative' }}
                  onMouseEnter={() => setHoveredKey(hit.groupKey)}
                  onMouseLeave={() => setHoveredKey(null)}>
                  <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: c.main + '18', color: c.main, fontWeight: 600, whiteSpace: 'nowrap', cursor: hit.storeCount > 1 ? 'default' : undefined }}>
                    {hit.bestStore}{hit.storeCount > 1 ? ` +${hit.storeCount - 1}` : ''}
                  </span>
                  {hoveredKey === hit.groupKey && hit.storeNames && hit.storeNames.length > 1 && (
                    <div style={{
                      position: 'absolute', right: 0, top: 'calc(100% + 4px)', zIndex: 400,
                      background: '#1e293b', color: '#fff', borderRadius: 8, padding: '6px 10px',
                      fontSize: 11, whiteSpace: 'nowrap', boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
                      pointerEvents: 'none',
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
      )}
    </div>
  )
}

// ─── ResultCard ───────────────────────────────────────────────────────────────
function ResultCard({ group }: { group: OptimizeResult['stores'][0] }) {
  const { main, bg } = col(group.storeName)
  return (
    <div style={{ borderRadius: 16, overflow: 'hidden', border: `2px solid ${main}22`, background: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
      <div style={{ background: main, padding: '14px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <StoreLogo name={group.storeName} size={26} />
          <span style={{ color: COLORS[group.storeName]?.text ?? '#fff', fontWeight: 800, fontSize: 18 }}>{group.storeName}</span>
        </div>
        <span style={{ color: COLORS[group.storeName]?.text ?? '#fff', fontWeight: 800, fontSize: 22 }}>{group.subtotal.toFixed(2)} €</span>
      </div>
      <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {group.items.map((item, i) => {
          const unitLabel = item.unit === 'g' ? 'kg' : item.unit === 'ml' ? 'l' : item.unit
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 9, background: bg }}>
              <ProductImg src={item.imageUrl} size={36} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, fontSize: 14 }}>{item.query}</div>
                <div style={{ fontSize: 12, color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {item.name !== item.query ? item.name + ' · ' : ''}{item.packageSize}{item.unit}
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                  {item.isPromo && <span style={{ fontSize: 11, background: '#dc2626', color: '#fff', borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>AKCIA</span>}
                  <span style={{ fontWeight: 700, color: item.isPromo ? '#dc2626' : '#1e293b', fontSize: 15 }}>{item.price.toFixed(2)} €</span>
                </div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>{item.unitPrice.toFixed(2)} €/{unitLabel}</div>
                {/* Porovnanie s ostatnými obchodmi */}
                {item.allStores.length > 1 && (
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                    {item.allStores
                      .filter((s: any) => s.storeName !== group.storeName)
                      .slice(0, 2)
                      .map((s: any) => `${s.storeName} ${s.price.toFixed(2)}€`)
                      .join(' · ')}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── ApprovalPanel ────────────────────────────────────────────────────────────
type Toast = { query: string; originalQuery: string; name: string }

function ApprovalPanel({
  approvals,
  onDecide,
  col,
}: {
  approvals: NeedsApproval[]
  onDecide: (decisions: { approval: NeedsApproval; accepted: boolean }[]) => void
  col: (name: string) => { main: string; bg: string }
}) {
  const [accepted, setAccepted] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(approvals.map(a => [a.originalQuery, true]))
  )
  const [toasts, setToasts] = useState<Toast[]>([])
  const timerRefs = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  const removeToast = (query: string) =>
    setToasts(prev => prev.filter(t => t.query !== query))

  const reject = (query: string, name: string) => {
    setAccepted(prev => ({ ...prev, [query]: false }))
    setToasts(prev => [...prev.filter(t => t.query !== query), { query, originalQuery: query, name }])
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
    <div style={{ marginBottom: 16 }}>
      {/* Stacked toasts */}
      {toasts.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
          {toasts.map(t => (
            <div key={t.query} style={{
              background: '#1e293b', color: '#fff', borderRadius: 12, padding: '12px 16px',
              display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
              fontSize: 13, boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
            }}>
              <div>
                <div>„{t.name}" odstránené zo zoznamu</div>
                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 3 }}>
                  Produkt nie je dostupný vo zvolených obchodoch — zvážte pridanie ďalšieho obchodu
                </div>
              </div>
              <button onClick={() => undo(t.query)} style={{
                background: '#fff', color: '#1e293b', border: 'none', borderRadius: 8,
                padding: '5px 12px', fontWeight: 700, cursor: 'pointer', fontSize: 13,
                marginLeft: 14, flexShrink: 0,
              }}>Späť</button>
            </div>
          ))}
        </div>
      )}

      {/* Panel */}
      <div style={{ background: '#fffbeb', border: '2px solid #f59e0b', borderRadius: 16, padding: 18 }}>
        <div style={{ fontWeight: 700, color: '#92400e', fontSize: 14, marginBottom: 4 }}>
          ⚠️ Niektoré produkty nie sú v tvojich obchodoch
        </div>
        <div style={{ fontSize: 13, color: '#78350f', marginBottom: 14 }}>
          Našli sme alternatívy — zamietnuť ich môžeš kliknutím na ✕
        </div>

        {visible.length === 0 && (
          <div style={{ fontSize: 13, color: '#92400e', textAlign: 'center', padding: '10px 0' }}>
            Všetky náhrady zamietnuté
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {visible.map(a => {
            const s = a.suggested
            const c = col(s.storeName)
            const unitLabel = s.unit === 'g' ? 'kg' : s.unit === 'ml' ? 'l' : s.unit
            return (
              <div key={a.originalQuery} style={{
                background: '#fff', borderRadius: 12, padding: '12px 14px',
                border: '2px solid #86efac',
                display: 'flex', alignItems: 'center', gap: 12,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', marginBottom: 2 }}>Hľadaný</div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: '#1e293b' }}>"{a.originalQuery}"</div>
                  <div style={{ fontSize: 12, color: '#ef4444' }}>Nie je v zvolených obchodoch</div>
                </div>

                <div style={{ color: '#cbd5e1', fontSize: 18, flexShrink: 0 }}>→</div>

                <div style={{ flex: 2, minWidth: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <ProductImg src={s.imageUrl} size={44} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</div>
                    <div style={{ fontSize: 12, color: '#64748b' }}>
                      {s.packageSize}{s.unit} · <strong style={{ color: '#16a34a' }}>{s.price.toFixed(2)} €</strong>
                      <span style={{ color: '#94a3b8' }}> ({s.unitPrice.toFixed(2)} €/{unitLabel})</span>
                    </div>
                    <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 20, background: c.main + '18', color: c.main, fontWeight: 600 }}>{s.storeName}</span>
                  </div>
                </div>

                <button onClick={() => reject(a.originalQuery, s.name)} style={{
                  flexShrink: 0, width: 32, height: 32, borderRadius: '50%',
                  border: '2px solid #fca5a5', background: '#fef2f2',
                  color: '#dc2626', fontWeight: 700, cursor: 'pointer', fontSize: 16,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>✕</button>
              </div>
            )
          })}
        </div>

        <button onClick={confirm} style={{
          marginTop: 14, width: '100%', padding: '12px', fontSize: 15, fontWeight: 700,
          background: '#f59e0b', color: '#fff', border: 'none', borderRadius: 12, cursor: 'pointer',
        }}>
          Potvrdiť a prepočítať
        </button>
      </div>
    </div>
  )
}

// ─── SavedListCard ────────────────────────────────────────────────────────────
function SavedListCard({ list, onDelete }: { list: SavedList; onDelete: () => void }) {
  // checked: Set of "companyId:query" keys
  const [checked, setChecked] = useState<Set<string>>(new Set())
  // collapsed stores (manually toggled by user)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

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

  // Auto-collapse store when all its items get checked; auto-expand when one unchecked
  const storeCollapsed = (store: SavedList['stores'][0]) =>
    isStoreDone(store) || collapsed.has(store.companyId)

  const toggleCollapse = (companyId: string) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(companyId)) next.delete(companyId); else next.add(companyId)
      return next
    })
  }

  const cardBg = allDone ? '#f0fdf4' : '#fff'
  const cardBorder = allDone ? '2px solid #86efac' : '2px solid transparent'

  return (
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 16, padding: 18, boxShadow: '0 1px 6px rgba(0,0,0,0.07)', transition: 'background 0.2s' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {allDone && <span style={{ fontSize: 16 }}>✅</span>}
            <span style={{ fontWeight: 700, fontSize: 16, color: allDone ? '#15803d' : '#0f172a' }}>{list.name}</span>
            {allDone && <span style={{ fontSize: 12, fontWeight: 600, color: '#16a34a', background: '#dcfce7', padding: '2px 8px', borderRadius: 20 }}>Hotové</span>}
          </div>
          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{new Date(list.savedAt).toLocaleString('sk-SK')}</div>
        </div>
        <button onClick={onDelete} style={{ background: 'none', border: '1px solid #fca5a5', borderRadius: 8, padding: '4px 10px', cursor: 'pointer', color: '#ef4444', fontSize: 12, fontWeight: 600 }}>Zmazať</button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {list.stores.map(store => {
          const done = isStoreDone(store)
          const open = !storeCollapsed(store)
          const c = col(store.storeName)
          return (
            <div key={store.companyId} style={{
              borderRadius: 10, overflow: 'hidden',
              border: `1px solid ${done ? '#bbf7d0' : c.main + '33'}`,
              background: done ? '#f0fdf4' : c.bg ?? '#f8fafc',
            }}>
              <div
                onClick={() => toggleCollapse(store.companyId)}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', cursor: 'pointer', userSelect: 'none' }}>
                <StoreLogo name={store.storeName} size={16} />
                <span style={{ fontWeight: 700, fontSize: 14, color: c.main, textDecoration: done ? 'line-through' : 'none', opacity: done ? 0.6 : 1 }}>{store.storeName}</span>
                <span style={{ marginLeft: 'auto', fontWeight: 700, fontSize: 13, color: done ? '#16a34a' : '#475569', textDecoration: done ? 'line-through' : 'none', opacity: done ? 0.6 : 1 }}>{store.subtotal.toFixed(2)} €</span>
                <span style={{ fontSize: 12, color: '#94a3b8', marginLeft: 6 }}>{open ? '▲' : '▼'}</span>
              </div>
              {open && (
                <div style={{ borderTop: `1px solid ${done ? '#bbf7d0' : c.main + '22'}` }}>
                  {store.items.map(item => {
                    const itemDone = isItemChecked(store.companyId, item.query)
                    return (
                      <div
                        key={item.query}
                        onClick={() => toggleItem(store.companyId, item.query)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          padding: '7px 12px', cursor: 'pointer',
                          background: itemDone ? '#dcfce744' : 'transparent',
                          borderBottom: `1px solid ${c.main}11`,
                        }}>
                        <div style={{
                          width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                          border: `2px solid ${itemDone ? '#16a34a' : '#cbd5e1'}`,
                          background: itemDone ? '#16a34a' : '#fff',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          {itemDone && <span style={{ color: '#fff', fontSize: 11, fontWeight: 700 }}>✓</span>}
                        </div>
                        <span style={{ flex: 1, fontSize: 13, color: itemDone ? '#94a3b8' : '#475569', textDecoration: itemDone ? 'line-through' : 'none' }}>{item.name}</span>
                        <span style={{ fontSize: 13, fontWeight: 600, color: itemDone ? '#94a3b8' : '#1e293b', textDecoration: itemDone ? 'line-through' : 'none' }}>{item.price.toFixed(2)} €</span>
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
        <div style={{ fontSize: 12, color: '#92400e', background: '#fffbeb', borderRadius: 6, padding: '4px 8px', marginTop: 8 }}>
          Nenájdené: {list.unmatched.join(', ')}
        </div>
      )}
    </div>
  )
}

// ─── SavedListsScreen ─────────────────────────────────────────────────────────
function SavedListsScreen({ onBack }: { onBack: () => void }) {
  const [lists, setLists] = useState<SavedList[]>(loadSavedLists)

  const deleteList = (id: string) => {
    const updated = lists.filter(l => l.id !== id)
    saveLists(updated)
    setLists(updated)
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', fontFamily: "'Inter','Segoe UI',system-ui,sans-serif" }}>
      <div style={{ maxWidth: 660, margin: '0 auto', padding: '28px 16px 64px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <button onClick={onBack} style={{ background: 'none', border: '2px solid #e2e8f0', borderRadius: 10, padding: '6px 12px', cursor: 'pointer', fontSize: 14, fontWeight: 600, color: '#475569' }}>← Späť</button>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: '#0f172a' }}>Uložené zoznamy</h1>
        </div>

        {lists.length === 0 ? (
          <div style={{ background: '#fff', borderRadius: 18, padding: 32, textAlign: 'center', color: '#94a3b8', boxShadow: '0 1px 6px rgba(0,0,0,0.07)' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>Žiadne uložené zoznamy</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>Vytvor nákupný zoznam a uložíš ho sem</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {lists.map(list => (
              <SavedListCard key={list.id} list={list} onDelete={() => deleteList(list.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── AuthInput helper ─────────────────────────────────────────────────────────
function AuthInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input {...props} style={{
      width: '100%', padding: '12px 14px', fontSize: 15,
      border: '2px solid #e2e8f0', borderRadius: 10, outline: 'none',
      fontFamily: 'inherit', boxSizing: 'border-box', color: '#1a202c',
      ...props.style,
    }} />
  )
}

// ─── LoginScreen ──────────────────────────────────────────────────────────────
function LoginScreen({ onSwitch, onBack, onSuccess }: { onSwitch: () => void; onBack: () => void; onSuccess: () => void }) {
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
    <div style={{ minHeight: '100vh', background: '#f1f5f9', fontFamily: "'Inter','Segoe UI',system-ui,sans-serif", display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: 400, padding: '0 16px' }}>
        <div style={{ background: '#fff', borderRadius: 20, padding: 32, boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}>
          <h2 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 800, color: '#0f172a' }}>Prihlásiť sa</h2>
          <p style={{ margin: '0 0 24px', color: '#64748b', fontSize: 14 }}>SmartNákup — tvoj nákupný optimalizátor</p>
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <AuthInput type="email" placeholder="E-mail" value={email} onChange={e => setEmail(e.target.value)} required />
            <AuthInput type="password" placeholder="Heslo" value={password} onChange={e => setPassword(e.target.value)} required />
            {error && <div style={{ color: '#dc2626', fontSize: 13, background: '#fef2f2', padding: '8px 12px', borderRadius: 8 }}>{error}</div>}
            <button type="submit" disabled={loading} style={{
              padding: '13px', fontSize: 15, fontWeight: 700,
              background: loading ? '#94a3b8' : '#2563eb', color: '#fff',
              border: 'none', borderRadius: 12, cursor: loading ? 'not-allowed' : 'pointer', marginTop: 4,
            }}>{loading ? 'Prihlasujem...' : 'Prihlásiť sa'}</button>
          </form>
          <div style={{ marginTop: 20, textAlign: 'center', fontSize: 14, color: '#64748b' }}>
            Nemáš účet?{' '}
            <button onClick={onSwitch} style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontWeight: 600, fontSize: 14, padding: 0 }}>
              Zaregistruj sa
            </button>
          </div>
          <button onClick={onBack} style={{ marginTop: 16, width: '100%', padding: '11px', fontSize: 14, fontWeight: 600, background: '#f8fafc', color: '#475569', border: '2px solid #e2e8f0', borderRadius: 10, cursor: 'pointer' }}>
            Pokračovať bez prihlásenia
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── RegisterScreen ───────────────────────────────────────────────────────────
function RegisterScreen({ onSwitch, onBack, onVerify }: { onSwitch: () => void; onBack: () => void; onVerify: (email: string) => void }) {
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
    <div style={{ minHeight: '100vh', background: '#f1f5f9', fontFamily: "'Inter','Segoe UI',system-ui,sans-serif", display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: 400, padding: '0 16px' }}>
        <div style={{ background: '#fff', borderRadius: 20, padding: 32, boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}>
          <h2 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 800, color: '#0f172a' }}>Registrácia</h2>
          <p style={{ margin: '0 0 24px', color: '#64748b', fontSize: 14 }}>Vytvor si bezplatný účet</p>
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <AuthInput type="text" placeholder="Meno" value={name} onChange={e => setName(e.target.value)} required />
            <AuthInput type="email" placeholder="E-mail" value={email} onChange={e => setEmail(e.target.value)} required />
            <AuthInput type="password" placeholder="Heslo (min. 8 znakov)" value={password} onChange={e => setPassword(e.target.value)} required />
            {error && <div style={{ color: '#dc2626', fontSize: 13, background: '#fef2f2', padding: '8px 12px', borderRadius: 8 }}>{error}</div>}
            <button type="submit" disabled={loading} style={{
              padding: '13px', fontSize: 15, fontWeight: 700,
              background: loading ? '#94a3b8' : '#1a7f37', color: '#fff',
              border: 'none', borderRadius: 12, cursor: loading ? 'not-allowed' : 'pointer', marginTop: 4,
            }}>{loading ? 'Registrujem...' : 'Vytvoriť účet'}</button>
          </form>
          <div style={{ marginTop: 20, textAlign: 'center', fontSize: 14, color: '#64748b' }}>
            Už máš účet?{' '}
            <button onClick={onSwitch} style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontWeight: 600, fontSize: 14, padding: 0 }}>
              Prihlásiť sa
            </button>
          </div>
          <button onClick={onBack} style={{ marginTop: 16, width: '100%', padding: '11px', fontSize: 14, fontWeight: 600, background: '#f8fafc', color: '#475569', border: '2px solid #e2e8f0', borderRadius: 10, cursor: 'pointer' }}>
            Pokračovať bez prihlásenia
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── VerifyEmailScreen ────────────────────────────────────────────────────────
function VerifyEmailScreen({ email, onBack }: { email: string; onBack: () => void }) {
  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', fontFamily: "'Inter','Segoe UI',system-ui,sans-serif", display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: 400, padding: '0 16px' }}>
        <div style={{ background: '#fff', borderRadius: 20, padding: 32, boxShadow: '0 4px 20px rgba(0,0,0,0.08)', textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📧</div>
          <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 800, color: '#0f172a' }}>Skontroluj e-mail</h2>
          <p style={{ color: '#64748b', fontSize: 14, marginBottom: 8 }}>
            Poslali sme overovací link na:
          </p>
          <p style={{ fontWeight: 700, color: '#1a202c', marginBottom: 24 }}>{email}</p>
          <p style={{ color: '#94a3b8', fontSize: 13, marginBottom: 24 }}>
            Po overení sa môžeš prihlásiť a ukladať nákupné zoznamy do cloudu.
          </p>
          <button onClick={onBack} style={{ width: '100%', padding: '11px', fontSize: 14, fontWeight: 600, background: '#f8fafc', color: '#475569', border: '2px solid #e2e8f0', borderRadius: 10, cursor: 'pointer' }}>
            Pokračovať bez prihlásenia
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState<'main' | 'saved' | 'login' | 'register' | 'verify'>('main')
  const [verifyEmail, setVerifyEmail] = useState('')
  const { data: session, isPending: sessionLoading } = authClient.useSession()
  const [stores, setStores] = useState<Store[]>([])
  const [selectedNames, setSelectedNames] = useState<string[]>([])
  const [cartItems, setCartItems] = useState<CartItem[]>([])
  const [result, setResult] = useState<OptimizeResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cacheInfo, setCacheInfo] = useState<{ rawProducts: number; groups: number; ageMinutes: number } | null>(null)
  const [pendingApprovals, setPendingApprovals] = useState<NeedsApproval[]>([])
  const [pendingItems, setPendingItems] = useState<CartItem[]>([])

  const saveResult = () => {
    if (!result) return
    const storeNames = result.stores
      .sort((a, b) => b.items.length - a.items.length)
      .map(s => s.storeName)
    const name = `${formatDate(new Date())} - ${storeNames.join(', ')}`
    const newList: SavedList = {
      id: Date.now().toString(),
      name,
      savedAt: new Date().toISOString(),
      stores: result.stores,
      unmatched: result.unmatched,
    }
    const updated = [newList, ...loadSavedLists()]
    saveLists(updated)
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
    api.status().then(s => { if (s.ok) setCacheInfo(s) }).catch(() => {})
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

  const optimize = () => { if (cartItems.length) runOptimize(cartItems) }

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

  if (screen === 'login') return <LoginScreen onSwitch={() => setScreen('register')} onBack={() => setScreen('main')} onSuccess={() => setScreen('main')} />
  if (screen === 'register') return <RegisterScreen onSwitch={() => setScreen('login')} onBack={() => setScreen('main')} onVerify={email => { setVerifyEmail(email); setScreen('verify') }} />
  if (screen === 'verify') return <VerifyEmailScreen email={verifyEmail} onBack={() => setScreen('main')} />
  if (screen === 'saved') return <SavedListsScreen onBack={() => setScreen('main')} />

  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', fontFamily: "'Inter','Segoe UI',system-ui,sans-serif" }}>
      <div style={{ maxWidth: 660, margin: '0 auto', padding: '28px 16px 64px' }}>

        <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, color: '#0f172a', letterSpacing: '-0.5px' }}>🛒 SmartNákup</h1>
            <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: 13 }}>
              Živé ceny z <a href="https://cenyslovensko.sk" target="_blank" rel="noreferrer" style={{ color: '#2563eb' }}>cenyslovensko.sk</a>
              {cacheInfo && <span style={{ color: '#94a3b8', marginLeft: 8 }}>· {cacheInfo.rawProducts} produktov · cache pred {cacheInfo.ageMinutes} min</span>}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {!sessionLoading && (
              session
                ? <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontSize: 13, color: '#475569', fontWeight: 500 }}>{session.user.email}</span>
                    <button onClick={() => authClient.signOut()} style={{ background: '#fff', border: '2px solid #e2e8f0', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#64748b' }}>Odhlásiť</button>
                  </div>
                : <button onClick={() => setScreen('login')} style={{ background: '#fff', border: '2px solid #2563eb', borderRadius: 10, padding: '8px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#2563eb', whiteSpace: 'nowrap' }}>Prihlásiť sa</button>
            )}
            {session && <button onClick={() => setScreen('saved')} style={{ background: '#fff', border: '2px solid #e2e8f0', borderRadius: 10, padding: '8px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#475569', whiteSpace: 'nowrap' }}>📋 Moje zoznamy</button>}
          </div>
        </div>

        {/* Krok 1 */}
        <div style={{ background: '#fff', borderRadius: 18, padding: 20, marginBottom: 12, boxShadow: '0 1px 6px rgba(0,0,0,0.07)' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>1 · Čo chceš kúpiť?</div>
          <TypeaheadInput onAdd={addItem} />
          {cartItems.length > 0 && (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {cartItems.map(item => (
                <span key={item.query} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#eff6ff', color: '#1d4ed8', padding: '8px 12px', borderRadius: 10, fontSize: 15, fontWeight: 500 }}>
                  {item.imageUrl && <img src={item.imageUrl} alt="" style={{ width: 20, height: 20, objectFit: 'contain' }} onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />}
                  <span style={{ flex: 1 }}>{item.displayName}</span>
                  <button onClick={() => { setCartItems(p => p.filter(i => i.query !== item.query)); setResult(null) }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#93c5fd', fontSize: 18, padding: 0, lineHeight: 1 }}>×</button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Krok 2 */}
        <div style={{ background: '#fff', borderRadius: 18, padding: 20, marginBottom: 12, boxShadow: '0 1px 6px rgba(0,0,0,0.07)' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>2 · Do ktorých obchodov pôjdeš?</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {(() => {
              const allSel = stores.length > 0 && stores.every(s => selectedNames.includes(s.name))
              return (
                <>
                  <button onClick={() => { setSelectedNames(allSel ? [] : stores.map(s => s.name)); setResult(null) }} style={{
                    padding: '8px 15px', borderRadius: 10, border: '3px solid',
                    borderColor: allSel ? '#2563eb' : '#e2e8f0',
                    background: '#fff',
                    color: allSel ? '#2563eb' : '#475569',
                    fontWeight: 600, cursor: 'pointer', fontSize: 13,
                  }}>Všetky</button>
                  {stores.map(s => {
                    const sel = selectedNames.includes(s.name)
                    const c = col(s.name)
                    return (
                      <button key={s.name} onClick={() => {
                        setSelectedNames(prev => prev.includes(s.name) ? prev.filter(x => x !== s.name) : [...prev, s.name])
                        setResult(null)
                      }} style={{
                        padding: '8px 15px', borderRadius: 10, border: '3px solid',
                        borderColor: sel ? c.main : '#e2e8f0',
                        background: '#fff',
                        color: sel ? c.main : '#475569',
                        fontWeight: 600, cursor: 'pointer', fontSize: 13, transition: 'all 0.12s',
                      }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <StoreLogo name={s.name} size={18} />
                          {s.name}
                        </span>
                      </button>
                    )
                  })}
                </>
              )
            })()}
          </div>
        </div>

        {/* CTA */}
        <button onClick={optimize} disabled={!cartItems.length || loading} style={{
          width: '100%', padding: '15px', fontSize: 16, fontWeight: 700,
          background: !cartItems.length ? '#cbd5e1' : '#2563eb',
          color: '#fff', border: 'none', borderRadius: 14,
          cursor: !cartItems.length ? 'not-allowed' : 'pointer',
          marginBottom: 20,
        }}>
          {loading ? '⏳ Hľadám najlepšie ceny...' : '🔍 Vytvoriť nákupné zoznamy'}
        </button>

        {error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: 14, marginBottom: 14, color: '#b91c1c', fontSize: 13 }}>⚠️ {error}</div>}

        {/* Approval panel */}
        {pendingApprovals.length > 0 && (
          <ApprovalPanel approvals={pendingApprovals} onDecide={approveAll} col={col} />
        )}

        {result && (
          <div>
            {result.total_saving > 0 && (
              <div style={{ background: 'linear-gradient(135deg,#f0fdf4,#dcfce7)', border: '2px solid #bbf7d0', borderRadius: 14, padding: '14px 18px', marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 700, color: '#15803d' }}>Ušetríš oproti najdrahšiemu obchodu</div>
                  <div style={{ fontSize: 12, color: '#16a34a' }}>celková optimalizácia nákupu</div>
                </div>
                <div style={{ fontSize: 28, fontWeight: 800, color: '#15803d' }}>{result.total_saving.toFixed(2)} €</div>
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {result.stores.map(g => <ResultCard key={g.companyId} group={g} />)}
            </div>
            {result.unmatched.length > 0 && (
              <div style={{ marginTop: 10, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: 14, fontSize: 13 }}>
                <strong style={{ color: '#92400e' }}>Nenájdené:</strong>
                <span style={{ marginLeft: 8, color: '#78350f' }}>{result.unmatched.join(', ')}</span>
              </div>
            )}
            {result.stores.length > 0 && (
              <button onClick={session ? saveResult : () => setScreen('login')} style={{
                marginTop: 14, width: '100%', padding: '14px', fontSize: 15, fontWeight: 700,
                background: session ? '#fff' : '#f1f5f9',
                color: session ? '#2563eb' : '#94a3b8',
                border: `2px solid ${session ? '#2563eb' : '#cbd5e1'}`,
                borderRadius: 14, cursor: 'pointer',
              }}>
                {session ? '💾 Uložiť nákupné zoznamy' : '🔒 Prihlásiť sa pre uloženie zoznamov'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
