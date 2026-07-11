import { Pool } from 'pg'

// Zdieľaný Postgres pool (Neon) — Better Auth, zoznamy aj kompas cache
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})
