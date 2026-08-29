import { useState, Component } from 'react'
import { ChevronDown } from 'lucide-react'

class GeoErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  render() {
    if (this.state.error) {
      return (
        <div className="rounded-xl border border-red-900/40 bg-red-950/20 px-5 py-3 text-sm text-red-400">
          <p className="font-semibold mb-1">Geo Regime render error</p>
          <p className="text-xs text-red-400/70 font-mono break-all">{this.state.error.message}</p>
          <button onClick={() => this.setState({ error: null })} className="text-xs text-slate-400 mt-2 hover:text-slate-200">
            Retry
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

/* ── Glossary tooltips ── */

const GLOSSARY = {
  ucdp: 'Uppsala Conflict Data Program — tracks armed conflicts worldwide',
  cii: 'Country Instability Index — composite fragility score per country',
  crossSource: 'Cross-source convergence — same signal detected by multiple independent feeds',
  posture: 'Theater military posture — naval/air force deployments near chokepoints',
  shipping: 'Shipping stress — transit delays, diversions, and insurance cost spikes',
  chokepoint: 'Maritime chokepoint — narrow passage where shipping can be disrupted',
  chokepoints: 'Maritime chokepoints — narrow passages where shipping can be disrupted',
  flowRatio: 'Flow ratio — current vs. normal vessel transit volume through a corridor',
  warRiskTier: "Lloyd's Joint War Committee risk tier — determines insurance premiums",
  'full-scan': 'Complete dataset re-evaluation — all sources queried, full LLM analysis',
  'gated-triggered': 'Delta scan — only changed categories sent to LLM (cost-saving)',
  'gated-skip': 'No material change detected — LLM not called, zero tokens used',
  oil_shock_risk: 'Probability of a supply-driven oil price spike from disruption',
  carry_unwind: 'Risk of leveraged FX carry trades unwinding (JPY strength signal)',
  equity_drawdown_severity: 'Expected equity market drawdown from geo escalation',
  safe_haven_bid: 'Flight-to-safety demand for USD, treasuries, gold, CHF',
  freight_cost_shock: 'Risk of sharp rise in shipping/freight costs',
  em_fx_stress: 'Emerging market currency stress from risk-off flows',
}

function Tip({ term, children }) {
  const tip = GLOSSARY[term]
  if (!tip) return children ?? <span>{term}</span>
  return (
    <span className="relative group/tip cursor-help border-b border-dotted border-slate-600">
      {children ?? term}
      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 rounded text-[10px] text-slate-200 bg-slate-800 border border-slate-700 whitespace-nowrap opacity-0 group-hover/tip:opacity-100 pointer-events-none transition-opacity z-50 max-w-[250px] whitespace-normal text-center">
        {tip}
      </span>
    </span>
  )
}

const RUN_TYPE_STYLE = {
  'full-scan': 'bg-indigo-950/50 border-indigo-800/40 text-indigo-300',
  'gated-triggered': 'bg-amber-950/50 border-amber-800/40 text-amber-300',
  'gated-skip': 'bg-slate-800/50 border-slate-700/40 text-slate-400',
}

const IMPLICATION_LABELS = {
  oil_shock_risk: 'Oil Shock',
  carry_unwind: 'Carry Unwind',
  equity_drawdown_severity: 'Equity Drawdown',
  safe_haven_bid: 'Safe Haven',
  freight_cost_shock: 'Freight Shock',
  em_fx_stress: 'EM FX Stress',
}

const CATEGORY_LABELS = {
  chokepoint: 'Chokepoint',
  conflict: 'Conflict',
  supply_chain: 'Supply Chain',
  policy: 'Policy',
}

const STATE_STYLE = {
  escalating: 'text-red-400',
  stable: 'text-slate-400',
  de_escalating: 'text-emerald-400',
}

function severityColor(sev) {
  if (sev >= 60) return 'text-red-400'
  if (sev >= 30) return 'text-amber-400'
  return 'text-slate-400'
}

function severityBg(sev) {
  if (sev >= 60) return 'bg-red-950/40 border-red-900/40'
  if (sev >= 30) return 'bg-amber-950/30 border-amber-900/30'
  return 'bg-slate-800/40 border-slate-700/40'
}

function RunTypeBadge({ type }) {
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] border ${RUN_TYPE_STYLE[type] ?? RUN_TYPE_STYLE['gated-skip']}`}>
      {type}
    </span>
  )
}

function fmtAgo(iso) {
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function fmtTime(iso) {
  return new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/New_York', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

/* ═══════════════════════════════════════════════════════════════════════
   MAIN VIEW — World Briefing + Trajectory + Market Pricing + Headlines
   ═══════════════════════════════════════════════════════════════════════ */

/* ── Source display name mapping ── */

const SOURCE_NAMES = {
  hormuz_strait: 'Strait of Hormuz', bab_el_mandeb: 'Bab el-Mandeb', suez: 'Suez Canal',
  bosphorus: 'Bosphorus', bosporus: 'Bosphorus', taiwan_strait: 'Taiwan Strait',
  kerch_strait: 'Kerch Strait', malacca_strait: 'Malacca Strait', panama_canal: 'Panama Canal',
}

function displaySource(raw) {
  if (SOURCE_NAMES[raw]) return SOURCE_NAMES[raw]
  if (/^thermal:/.test(raw)) {
    const cc = raw.match(/^thermal:([a-z]{2}):/)?.[1]?.toUpperCase()
    return cc ? `Thermal anomaly (${cc})` : 'Thermal anomaly'
  }
  if (/^risk:/.test(raw)) {
    const cc = raw.replace('risk:', '').toUpperCase()
    return `Country risk (${cc})`
  }
  if (/^unrest:/.test(raw)) return `Unrest: ${raw.replace('unrest:', '').replace(/-/g, ' ')}`
  if (/^gpsjam:/.test(raw)) return `GPS jamming: ${raw.replace('gpsjam:', '').replace(/-/g, ' ')}`
  if (/^cyber:/.test(raw)) return `Cyber incidents: ${raw.replace('cyber:', '')}`
  if (/^composite:/.test(raw)) return `Composite: ${raw.replace('composite:', '').replace(/-/g, ' ')}`
  if (/^commodity:/.test(raw)) return `Commodity signal`
  if (/^forecast:/.test(raw)) return 'Forecast model'
  if (/crossSourceSignals/.test(raw)) {
    const inner = raw.match(/id=([^[\]]+)/)?.[1]
    return inner ? `Convergence: ${displaySource(inner)}` : 'Cross-source convergence'
  }
  if (/^chokepoints\./.test(raw)) {
    const name = raw.replace('chokepoints.', '').split('.')[0]
    return SOURCE_NAMES[name] || name.replace(/_/g, ' ')
  }
  if (/ucdp/i.test(raw)) return 'UCDP conflict data'
  return raw.replace(/_/g, ' ').replace(/-/g, ' ')
}

/* ── Geo Map regions + chokepoints ── */

const MAP_REGIONS = [
  { id: 'middle_east', label: 'Middle East', cx: 595, cy: 220, match: /middle.east|gulf|iran|iraq|yemen|saudi|red.sea|persian/i },
  { id: 'eastern_europe', label: 'E. Europe', cx: 555, cy: 150, match: /eastern.europe|ukraine|russia|black.sea|crimea/i },
  { id: 'asia_pacific', label: 'Asia Pacific', cx: 775, cy: 195, match: /asia.pacific|taiwan|china|south.china|indo.pacific|pacific/i },
  { id: 'africa', label: 'Africa', cx: 520, cy: 310, match: /africa|sahel|nigeria|sudan|ethiopia/i },
  { id: 'south_asia', label: 'South Asia', cx: 670, cy: 240, match: /south.asia|india|pakistan|bangladesh/i },
  { id: 'americas', label: 'Americas', cx: 230, cy: 200, match: /america|us.canada|north.america|latin|caribbean|panama/i },
  { id: 'europe_west', label: 'W. Europe', cx: 490, cy: 155, match: /western.europe|nato|europe(?!.*east)/i },
  { id: 'global', label: 'Global', cx: 450, cy: 400, match: /global|systemic|worldwide|cyber/i },
]

const CHOKEPOINTS = [
  { id: 'hormuz', label: 'Hormuz', cx: 620, cy: 235, region: 'middle_east' },
  { id: 'bab_el_mandeb', label: 'Bab el-Mandeb', cx: 580, cy: 275, region: 'middle_east' },
  { id: 'suez', label: 'Suez', cx: 560, cy: 225, region: 'middle_east' },
  { id: 'taiwan_strait', label: 'Taiwan Str.', cx: 775, cy: 215, region: 'asia_pacific' },
  { id: 'malacca', label: 'Malacca', cx: 725, cy: 280, region: 'asia_pacific' },
  { id: 'panama', label: 'Panama', cx: 235, cy: 265, region: 'americas' },
  { id: 'bosphorus', label: 'Bosphorus', cx: 555, cy: 175, region: 'eastern_europe' },
]

const CONNECTION_LINES = [
  { from: 'middle_east', to: 'eastern_europe' },
  { from: 'middle_east', to: 'asia_pacific' },
  { from: 'middle_east', to: 'europe_west' },
  { from: 'eastern_europe', to: 'europe_west' },
  { from: 'asia_pacific', to: 'americas' },
  { from: 'middle_east', to: 'africa' },
]

function matchThemeToRegion(theme) {
  const text = `${theme.region} ${theme.situation}`
  for (const r of MAP_REGIONS) {
    if (r.match.test(text)) return r.id
  }
  return 'global'
}

function getRegionSeverity(themes, regionId) {
  const region = MAP_REGIONS.find(r => r.id === regionId)
  if (!region) return null
  const matched = themes.filter(t => matchThemeToRegion(t) === regionId)
  if (matched.length === 0) return null
  const hasCritical = matched.some(t => /critical|severe|acute|escalat/i.test(t.situation))
  const hasElevated = matched.some(t => /elevated|heightened|tension|disrupt/i.test(t.situation))
  if (hasCritical) return 'critical'
  if (hasElevated) return 'elevated'
  return 'watch'
}

const SEV_COLORS = {
  critical: { fill: '#ef4444', glow: '#ef444480', pulse: '#ef444440', text: 'text-red-400' },
  elevated: { fill: '#f59e0b', glow: '#f59e0b80', pulse: '#f59e0b40', text: 'text-amber-400' },
  watch: { fill: '#6366f1', glow: '#6366f180', pulse: '#6366f140', text: 'text-indigo-400' },
}

function WorldBriefing({ latestRun }) {
  const [selectedRegion, setSelectedRegion] = useState(null)
  const briefing = latestRun?.verdict?.briefing
  if (!briefing) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/30 px-4 py-3">
        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">World Briefing</p>
        <p className="text-[11px] text-slate-600 italic">Briefing unavailable for this run — will appear after the next LLM assessment.</p>
      </div>
    )
  }

  const themes = briefing.themes ?? []
  const regionSeverities = {}
  for (const r of MAP_REGIONS) {
    const sev = getRegionSeverity(themes, r.id)
    if (sev) regionSeverities[r.id] = sev
  }

  const selectedThemes = selectedRegion
    ? themes.filter(t => matchThemeToRegion(t) === selectedRegion)
    : []
  const selectedLabel = MAP_REGIONS.find(r => r.id === selectedRegion)?.label

  const confidence = latestRun?.confidence ?? null

  return (
    <div className="rounded-xl border border-indigo-900/30 bg-gradient-to-b from-[#1a1040] to-[#0f0d1a] px-4 py-3 overflow-hidden">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">World Briefing</p>
        {confidence != null && (
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] text-slate-600 uppercase">Threat</span>
            <span className={`text-[11px] font-mono font-bold ${confidence >= 80 ? 'text-red-400' : confidence >= 60 ? 'text-amber-400' : confidence >= 40 ? 'text-indigo-400' : 'text-slate-500'}`}>
              {confidence}
            </span>
          </div>
        )}
      </div>
      <p className="text-[12px] text-slate-300 font-medium leading-snug mb-3">{briefing.bottom_line}</p>

      {/* SVG World Map */}
      <div className="relative -mx-4 mb-3">
        <svg viewBox="0 0 960 480" className="w-full" style={{ minHeight: 240 }}>
          <defs>
            <radialGradient id="glow-critical" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#ef4444" stopOpacity="0.7" />
              <stop offset="100%" stopColor="#ef4444" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="glow-elevated" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.7" />
              <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="glow-watch" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#6366f1" stopOpacity="0.7" />
              <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="line-grad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#6366f1" stopOpacity="0" />
              <stop offset="50%" stopColor="#818cf8" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
            </linearGradient>
            <filter id="map-glow">
              <feGaussianBlur stdDeviation="1.5" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <style>{`
              @keyframes pulse-ring { 0% { r: 10; opacity: 0.7; } 100% { r: 28; opacity: 0; } }
              .pulse-anim { animation: pulse-ring 2.5s ease-out infinite; }
              @keyframes pulse-ring-sm { 0% { r: 5; opacity: 0.5; } 100% { r: 14; opacity: 0; } }
              .pulse-sm { animation: pulse-ring-sm 3s ease-out infinite; }
            `}</style>
          </defs>

          {/* Continent outlines — Natural Earth simplified */}
          <g fill="#251d55" stroke="#4f46e5" strokeWidth="0.5" opacity="0.5">
            {/* North America */}
            <path d="M40,72 C50,58 68,48 90,42 C105,38 125,36 148,38 C162,40 172,36 185,32 C200,28 218,30 232,38 C240,42 248,48 258,52 C268,55 278,62 288,72 C295,80 300,90 305,102 C310,115 312,128 310,140 C308,148 305,158 298,168 C292,178 284,186 275,195 C268,202 260,210 252,218 C248,222 242,228 238,232 C235,234 232,238 228,238 C225,236 222,232 220,228 C218,224 215,220 212,218 C208,215 204,218 200,222 C196,226 192,230 188,228 C182,224 176,218 168,210 C158,198 146,186 135,175 C122,162 110,150 100,138 C92,128 85,118 78,106 C72,96 66,86 60,78 C55,72 48,68 42,72 Z" />
            {/* Greenland */}
            <path d="M310,22 C325,18 342,16 358,20 C370,24 380,32 386,44 C390,55 385,68 376,76 C368,82 356,84 344,82 C332,80 322,74 314,66 C308,58 304,48 304,38 C304,30 306,24 310,22 Z" />
            {/* Central America */}
            <path d="M228,238 C232,242 236,248 238,255 C240,262 240,268 238,272 C236,276 232,278 228,276 C224,274 220,268 218,262 C216,255 216,248 218,242 C220,238 224,236 228,238 Z" />
            {/* South America */}
            <path d="M240,278 C248,274 258,272 268,272 C280,274 290,280 298,290 C306,300 312,314 316,330 C320,348 320,366 316,382 C312,396 305,408 295,418 C285,426 272,430 260,432 C248,432 238,428 230,420 C222,410 218,398 216,384 C214,368 214,352 216,336 C218,320 222,306 228,294 C232,286 236,280 240,278 Z" />
            {/* UK */}
            <path d="M440,88 C444,84 450,82 454,86 C458,90 458,98 456,106 C454,112 450,116 446,118 C442,118 438,114 436,108 C434,100 436,92 440,88 Z" />
            {/* Ireland */}
            <path d="M430,96 C434,92 438,94 438,100 C438,106 436,110 432,110 C428,108 428,100 430,96 Z" />
            {/* Iceland */}
            <path d="M404,62 C410,58 418,58 422,62 C426,66 426,72 422,76 C418,78 410,78 406,74 C402,70 402,64 404,62 Z" />
            {/* Scandinavia + Finland */}
            <path d="M478,52 C484,42 494,36 504,38 C512,40 518,46 522,56 C525,66 526,78 524,90 C522,100 516,108 508,112 C500,114 492,110 486,102 C480,92 476,80 474,68 C474,60 476,55 478,52 Z" />
            {/* Western + Central Europe */}
            <path d="M442,118 C450,112 462,108 476,108 C490,108 504,112 518,118 C530,124 540,132 548,142 C554,152 556,162 554,170 C550,178 542,184 532,188 C520,192 506,192 492,190 C478,188 466,184 456,178 C448,172 442,164 438,154 C436,144 436,134 438,126 C440,122 440,120 442,118 Z" />
            {/* Iberian Peninsula */}
            <path d="M424,152 C432,146 442,144 450,148 C456,152 460,160 460,170 C458,178 454,186 446,190 C438,192 430,188 424,182 C420,176 418,168 418,160 C420,155 422,152 424,152 Z" />
            {/* Italy + Sicily + Sardinia */}
            <path d="M492,162 C496,158 500,160 504,166 C508,174 512,184 514,194 C515,202 514,208 510,210 C506,210 502,206 498,198 C494,190 492,180 490,172 C490,166 490,162 492,162 Z" />
            <path d="M500,212 C504,208 510,210 510,216 C510,220 506,224 502,222 C498,220 498,214 500,212 Z" />
            {/* Greece */}
            <path d="M518,178 C522,174 528,176 530,182 C532,188 530,196 526,200 C522,202 518,198 516,192 C514,186 516,180 518,178 Z" />
            {/* Russia + Central Asia */}
            <path d="M558,50 C580,42 608,38 638,38 C668,40 698,44 728,50 C755,56 778,62 798,68 C818,74 834,80 846,86 C852,92 852,100 846,106 C838,112 826,118 810,122 C792,126 772,130 750,132 C728,134 706,136 684,138 C664,140 644,142 626,144 C610,146 596,146 584,144 C572,142 564,136 558,128 C554,118 554,106 556,94 C558,82 558,68 558,56 Z" />
            {/* Turkey */}
            <path d="M536,168 C544,162 556,160 570,162 C582,164 592,170 598,178 C602,186 600,194 594,198 C586,202 576,202 566,200 C556,198 548,194 542,188 C538,182 536,176 536,170 Z" />
            {/* Middle East — Iraq, Syria, Iran */}
            <path d="M582,198 C594,192 608,190 622,194 C634,198 642,208 646,220 C648,232 644,244 636,252 C628,258 618,260 606,258 C594,256 584,250 576,240 C570,230 568,218 572,208 C574,202 578,198 582,198 Z" />
            {/* Arabian Peninsula */}
            <path d="M576,252 C586,246 598,244 612,248 C624,252 632,260 636,272 C638,282 634,292 626,298 C618,302 608,302 598,298 C588,294 580,286 576,276 C572,266 572,256 576,252 Z" />
            {/* North Africa — Morocco to Egypt */}
            <path d="M420,198 C438,192 462,190 488,192 C512,194 534,198 550,206 C558,212 560,220 556,228 C550,236 540,242 526,246 C510,250 492,252 474,252 C456,252 440,248 428,242 C420,236 416,228 416,218 C416,210 418,202 420,198 Z" />
            {/* Sub-Saharan Africa */}
            <path d="M454,252 C472,250 492,250 512,254 C530,258 546,266 558,278 C568,290 574,306 576,324 C578,342 574,362 566,380 C558,396 546,408 532,416 C518,422 502,424 486,420 C472,416 460,406 452,394 C444,380 440,364 438,346 C436,328 438,310 442,294 C446,278 450,264 454,252 Z" />
            {/* Madagascar */}
            <path d="M572,362 C576,356 582,358 584,366 C586,374 584,384 580,390 C576,394 572,390 570,382 C568,374 570,366 572,362 Z" />
            {/* India */}
            <path d="M638,192 C650,186 664,184 678,190 C690,196 698,208 702,224 C704,240 700,258 692,274 C684,288 672,298 658,302 C646,304 636,298 630,288 C624,276 622,262 622,246 C622,230 626,216 632,204 C634,198 636,194 638,192 Z" />
            {/* Sri Lanka */}
            <path d="M666,304 C670,300 676,302 678,308 C678,314 676,320 672,322 C668,322 664,318 664,312 C664,308 664,304 666,304 Z" />
            {/* Southeast Asia mainland */}
            <path d="M698,188 C708,182 720,180 732,184 C742,188 750,198 754,212 C756,226 754,242 748,256 C742,268 732,276 720,278 C708,278 698,272 692,262 C686,250 684,236 686,222 C688,208 692,196 698,188 Z" />
            {/* China + Mongolia */}
            <path d="M698,102 C716,96 738,94 760,98 C780,102 798,112 810,126 C820,140 824,158 822,176 C818,192 808,206 794,214 C780,220 764,222 748,220 C732,218 718,210 708,200 C698,188 694,174 694,158 C694,142 694,126 696,112 C696,106 698,104 698,102 Z" />
            {/* Korean Peninsula */}
            <path d="M790,145 C794,140 800,142 802,148 C804,156 802,166 798,172 C794,176 790,172 788,166 C786,158 788,148 790,145 Z" />
            {/* Japan — Honshu + Hokkaido */}
            <path d="M810,118 C816,112 822,114 826,122 C830,132 830,144 828,156 C826,166 822,176 816,182 C810,186 806,182 804,174 C802,164 802,152 804,140 C806,130 808,122 810,118 Z" />
            {/* Taiwan */}
            <path d="M788,210 C792,206 796,208 796,214 C796,220 794,226 790,228 C786,228 784,224 784,218 C784,214 786,210 788,210 Z" />
            {/* Philippines */}
            <path d="M786,232 C790,226 796,228 798,236 C800,244 798,254 794,260 C790,264 786,260 784,252 C782,244 784,236 786,232 Z" />
            {/* Indonesia — Sumatra, Java, Borneo, Sulawesi, Papua */}
            <path d="M706,278 C718,274 732,272 748,274 C762,276 774,282 784,290 C792,298 796,306 794,312 C790,316 782,318 772,318 C760,316 748,312 736,308 C724,304 714,298 708,290 C704,284 704,280 706,278 Z" />
            {/* Borneo */}
            <path d="M752,260 C760,256 768,258 772,266 C774,274 772,282 766,286 C760,288 754,284 750,276 C748,268 748,262 752,260 Z" />
            {/* Papua New Guinea */}
            <path d="M808,300 C816,296 824,298 828,306 C830,314 828,322 822,326 C816,328 810,324 806,316 C804,308 804,302 808,300 Z" />
            {/* Australia */}
            <path d="M748,342 C768,334 792,330 818,332 C840,334 858,342 868,356 C876,370 878,386 872,402 C866,416 854,426 838,432 C822,436 804,436 786,432 C770,428 756,420 746,408 C738,396 734,382 736,368 C738,354 742,346 748,342 Z" />
            {/* Tasmania */}
            <path d="M842,438 C848,434 854,436 856,442 C856,448 852,452 846,452 C840,450 838,444 842,438 Z" />
            {/* New Zealand */}
            <path d="M882,404 C888,398 894,400 896,408 C898,416 896,426 892,434 C888,440 882,440 880,434 C878,426 878,416 880,408 Z" />
          </g>

          {/* Grid lines */}
          <g stroke="#4338ca" strokeWidth="0.2" opacity="0.2">
            <line x1="0" y1="240" x2="960" y2="240" strokeDasharray="4 8" />
            <line x1="480" y1="0" x2="480" y2="480" strokeDasharray="4 8" />
            {[120, 240, 360, 480, 600, 720, 840].map(x => <line key={`v${x}`} x1={x} y1="0" x2={x} y2="480" strokeDasharray="1 10" />)}
            {[96, 192, 288, 384].map(y => <line key={`h${y}`} x1="0" y1={y} x2="960" y2={y} strokeDasharray="1 10" />)}
          </g>

          {/* Connection lines between active regions */}
          {CONNECTION_LINES.map(({ from, to }, i) => {
            const fSev = regionSeverities[from]
            const tSev = regionSeverities[to]
            if (!fSev && !tSev) return null
            const fR = MAP_REGIONS.find(r => r.id === from)
            const tR = MAP_REGIONS.find(r => r.id === to)
            if (!fR || !tR) return null
            const mx = (fR.cx + tR.cx) / 2
            const my = Math.min(fR.cy, tR.cy) - 25
            return (
              <path key={i} d={`M${fR.cx},${fR.cy} Q${mx},${my} ${tR.cx},${tR.cy}`}
                fill="none" stroke="url(#line-grad)" strokeWidth="1.2" strokeDasharray="4 6" opacity="0.5" />
            )
          })}

          {/* Chokepoint markers (diamonds with labels) */}
          {CHOKEPOINTS.map(cp => (
            <g key={cp.id}>
              <circle cx={cp.cx} cy={cp.cy} r="4" fill="none" stroke="#818cf8" strokeWidth="0.8" className="pulse-sm" opacity="0.4" />
              <polygon
                points={`${cp.cx},${cp.cy - 6} ${cp.cx + 4.5},${cp.cy} ${cp.cx},${cp.cy + 6} ${cp.cx - 4.5},${cp.cy}`}
                fill="#818cf8" fillOpacity="0.8" stroke="#a5b4fc" strokeWidth="0.8"
              />
              <text x={cp.cx} y={cp.cy - 10} textAnchor="middle" fill="#a5b4fc" fontSize="8" fontFamily="system-ui" opacity="0.7">
                {cp.label}
              </text>
            </g>
          ))}

          {/* Region hotspot markers */}
          {MAP_REGIONS.map(r => {
            const sev = regionSeverities[r.id]
            if (!sev) return null
            const colors = SEV_COLORS[sev]
            const isSelected = selectedRegion === r.id
            return (
              <g key={r.id} onClick={() => setSelectedRegion(selectedRegion === r.id ? null : r.id)} style={{ cursor: 'pointer' }}>
                <circle cx={r.cx} cy={r.cy} r="10" fill="none" stroke={colors.fill} strokeWidth="2" className="pulse-anim" opacity="0.6" />
                <circle cx={r.cx} cy={r.cy} r="22" fill={`url(#glow-${sev})`} />
                <circle cx={r.cx} cy={r.cy} r={isSelected ? 9 : 7} fill={colors.fill} stroke={isSelected ? '#fff' : colors.glow} strokeWidth={isSelected ? 2 : 1.2} filter="url(#map-glow)" />
                <text x={r.cx} y={r.cy - 16} textAnchor="middle" fill="#e2e8f0" fontSize="10" fontWeight="600" fontFamily="system-ui" opacity="0.9">
                  {r.label}
                </text>
              </g>
            )
          })}
        </svg>

        {/* Legend */}
        <div className="flex items-center justify-center gap-4 px-4 mt-1">
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-red-500" /><span className="text-[9px] text-slate-400">Critical</span></div>
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber-500" /><span className="text-[9px] text-slate-400">Elevated</span></div>
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-indigo-500" /><span className="text-[9px] text-slate-400">Watch</span></div>
          <div className="flex items-center gap-1.5"><span className="w-2 h-2 rotate-45 bg-indigo-400" /><span className="text-[9px] text-slate-400">Chokepoint</span></div>
        </div>
      </div>

      {/* Critical regions — always visible */}
      {(() => {
        const criticalRegionIds = Object.entries(regionSeverities)
          .filter(([, sev]) => sev === 'critical')
          .map(([id]) => id)
        const criticalThemes = criticalRegionIds.flatMap(rid =>
          themes.filter(t => matchThemeToRegion(t) === rid).map(t => ({ ...t, _regionId: rid }))
        )
        if (criticalThemes.length === 0) return null
        const grouped = {}
        for (const t of criticalThemes) {
          if (!grouped[t._regionId]) grouped[t._regionId] = []
          grouped[t._regionId].push(t)
        }
        return Object.entries(grouped).map(([rid, rThemes]) => {
          const label = MAP_REGIONS.find(r => r.id === rid)?.label
          return (
            <div key={rid} className="rounded-lg border border-red-900/40 bg-red-950/20 px-3 py-2 mb-2">
              <div className="flex items-center gap-2 mb-1">
                <span className="w-2 h-2 rounded-full bg-red-500" />
                <p className="text-[11px] font-semibold text-red-300">{label}</p>
                <span className="text-[9px] text-red-400/60 uppercase tracking-wider">Critical</span>
              </div>
              {rThemes.map((t, i) => (
                <div key={i} className="mb-1.5 last:mb-0">
                  <p className="text-[11px] text-slate-300 leading-relaxed">{t.situation}</p>
                  {t.sources_confirmed?.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1 mt-1">
                      <span className="text-[8px] text-slate-600">Sources:</span>
                      {t.sources_confirmed.slice(0, 4).map((s, j) => (
                        <span key={j} className="px-1 py-0.5 rounded text-[8px] bg-slate-800/60 border border-slate-700/40 text-slate-500">{displaySource(s)}</span>
                      ))}
                      {t.sources_confirmed.length > 4 && <span className="text-[8px] text-slate-600">+{t.sources_confirmed.length - 4}</span>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )
        })
      })()}

      {/* Selected non-critical region detail */}
      {selectedRegion && regionSeverities[selectedRegion] !== 'critical' && (() => {
        const selThemes = themes.filter(t => matchThemeToRegion(t) === selectedRegion)
        if (selThemes.length === 0) return null
        const borderColor = regionSeverities[selectedRegion] === 'elevated' ? 'border-amber-800/40 bg-amber-950/20' : 'border-indigo-800/40 bg-indigo-950/30'
        return (
          <div className={`rounded-lg border ${borderColor} px-3 py-2 mb-2`}>
            <div className="flex items-center justify-between mb-1">
              <p className="text-[11px] font-semibold text-slate-300">{MAP_REGIONS.find(r => r.id === selectedRegion)?.label}</p>
              <button onClick={() => setSelectedRegion(null)} className="text-[9px] text-slate-600 hover:text-slate-400">✕</button>
            </div>
            {selThemes.map((t, i) => (
              <div key={i} className="mb-1.5 last:mb-0">
                <p className="text-[11px] text-slate-300 leading-relaxed">{t.situation}</p>
                {t.sources_confirmed?.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1 mt-1">
                    <span className="text-[8px] text-slate-600">Sources:</span>
                    {t.sources_confirmed.slice(0, 4).map((s, j) => (
                      <span key={j} className="px-1 py-0.5 rounded text-[8px] bg-slate-800/60 border border-slate-700/40 text-slate-500">{displaySource(s)}</span>
                    ))}
                    {t.sources_confirmed.length > 4 && <span className="text-[8px] text-slate-600">+{t.sources_confirmed.length - 4}</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      })()}

      {/* Non-critical themes list (clickable to expand) */}
      {themes.length > 0 && (() => {
        const nonCritical = themes.filter(t => {
          const rid = matchThemeToRegion(t)
          return regionSeverities[rid] !== 'critical' && rid !== selectedRegion
        })
        if (nonCritical.length === 0) return null
        return (
          <div className="space-y-1.5">
            {nonCritical.map((t, i) => {
              const regionId = matchThemeToRegion(t)
              const sev = regionSeverities[regionId]
              const colors = sev ? SEV_COLORS[sev] : SEV_COLORS.watch
              return (
                <div key={i} className="flex items-start gap-2 cursor-pointer hover:bg-slate-800/20 rounded px-1 py-0.5 -mx-1"
                  onClick={() => setSelectedRegion(regionId)}>
                  <span className="w-1.5 h-1.5 rounded-full mt-1 flex-shrink-0" style={{ backgroundColor: colors.fill }} />
                  <div className="min-w-0">
                    <span className="text-[10px] font-semibold text-slate-400">{t.region}</span>
                    <p className="text-[10px] text-slate-500 line-clamp-1">{t.situation}</p>
                  </div>
                </div>
              )
            })}
          </div>
        )
      })()}

      {latestRun && (
        <p className="text-[9px] text-slate-600 mt-2">
          Based on {latestRun.run_type} · {fmtAgo(latestRun.evaluated_at)}
        </p>
      )}
    </div>
  )
}

/* ── Trajectory Layer (7/14/30-day trend per theme) ── */


function confColor(conf) {
  if (conf >= 80) return { bar: '#ef4444', text: 'text-red-400', bg: 'bg-red-500' }
  if (conf >= 60) return { bar: '#f59e0b', text: 'text-amber-400', bg: 'bg-amber-500' }
  if (conf >= 40) return { bar: '#3b82f6', text: 'text-blue-400', bg: 'bg-blue-500' }
  return { bar: '#64748b', text: 'text-slate-400', bg: 'bg-slate-500' }
}

function ConfidenceBarChart({ runs, onSelectRun, selectedIdx }) {
  if (!runs || runs.length === 0) return null
  const barW = Math.max(4, Math.min(12, Math.floor(320 / runs.length)))
  const gap = Math.max(1, Math.min(3, Math.floor(barW / 4)))
  const chartW = runs.length * (barW + gap)
  const chartH = 80

  return (
    <div className="overflow-x-auto">
      <svg width={Math.max(chartW, 200)} height={chartH + 16} viewBox={`0 0 ${Math.max(chartW, 200)} ${chartH + 16}`} className="block">
        {/* gridlines */}
        {[25, 50, 75, 100].map(v => (
          <g key={v}>
            <line x1="0" y1={chartH - (v / 100) * chartH} x2={chartW} y2={chartH - (v / 100) * chartH} stroke="#334155" strokeWidth="0.5" strokeDasharray="2,3" />
            <text x={chartW + 2} y={chartH - (v / 100) * chartH + 3} fill="#475569" fontSize="7">{v}</text>
          </g>
        ))}
        {runs.map((r, i) => {
          const conf = r.confidence ?? 0
          const h = (conf / 100) * chartH
          const x = i * (barW + gap)
          const color = confColor(conf)
          const isSelected = selectedIdx === i
          return (
            <g key={i} onClick={() => onSelectRun(i)} style={{ cursor: 'pointer' }}>
              <rect x={x} y={chartH - h} width={barW} height={h} fill={color.bar} rx="1"
                opacity={isSelected ? 1 : 0.7} stroke={isSelected ? '#e2e8f0' : 'none'} strokeWidth={isSelected ? 1 : 0} />
              {r.flagged && <circle cx={x + barW / 2} cy={chartH - h - 4} r="2" fill="#ef4444" />}
            </g>
          )
        })}
        <line x1="0" y1={chartH} x2={chartW} y2={chartH} stroke="#475569" strokeWidth="0.5" />
      </svg>
    </div>
  )
}

function ReasoningEntry({ entry, prevEntry }) {
  const [expanded, setExpanded] = useState(false)
  const color = confColor(entry.confidence ?? 0)
  const dateStr = new Date(entry.evaluated_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  const delta = prevEntry && entry.confidence != null && prevEntry.confidence != null
    ? entry.confidence - prevEntry.confidence : null

  return (
    <div className={`border-l-2 pl-3 py-2 ${entry.flagged ? 'border-red-800/60' : 'border-slate-800/40'}`}>
      <div className="flex items-center gap-2 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <span className={`text-[9px] font-mono ${color.text}`}>{entry.confidence ?? '—'}</span>
        {delta != null && delta !== 0 && (
          <span className={`text-[9px] font-mono ${delta > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
            {delta > 0 ? `+${delta}` : delta}
          </span>
        )}
        <span className={`w-1.5 h-1.5 rounded-full ${entry.flagged ? 'bg-red-500' : 'bg-slate-600'}`} />
        <span className="text-[10px] text-slate-400 flex-1 truncate">
          {entry.risk_category || 'no flag'}
        </span>
        <span className="text-[9px] text-slate-600">{dateStr}</span>
        <ChevronDown className={`w-3 h-3 text-slate-600 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </div>

      {entry.bottom_line && !expanded && (
        <p className="text-[10px] text-slate-500 mt-0.5 line-clamp-1">{entry.bottom_line}</p>
      )}

      {expanded && (
        <div className="mt-2 space-y-1.5">
          {entry.bottom_line && (
            <p className="text-[11px] text-slate-300 font-medium">{entry.bottom_line}</p>
          )}
          {entry.reasoning && (
            <div>
              <p className="text-[9px] text-slate-600 uppercase tracking-wider mb-0.5">Reasoning</p>
              <p className="text-[10px] text-slate-400 leading-relaxed">{entry.reasoning}</p>
            </div>
          )}
          {entry.categories_considered?.length > 0 && (
            <div>
              <p className="text-[9px] text-slate-600 uppercase tracking-wider mb-0.5">Categories assessed</p>
              <div className="flex flex-wrap gap-1">
                {entry.categories_considered.map((c, i) => (
                  <span key={i} className="text-[9px] bg-slate-800/60 text-slate-400 px-1.5 py-0.5 rounded">{c}</span>
                ))}
              </div>
            </div>
          )}
          {entry.dismissed && Object.keys(entry.dismissed).length > 0 && (
            <div>
              <p className="text-[9px] text-slate-600 uppercase tracking-wider mb-0.5">Dismissed (why not flagged)</p>
              <div className="space-y-0.5">
                {Object.entries(entry.dismissed).map(([cat, reason]) => (
                  <p key={cat} className="text-[9px] text-slate-500"><span className="text-slate-400">{cat}:</span> {reason}</p>
                ))}
              </div>
            </div>
          )}
          {entry.relevant_signals?.length > 0 && (
            <div>
              <p className="text-[9px] text-slate-600 uppercase tracking-wider mb-0.5">Key signals</p>
              <div className="flex flex-wrap gap-1">
                {entry.relevant_signals.slice(0, 8).map((s, i) => (
                  <span key={i} className="text-[9px] bg-slate-800/60 text-slate-400 px-1.5 py-0.5 rounded">{displaySource(s)}</span>
                ))}
                {entry.relevant_signals.length > 8 && (
                  <span className="text-[9px] text-slate-600">+{entry.relevant_signals.length - 8} more</span>
                )}
              </div>
            </div>
          )}
          <div className="flex gap-2 text-[9px] text-slate-600">
            <span>{entry.run_type}</span>
          </div>
        </div>
      )}
    </div>
  )
}

function TrajectoryLayer({ trajectory, reasoningTimeline }) {
  const [windowDays, setWindowDays] = useState(7)
  const [selectedBar, setSelectedBar] = useState(null)

  if (!trajectory || trajectory.length === 0) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/30 px-4 py-3">
        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Assessment History</p>
        <p className="text-[11px] text-slate-600 italic">Assessment data will appear once enough runs have accumulated.</p>
      </div>
    )
  }

  const cutoff = Date.now() - windowDays * 86400000
  const windowRuns = trajectory
    .filter(r => new Date(r.evaluated_at).getTime() >= cutoff && r.run_type !== 'gated-skip')
    .sort((a, b) => new Date(a.evaluated_at) - new Date(b.evaluated_at))

  const flaggedCount = windowRuns.filter(r => r.flagged).length

  const windowReasoningRuns = (reasoningTimeline ?? [])
    .filter(r => new Date(r.evaluated_at).getTime() >= cutoff)
    .sort((a, b) => new Date(b.evaluated_at) - new Date(a.evaluated_at))

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/30 px-4 py-3">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Assessment History</p>
          <p className="text-[9px] text-slate-600 mt-0.5">
            {windowRuns.length} assessments · {flaggedCount} flagged · confidence bars (click for detail)
          </p>
        </div>
        <div className="flex gap-1">
          {[7, 14, 30].map(d => (
            <button
              key={d}
              onClick={() => { setWindowDays(d); setSelectedBar(null) }}
              className={`px-2 py-0.5 rounded text-[10px] font-semibold border transition-colors ${
                windowDays === d
                  ? 'text-violet-300 bg-violet-950/40 border-violet-800/60'
                  : 'text-slate-500 bg-slate-900/40 border-slate-800 hover:text-slate-300'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      <ConfidenceBarChart
        runs={windowRuns}
        selectedIdx={selectedBar}
        onSelectRun={i => setSelectedBar(selectedBar === i ? null : i)}
      />

      {selectedBar != null && windowRuns[selectedBar] && (() => {
        const r = windowRuns[selectedBar]
        const match = windowReasoningRuns.find(rr => rr.evaluated_at === r.evaluated_at)
        if (!match) return (
          <div className="mt-2 p-2 rounded bg-slate-900/60 border border-slate-800/40">
            <p className="text-[10px] text-slate-500">
              {new Date(r.evaluated_at).toLocaleString()} · confidence {r.confidence} · {r.flagged ? r.risk_category : 'not flagged'}
            </p>
            <p className="text-[9px] text-slate-600 italic mt-0.5">Detailed reasoning not available for this run (outside the 20 most recent assessed runs).</p>
          </div>
        )
        return (
          <div className="mt-2 p-2 rounded bg-slate-900/60 border border-slate-800/40">
            <ReasoningEntry entry={match} />
          </div>
        )
      })()}

      <div className="mt-3">
        <p className="text-[9px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Recent Assessments</p>
        <div className="space-y-0.5 max-h-[300px] overflow-y-auto">
          {windowReasoningRuns.slice(0, 10).map((entry, i, arr) => (
            <ReasoningEntry key={entry.evaluated_at + i} entry={entry} prevEntry={arr[i + 1] ?? null} />
          ))}
          {windowReasoningRuns.length === 0 && (
            <p className="text-[9px] text-slate-600 italic">No assessed runs in this window.</p>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── Market Pricing (unchanged) ── */

function MarketPricing({ marketPricing }) {
  if (!marketPricing) return null
  const items = [
    { key: 'wti', ...marketPricing.wti, theme: 'Hormuz / oil shock' },
    { key: 'brent', ...marketPricing.brent, theme: 'Hormuz / oil shock' },
    { key: 'natGas', ...marketPricing.natGas, theme: 'Energy supply' },
    { key: 'gold', ...marketPricing.gold, theme: 'Safe haven / geo stress' },
    { key: 'copper', ...marketPricing.copper, theme: 'Taiwan / China demand' },
  ].filter(i => i.value != null)

  if (items.length === 0) return null

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/30 px-3 py-2">
      <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
        Market Pricing <span className="normal-case font-normal text-slate-600">(independent — not used in geo scoring)</span>
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        {items.map(i => (
          <div key={i.key} className="rounded-lg border border-slate-800 bg-slate-950/40 px-2.5 py-1.5">
            <p className="text-[9px] text-slate-500 uppercase tracking-wider">{i.label}</p>
            <p className="text-sm font-semibold tabular-nums text-slate-300">
              {typeof i.value === 'number' ? i.value.toFixed(2) : i.value}
            </p>
            <p className="text-[8px] text-slate-600">{i.theme}</p>
          </div>
        ))}
      </div>
      <p className="text-[9px] text-slate-600 mt-1.5">
        Compare against geo severity — these values do not influence the risk assessment.
      </p>
    </div>
  )
}

/* ── Polymarket Prediction Markets ── */

const THEME_LABELS = {
  oil_energy: 'Oil / Energy', carry_unwind: 'Carry Unwind',
  equity_drawdown: 'Equity / Drawdown', safe_haven: 'Safe Haven', freight_shock: 'Freight / Shipping',
}

function probColor(p) {
  if (p >= 0.5) return 'text-red-400'
  if (p >= 0.2) return 'text-amber-400'
  return 'text-slate-400'
}

function PolymarketLayer({ polymarket }) {
  if (!polymarket || polymarket.length === 0) return null

  const byTheme = {}
  for (const m of polymarket) {
    if (m.closed) continue
    if (!byTheme[m.theme]) byTheme[m.theme] = []
    byTheme[m.theme].push(m)
  }

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/30 px-3 py-2">
      <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
        Prediction Markets <span className="normal-case font-normal text-slate-600">(Polymarket — crowd implied probabilities)</span>
      </p>
      <div className="space-y-2">
        {Object.entries(byTheme).map(([theme, markets]) => (
          <div key={theme}>
            <p className="text-[9px] text-slate-600 uppercase tracking-wider mb-1">{THEME_LABELS[theme] || theme}</p>
            <div className="space-y-1">
              {markets.map(m => (
                <div key={m.slug} className="flex items-center gap-2 rounded-lg border border-slate-800/60 bg-slate-950/40 px-2.5 py-1.5">
                  <span className={`text-sm font-bold tabular-nums ${probColor(m.yesPrice)} min-w-[3rem]`}>
                    {m.yesPrice != null ? `${(m.yesPrice * 100).toFixed(0)}%` : '—'}
                  </span>
                  <span className="text-[10px] text-slate-400 flex-1">{m.question || m.label}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="text-[9px] text-slate-600 mt-1.5">
        Implied probabilities from Polymarket CLOB — compare with geo trajectory for convergence/divergence.
      </p>
    </div>
  )
}

/* ── Headlines (server-side GDELT, fetched by aggregator cron) ── */

function shortDomain(domain) {
  return (domain ?? '').replace(/^www\./, '').split('.').slice(0, -1).join('.') || domain
}

function gdeltTime(seendate) {
  if (!seendate) return ''
  const d = new Date(seendate.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z'))
  const ms = Date.now() - d.getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return `${Math.floor(hrs / 24)}d`
}

const IMPORTANCE_STYLE = {
  high: 'text-red-400 bg-red-950/40 border-red-900/40',
  medium: 'text-amber-400 bg-amber-950/30 border-amber-900/30',
  low: 'text-slate-400 bg-slate-800/40 border-slate-700/40',
}

function Headlines({ headlineData }) {
  const [expandedGroup, setExpandedGroup] = useState(null)
  const articles = headlineData?.articles ?? []
  const analysis = headlineData?.analysis
  const groups = analysis?.groups ?? []
  const fetchedAt = headlineData?.fetchedAt

  if (articles.length === 0) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/30 px-3 py-2">
        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
          Headlines <span className="normal-case font-normal text-slate-600">(GDELT · server-fetched)</span>
        </p>
        <p className="text-[10px] text-slate-600 italic">Headlines will appear after the next aggregator run.</p>
      </div>
    )
  }

  if (groups.length > 0) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/30 px-3 py-2">
        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
          Headlines <span className="normal-case font-normal text-slate-600">({articles.length} sources · GDELT)</span>
        </p>
        <div className="space-y-1.5">
          {groups.map((g, gi) => {
            const isExpanded = expandedGroup === gi
            const groupArticles = (g.headline_indices ?? []).map(i => articles[i]).filter(Boolean)
            return (
              <div key={gi} className="rounded-lg border border-slate-800/60 bg-slate-950/30">
                <button
                  onClick={() => setExpandedGroup(isExpanded ? null : gi)}
                  className="w-full px-2.5 py-1.5 flex items-start gap-2 text-left hover:bg-slate-800/20 transition-colors rounded-lg"
                >
                  <ChevronDown
                    size={10}
                    className="text-slate-600 shrink-0 mt-0.5"
                    style={{ transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.15s' }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="text-[11px] font-semibold text-slate-300">{g.theme}</span>
                      <span className={`px-1 py-0.5 rounded text-[9px] border ${IMPORTANCE_STYLE[g.importance] ?? IMPORTANCE_STYLE.low}`}>
                        {g.importance}
                      </span>
                      {g.converging && (
                        <span className="px-1 py-0.5 rounded text-[9px] bg-indigo-950/40 border border-indigo-800/40 text-indigo-300">
                          converging
                        </span>
                      )}
                      <span className="text-[9px] text-slate-600 ml-auto shrink-0">{groupArticles.length} source{groupArticles.length !== 1 ? 's' : ''}</span>
                    </div>
                    <p className="text-[10px] text-slate-500 leading-relaxed">{g.context}</p>
                  </div>
                </button>
                {isExpanded && groupArticles.length > 0 && (
                  <div className="px-2.5 pb-2 border-t border-slate-800/40 space-y-0.5 pt-1">
                    {groupArticles.map((a, ai) => (
                      <div key={ai} className="flex items-baseline gap-1.5 text-[10px] leading-tight py-0.5">
                        <span className="text-slate-600 shrink-0 tabular-nums w-5 text-right">{gdeltTime(a.seendate)}</span>
                        <span className="text-slate-500 shrink-0 truncate max-w-[70px]">{shortDomain(a.domain)}</span>
                        <a href={a.url} target="_blank" rel="noopener noreferrer"
                           className="text-slate-400 hover:text-slate-200 truncate transition-colors">
                          {a.title}
                        </a>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
        {fetchedAt && (
          <p className="text-[9px] text-slate-600 mt-1.5">Fetched {fmtAgo(fetchedAt)}</p>
        )}
      </div>
    )
  }

  // Fallback: raw headlines if no analysis yet
  const [showAll, setShowAll] = useState(false)
  const visible = showAll ? articles.slice(0, 15) : articles.slice(0, 5)
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/30 px-3 py-2">
      <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
        Headlines <span className="normal-case font-normal text-slate-600">({articles.length} sources · GDELT)</span>
      </p>
      <div className="space-y-0.5">
        {visible.map((a, i) => (
          <div key={i} className="flex items-baseline gap-1.5 text-[11px] leading-tight py-0.5">
            <span className="text-slate-600 shrink-0 tabular-nums w-6 text-right">{gdeltTime(a.seendate)}</span>
            <span className="text-slate-500 shrink-0 truncate max-w-[80px]">{shortDomain(a.domain)}</span>
            <a href={a.url} target="_blank" rel="noopener noreferrer"
               className="text-slate-300 hover:text-slate-100 truncate transition-colors">
              {a.title}
            </a>
          </div>
        ))}
      </div>
      {articles.length > 5 && (
        <button onClick={() => setShowAll(v => !v)}
                className="text-[10px] text-slate-600 hover:text-slate-400 mt-1 transition-colors">
          {showAll ? 'show fewer' : `+${articles.length - 5} more`}
        </button>
      )}
      {fetchedAt && (
        <p className="text-[9px] text-slate-600 mt-1">Fetched {fmtAgo(fetchedAt)}</p>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   DIAGNOSTICS VIEW — all former default content, collapsed
   ═══════════════════════════════════════════════════════════════════════ */

function deriveRegime(signals) {
  const buckets = {}
  let escalating = 0
  for (const s of signals) {
    if (s.implication && s.implication !== 'none') {
      const key = s.implication
      buckets[key] = Math.max(buckets[key] ?? 0, s.severity ?? 0)
    }
    if (s.state === 'escalating') escalating++
  }
  return { buckets, escalating }
}

function RegimeSummary({ allSignals, latestRun }) {
  if (!allSignals?.length) return null
  const { buckets, escalating } = deriveRegime(allSignals)
  const implications = [
    { key: 'oil_shock_risk', label: 'Oil Shock' },
    { key: 'carry_unwind', label: 'Carry Unwind' },
    { key: 'equity_drawdown_severity', label: 'Equity Drawdown' },
    { key: 'safe_haven_bid', label: 'Safe Haven' },
    { key: 'freight_cost_shock', label: 'Freight Shock' },
  ].map(i => ({ ...i, value: buckets[i.key] ?? 0 })).filter(i => i.value > 0)

  const maxSeverity = Math.max(...implications.map(i => i.value ?? 0), 0)
  const summaryColor = maxSeverity >= 60 ? 'border-red-900/40 bg-red-950/15'
    : maxSeverity >= 30 ? 'border-amber-900/30 bg-amber-950/10'
    : 'border-slate-800 bg-slate-900/30'

  return (
    <div className={`rounded-xl border ${summaryColor} px-4 py-3`}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Regime Summary</p>
        {escalating > 0 && (
          <span className="text-[10px] text-red-400">{escalating} escalating</span>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {implications.map(i => (
          <div key={i.key} className={`rounded-lg border px-2.5 py-1.5 ${severityBg(i.value)}`}>
            <p className="text-[9px] text-slate-500 uppercase tracking-wider">{i.label}</p>
            <p className={`text-lg font-semibold tabular-nums ${severityColor(i.value)}`}>{i.value}</p>
          </div>
        ))}
      </div>
      {latestRun && (
        <p className="text-[9px] text-slate-600 mt-2">
          Last assessed {fmtAgo(latestRun.evaluated_at)} · {latestRun.run_type}
          {latestRun.flagged && ` · flagged: ${latestRun.risk_category}`}
        </p>
      )}
    </div>
  )
}

const STALENESS_THRESHOLD_DAYS = 14
const CHOKEPOINT_NAMES = {
  hormuz_strait: 'Hormuz',
  bab_el_mandeb: 'Bab el-Mandeb',
  suez: 'Suez',
  taiwan_strait: 'Taiwan Strait',
}
const TIER_SHORT = {
  WAR_RISK_TIER_WAR_ZONE: 'War Zone',
  WAR_RISK_TIER_CRITICAL: 'Critical',
  WAR_RISK_TIER_HIGH: 'High',
  WAR_RISK_TIER_ELEVATED: 'Elevated',
  WAR_RISK_TIER_NORMAL: 'Normal',
}

function TierStaleness({ tierTracking }) {
  if (!tierTracking) return null
  const now = Date.now()
  const stale = Object.entries(tierTracking)
    .map(([id, t]) => ({
      id,
      name: CHOKEPOINT_NAMES[id] ?? id,
      tier: TIER_SHORT[t.tier] ?? t.tier,
      daysStale: Math.floor((now - new Date(t.last_changed_at).getTime()) / 86400000),
    }))
    .filter(t => t.daysStale >= STALENESS_THRESHOLD_DAYS)
    .sort((a, b) => b.daysStale - a.daysStale)

  if (stale.length === 0) return null

  return (
    <div className="rounded-lg border border-amber-900/40 bg-amber-950/15 px-3 py-2">
      <p className="text-[10px] font-semibold text-amber-500 uppercase tracking-wider mb-1.5">
        Stale Risk Tiers
      </p>
      <div className="space-y-1">
        {stale.map(s => (
          <div key={s.id} className="flex items-center justify-between text-[11px]">
            <span className="text-slate-300">{s.name}</span>
            <div className="flex items-center gap-2">
              <span className="text-slate-500">{s.tier}</span>
              <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-950/50 border border-amber-800/30 text-amber-400">
                {s.daysStale}d unchanged
              </span>
            </div>
          </div>
        ))}
      </div>
      <p className="text-[9px] text-amber-700 mt-1.5">
        Upstream warRiskTier is manually configured — verify these still reflect current conditions.
      </p>
    </div>
  )
}

function StandingSignals({ signals }) {
  if (!signals?.length) return null
  return (
    <div>
      <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Monitored Signals</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
        {signals.map(s => (
          <div key={s.slug} className={`rounded-lg border px-3 py-2 ${severityBg(s.severity)}`}>
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-[11px] font-semibold text-slate-200 truncate">{s.name}</span>
              <span className={`text-sm font-semibold tabular-nums ml-2 ${severityColor(s.severity)}`}>
                {s.severity}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-[9px]">
              <span className="px-1 py-0.5 rounded bg-slate-800/60 border border-slate-700/40 text-slate-400">
                {CATEGORY_LABELS[s.category] ?? s.category}
              </span>
              <span className={STATE_STYLE[s.state] ?? 'text-slate-400'}>
                {s.state?.replace('_', '-')}
              </span>
              {s.implication && s.implication !== 'none' && (
                <span className="text-slate-500">→ {IMPLICATION_LABELS[s.implication] ?? s.implication.replace(/_/g, ' ')}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function RunCard({ run, expanded, onToggle }) {
  const verdict = run.verdict ?? {}
  const dismissed = run.categories_dismissed_reason ?? {}
  const considered = run.categories_considered ?? []
  const dismissedKeys = Object.keys(dismissed)
  const diff = run.diff ?? {}
  const diffKeys = Object.keys(diff)
  const [showDetail, setShowDetail] = useState(false)

  const isSkip = run.run_type === 'gated-skip'

  return (
    <div className={`rounded-lg border ${run.flagged ? 'border-red-900/40 bg-red-950/10' : 'border-slate-800 bg-slate-950/40'}`}>
      <button
        onClick={onToggle}
        className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-slate-800/30 transition-colors rounded-lg"
      >
        <ChevronDown
          size={12}
          className="text-slate-600 shrink-0"
          style={{ transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.15s' }}
        />
        <span className="text-[11px] text-slate-500 font-mono shrink-0">{fmtTime(run.evaluated_at)}</span>

        {run.flagged ? (
          <span className="text-[11px] text-red-300 truncate">
            <span className="font-semibold">{run.risk_category ?? 'flagged'}</span>
            {run.confidence > 0 && <span className="text-red-400/70"> · {run.confidence}%</span>}
          </span>
        ) : isSkip ? (
          <span className="text-[11px] text-slate-500">No change</span>
        ) : (
          <span className="text-[11px] text-emerald-500">Clear</span>
        )}

        <span className="ml-auto flex items-center gap-1.5 shrink-0">
          <RunTypeBadge type={run.run_type} />
          <span className="text-[10px] text-slate-600">{fmtAgo(run.evaluated_at)}</span>
        </span>
      </button>

      {expanded && (
        <div className="px-3 pb-3 border-t border-slate-800/60">
          {!isSkip && verdict.reasoning && (
            <div className="mt-2 mb-2">
              <p className="text-[11px] text-slate-300 leading-relaxed">{verdict.reasoning}</p>
              {verdict.transmission_chain && (
                <p className="text-[10px] text-slate-500 mt-1">
                  <span className="font-medium text-slate-400">Transmission:</span> {verdict.transmission_chain}
                </p>
              )}
            </div>
          )}

          {isSkip && (
            <p className="mt-2 mb-2 text-[11px] text-slate-500 italic">No material change since last snapshot — LLM not called.</p>
          )}

          {diffKeys.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap mb-2">
              <span className="text-[10px] text-slate-500 shrink-0">Changed:</span>
              {diffKeys.map(k => (
                <Tip key={k} term={k}>
                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-950/40 border border-amber-800/30 text-amber-300">
                    {k}
                  </span>
                </Tip>
              ))}
            </div>
          )}

          {(considered.length > 0 || dismissedKeys.length > 0) && (
            <div>
              <button
                onClick={() => setShowDetail(v => !v)}
                className="text-[10px] text-slate-600 hover:text-slate-400 transition-colors flex items-center gap-1"
              >
                <ChevronDown
                  size={10}
                  style={{ transform: showDetail ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.15s' }}
                />
                {considered.length} included · {dismissedKeys.length} excluded
              </button>

              {showDetail && (
                <div className="mt-1.5 space-y-2 pl-3 border-l border-slate-800/60">
                  {considered.length > 0 && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] text-slate-500 shrink-0">Included:</span>
                      {considered.map(c => (
                        <Tip key={c} term={c}>
                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800/60 border border-slate-700/40 text-slate-300">
                            {c}
                          </span>
                        </Tip>
                      ))}
                    </div>
                  )}

                  {dismissedKeys.length > 0 && (
                    <div>
                      <span className="text-[10px] text-slate-500">Excluded:</span>
                      <div className="mt-0.5 space-y-0.5">
                        {dismissedKeys.map(k => {
                          const val = dismissed[k]
                          const text = typeof val === 'string' ? val
                            : typeof val === 'object' && val !== null ? Object.entries(val).map(([subK, subV]) => `${subK}: ${subV}`).join('; ')
                            : String(val)
                          return (
                            <div key={k} className="flex gap-1.5 text-[10px]">
                              <Tip term={k}><span className="text-slate-400 shrink-0">{k}</span></Tip>
                              <span className="text-slate-600">— {text}</span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {run.token_usage && (
                    <p className="text-[9px] text-slate-700">
                      {run.token_usage.inputToken?.toLocaleString()} in / {run.token_usage.totalToken?.toLocaleString()} total tokens
                      {run.token_usage.credit != null && ` · ${run.token_usage.credit} credits`}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {run.source_errors?.length > 0 && (
            <p className="text-[10px] text-red-400/70 mt-1.5">
              Source errors: {run.source_errors.join(', ')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   Main Panel — tab-switched between Main and Diagnostics
   ═══════════════════════════════════════════════════════════════════════ */

export default function GeoRegimePanel({ data, loading, error }) {
  const [collapsed, setCollapsed] = useState(true)
  const [view, setView] = useState('main')
  const [expandedRun, setExpandedRun] = useState(null)

  const runs = data?.runs ?? []
  const allSignals = data?.signals ?? []
  const trajectory = data?.trajectory ?? []
  const reasoningTimeline = data?.reasoningTimeline ?? []
  const headlineData = data?.headlines ?? null
  const latestRun = runs[0]

  const standingSignals = allSignals.filter(s => !s.slug?.startsWith('llm-'))
  const aiSignalCount = allSignals.length - standingSignals.length

  const handleToggle = () => {
    setCollapsed(v => {
      if (v && expandedRun === null && latestRun) setExpandedRun(latestRun.id)
      return !v
    })
  }

  return (
    <div>
      <button
        onClick={handleToggle}
        className="flex items-center gap-2 mb-3 text-xs font-semibold text-slate-500 uppercase tracking-widest hover:text-slate-400 transition-colors"
      >
        <ChevronDown
          size={14}
          style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
        />
        Geo Regime
        {!collapsed && latestRun && (
          <span className="normal-case tracking-normal font-normal text-slate-600 text-[10px] ml-1">
            last run {fmtAgo(latestRun.evaluated_at)}
          </span>
        )}
      </button>

      {!collapsed && (
        <GeoErrorBoundary>
          <div className="space-y-4">
            {loading && (
              <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-5 py-6 text-center text-sm text-slate-600 animate-pulse">
                Loading geo regime…
              </div>
            )}

            {error && (
              <div className="rounded-xl border border-red-900/40 bg-red-950/20 px-5 py-3 text-sm text-red-400">
                Geo regime unavailable — {error}
              </div>
            )}

            {!loading && !error && (
              <>
                {/* Tab switcher */}
                <div className="flex gap-1">
                  {[
                    { key: 'main', label: 'Main' },
                    { key: 'diagnostics', label: 'Diagnostics' },
                  ].map(tab => (
                    <button
                      key={tab.key}
                      onClick={() => setView(tab.key)}
                      className={`px-2.5 py-0.5 rounded text-[11px] font-semibold border transition-colors ${
                        view === tab.key
                          ? 'text-violet-300 bg-violet-950/40 border-violet-800/60'
                          : 'text-slate-500 bg-slate-900/40 border-slate-800 hover:text-slate-300'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {view === 'main' && (
                  <>
                    <WorldBriefing latestRun={latestRun} />
                    <TrajectoryLayer trajectory={trajectory} reasoningTimeline={reasoningTimeline} />
                    <MarketPricing marketPricing={data?.marketPricing} />
                    <PolymarketLayer polymarket={data?.polymarket} />
                    <Headlines headlineData={headlineData} />
                  </>
                )}

                {view === 'diagnostics' && (
                  <>
                    <RegimeSummary allSignals={allSignals} latestRun={latestRun} />
                    <TierStaleness tierTracking={data?.tierTracking} />
                    <StandingSignals signals={standingSignals} />

                    {aiSignalCount > 0 && (
                      <p className="text-[9px] text-slate-600">
                        + {aiSignalCount} LLM-generated flag{aiSignalCount !== 1 ? 's' : ''} in signal history
                      </p>
                    )}

                    <div>
                      <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                        Recent Runs ({runs.length})
                      </p>
                      <div className="space-y-1">
                        {runs.map(run => (
                          <RunCard
                            key={run.id}
                            run={run}
                            expanded={expandedRun === run.id}
                            onToggle={() => setExpandedRun(prev => prev === run.id ? null : run.id)}
                          />
                        ))}
                      </div>
                      {runs.length === 0 && (
                        <p className="text-[11px] text-slate-600">No runs recorded yet — the 4-hourly cron populates this.</p>
                      )}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </GeoErrorBoundary>
      )}
    </div>
  )
}
