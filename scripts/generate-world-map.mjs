// Generate simplified world map SVG path from GeoJSON (equirectangular, 960x480, lat clamped to [-60, 85])
const res = await fetch('https://raw.githubusercontent.com/johan/world.geo.json/master/countries.geo.json')
const geo = await res.json()

const W = 960, H = 480, LAT_TOP = 85, LAT_BOT = -60
const px = lon => (lon + 180) / 360 * W
const py = lat => (LAT_TOP - lat) / (LAT_TOP - LAT_BOT) * H

const MIN_DIST = 1.6   // px — drop points closer than this to last kept point
const MIN_RING_SPAN = 3.5 // px — drop rings whose bbox is smaller than this

let paths = []
let totalPts = 0

function ringToPath(ring) {
  const pts = []
  let lx = null, ly = null
  for (const [lon, lat] of ring) {
    if (lat < LAT_BOT) continue
    const x = px(lon), y = py(lat)
    if (lx !== null && Math.hypot(x - lx, y - ly) < MIN_DIST) continue
    pts.push([x, y]); lx = x; ly = y
  }
  if (pts.length < 4) return null
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1])
  if (Math.max(...xs) - Math.min(...xs) < MIN_RING_SPAN && Math.max(...ys) - Math.min(...ys) < MIN_RING_SPAN) return null
  totalPts += pts.length
  return 'M' + pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('L') + 'Z'
}

for (const f of geo.features) {
  if (f.id === 'ATA') continue // Antarctica
  const g = f.geometry
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
  for (const poly of polys) {
    const p = ringToPath(poly[0]) // outer ring only
    if (p) paths.push(p)
  }
}

const d = paths.join('')
console.log('rings:', paths.length, 'points:', totalPts, 'chars:', d.length)

const out = `// Auto-generated world map path — equirectangular projection, viewBox 0 0 960 480, lat range [85, -60], Antarctica excluded.
// Source: world.geo.json (Natural Earth derived). Regenerate with scratchpad genmap.mjs if needed.
export const WORLD_MAP_PATH = ${JSON.stringify(d)}
`
import { writeFileSync } from 'fs'
writeFileSync('new URL("../src/lib/worldMapPath.js", import.meta.url)', out)
console.log('written')
