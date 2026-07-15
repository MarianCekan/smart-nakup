import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { fromNodeHeaders } from 'better-auth/node'
import { auth, pool } from '../auth.js'

export const listsRouter = Router()

// Bootstrap tabuľky — beží raz pri prvom requeste
let _ready: Promise<void> | null = null
function ensureTable(): Promise<void> {
  if (!_ready) {
    _ready = pool.query(`
      CREATE TABLE IF NOT EXISTS shopping_lists (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        saved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        data JSONB NOT NULL
      );
    `).then(() => pool.query(
      `CREATE INDEX IF NOT EXISTS idx_shopping_lists_user ON shopping_lists(user_id);`
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

// GET /api/v1/lists — všetky zoznamy prihláseného usera
listsRouter.get('/', async (req, res) => {
  const userId = await getUserId(req)
  if (!userId) return res.status(401).json({ error: 'Neprihlásený' })
  try {
    await ensureTable()
    // Nedokončené zoznamy staršie ako 7 dní tíško zmažeme (bez pripísania do štatistík —
    // to sa robí len explicitným potvrdením cez POST /stats pri dokončení nákupu)
    await pool.query(`DELETE FROM shopping_lists WHERE user_id = $1 AND saved_at < now() - interval '7 days'`, [userId])
    const { rows } = await pool.query(
      `SELECT id, name, saved_at, data FROM shopping_lists WHERE user_id = $1 ORDER BY saved_at DESC`,
      [userId],
    )
    res.json(rows.map(r => ({
      id: r.id,
      name: r.name,
      savedAt: r.saved_at,
      stores: r.data.stores ?? [],
      unmatched: r.data.unmatched ?? [],
    })))
  } catch (e: any) { res.status(500).json({ error: e.message }) }
})

// POST /api/v1/lists — ulož nový zoznam
listsRouter.post('/', async (req, res) => {
  const userId = await getUserId(req)
  if (!userId) return res.status(401).json({ error: 'Neprihlásený' })
  const { name, stores, unmatched } = req.body ?? {}
  if (!name || !Array.isArray(stores)) return res.status(400).json({ error: 'Chýba name alebo stores' })
  try {
    await ensureTable()
    const id = randomUUID()
    const { rows } = await pool.query(
      `INSERT INTO shopping_lists (id, user_id, name, data) VALUES ($1, $2, $3, $4) RETURNING saved_at`,
      [id, userId, String(name).slice(0, 200), JSON.stringify({ stores, unmatched: unmatched ?? [] })],
    )
    res.json({ id, name, savedAt: rows[0].saved_at, stores, unmatched: unmatched ?? [] })
  } catch (e: any) { res.status(500).json({ error: e.message }) }
})

// PATCH /api/v1/lists/:id — premenuj zoznam (len vlastný)
listsRouter.patch('/:id', async (req, res) => {
  const userId = await getUserId(req)
  if (!userId) return res.status(401).json({ error: 'Neprihlásený' })
  const { name } = req.body ?? {}
  if (!name || typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'Chýba name' })
  try {
    await ensureTable()
    const { rowCount } = await pool.query(
      `UPDATE shopping_lists SET name = $1 WHERE id = $2 AND user_id = $3`,
      [name.trim().slice(0, 200), req.params.id, userId],
    )
    if (!rowCount) return res.status(404).json({ error: 'Zoznam neexistuje' })
    res.json({ ok: true, name: name.trim().slice(0, 200) })
  } catch (e: any) { res.status(500).json({ error: e.message }) }
})

// DELETE /api/v1/lists/:id — zmaž zoznam (len vlastný)
listsRouter.delete('/:id', async (req, res) => {
  const userId = await getUserId(req)
  if (!userId) return res.status(401).json({ error: 'Neprihlásený' })
  try {
    await ensureTable()
    await pool.query(`DELETE FROM shopping_lists WHERE id = $1 AND user_id = $2`, [req.params.id, userId])
    res.json({ ok: true })
  } catch (e: any) { res.status(500).json({ error: e.message }) }
})
