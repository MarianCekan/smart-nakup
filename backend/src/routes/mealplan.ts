import { Router } from 'express'
import { fromNodeHeaders } from 'better-auth/node'
import { auth, pool } from '../auth.js'

export const mealPlanRouter = Router()

// Bootstrap tabuľky — beží raz pri prvom requeste
let _ready: Promise<void> | null = null
function ensureTable(): Promise<void> {
  if (!_ready) {
    _ready = pool.query(`
      CREATE TABLE IF NOT EXISTS meal_plans (
        user_id TEXT NOT NULL,
        date DATE NOT NULL,
        recipe_id TEXT NOT NULL,
        PRIMARY KEY (user_id, date)
      );
    `).then(() => undefined)
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

// GET /api/v1/mealplan — všetky naplánované dni prihláseného usera
mealPlanRouter.get('/', async (req, res) => {
  const userId = await getUserId(req)
  if (!userId) return res.status(401).json({ error: 'Neprihlásený' })
  try {
    await ensureTable()
    const { rows } = await pool.query(
      `SELECT date::text AS date, recipe_id FROM meal_plans WHERE user_id = $1 AND date >= CURRENT_DATE - INTERVAL '1 day' ORDER BY date ASC`,
      [userId],
    )
    res.json(rows.map(r => ({ date: r.date, recipeId: r.recipe_id })))
  } catch (e: any) { res.status(500).json({ error: e.message }) }
})

// POST /api/v1/mealplan — naplánuj recept na dátum (nahradí existujúci)
mealPlanRouter.post('/', async (req, res) => {
  const userId = await getUserId(req)
  if (!userId) return res.status(401).json({ error: 'Neprihlásený' })
  const { date, recipeId } = req.body ?? {}
  if (!date || !recipeId) return res.status(400).json({ error: 'Chýba date alebo recipeId' })
  try {
    await ensureTable()
    await pool.query(
      `INSERT INTO meal_plans (user_id, date, recipe_id) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, date) DO UPDATE SET recipe_id = $3`,
      [userId, date, recipeId],
    )
    res.json({ ok: true, date, recipeId })
  } catch (e: any) { res.status(500).json({ error: e.message }) }
})

// DELETE /api/v1/mealplan/:date — zruš plán na daný deň
mealPlanRouter.delete('/:date', async (req, res) => {
  const userId = await getUserId(req)
  if (!userId) return res.status(401).json({ error: 'Neprihlásený' })
  try {
    await ensureTable()
    await pool.query(`DELETE FROM meal_plans WHERE user_id = $1 AND date = $2`, [userId, req.params.date])
    res.json({ ok: true })
  } catch (e: any) { res.status(500).json({ error: e.message }) }
})
