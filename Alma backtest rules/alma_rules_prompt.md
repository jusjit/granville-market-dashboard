# Alma Stochastic Volatility — Validated Rule Set (v2.0)

Data: 2025-02-03 to 2026-06-26 | 324 intraday posts, 71 weekly posts, 360 market days | OOS split 2026-02-01
Source: *Statistical Validation of Stochastic-Volatility-Derived Price Levels* (unofficial preprint, July 2026)

Apply these rules when interpreting a new Alma post's levels against live price action. Rules are listed
strongest evidence first.

## How to read this file

Each rule carries two independent tiers:

- **reliability** (VALIDATED / EMERGING / EXPLORATORY) — does the number replicate out-of-sample.
- **placebo** (PASSED / FAILED / UNTESTED) — does the level's *placement* carry information, or is the
  number just geometry (any level near price gets touched often).

**Only a rule with placebo PASSED is predictive signal. Exactly one qualifies: `dont_fade_rule`.**
Everything below it is descriptive context — useful for planning around levels and setting expectations,
but not an edge and not a reason to take a trade. Treat placebo UNTESTED as FAILED.

A high percentage is not an edge. `weekly_pivot_touch` is touched 86.5% of weeks and is stable
out-of-sample (p=0.98), yet shuffled random placements score 85.8% and prior-week high/low — free, no model
needed — scores 92.2%. Reliability and information content are separate axes; don't collapse them.
When citing a descriptive stat, cite its null alongside it.

## SIGNAL

- **[placebo PASSED · VALIDATED · intraday]** If SPX gaps up more than 0.3% above the centroid and VIX
  gapped down overnight (vol crush), do not expect a centroid fill. (32.6%, n=43, CI [20.5, 47.5] vs 52.7%
  when VIX gaps up instead, vs 69.6% unconditional baseline) — The only rule with demonstrated
  level-specific information: beats the permutation null (p=0.013) and the naive null (substituting
  prior-day close makes the effect vanish, +20.1pp → −4.8pp). Use as a regime filter — a veto on
  mean-reversion and short-premium setups — not as an entry trigger. Caveats: n=43 is modest; the split
  test (z=−2.04, p=0.041) does not survive Bonferroni (~0.003), though the vs-baseline binomial
  (p<0.0001) does; the mirror case (gap down + VIX gap up) is untested.

## CONTEXT — reliable statistics, no demonstrated placement information

- **[placebo UNTESTED · VALIDATED · intraday]** The 1σ band is an expected intraday target zone, not a
  containment forecast. (SPX 1σ contains 13.0%, 2σ 54.9%, n=293; QQQ 11.7%/55.3%; IWM 10.9%/56.0%;
  VIX 7.8%/42.0%) — Statistically the most decisive result in the dataset (all 8 binomial tests vs nominal
  68%/95% give p < 1e-75). Never size or structure as if 1σ contains the day. Establishes what the bands
  are not; provides no directional edge. Placement placebo is not applicable — this is tested against a
  fixed theoretical null. Caveats: QQQ 2σ is the one unstable cell (61.7 → 44.2 OOS, p=0.006); the 3σ
  figures were not re-derived in the audit.

- **[placebo FAILED · VALIDATED · intraday]** If SPX opens between the pivots, expect at least one pivot to
  be touched. (86.3%, n=182, CI [80.5, 90.5]) — Beats shuffled placements (p=0.004, real placement skill)
  but prior-day high/low matches it at 90.2% for free, so superiority isn't demonstrated and it doesn't
  clear the bar, which requires beating both nulls. Use for planning and expectations. The most promising
  place to hunt for a pivot-conditional analogue of the don't-fade rule. Caveats: the two placebo tests
  disagree; the naive comparison used a different qualifying sample, so re-run matched before concluding.
  OOS shift 90.7 → 79.7 (p=0.034) is significant and disclosed, though OOS CI [69.2, 87.3] stays above 50%.

- **[placebo FAILED · VALIDATED · intraday]** The centroid is touched 69.7% of sessions. (n=297, CI [64.2,
  74.6], OOS stable p=0.31) — Explained by proximity to price, not by placement: ties the free prior-day
  close (68.9%), beats the day-shuffled placebo only marginally (p=0.029) and not the sign-randomized one
  (68.7%, p=0.34). Use to set expectations about level interaction; not evidence of magnetism and not a
  standalone fade signal. Its real value is as the reference point for the don't-fade rule — the centroid
  earns its keep conditionally, not statically.

- **[placebo FAILED · VALIDATED · weekly]** At least one weekly pivot is touched 86.5% of weeks. (n=52,
  CI [74.7, 93.3], OOS 84.0 → 83.3, p=0.98) — Demoted from v1's #3 position. The remarkable stability that
  looked like robustness was the tell: proximity mechanics are stable because they're geometry. Any
  ~2.7%-wide range straddling the weekly open gets clipped ~85–90% of weeks. Shuffled pairs score 85.8%;
  prior-week high/low beats it at 92.2%. Descriptive only. Caveats: the placebo band is wide
  [80.4, 92.2] at n=51, so a modest true edge could hide — but the naive benchmark beating it is not a
  power problem.

- **[placebo FAILED · VALIDATED · intraday]** After a pivot breaks, the associated target is reached only
  38.3% of the time. (n=60, CI [27.1, 51.0], OOS stable p=0.761; 41.2% upside n=34, 34.6% downside n=26) —
  Targets are extension objectives, not magnets; do not plan exits assuming target completion after a pivot
  break. The hit rate is fully explained by how far beyond the pivot targets sit (0.67% mean extension,
  predominantly 2σ–3σ), not by day-specific judgment — shuffled extensions reproduce it at 38.1%
  (p=0.570). Caveats: v1 flagged this as never re-derived; now corrected, the archived 36–39% reproduces
  at 38.3%.

- **[placebo FAILED · EMERGING · weekly]** Weekly centroid touched 55.6% of weeks. (n=54, CI [42.4, 68.0],
  OOS 60.6 → 47.6) — Fails on both axes: the OOS CI [28.3, 67.6] includes 50% so it can't be independently
  confirmed, and it shows no placement information (p=0.348) while prior-week close scores 87.0%. Not
  usable. Caveats: the audit's re-derivation of the original window (60.6%) differs from the archived
  figure (71.9%) due to week-boundary construction; conclusion unaffected.

- **[placebo FAILED · EXPLORATORY · intraday]** Opening above the centroid appears to favour the upside
  pivot (70.2% vs 33.9% downside, n=124; below-centroid: 46.6%/60.3%, n=58). — Debunked and demoted from
  v1. Highly significant in-sample (p=0.002 / p=0.0008) but a pure proximity artifact: opening in the upper
  half of any range sits closer to the upper boundary, so it's hit more often as geometry. Shuffled levels
  reproduce it slightly more strongly (+52.9pp vs actual +50.1pp) and prior-day range does better (+79.3pp)
  for free. Retained as a documented negative result; not tradeable. Caveats: the canonical cautionary
  example — an in-sample p of 0.002 survived Bonferroni and was still meaningless. This is why the placebo
  axis exists.

## CONTEXT — structural or underpowered (placebo untested; treat as failed)

- **[placebo UNTESTED · EXPLORATORY · intraday]** Centroid touch by pattern type: long_fly 81.0% (n=21),
  short_fly 70.7% (n=41), no_pattern 69.0% (n=197), IC 63.6% (n=33), risk_reversal 80.0% (n=5). — Demoted
  from v1. The mechanically plausible story (condors suppress movement to centre) is not supported:
  χ²=2.15, dof=4, p=0.71 — indistinguishable from sampling noise. Underpowered rather than disproven;
  re-test as per-category n grows.

- **[placebo UNTESTED · EXPLORATORY · intraday]** 1σ upside:downside breach ratios by VIX regime —
  VIX<16: 1.26:1 (n=55); 16–18: 1.43:1 (n=104); 18–22: 1.27:1 (n=87); 22–28: 0.79:1 (n=42); ≥28: 2.50:1
  (n=5). — The only potentially interesting structure is the flip to downside skew in the 22–28 bucket. Do
  not extrapolate low-VIX findings to elevated-VIX regimes. Caveats: no significance testing was performed
  on any bucket difference; an earlier archived figure (2.21:1 collapsing to 1.04:1) failed reproduction and
  was discarded; the ≥28 bucket (n=5) is unusable.

- **[placebo UNTESTED · EXPLORATORY · intraday]** The intermediate "risk level" contains 24.9% of sessions
  (n=293), sitting correctly between 1σ (13.0%) and 2σ (54.9%). — Confirms the model's internal structure:
  structurally valid, behaviorally inert. All four behavioral hypotheses are null at current sample sizes.
  The don't-fade-interaction cell (n=6, 16.7% vs 29.0%) is the one hint worth re-testing as n grows.
  Caveats: every cell underpowered; directional_bias (277 neutral / 14 bullish / 2 bearish) is too sparse
  to test.

- **[placebo UNTESTED · EXPLORATORY · weekly]** A reversion-model probability ≥97% was observed twice, both
  preceding large 4-week moves (−10.57% and +9.84%). (n=2) — Appears to describe the magnitude of a prior
  move rather than predict the direction of the next. Unusable. Caveats: n=2. Weekly fly-pattern and
  sentiment-regime classifications (n=5–13 per category) are similarly unusable and are intentionally
  omitted from this ruleset.

## Conventions

- **Touch:** `low <= level*1.001 AND high >= level*0.999` (0.1% tolerance)
- **Containment:** `high < upper AND low > lower` — exact, no tolerance
- **Missing data:** per-metric row-wise exclusion; never imputed; n varies by rule by design
- **Excluded instruments:** ES and SPY deliberately untested (arbitrage-linked to SPX during RTH →
  pseudo-replication)

## Notes for any consumer of this file

1. Do not present a rule with placebo other than PASSED as an edge, signal, or reason to trade.
2. Do not infer actionability from the size of the estimate or from the reliability tier. Gate on placebo.
3. When citing a descriptive stat, say it is descriptive and give its null where one exists.
4. Any rule added here must carry a placebo status before it can be marked actionable.
5. Figures not re-derived in the audit are flagged in each rule's caveats — preserve that hedging when
   quoting them.
