import 'dotenv/config'
// Node 18 polyfill — Better Auth requires globalThis.crypto (WebCrypto API)
import { webcrypto } from 'node:crypto'
if (!globalThis.crypto) (globalThis as any).crypto = webcrypto

import express from 'express'
import cors from 'cors'
import { toNodeHandler } from 'better-auth/node'
import { router } from './routes/api.js'
import { auth } from './auth.js'
import { getCache } from './services/cenysk.js'

const app = express()
const PORT = process.env.PORT ?? 3001

app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:3000'],
  credentials: true,
}))

// Better Auth handler — must be before express.json()
app.all('/api/auth/*', toNodeHandler(auth))

app.use(express.json())
app.use('/api/v1', router)
app.get('/health', (_req, res) => res.json({ ok: true }))

app.listen(PORT, async () => {
  console.log(`🚀 Backend na http://localhost:${PORT}`)
  console.log('📦 Načítavam produkty z cenyslovensko.sk...')
  getCache()
    .then(c => console.log(`✅ Cache: ${c.totalRaw} produktov`))
    .catch(e => console.error('❌ Cache error:', e.message))
})
