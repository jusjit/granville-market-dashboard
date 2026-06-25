export default async function handler(req, res) {
  const { symbols } = req.query
  if (!symbols) return res.status(400).json({ error: 'symbols query param required' })
  const key = process.env.FINNHUB_KEY
  if (!key) return res.status(500).json({ error: 'FINNHUB_KEY not configured' })
  const tickers = symbols.split(',').map(s => s.trim()).filter(Boolean)
  try {
    const results = await Promise.all(
      tickers.map(async (symbol) => {
        const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${key}`)
        if (!r.ok) return { symbol, error: `Finnhub ${r.status}` }
        const data = await r.json()
        if (data.c == null || data.c === 0) return { symbol, error: `No data for ${symbol}` }
        return { symbol, price: data.c, prevClose: data.pc, pctChange: data.dp }
      })
    )
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30')
    return res.status(200).json(results)
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
