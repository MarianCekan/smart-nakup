import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { fromNodeHeaders } from 'better-auth/node'
import { auth, pool } from '../auth.js'

export const statsRouter = Router()

let _ready: Promise<void> | null = null
function ensureTable(): Promise<void> {
  if (!_ready) {
    _ready = pool.query(`
      CREATE TABLE IF NOT EXISTS savings_log (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        amount NUMERIC NOT NULL,
        list_name TEXT,
        recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `).then(() => pool.query(
      `CREATE INDEX IF NOT EXISTS idx_savings_log_user ON savings_log(user_id);`
    )).then(() => undefined)
  }
  return _ready
}

async function getUserId(req: any): Promise<string | null> {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) })
    return session?.user?.id ?? null
  } catch {
    return null
  }
}

// GET /api/v1/stats — všetky záznamy úspor (frontend si spočíta obdobia sám)
statsRouter.get('/', async (req, res) => {
  const userId = await getUserId(req)
  if (!userId) return res.status(401).json({ error: 'Neprihlásený' })
  try {
    await ensureTable()
    const { rows } = await pool.query(
      `SELECT amount, list_name, recorded_at FROM savings_log WHERE user_id = $1 ORDER BY recorded_at DESC`,
      [userId],
    )
    res.json(rows.map(r => ({ amount: parseFloat(r.amount), listName: r.list_name, recordedAt: r.recorded_at })))
  } catch (e: any) { res.status(500).json({ error: e.message }) }
})

// POST /api/v1/stats — zapíš úsporu (keď user dokončí nákup a zoznam sa zmaže)
statsRouter.post('/', async (req, res) => {
  const userId = await getUserId(req)
  if (!userId) return res.status(401).json({ error: 'Neprihlásený' })
  const { amount, listName } = req.body ?? {}
  if (typeof amount !== 'number' || !isFinite(amount) || amount < 0) return res.status(400).json({ error: 'Neplatná suma' })
  try {
    await ensureTable()
    await pool.query(
      `INSERT INTO savings_log (id, user_id, amount, list_name) VALUES ($1, $2, $3, $4)`,
      [randomUUID(), userId, amount, listName ?? null],
    )
    res.json({ ok: true })
  } catch (e: any) { res.status(500).json({ error: e.message }) }
})
