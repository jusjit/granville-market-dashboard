"""
Push alma_rules.json (schema v2) into the Supabase `rules` table.

Rules-only by design: does NOT touch intraday_posts / weekly_posts / market_data.
(migrate_to_supabase.py re-pushes those from the stale SQLite snapshot, which
would clobber Gmail-ingested posts — never run that again for a rules update.)

Prerequisite: run rules_v2_schema.sql first (recreates the table with v2 columns
and the actionable_as_signal CHECK constraint).

Reads credentials from ../.env so no key is hardcoded.

Usage:  python push_rules_v2.py
"""

import json
import sys
import urllib.request
import urllib.error
from pathlib import Path

HERE = Path(__file__).parent
RULES_PATH = HERE / "alma_rules.json"
ENV_PATH = HERE.parent / ".env"

# Columns the v2 table accepts — anything else in the JSON is rejected loudly
# rather than silently dropped by PostgREST.
COLUMNS = {"id", "name", "horizon", "rank", "reliability_tier", "placebo_status",
           "actionable_as_signal", "condition", "finding", "stats",
           "interpretation", "caveats"}


def load_env():
    env = {}
    for line in ENV_PATH.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    return env


def main():
    env = load_env()
    url = env.get("SUPABASE_URL")
    key = env.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("FAIL: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not found in .env")
        return 1

    data = json.loads(RULES_PATH.read_text(encoding="utf-8-sig"))
    rules = data["rules"]

    # Re-assert the invariant client-side before hitting the DB, so a bad file
    # fails here with a clear message rather than as a Postgres CHECK violation.
    for r in rules:
        if r["actionable_as_signal"] != (r["placebo_status"] == "PASSED"):
            print(f"FAIL: {r['id']} violates actionable_as_signal invariant — aborting push")
            return 1
        extra = set(r) - COLUMNS
        if extra:
            print(f"FAIL: {r['id']} has fields not in the v2 table: {sorted(extra)}")
            return 1

    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates",
    }
    req = urllib.request.Request(
        f"{url}/rest/v1/rules?on_conflict=id",
        data=json.dumps(rules).encode(),
        headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req) as r:
            if r.status not in (200, 201):
                print(f"FAIL: Supabase HTTP {r.status}")
                return 1
    except urllib.error.HTTPError as e:
        print(f"FAIL: Supabase {e.code}: {e.read().decode()[:400]}")
        return 1

    # Verify what actually landed
    vreq = urllib.request.Request(
        f"{url}/rest/v1/rules?select=id,rank,reliability_tier,placebo_status,actionable_as_signal&order=rank",
        headers={"apikey": key, "Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(vreq) as r:
        landed = json.loads(r.read().decode())

    print(f"Pushed {len(rules)} rules; table now has {len(landed)}:\n")
    for row in landed:
        flag = "SIGNAL " if row["actionable_as_signal"] else "context"
        print(f"  {row['rank']:>2}. {row['id']:<34} {row['reliability_tier']:<12} "
              f"placebo={row['placebo_status']:<9} {flag}")
    actionable = [r["id"] for r in landed if r["actionable_as_signal"]]
    print(f"\nactionable as signal: {actionable}")
    if len(landed) != len(rules):
        print(f"WARN: expected {len(rules)} rows, found {len(landed)} — stale v1 rows may remain")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
