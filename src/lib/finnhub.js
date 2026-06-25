const quoteCache = new Map()

export async function prefetchQuotes(symbols) {
  quoteCache.clear()
  const res = await fetch(`/api/finnhub?symbols=${symbols.map(encodeURIComponent).join(',')}`)
  if (!res.ok) throw new Error(`/api/finnhub ${res.status}`)
  const data = await res.json()
  for (const item of data) {
    quoteCache.set(item.symbol, item.error ? { error: item.error } : item)
  }
}

export function getQuote(symbol) {
  return quoteCache.get(symbol) ?? { error: `${symbol} not in cache` }
}
