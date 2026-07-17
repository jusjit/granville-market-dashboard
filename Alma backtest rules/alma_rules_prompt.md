# Alma Stochastic Volatility — Validated Rule Set (v2.0)

Data: 2025-02-03 to 2026-06-26 | 324 intraday posts, 71 weekly posts, 360 market days | OOS split 2026-02-01
Source: *Statistical Validation of Stochastic-Volatility-Derived Price Levels* (unofficial preprint, July 2026)

---

## ⚠️ READ THIS FIRST — THE USAGE GATE

**Exactly ONE rule in this file is tradeable signal: `dont_fade_rule`. Everything else is descriptive context.**

Use a rule as predictive signal **ONLY** if `placebo_status == "PASSED"`. Otherwise it is descriptive
only — useful for planning around levels and setting expectations, but it must **never** be treated as
predictive edge, and must never be described to a user as an edge, an advantage, or a reason to take a trade.

### Why a high percentage is NOT an edge

Every rule was placebo-tested two ways: (a) **permutation** — shuffle level-to-day assignment 5,000×,
preserving the distance distribution but destroying day-specific placement; (b) **naive benchmarks** — run
identical logic on free levels (prior-day close / midpoint / high-low, or prior-week equivalents).
A rule passes only if it beats **both**.

Most of these levels get touched often simply because **they sit near the price**. Any level near price gets
touched a lot. That is geometry, not information. The clearest case:

> `weekly_pivot_touch` is touched **86.5%** of weeks and is rock-stable out-of-sample (p=0.98).
> It is also **completely information-free**: shuffled random placements score 85.8% (indistinguishable),
> and prior-week high/low — a free level requiring no model — scores **92.2%**, beating it.
> **86.5% is not an edge. It is what any ~2.7%-wide range straddling the weekly open scores.**

Statistical reliability and information content are **independent axes**. `reliability_tier` measures only
whether the number replicates. `placebo_status` measures whether the level's *placement* carries information.
A rule can be perfectly reliable and entirely worthless as signal. Do not collapse these two fields.

---

## ✅ TRADEABLE SIGNAL (1 rule)

### `dont_fade_rule` — Don't Fade the Vol-Crush Gap
**intraday · rank 1 · reliability VALIDATED · placebo PASSED · ACTIONABLE**

- **Trigger:** `(spx_open - centroid) / centroid * 100 > 0.3 AND vix_gap_pct < 0`
- **Finding:** Centroid touch rate collapses to **32.6%** (n=43, CI [20.5, 47.5]) vs **52.7%** when VIX gaps
  up instead (n=73), vs **69.6%** unconditional baseline.
- **Why it passes:** Beats the permutation null (p=0.013) **and** the naive null — substituting prior-day
  close makes the effect vanish entirely (differential collapses +20.1pp → −4.8pp). The only rule in the
  dataset with demonstrated level-specific information.
- **How to use:** A **regime filter / veto**, not an entry trigger. On a vol-crush gap-up morning, do not
  fade the gap and do not expect a centroid fill. Veto mean-reversion and short-premium setups.
- **Caveats to state honestly:** n=43 is modest. The split test (z=−2.04, p=0.041) does **not** survive
  Bonferroni (~0.003), though the vs-baseline binomial (p<0.0001) does. The mirror case (gap down + VIX gap
  up) is untested — cell too small. Dose-response across gap sizes untested.

---

## 📋 DESCRIPTIVE ONLY — NOT SIGNAL (11 rules)

**None of the below may be used as predictive edge.** Use them to set expectations and plan around levels.

### Reliable statistics that carry NO placement information (placebo FAILED)

| rule | horizon | stat | why it's not signal |
|---|---|---|---|
| `intraday_pivot_touch` | intraday | 86.3% (n=182) | Beats permutation (p=0.004 — real placement skill) but prior-day high/low matches it at 90.2% for free. Must beat **both** nulls; it doesn't. Best candidate for future work. |
| `intraday_centroid_touch` | intraday | 69.7% (n=297) | Explained by proximity, not placement. Ties prior-day close (68.9%). Beats day-shuffled placebo (p=0.029) but **not** sign-randomized (68.7%, p=0.34). |
| `weekly_pivot_touch` | weekly | 86.5% (n=52) | See gate above. Shuffled placements 85.8%; prior-week high/low 92.2% beats it. Demoted from v1's #3. |
| `targets_are_soft_walls` | intraday | 38.3% (n=60) | Targets are **extension objectives, not magnets**. Do not plan exits assuming target completion after a pivot break. Shuffled extensions reproduce it at 38.1% (p=0.570). |
| `weekly_centroid_touch` | weekly | 55.6% (n=54) | Fails **both** axes — OOS CI [28.3, 67.6] includes 50% (EMERGING, unconfirmable) and no placement info (p=0.348). Prior-week close scores 87.0%. Not usable. |

### Debunked — documented negative result

| rule | horizon | why it's here |
|---|---|---|
| `directional_tell` | intraday | **DO NOT TRADE.** Highly significant in-sample (p=0.002, p=0.0008) and still meaningless — a pure proximity artifact. Opening in the upper half of any range sits closer to the upper boundary. Shuffled levels produce a *stronger* tell (+52.9pp vs actual +50.1pp); prior-day range does better (+79.3pp) for free. Retained only as the canonical cautionary example of why `placebo_status` exists. |

### Structural / underpowered (placebo UNTESTED — treat as FAILED)

| rule | horizon | note |
|---|---|---|
| `sigma_bands_are_not_containment` | intraday | **Statistically the most decisive result in the dataset** (all 8 binomial tests p < 1e-75). SPX 1σ contains only **13.0%** of sessions, 2σ 54.9%. The 1σ band is an expected **target zone, not a range forecast** — never size or structure as if 1σ contains the day. Establishes what the bands are NOT; provides no directional edge. (Placement placebo is n/a here — tested against a fixed theoretical null.) |
| `pattern_type_conditioning` | intraday | Differences indistinguishable from noise (χ²=2.15, p=0.71). The "condors suppress movement" story is **not supported**. Underpowered, not disproven. |
| `vix_regime_breach_skew` | intraday | No significance testing performed. Only hint: skew flips to downside in the 22–28 VIX bucket. Do not extrapolate low-VIX findings to elevated-VIX regimes. |
| `risk_level_construct` | intraday | Containment 24.9%, correctly between 1σ and 2σ — structurally valid, behaviorally inert. All four behavioral hypotheses null. |
| `weekly_reversion_model` | weekly | n=2. Describes the magnitude of a **prior** move, does not predict direction of the next. Unusable. |

---

## Conventions

- **Touch:** `low <= level*1.001 AND high >= level*0.999` (0.1% tolerance)
- **Containment:** `high < upper AND low > lower` — exact, **no** tolerance
- **Missing data:** per-metric row-wise exclusion; never imputed; **n varies by rule by design**
- **Excluded instruments:** ES and SPY deliberately untested (arbitrage-linked to SPX during RTH → pseudo-replication)

## Rules for any consumer of this file

1. **Never** present a `placebo_status != "PASSED"` rule as an edge, signal, or reason to trade.
2. **Never** infer actionability from `estimate` size or from `reliability_tier`. Gate on `placebo_status` only.
3. When citing a descriptive stat, state that it is descriptive — ideally with its null (e.g. "86.5%, but
   random placements score 85.8% and prior-week high/low beats it at 92.2%").
4. Any rule added to this file must carry a `placebo_status` before it can ever be marked actionable.
5. Figures not re-derived in the audit are flagged in each rule's `caveats` (e.g. the 3σ containment values)
   — preserve that hedging when quoting them; do not present them as freshly validated.
