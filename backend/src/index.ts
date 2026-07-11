import 'dotenv/config'
// Node 18 polyfill — Better Auth requires globalThis.crypto (WebCrypto API)
import { webcrypto } from 'node:crypto'
if (!globalThis.crypto) (globalThis as any).crypto = webcrypto

import express from 'express'
import cors from 'cors'
import { toNodeHandler } from 'better-auth/node'
import { router } from './routes/api.js'
import { listsRouter } from './routes/lists.js'
import { auth } from './auth.js'
import { getCache } from './services/cenysk.js'
import { searchKompas } from './services/kompas.js'

const app = express()
const PORT = process.env.PORT ?? 3001

const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:3000',
  'https://smart-nakup.vercel.app',
  ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : []),
]

app.use(cors({
  origin: (origin, cb) => cb(null, !origin || /^http:\/\/localhost(:\d+)?$/.test(origin) || ALLOWED_ORIGINS.some(o => origin.startsWith(o))),
  credentials: true,
}))

// Better Auth handler — must be before express.json()
app.all('/api/auth/*', toNodeHandler(auth))

app.use(express.json())
app.use('/api/v1/lists', listsRouter)
app.use('/api/v1', router)
app.get('/health', (_req, res) => res.json({ ok: true }))

// Suroviny všetkých receptov (FE RECIPES) — predhrievame cache, aby "Zistiť dostupnosť"
// nebežalo proti studenej cache (jina relay je pomalý a rate-limitovaný)
const WARMUP_QUERIES = [
  'mleté mäso', 'cestoviny', 'paradajková omáčka', 'cibuľa', 'mrkva', 'cesnak',
  'červená šošovica', 'klobása', 'zemiaky', 'vajcia', 'kyslá smotana',
  'bravčové mäso', 'kyslá kapusta', 'paprika mletá', 'ryža',
  'kuracie prsia', 'zeler', 'rezance', 'petržlen',
  'šampiňóny', 'maslo', 'smotana na varenie',
]

async function warmupKompas() {
  console.log('🔥 Warm-up kompas cache pre receptové suroviny...')
  for (const q of WARMUP_QUERIES) {
    await searchKompas(q, 3, 30000).catch(() => {})
  }
  console.log('🔥 Warm-up hotový')
}

app.listen(PORT, async () => {
  console.log(`🚀 Backend na http://localhost:${PORT}`)
  console.log('📦 Načítavam produkty z cenyslovensko.sk...')
  getCache()
    .then(c => console.log(`✅ Cache: ${c.totalRaw} produktov`))
    .catch(e => console.error('❌ Cache error:', e.message))
  setTimeout(warmupKompas, 3000)
  setInterval(warmupKompas, 60 * 60 * 1000)  // query cache TTL je 2h — hodinový refresh ju drží teplú
})
