// Vercel Edge Middleware — shared-password gate for the private dashboard.
// Enforced ONLY when DASHBOARD_PASSWORD is set (private project). The public
// project builds from the same repo but has no DASHBOARD_PASSWORD, so this
// no-ops there.
//
// Cookie holds SHA-256(password), never the plaintext. Routes with their own
// auth (snapshot cron, alma ingest webhook) are excluded so automation keeps
// working.

const OPEN_PATHS = [
  /^\/login$/,
  /^\/api\/login$/,
  /^\/api\/snapshot/,      // Bearer SNAPSHOT_SECRET (dashboard + vol snapshots)
  /^\/api\/vol-history/,   // Bearer SNAPSHOT_SECRET (POST capture) + dashboard GET
  /^\/api\/reference/,     // Bearer SNAPSHOT_SECRET (POST capture) + dashboard GET
  /^\/api\/aggregate-geo-regime/, // Bearer SNAPSHOT_SECRET (geo regime cron)
  /^\/api\/ingest-alma/,   // X-Ingest-Secret
  /^\/assets\//,           // Vite build output (hashed filenames)
  /^\/favicon/,
  /^\/vite\.svg$/,
]

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export default async function middleware(req) {
  const password = process.env.DASHBOARD_PASSWORD
  if (!password) return // public project — gate disabled

  const url = new URL(req.url)
  if (OPEN_PATHS.some(re => re.test(url.pathname))) return

  const cookies = req.headers.get('cookie') ?? ''
  const match = cookies.match(/(?:^|;\s*)dashboard_auth=([^;]+)/)
  if (match) {
    const expected = await sha256Hex(password)
    if (match[1] === expected) return
  }

  if (url.pathname.startsWith('/api/')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return Response.redirect(new URL('/login', req.url), 307)
}
