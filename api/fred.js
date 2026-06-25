export default async function handler(req, res) {
  const { series } = req.query
  if (!series) return res.status(400).json({ error: 'series query param required' })
  const key = process.env.FRED_KEY
  if (!key) return res.status(500).json({ error: 'FRED_KEY not configured' })
  const seriesIds = series.split(',').map(s => s.trim()).filter(Boolean)
  try {
    const results = await Promise.all(
      seriesIds.map(async (id) => {
        const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${id}&api_key=${key}&sort_order=desc&limit=2&file_type=json`
        const r = await fetch(url)
        if (!r.ok) return { id, error: `FRED ${r.status}` }
        const data = await r.json()
        const obs = data.observations?.filter(o => o.value !== '.')
        if (!obs?.length) return { id, error: `No data for ${id}` }
        return { id, observations: obs.map(o => ({ date: o.date, value: parseFloat(o.value) })) }
      })
    )
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600')
    return res.status(200).json(results)
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
