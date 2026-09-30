/*
 * Overnight Context — descriptive only (no signals, no scores).
 * Data: Yahoo chart endpoint. ES=F 5m bars (~10 min delayed, continuous
 * front month), ^N225 ^HSI ^GDAXI ^STOXX50E ^VIX daily bars (~15 min delayed).
 * All session logic in America/Chicago. Overnight = 5:00pm CT prior day → 8:30am CT.
 *
 * ── SQL: overnight log (run once in Supabase SQL editor) ─────────────────────
 *
 * create table if not exists overnight_context_log (
 *   session_date date primary key,
 *   logged_at timestamptz,
 *   es_data_as_of timestamptz,
 *   es_on_open numeric, es_on_high numeric, es_on_low numeric, es_on_last numeric,
 *   es_on_range numeric, es_on_volume bigint,
 *   es_on_range_avg20 numeric, es_on_range_ratio numeric,
 *   es_on_volume_avg20 numeric, es_on_volume_ratio numeric,
 *   prior_rth_date date, prior_rth_close numeric, prior_rth_high numeric, prior_rth_low numeric,
 *   es_830 numeric, es_830_provisional boolean,
 *   gap_pts numeric, vix_ref numeric, vix_ref_date date, sigma_pts numeric,
 *   gap_sigma numeric, gap_label text,
 *   range_position text,
 *   move_postclose_pts numeric, move_postclose_pct numeric,
 *   move_asia_pts numeric, move_asia_pct numeric,
 *   move_europe_pts numeric, move_europe_pct numeric,
 *   move_preopen_pts numeric, move_preopen_pct numeric,
 *   n225_status text, n225_ret_pct numeric, n225_z numeric, n225_flag boolean, n225_agrees boolean,
 *   hsi_status text,  hsi_ret_pct numeric,  hsi_z numeric,  hsi_flag boolean,  hsi_agrees boolean,
 *   dax_status text,  dax_ret_pct numeric,  dax_z numeric,  dax_flag boolean,  dax_agrees boolean,
 *   sx5e_status text, sx5e_ret_pct numeric, sx5e_z numeric, sx5e_flag boolean, sx5e_agrees boolean,
 *   roll_week boolean,
 *   feed_flags text[],
 *   summary text,
 *   rth_open numeric, rth_high numeric, rth_low numeric, rth_close numeric,
 *   rth_range numeric, rth_net numeric, rth_half_day boolean, rth_logged_at timestamptz
 * );
 * alter table overnight_context_log enable row level security;
 * grant all on table overnight_context_log to service_role;
 */

const YF = 'https://query1.finance.yahoo.com/v8/finance/chart/'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const CT = 'America/Chicago'

const RTH_OPEN = 8 * 60 + 30
const RTH_CLOSE = 15 * 60
const GLOBEX_REOPEN = 17 * 60
const ASIA_END = 60          // 1:00am CT
const EUROPE_END = 7 * 60 + 30

export const FOREIGN = [
  { key: 'n225', symbol: '^N225', label: 'Nikkei 225' },
  { key: 'hsi', symbol: '^HSI', label: 'Hang Seng' },
  { key: 'dax', symbol: '^GDAXI', label: 'DAX' },
  { key: 'sx5e', symbol: '^STOXX50E', label: 'Euro Stoxx 50' },
]

// ─── time helpers ────────────────────────────────────────────────────────────
const fmtCache = {}
export function tzParts(epochSec, tz = CT) {
  const f = fmtCache[tz] ??= new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
  })
  const p = Object.fromEntries(f.formatToParts(new Date(epochSec * 1000)).map(x => [x.type, x.value]))
  return { date: `${p.year}-${p.month}-${p.day}`, min: +p.hour * 60 + +p.minute, wd: p.weekday }
}

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function nextWeekday(dateStr) {
  let d = addDays(dateStr, 1)
  while ([0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay())) d = addDays(d, 1)
  return d
}

// ES quarterly roll: flag from ~9 days before expiry (3rd Friday of Mar/Jun/Sep/Dec) through expiry.
function isRollWeek(dateStr) {
  const [y, m] = dateStr.split('-').map(Number)
  if (![3, 6, 9, 12].includes(m)) return false
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay()
  const thirdFri = `${y}-${String(m).padStart(2, '0')}-${String(1 + ((5 - first + 7) % 7) + 14).padStart(2, '0')}`
  return dateStr >= addDays(thirdFri, -9) && dateStr <= thirdFri
}

function globexOpen(p) {
  if (p.wd === 'Sat') return false
  if (p.wd === 'Sun') return p.min >= GLOBEX_REOPEN
  if (p.wd === 'Fri' && p.min >= 16 * 60) return false
  return !(p.min >= 16 * 60 && p.min < GLOBEX_REOPEN)
}

const r2 = v => (v == null || !Number.isFinite(v)) ? null : Math.round(v * 100) / 100
const r3 = v => (v == null || !Number.isFinite(v)) ? null : Math.round(v * 1000) / 1000
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null
function stdev(a) {
  if (a.length < 2) return null
  const m = mean(a)
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1))
}

// ─── Yahoo ───────────────────────────────────────────────────────────────────
async function yahooChart(symbol, query) {
  const r = await fetch(`${YF}${encodeURIComponent(symbol)}?${query}`, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(12000),
  })
  if (!r.ok) throw new Error(`Yahoo ${symbol} HTTP ${r.status}`)
  const res = (await r.json())?.chart?.result?.[0]
  if (!res?.timestamp) throw new Error(`Yahoo ${symbol}: no data`)
  const q = res.indicators.quote[0]
  const bars = res.timestamp
    .map((t, i) => ({ t, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: q.volume?.[i] ?? 0 }))
    .filter(b => b.c != null && b.o != null && b.h != null && b.l != null)
  return { meta: res.meta, bars }
}

// ─── ES sessions ─────────────────────────────────────────────────────────────
// Session date of a bar: bars from 5:00pm CT onward belong to the next weekday's session.
function buildSessions(bars) {
  const sessions = new Map()
  for (const b of bars) {
    const p = tzParts(b.t)
    b.p = p
    const sd = p.min >= GLOBEX_REOPEN ? nextWeekday(p.date) : p.date
    if (!sessions.has(sd)) sessions.set(sd, { date: sd, on: [], rth: [] })
    const s = sessions.get(sd)
    if (p.date < sd || p.min < RTH_OPEN) s.on.push(b)
    else if (p.date === sd && p.min < RTH_CLOSE) s.rth.push(b)
  }
  return [...sessions.values()].sort((a, b) => a.date.localeCompare(b.date))
}

function onStats(on) {
  if (!on.length) return null
  return {
    open: on[0].o,
    high: Math.max(...on.map(b => b.h)),
    low: Math.min(...on.map(b => b.l)),
    last: on.at(-1).c,
    volume: on.reduce((s, b) => s + (b.v || 0), 0),
  }
}

function rthStats(rth) {
  if (!rth.length) return null
  return {
    open: rth[0].o,
    high: Math.max(...rth.map(b => b.h)),
    low: Math.min(...rth.map(b => b.l)),
    close: rth.at(-1).c,
    lastBarMin: rth.at(-1).p.min,
  }
}

async function fetchEsSessions() {
  const { meta, bars } = await yahooChart('ES=F', 'interval=5m&range=60d&includePrePost=true')
  return { meta, bars, sessions: buildSessions(bars) }
}

// ─── foreign indices ─────────────────────────────────────────────────────────
async function foreignIndex(def, D, esDir, nowSec) {
  const base = { key: def.key, symbol: def.symbol, label: def.label }
  let data
  try {
    data = await yahooChart(def.symbol, 'interval=1d&range=6mo')
  } catch (err) {
    return { ...base, status: 'missing', error: err.message }
  }
  const { meta, bars } = data
  const tz = meta.exchangeTimezoneName
  const byDate = new Map()
  for (const b of bars) byDate.set(tzParts(b.t, tz).date, b)
  const days = [...byDate.entries()].map(([date, b]) => ({ date, ...b })).sort((a, b) => a.t - b.t)
  const idx = days.findIndex(d => d.date === D)
  const reg = meta.currentTradingPeriod?.regular
  const regDate = reg ? tzParts(reg.start, tz).date : null

  if (idx === -1) {
    const status = (regDate === D && nowSec < reg.start) ? 'not_open' : 'closed'
    return { ...base, status }
  }
  if (idx < 21) return { ...base, status: 'missing', error: 'insufficient history' }

  const intraday = regDate === D && nowSec >= reg.start && nowSec < reg.end
  const price = intraday && meta.regularMarketPrice != null ? meta.regularMarketPrice : days[idx].c
  const prevClose = days[idx - 1].c
  const ret = (price / prevClose - 1) * 100
  const window = days.slice(Math.max(0, idx - 61), idx)
  const rets = window.slice(1).map((d, i) => (d.c / window[i].c - 1) * 100)
  const sd = stdev(rets)
  const z = sd ? ret / sd : null
  const asOf = (meta.regularMarketTime && tzParts(meta.regularMarketTime, tz).date === D)
    ? meta.regularMarketTime : days[idx].t
  return {
    ...base,
    status: intraday ? 'intraday' : 'ok',
    retPct: r3(ret),
    sd60: r3(sd),
    nReturns: rets.length,
    z: r2(z),
    flag: z != null && Math.abs(z) > 1.5,
    agrees: esDir === 0 || z == null ? null : Math.sign(ret) === esDir,
    asOf,
    stale: intraday && nowSec - (meta.regularMarketTime ?? 0) > 40 * 60,
  }
}

async function fetchVixRef(D) {
  const { meta, bars } = await yahooChart('^VIX', 'interval=1d&range=1mo')
  const tz = meta.exchangeTimezoneName
  const prior = bars.map(b => ({ date: tzParts(b.t, tz).date, c: b.c })).filter(b => b.date < D).at(-1)
  if (!prior) throw new Error('no prior VIX close')
  return { vix: prior.c, date: prior.date }
}

// ─── main compute ────────────────────────────────────────────────────────────
export async function computeOvernightContext(nowMs = Date.now()) {
  const nowSec = nowMs / 1000
  const nowCt = tzParts(nowSec)
  const feedFlags = []

  let es
  try {
    es = await fetchEsSessions()
  } catch (err) {
    return { computedAt: new Date(nowMs).toISOString(), error: `ES feed unavailable: ${err.message}`, feedFlags: ['es_missing'] }
  }
  const { bars, sessions } = es
  const lastBar = bars.at(-1)
  const cur = sessions.at(-1)
  const D = cur.date
  const priorIdx = sessions.findLastIndex(s => s.date < D && s.rth.length > 0)
  const prior = priorIdx >= 0 ? sessions[priorIdx] : null
  const priorRth = prior ? rthStats(prior.rth) : null

  if (globexOpen(nowCt) && nowSec - lastBar.t > 25 * 60) feedFlags.push('es_stale')

  const on = onStats(cur.on)
  if (!on) feedFlags.push('es_overnight_missing')

  // 20-day trailing overnight range/volume; skip the oldest (partial) session and short sessions.
  const history = sessions.slice(1).filter(s => s.date < D && s.on.length >= 150).slice(-20).map(s => onStats(s.on))
  const rangeAvg = mean(history.map(h => h.high - h.low))
  const volAvg = mean(history.map(h => h.volume))

  // ES at 8:30am CT: open of the 8:30 bar; before that, the latest overnight price (provisional).
  const firstRth = cur.rth[0]
  const es830 = firstRth && firstRth.p.min === RTH_OPEN ? firstRth.o : on?.last ?? null
  const es830Provisional = !(firstRth && firstRth.p.min === RTH_OPEN)

  let vixRef = null
  try { vixRef = await fetchVixRef(D) } catch { feedFlags.push('vix_missing') }

  const priorClose = priorRth?.close ?? null
  const gap = es830 != null && priorClose != null ? es830 - priorClose : null
  const sigmaPts = vixRef && priorClose ? (vixRef.vix / 100) / Math.sqrt(252) * priorClose : null
  const gapSigma = gap != null && sigmaPts ? gap / sigmaPts : null
  const gapLabel = gapSigma == null ? null
    : Math.abs(gapSigma) < 0.25 ? 'flat' : Math.abs(gapSigma) <= 0.75 ? 'moderate' : 'large'

  let rangePosition = null
  if (on && priorRth) {
    const above = on.high > priorRth.high, below = on.low < priorRth.low
    rangePosition = above && below ? 'outside' : above ? 'above' : below ? 'below' : 'inside'
  }

  // Timing split — segments sum exactly to the gap.
  let timing = null
  if (on && priorClose != null) {
    const seg = { asia: [], europe: [], preopen: [] }
    for (const b of cur.on) {
      const m = b.p.min
      if (m >= GLOBEX_REOPEN || m < ASIA_END) seg.asia.push(b)
      else if (m < EUROPE_END) seg.europe.push(b)
      else seg.preopen.push(b)
    }
    const asiaEnd = seg.asia.at(-1)?.c ?? on.open
    const europeEnd = seg.europe.at(-1)?.c ?? asiaEnd
    const end = es830 ?? europeEnd
    const moves = {
      postclose: on.open - priorClose,
      asia: asiaEnd - on.open,
      europe: europeEnd - asiaEnd,
      preopen: end - europeEnd,
    }
    const pct = v => gap != null && Math.abs(gap) >= 0.01 ? r2(v / gap * 100) : null
    timing = {
      postclose: { window: '3:00pm–5:00pm', pts: r2(moves.postclose), pct: pct(moves.postclose), bars: null },
      asia: { window: '5:00pm–1:00am', pts: r2(moves.asia), pct: pct(moves.asia), bars: seg.asia.length },
      europe: { window: '1:00am–7:30am', pts: r2(moves.europe), pct: pct(moves.europe), bars: seg.europe.length },
      preopen: { window: '7:30am–8:30am', pts: r2(moves.preopen), pct: pct(moves.preopen), bars: seg.preopen.length },
    }
  }

  const esDir = gap == null || gapLabel === 'flat' ? 0 : Math.sign(gap)
  const foreign = await Promise.all(FOREIGN.map(f => foreignIndex(f, D, esDir, nowSec)))
  for (const f of foreign) {
    if (f.status === 'missing') feedFlags.push(`${f.key}_missing`)
    if (f.stale) feedFlags.push(`${f.key}_stale`)
  }

  const ctx = {
    computedAt: new Date(nowMs).toISOString(),
    sessionDate: D,
    esDataAsOf: lastBar.t,
    rollWeek: isRollWeek(D),
    priorRth: prior ? {
      date: prior.date, close: r2(priorRth.close), high: r2(priorRth.high), low: r2(priorRth.low),
      halfDay: priorRth.lastBarMin < RTH_CLOSE - 5,
    } : null,
    overnight: on ? {
      open: r2(on.open), high: r2(on.high), low: r2(on.low), last: r2(on.last),
      range: r2(on.high - on.low), volume: on.volume,
      rangeAvg20: r2(rangeAvg), rangeRatio: r2(rangeAvg ? (on.high - on.low) / rangeAvg : null),
      volumeAvg20: volAvg != null ? Math.round(volAvg) : null, volumeRatio: r2(volAvg ? on.volume / volAvg : null),
      historyDays: history.length,
      complete: !es830Provisional,
    } : null,
    gap: {
      es830: r2(es830), provisional: es830Provisional, pts: r2(gap),
      vix: r2(vixRef?.vix), vixDate: vixRef?.date ?? null, sigmaPts: r2(sigmaPts),
      sigma: r2(gapSigma), label: gapLabel,
    },
    rangePosition,
    timing,
    foreign,
    feedFlags,
  }
  ctx.summary = buildSummary(ctx)
  return ctx
}

const POSITION_TEXT = {
  inside: "inside the prior day's RTH range",
  above: "trading above the prior RTH high",
  below: 'trading below the prior RTH low',
  outside: "breaking both sides of the prior RTH range",
}
const SEGMENT_TEXT = { postclose: 'the post-close hours', asia: 'Asia hours', europe: 'Europe hours', preopen: 'the pre-open hour' }

function buildSummary(c) {
  if (!c.overnight || c.gap.pts == null) return 'Overnight data incomplete.'
  const g = c.gap
  const sign = g.pts > 0 ? '+' : ''
  const parts = [
    `ES ${sign}${g.pts.toFixed(2)} pts vs prior close${g.sigma != null ? ` (${g.sigma.toFixed(2)}σ, ${g.label})` : ''}${g.provisional ? ' so far' : ''}`,
    `overnight range ${c.overnight.range.toFixed(2)} pts${c.overnight.rangeRatio != null ? ` (${c.overnight.rangeRatio.toFixed(2)}× 20d avg)` : ''} on ${c.overnight.volumeRatio != null ? `${c.overnight.volumeRatio.toFixed(2)}× avg volume` : 'unknown relative volume'}`,
  ]
  if (c.rangePosition) parts.push(POSITION_TEXT[c.rangePosition])
  let s = parts.join(', ')
  if (c.timing && g.label !== 'flat') {
    const top = Object.entries(c.timing).sort((a, b) => Math.abs(b[1].pts) - Math.abs(a[1].pts))[0]
    s += `; most of the move came in ${SEGMENT_TEXT[top[0]]}`
  }
  const live = c.foreign.filter(f => f.status === 'ok' || f.status === 'intraday')
  const agree = live.filter(f => f.agrees === true).map(f => f.label)
  const disagree = live.filter(f => f.agrees === false).map(f => f.label)
  const flagged = live.filter(f => f.flag).map(f => f.label)
  const closed = c.foreign.filter(f => f.status === 'closed').map(f => f.label)
  const foreignBits = []
  if (agree.length) foreignBits.push(`${agree.join(', ')} agree`)
  if (disagree.length) foreignBits.push(`${disagree.join(', ')} disagree`)
  if (flagged.length) foreignBits.push(`${flagged.join(', ')} |z|>1.5`)
  if (closed.length) foreignBits.push(`${closed.join(', ')} closed`)
  if (foreignBits.length) s += `. Foreign: ${foreignBits.join('; ')}`
  return `${s}.`
}

// ─── logging ─────────────────────────────────────────────────────────────────
export function toMorningRow(c) {
  const row = {
    session_date: c.sessionDate,
    logged_at: c.computedAt,
    es_data_as_of: new Date(c.esDataAsOf * 1000).toISOString(),
    es_on_open: c.overnight?.open, es_on_high: c.overnight?.high, es_on_low: c.overnight?.low,
    es_on_last: c.overnight?.last, es_on_range: c.overnight?.range, es_on_volume: c.overnight?.volume,
    es_on_range_avg20: c.overnight?.rangeAvg20, es_on_range_ratio: c.overnight?.rangeRatio,
    es_on_volume_avg20: c.overnight?.volumeAvg20, es_on_volume_ratio: c.overnight?.volumeRatio,
    prior_rth_date: c.priorRth?.date, prior_rth_close: c.priorRth?.close,
    prior_rth_high: c.priorRth?.high, prior_rth_low: c.priorRth?.low,
    es_830: c.gap.es830, es_830_provisional: c.gap.provisional,
    gap_pts: c.gap.pts, vix_ref: c.gap.vix, vix_ref_date: c.gap.vixDate, sigma_pts: c.gap.sigmaPts,
    gap_sigma: c.gap.sigma, gap_label: c.gap.label,
    range_position: c.rangePosition,
    roll_week: c.rollWeek,
    feed_flags: c.feedFlags,
    summary: c.summary,
  }
  for (const k of ['postclose', 'asia', 'europe', 'preopen']) {
    row[`move_${k}_pts`] = c.timing?.[k]?.pts ?? null
    row[`move_${k}_pct`] = c.timing?.[k]?.pct ?? null
  }
  for (const f of c.foreign) {
    row[`${f.key}_status`] = f.status
    row[`${f.key}_ret_pct`] = f.retPct ?? null
    row[`${f.key}_z`] = f.z ?? null
    row[`${f.key}_flag`] = f.flag ?? null
    row[`${f.key}_agrees`] = f.agrees ?? null
  }
  return row
}

// RTH fill for a given CT date. Returns null when there was no RTH session (holiday)
// or the session hasn't finished in the (delayed) feed yet.
export async function computeRthRow(sessionDate, nowMs = Date.now()) {
  const { sessions } = await fetchEsSessions()
  const s = sessions.find(x => x.date === sessionDate)
  const rth = s ? rthStats(s.rth) : null
  if (!rth) return null
  const nowCt = tzParts(nowMs / 1000)
  const fullDone = rth.lastBarMin >= RTH_CLOSE - 5
  const halfDay = !fullDone && (nowCt.date > sessionDate || nowCt.min >= RTH_CLOSE + 10)
  if (!fullDone && !halfDay) return null
  return {
    session_date: sessionDate,
    rth_open: r2(rth.open), rth_high: r2(rth.high), rth_low: r2(rth.low), rth_close: r2(rth.close),
    rth_range: r2(rth.high - rth.low), rth_net: r2(rth.close - rth.open),
    rth_half_day: halfDay,
    rth_logged_at: new Date(nowMs).toISOString(),
  }
}

export function ctToday(nowMs = Date.now()) {
  return tzParts(nowMs / 1000).date
}
