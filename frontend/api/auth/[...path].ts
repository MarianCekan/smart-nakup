// Proxy pre better-auth — rieši Safari/iOS ITP cross-origin cookie blokovanie
// Auth requesty idú cez vercel.app (same-origin) namiesto priamo na onrender.com
const BACKEND = process.env.BACKEND_URL ?? 'https://smart-nakup-backend.onrender.com'

export default async function handler(req: any, res: any) {
  const pathParts: string[] = Array.isArray(req.query.path) ? req.query.path : [req.query.path ?? '']
  const authPath = pathParts.join('/')

  // Query string bez "path" parametra
  const { path: _p, ...rest } = req.query
  const qs = new URLSearchParams(rest as any).toString()
  const url = `${BACKEND}/api/auth/${authPath}${qs ? `?${qs}` : ''}`

  const headers: Record<string, string> = {
    'content-type': req.headers['content-type'] ?? 'application/json',
  }
  if (req.headers['cookie'])       headers['cookie'] = req.headers['cookie']
  if (req.headers['origin'])       headers['origin'] = req.headers['origin']
  if (req.headers['x-forwarded-for']) headers['x-forwarded-for'] = req.headers['x-forwarded-for']

  const body = req.method !== 'GET' && req.method !== 'HEAD'
    ? JSON.stringify(req.body)
    : undefined

  const upstream = await fetch(url, { method: req.method, headers, body })

  // Prepošli všetky response headers (hlavne Set-Cookie)
  for (const [key, value] of upstream.headers.entries()) {
    if (key.toLowerCase() === 'content-encoding') continue
    if (key.toLowerCase() === 'transfer-encoding') continue
    res.setHeader(key, value)
  }

  const text = await upstream.text()
  return res.status(upstream.status).send(text)
}
