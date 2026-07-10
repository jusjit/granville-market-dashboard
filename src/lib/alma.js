export async function fetchAlmaData() {
  const res = await fetch('/api/alma')
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error ?? `alma API ${res.status}`)
  }
  return res.json()
}
