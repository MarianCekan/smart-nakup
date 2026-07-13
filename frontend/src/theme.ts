// Dizajnový jazyk „1C Premium" — tokeny pre svetlý (sage) a tmavý (takmer čierny) režim.
// Zdroj: design_handoff_1c_redesign/README.md
import { useEffect, useState } from 'react'

export type ThemeMode = 'light' | 'dark' | 'system'

// Brandové farby obchodov (obe témy)
export const STORE_BRAND: Record<string, { main: string; tint: string; text?: string; abbr: string }> = {
  'Lidl':     { main: '#0050AA', tint: '#e8f0fb', abbr: 'L' },
  'Kaufland': { main: '#cc0000', tint: '#fde8e8', abbr: 'K' },
  'Tesco':    { main: '#003DA5', tint: '#e8edf8', abbr: 'T' },
  'Billa':    { main: '#FFC72C', tint: '#fff8e1', text: '#1a1a1a', abbr: 'B' },
  'Terno':    { main: '#ff6600', tint: '#fff3e0', abbr: 'Tn' },
  'Fresh':    { main: '#5aaa3c', tint: '#edf7e8', abbr: 'F' },
  'COOP Jednota': { main: '#e2001a', tint: '#fde8ea', abbr: 'CJ' },
  'Klas':         { main: '#2f8f4e', tint: '#e8f5ec', abbr: 'Kl' },
}

// Zosvetlené brandové farby pre text/rámiky na tmavom podklade
const STORE_LIGHTENED: Record<string, string> = {
  'Lidl': '#5b9be8', 'Kaufland': '#ff5a5a', 'Tesco': '#5b8ff0',
  'Billa': '#ffd54a', 'Terno': '#ff9a4d', 'Fresh': '#7ecb5a',
  'COOP Jednota': '#ff5a5a', 'Klas': '#5cc47a',
}

export type Theme = {
  isDark: boolean
  font: string
  fontHead: string
  // plochy
  bg: string
  surface: string
  surface2: string
  border: string
  hairline: string
  rowActive: string
  inputBg: string
  // text
  text: string
  textSec: string
  textMuted: string
  textFaint: string
  // akcent
  accent: string
  accentOn: string        // text NA akcentovom pozadí
  accentInk: string       // akcentový text na povrchu
  accentSoftBg: string
  accentSoftText: string
  accentTileBg: string    // „Všetky obchody" vybraté
  // banner úspory
  savingBg: string
  savingBorder: string
  savingText: string
  savingSub: string
  savingStripe: string | null
  // sémantické
  promoText: string; promoBg: string; promoBorder: string
  upcomingText: string; upcomingBg: string; upcomingBorder: string
  warnText: string; warnBg: string; warnBorder: string
  doneText: string; doneBg: string
  errorText: string; errorBg: string; errorBorder: string
  diffPlus: string; diffMinus: string
  // ostatné
  scrim: string
  ctaDisabledBg: string
  ctaDisabledText: string
  tooltipBg: string
  tooltipText: string
  shadowCard: string
  shadowCta: string
  shadowDrop: string
  shadowDrawer: string
}

const FONT = "'Manrope', system-ui, sans-serif"
const FONT_HEAD = "'Sora', 'Manrope', system-ui, sans-serif"

export const lightTheme: Theme = {
  isDark: false,
  font: FONT, fontHead: FONT_HEAD,
  bg: '#e7efe8', surface: '#ffffff', surface2: '#f0f5f0',
  border: '#dde7de', hairline: '#eef3ee', rowActive: '#f0f5f0', inputBg: '#ffffff',
  text: '#16241b', textSec: '#566a5c', textMuted: '#8fa093', textFaint: '#b6c4b8',
  accent: '#0f9d6a', accentOn: '#ffffff', accentInk: '#0a7a53',
  accentSoftBg: '#d9f2e6', accentSoftText: '#0a7a53', accentTileBg: '#d9f2e6',
  savingBg: 'linear-gradient(135deg,#ecfdf5,#d6f5e5)', savingBorder: '#a7f3d0',
  savingText: '#047857', savingSub: '#10b981', savingStripe: null,
  promoText: '#dc2626', promoBg: '#fef2f2', promoBorder: '#fca5a5',
  upcomingText: '#b45309', upcomingBg: '#fffbeb', upcomingBorder: '#fcd34d',
  warnText: '#92400e', warnBg: '#fffbeb', warnBorder: '#fde68a',
  doneText: '#15803d', doneBg: '#dcfce7',
  errorText: '#b91c1c', errorBg: '#fef2f2', errorBorder: '#fecaca',
  diffPlus: '#dc2626', diffMinus: '#0f9d6a',
  scrim: 'rgba(8,16,12,0.5)',
  ctaDisabledBg: '#cbd5e1', ctaDisabledText: '#ffffff',
  tooltipBg: '#16241b', tooltipText: '#ffffff',
  shadowCard: '0 8px 22px -16px rgba(20,50,35,0.3)',
  shadowCta: '0 14px 30px -12px rgba(15,157,106,0.55)',
  shadowDrop: '0 20px 40px -18px rgba(20,50,35,0.25)',
  shadowDrawer: '-12px 0 50px rgba(0,0,0,0.25)',
}

export const darkTheme: Theme = {
  isDark: true,
  font: FONT, fontHead: FONT_HEAD,
  bg: '#0a0a0c', surface: '#17171c', surface2: '#26262c',
  border: 'rgba(255,255,255,0.08)', hairline: 'rgba(255,255,255,0.06)',
  rowActive: 'rgba(255,255,255,0.04)', inputBg: '#26262c',
  text: '#f4f4f5', textSec: '#a1a1aa', textMuted: '#71717a', textFaint: '#52525b',
  accent: '#34d399', accentOn: '#08130d', accentInk: '#6ee7b7',
  accentSoftBg: '#0f2a1d', accentSoftText: '#6ee7b7', accentTileBg: '#34d39914',
  savingBg: '#0f1a14', savingBorder: '#1e3a2a',
  savingText: '#34d399', savingSub: '#6ee7b7', savingStripe: '#34d399',
  promoText: '#ff8080', promoBg: '#dc262622', promoBorder: '#dc262655',
  upcomingText: '#fcd34d', upcomingBg: '#b4530922', upcomingBorder: '#b4530966',
  warnText: '#f0d68a', warnBg: '#1c160a', warnBorder: '#3a2e12',
  doneText: '#34d399', doneBg: '#0f2a1d',
  errorText: '#ff8080', errorBg: '#2a1215', errorBorder: '#5b1d22',
  diffPlus: '#ff8080', diffMinus: '#34d399',
  scrim: 'rgba(0,0,0,0.62)',
  ctaDisabledBg: '#26262c', ctaDisabledText: '#52525b',
  tooltipBg: '#26262c', tooltipText: '#f4f4f5',
  shadowCard: 'none',
  shadowCta: '0 14px 30px -12px rgba(52,211,153,0.6)',
  shadowDrop: '0 24px 48px -20px rgba(0,0,0,0.8)',
  shadowDrawer: '-12px 0 50px rgba(0,0,0,0.6)',
}

// Brandová farba obchodu — na tmavom podklade zosvetlená (pre text/rámik, NIE fill hlavičky)
export function storeInk(name: string, isDark: boolean): string {
  if (isDark && STORE_LIGHTENED[name]) return STORE_LIGHTENED[name]
  return STORE_BRAND[name]?.main ?? (isDark ? '#a1a1aa' : '#566a5c')
}

export function storeBrand(name: string) {
  return STORE_BRAND[name] ?? { main: '#71717a', tint: '#f0f5f0', abbr: name[0] ?? '?' }
}

const THEME_KEY = 'smartnakup_theme'

export function useThemeMode(): { mode: ThemeMode; setMode: (m: ThemeMode) => void; theme: Theme } {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem(THEME_KEY)
    return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system'
  })
  const [sysDark, setSysDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const fn = (e: MediaQueryListEvent) => setSysDark(e.matches)
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [])

  const setMode = (m: ThemeMode) => { setModeState(m); localStorage.setItem(THEME_KEY, m) }
  const isDark = mode === 'dark' || (mode === 'system' && sysDark)
  return { mode, setMode, theme: isDark ? darkTheme : lightTheme }
}
