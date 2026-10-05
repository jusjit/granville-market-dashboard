/*
 * When-issued (WI) yields at the 1pm bid deadline, used for the real auction tail
 * (high yield − WI). Treasury does not publish WI yields and no data source wired into
 * this dashboard has them, so values come from manual entry until a provider is added.
 * Never estimate or back-fill a WI yield.
 *
 * ── SQL (run once in Supabase SQL editor) ────────────────────────────────────
 *
 * create table if not exists treasury_wi_yields (
 *   cusip text not null,
 *   auction_date date not null,
 *   wi_yield_1pm numeric not null,
 *   source text not null default 'manual',
 *   entered_at timestamptz not null default now(),
 *   primary key (cusip, auction_date)
 * );
 * alter table treasury_wi_yields enable row level security;
 * grant all on table treasury_wi_yields to service_role;
 */

const TABLE = 'treasury_wi_yields'

// Provider interface — add an adapter here to source WI yields automatically:
//   { name: string, fetch: async ({ since }) => ({ [`${cusip}|${auctionDate}`]: number }) }
// Manual entries always take precedence over provider values.
const PROVIDERS = []

export async function getWiYields(supabase, { since }) {
  const values = {}
  for (const p of PROVIDERS) {
    try {
      const got = await p.fetch({ since })
      for (const [k, y] of Object.entries(got)) values[k] = { yield: y, source: p.name }
    } catch (err) {
      console.warn(`WI provider ${p.name} failed: ${err.message}`)
    }
  }
  const { data, error } = await supabase.from(TABLE)
    .select('cusip,auction_date,wi_yield_1pm,source')
    .gte('auction_date', since)
  if (error) throw new Error(error.message)
  for (const r of data ?? []) values[`${r.cusip}|${r.auction_date}`] = { yield: Number(r.wi_yield_1pm), source: r.source }
  return values
}

export function validateWiInput(body) {
  const { cusip, auctionDate, wiYield } = body ?? {}
  if (typeof cusip !== 'string' || !/^[0-9A-Z]{9}$/.test(cusip)) return 'cusip must be 9 alphanumeric characters'
  if (typeof auctionDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(auctionDate)) return 'auctionDate must be YYYY-MM-DD'
  if (wiYield === null) return null
  if (typeof wiYield !== 'number' || !Number.isFinite(wiYield) || wiYield <= 0 || wiYield >= 20) return 'wiYield must be a percent between 0 and 20, or null to clear'
  return null
}

export async function saveWiYield(supabase, { cusip, auctionDate, wiYield }) {
  if (wiYield === null) {
    const { error } = await supabase.from(TABLE).delete().eq('cusip', cusip).eq('auction_date', auctionDate)
    if (error) throw new Error(error.message)
    return
  }
  const { error } = await supabase.from(TABLE).upsert([{
    cusip, auction_date: auctionDate, wi_yield_1pm: wiYield, source: 'manual', entered_at: new Date().toISOString(),
  }], { onConflict: 'cusip,auction_date' })
  if (error) throw new Error(error.message)
}
