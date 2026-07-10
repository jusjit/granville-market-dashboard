import { createHash } from 'node:crypto'

// Shared-password login: on success, sets a 30-day cookie holding
// SHA-256(password) — the same value the edge middleware expects.
export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const expected = process.env.DASHBOARD_PASSWORD
  if (!expected) return res.status(500).json({ error: 'DASHBOARD_PASSWORD not configured' })

  let body
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body }
  catch { return res.status(400).json({ error: 'Invalid JSON body' }) }

  if (body?.password !== expected) {
    return res.status(401).json({ error: 'Incorrect password' })
  }

  const hash = createHash('sha256').update(expected).digest('hex')
  res.setHeader('Set-Cookie',
    `dashboard_auth=${hash}; Max-Age=2592000; Path=/; HttpOnly; Secure; SameSite=Lax`)
  return res.status(200).json({ success: true })
}
