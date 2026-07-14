import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { fromNodeHeaders } from 'better-auth/node'
import { auth, pool } from '../auth.js'

export const favoritesRouter = Router()

// Bootstrap tabuľky — beží raz pri prvom requeste
let _ready: Promise<void> | null = null
function ensureTable(): Promise<void> {
  if (!_ready) {
    _ready = pool.query(`
      CREATE TABLE IF NOT EXISTS favorites (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        query TEXT NOT NULL,
        group_key TEXT,
        display_name TEXT NOT NULL,
        image_url TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (user_id, query)
      );
    `).then(() => pool.query(
      `CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id);`
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

// GET /api/v1/favorites — obľúbené položky prihláseného usera
favoritesRouter.get('/', async (req, res) => {
  const userId = await getUserId(req)
  if (!userId) return res.status(401).json({ error: 'Neprihlásený' })
  try {
    await ensureTable()
    const { rows } = await pool.query(
      `SELECT id, query, group_key, display_name, image_url, created_at FROM favorites WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId],
    )
    res.json(rows.map(r => ({
      id: r.id,
      query: r.query,
      groupKey: r.group_key,
      displayName: r.display_name,
      imageUrl: r.image_url,
      createdAt: r.created_at,
    })))
  } catch (e: any) { res.status(500).json({ error: e.message }) }
})

// POST /api/v1/favorites — pridaj (alebo aktualizuj) obľúbenú položku, kľúčované podľa query
favoritesRouter.post('/', async (req, res) => {
  const userId = await getUserId(req)
  if (!userId) return res.status(401).json({ error: 'Neprihlásený' })
  const { query, groupKey, displayName, imageUrl } = req.body ?? {}
  if (!query || !displayName) return res.status(400).json({ error: 'Chýba query alebo displayName' })
  try {
    await ensureTable()
    const id = randomUUID()
    const { rows } = await pool.query(
      `INSERT INTO favorites (id, user_id, query, group_key, display_name, image_url)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, query) DO UPDATE SET group_key = $4, display_name = $5, image_url = $6
       RETURNING id, query, group_key, display_name, image_url, created_at`,
      [id, userId, String(query).slice(0, 200), groupKey ?? null, String(displayName).slice(0, 200), imageUrl ?? null],
    )
    const r = rows[0]
    res.json({ id: r.id, query: r.query, groupKey: r.group_key, displayName: r.display_name, imageUrl: r.image_url, createdAt: r.created_at })
  } catch (e: any) { res.status(500).json({ error: e.message }) }
})

// DELETE /api/v1/favorites/:query — odober obľúbenú položku (len vlastnú)
favoritesRouter.delete('/:query', async (req, res) => {
  const userId = await getUserId(req)
  if (!userId) return res.status(401).json({ error: 'Neprihlásený' })
  try {
    await ensureTable()
    await pool.query(`DELETE FROM favorites WHERE user_id = $1 AND query = $2`, [userId, req.params.query])
    res.json({ ok: true })
  } catch (e: any) { res.status(500).json({ error: e.message }) }
})
