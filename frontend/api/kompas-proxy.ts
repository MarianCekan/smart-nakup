import type { VercelRequest, VercelResponse } from '@vercel/node'

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'sk-SK,sk;q=0.9',
  'Referer': 'https://kompaszliav.sk/',
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const url = String(req.query.url ?? '')
  if (!url.startsWith('https://kompaszliav.sk/')) {
    return res.status(400).json({ error: 'Invalid URL' })
  }

  try {
    const response = await fetch(url, { headers: HEADERS })
    if (!response.ok) {
      return res.status(response.status).json({ error: `Upstream ${response.status}` })
    }
    const html = await response.text()
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Cache-Control', 's-maxage=300') // 5min Vercel edge cache
    return res.status(200).send(html)
  } catch (e: any) {
    return res.status(502).json({ error: e.message })
  }
}
