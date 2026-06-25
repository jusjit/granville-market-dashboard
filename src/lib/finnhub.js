const BASE = 'https://finnhub.io/api/v1'
const API_KEY = import.meta.env.VITE_FINNHUB_KEY

export async function getQuote(symbol) {
  const res = await fetch(`${BASE}/quote?symbol=${encodeURIComponent(symbol)}&token=${API_KEY}`)
  if (!res.ok) throw new Error(`Finnhub ${res.status} for ${symbol}`)
  const data = await res.json()
  if (data.c == null || data.c === 0) throw new Error(`No data for ${symbol}`)
  return {
    price: data.c,
    prevClose: data.pc,
    pctChange: data.dp,
  }
}
