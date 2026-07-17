-- ============================================================================
-- Alma rules table -> schema v2
-- v1 rows are superseded by the audit and must NOT be preserved (several were
-- demoted or debunked), so the table is recreated rather than migrated.
-- Run in the Supabase SQL Editor, then push rows with migrate_to_supabase.py.
-- ============================================================================

drop table if exists public.rules;

create table public.rules (
  id                  text primary key,        -- v2 rule id (was rule_id in v1)
  name                text,
  horizon             text,                    -- 'intraday' | 'weekly'
  rank                integer,                 -- 1 = strongest evidence; UI orders by this
  reliability_tier    text,                    -- VALIDATED | EMERGING | EXPLORATORY  (does the stat replicate)
  placebo_status      text,                    -- PASSED | FAILED | UNTESTED          (does placement carry information)
  actionable_as_signal boolean not null,       -- MUST equal (placebo_status = 'PASSED')
  condition           text,                    -- machine-readable trigger; null = unconditional descriptive stat
  finding             text,
  stats               jsonb,                   -- {estimate, ci_95, n, oos_*, placebo_permutation_p, naive_benchmark}
  interpretation      text,
  caveats             text
);

-- The invariant, enforced by the database itself: statistical reliability or a
-- big estimate can never leak into actionability. Only a passed placebo can.
alter table public.rules
  add constraint rules_actionable_requires_placebo_passed
  check (actionable_as_signal = (placebo_status = 'PASSED'));

alter table public.rules
  add constraint rules_reliability_tier_valid
  check (reliability_tier in ('VALIDATED','EMERGING','EXPLORATORY'));

alter table public.rules
  add constraint rules_placebo_status_valid
  check (placebo_status in ('PASSED','FAILED','UNTESTED'));

create index idx_rules_rank on public.rules(rank);

grant all on table public.rules to service_role, anon, authenticated;
alter table public.rules enable row level security;
