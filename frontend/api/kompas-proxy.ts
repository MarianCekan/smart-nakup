import { IncomingMessage, ServerResponse } from 'http'

const KOMPAS_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'sk-SK,sk;q=0.9',
  'Referer': 'https://kompaszliav.sk/',
}

export default async function handler(req: IncomingMessage & { query?: Record<string, string> }, res: ServerResponse) {
  const urlParam = (req as any).query?.url ?? new URL(req.url ?? '', 'http://localhost').searchParams.get('url') ?? ''

  if (!urlParam.startsWith('https://kompaszliav.sk/')) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ error: 'Invalid URL' }))
  }

  try {
    const response = await fetch(urlParam, { headers: KOMPAS_HEADERS })
    if (!response.ok) {
      res.writeHead(response.status, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ error: `Upstream ${response.status}` }))
    }
    const html = await response.text()
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 's-maxage=300',
    })
    return res.end(html)
  } catch (e: any) {
    res.writeHead(502, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ error: e.message }))
  }
}
