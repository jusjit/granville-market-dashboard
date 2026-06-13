import { PieChart, Pie, Cell } from 'recharts'

const COLORS = {
  bull: '#22c55e',
  transitional: '#eab308',
  bear: '#ef4444',
}

function phaseColor(phase) {
  if (!phase) return COLORS.transitional
  if (phase.startsWith('Bull')) return COLORS.bull
  if (phase.startsWith('Bear')) return COLORS.bear
  return COLORS.transitional
}

function phaseDescription(phase) {
  const map = {
    'Bull Phase 1': 'Emerging uptrend — breadth expanding, early accumulation',
    'Bull Phase 2': 'Established bull — broad participation, momentum strong',
    'Bull Phase 3': 'Maturing bull — leadership narrowing, watch for rotation',
    'Bear Phase 1': 'Emerging downtrend — distribution beginning, risk rising',
    'Bear Phase 2': 'Established bear — broad deterioration, defensive posture',
    'Bear Phase 3': 'Maturing bear — capitulation possible, watch for reversal',
    'Transitional': 'Mixed signals — market in transition, no clear direction',
  }
  return map[phase] ?? ''
}

export default function ScoreGauge({ score, phase }) {
  const color = phaseColor(phase)

  // Gauge arc: 180° half-circle
  const gaugeData = [
    { value: score },
    { value: 100 - score },
  ]

  return (
    <div className="flex flex-col items-center justify-center py-8 px-4">
      <div className="relative">
        <PieChart width={260} height={140}>
          {/* Background track */}
          <Pie
            data={[{ value: 100 }]}
            cx={130} cy={130}
            startAngle={180} endAngle={0}
            innerRadius={85} outerRadius={110}
            dataKey="value"
            stroke="none"
          >
            <Cell fill="#1e293b" />
          </Pie>
          {/* Score arc */}
          <Pie
            data={gaugeData}
            cx={130} cy={130}
            startAngle={180} endAngle={0}
            innerRadius={85} outerRadius={110}
            dataKey="value"
            stroke="none"
          >
            <Cell fill={color} />
            <Cell fill="transparent" />
          </Pie>
        </PieChart>

        {/* Center text overlay */}
        <div className="absolute inset-0 flex flex-col items-center justify-end pb-1">
          <span className="text-5xl font-black" style={{ color }}>{score}</span>
          <span className="text-xs text-slate-500 mt-0.5">out of 100</span>
        </div>
      </div>

      {/* Zone labels */}
      <div className="flex justify-between w-[260px] text-xs mt-1 px-1">
        <span className="text-red-400">Bear</span>
        <span className="text-yellow-400">Transitional</span>
        <span className="text-green-400">Bull</span>
      </div>

      {/* Phase badge */}
      <div
        className="mt-4 px-5 py-2 rounded-full text-sm font-semibold tracking-wide"
        style={{ background: `${color}22`, color, border: `1px solid ${color}55` }}
      >
        {phase ?? '—'}
      </div>

      <p className="text-xs text-slate-500 mt-2 text-center max-w-xs">
        {phaseDescription(phase)}
      </p>
    </div>
  )
}
