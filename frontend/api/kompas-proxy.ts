export default async function handler(req: any, res: any) {
  try {
    const url = String(req.query?.url ?? '')
    if (!url.startsWith('https://kompaszliav.sk/')) {
      return res.status(400).json({ error: 'Invalid URL' })
    }
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html',
        'Accept-Language': 'sk-SK,sk;q=0.9',
        'Referer': 'https://kompaszliav.sk/',
      },
    })
    const html = await response.text()
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Cache-Control', 's-maxage=300')
    return res.status(response.status).send(html)
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? 'unknown error', stack: e?.stack })
  }
}
