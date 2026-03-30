import express from 'express'
import cors from 'cors'
import { router } from './routes/api.js'
import { getCache } from './services/cenysk.js'

const app = express()
const PORT = process.env.PORT ?? 3001

app.use(cors({ origin: ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:3000'] }))
app.use(express.json())
app.use('/api/v1', router)
app.get('/health', (_req, res) => res.json({ ok: true }))

app.listen(PORT, async () => {
  console.log(`🚀 Backend na http://localhost:${PORT}`)
  // Prednahranie cache pri štarte
  console.log('📦 Načítavam produkty z cenyslovensko.sk...')
  getCache()
    .then(c => console.log(`✅ Cache: ${c.totalCount} produktov`))
    .catch(e => console.error('❌ Cache error:', e.message))
})
