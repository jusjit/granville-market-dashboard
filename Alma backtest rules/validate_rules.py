"""
Validator for alma_rules.json (schema v2).

Enforces the invariant that the v2 audit exists to protect:

    actionable_as_signal == (placebo_status == "PASSED")

A high `estimate` or a VALIDATED `reliability_tier` must NEVER leak into
`actionable_as_signal` — conflating statistical reliability with information
content is the exact error v2 corrected (see weekly_pivot_touch: 86.5%,
rock-stable OOS, and completely information-free).

Usage:  python validate_rules.py
Exit code 0 = valid, 1 = violations found.
"""

import json
import sys
from pathlib import Path

RULES_PATH = Path(__file__).parent / "alma_rules.json"

TOP_LEVEL = ["schema_version", "generated", "source_paper", "dataset",
             "conventions", "tier_definitions", "usage_gate", "rules"]
RULE_FIELDS = ["id", "name", "horizon", "rank", "reliability_tier", "placebo_status",
               "actionable_as_signal", "condition", "finding", "stats",
               "interpretation", "caveats"]
STAT_FIELDS = ["estimate", "ci_95", "n", "oos_original", "oos_holdout",
               "oos_shift_p", "placebo_permutation_p", "naive_benchmark"]
RELIABILITY = {"VALIDATED", "EMERGING", "EXPLORATORY"}
PLACEBO = {"PASSED", "FAILED", "UNTESTED"}
HORIZONS = {"intraday", "weekly"}

errors = []
warnings = []


def err(msg):
    errors.append(msg)


def main():
    try:
        # utf-8-sig tolerates a BOM (Windows editors add one) and plain UTF-8 alike
        data = json.loads(RULES_PATH.read_text(encoding="utf-8-sig"))
    except json.JSONDecodeError as e:
        print(f"FAIL: alma_rules.json does not parse — {e}")
        return 1

    # ---- top level -------------------------------------------------------
    for k in TOP_LEVEL:
        if k not in data:
            err(f"top level: missing '{k}'")
    if data.get("schema_version") != 2:
        err(f"top level: schema_version must be 2, got {data.get('schema_version')!r}")

    rules = data.get("rules", [])
    if not rules:
        err("top level: 'rules' is empty")

    seen_ids, seen_ranks = set(), set()

    for i, r in enumerate(rules):
        rid = r.get("id", f"<index {i}>")

        # ---- required fields present (null allowed, omission not) --------
        for f in RULE_FIELDS:
            if f not in r:
                err(f"{rid}: missing field '{f}'")

        # ---- enums -------------------------------------------------------
        if r.get("reliability_tier") not in RELIABILITY:
            err(f"{rid}: reliability_tier {r.get('reliability_tier')!r} not in {sorted(RELIABILITY)}")
        if r.get("placebo_status") not in PLACEBO:
            err(f"{rid}: placebo_status {r.get('placebo_status')!r} not in {sorted(PLACEBO)}")
        if r.get("horizon") not in HORIZONS:
            err(f"{rid}: horizon {r.get('horizon')!r} not in {sorted(HORIZONS)}")

        # ---- THE INVARIANT ----------------------------------------------
        expected = r.get("placebo_status") == "PASSED"
        actual = r.get("actionable_as_signal")
        if actual is not expected:
            err(f"{rid}: INVARIANT VIOLATION — actionable_as_signal={actual!r} but "
                f"placebo_status={r.get('placebo_status')!r} requires {expected!r}. "
                f"Only placebo_status=='PASSED' may be actionable.")

        # ---- uniqueness --------------------------------------------------
        if r.get("id") in seen_ids:
            err(f"{rid}: duplicate id")
        seen_ids.add(r.get("id"))
        if r.get("rank") in seen_ranks:
            err(f"{rid}: duplicate rank {r.get('rank')}")
        seen_ranks.add(r.get("rank"))

        # ---- stats -------------------------------------------------------
        stats = r.get("stats")
        if not isinstance(stats, dict):
            err(f"{rid}: stats must be an object")
            continue
        for f in STAT_FIELDS:
            if f not in stats:
                err(f"{rid}: stats missing field '{f}'")
        ci = stats.get("ci_95")
        if ci is not None:
            if not (isinstance(ci, list) and len(ci) == 2):
                err(f"{rid}: stats.ci_95 must be [lo, hi] or null, got {ci!r}")
            elif ci[0] > ci[1]:
                err(f"{rid}: stats.ci_95 lo > hi {ci!r}")
        if not isinstance(stats.get("n"), int):
            err(f"{rid}: stats.n must be an int, got {stats.get('n')!r}")

        # ---- consistency warnings (not hard failures) --------------------
        if r.get("placebo_status") == "PASSED" and stats.get("placebo_permutation_p") is None:
            err(f"{rid}: placebo_status PASSED but placebo_permutation_p is null — "
                f"PASSED requires beating BOTH nulls, so both must be recorded")
        if r.get("placebo_status") == "PASSED" and stats.get("naive_benchmark") is None:
            err(f"{rid}: placebo_status PASSED but naive_benchmark is null — "
                f"PASSED requires beating BOTH nulls, so both must be recorded")

    # ---- ranks should be contiguous from 1 -------------------------------
    if seen_ranks and sorted(seen_ranks) != list(range(1, len(rules) + 1)):
        warnings.append(f"ranks are not contiguous 1..{len(rules)}: {sorted(seen_ranks)}")

    # ---- report ----------------------------------------------------------
    actionable = [r["id"] for r in rules if r.get("actionable_as_signal")]
    print(f"alma_rules.json — schema v{data.get('schema_version')}, {len(rules)} rules, parses OK")
    print(f"actionable as signal ({len(actionable)}): {actionable or 'none'}")
    for tier in ("VALIDATED", "EMERGING", "EXPLORATORY"):
        ids = [r["id"] for r in rules if r.get("reliability_tier") == tier]
        print(f"  reliability {tier:<12} {len(ids)}")
    for st in ("PASSED", "FAILED", "UNTESTED"):
        ids = [r["id"] for r in rules if r.get("placebo_status") == st]
        print(f"  placebo     {st:<12} {len(ids)}")

    for w in warnings:
        print(f"WARN: {w}")
    if errors:
        print(f"\nFAIL — {len(errors)} violation(s):")
        for e in errors:
            print(f"  - {e}")
        return 1
    print("\nPASS — schema and actionable_as_signal invariant hold.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
