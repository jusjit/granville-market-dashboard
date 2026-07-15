-- ============================================================================
-- Alma running touch-rate test — derives per-session touches + rolling rates
-- from stored posts + market_data. 0.1% tolerance (matches backtest TOL=0.001).
-- Views recompute live, so they always reflect current data & the tolerance.
-- Run once in the Supabase SQL Editor.
-- ============================================================================

-- Touch = level's +/-0.1% band overlaps the session high/low:
--   spx_low <= level*1.001  AND  spx_high >= level*0.999

-- ── INTRADAY: daily levels vs same-day SPX range ────────────────────────────
create or replace view alma_intraday_touches as
select
  i.date,
  m.spx_low, m.spx_high,
  case when i.centroid        is not null then (m.spx_low <= i.centroid*1.001        and m.spx_high >= i.centroid*0.999)        end as centroid_touched,
  case when i.upside_pivot    is not null then (m.spx_low <= i.upside_pivot*1.001    and m.spx_high >= i.upside_pivot*0.999)    end as upside_pivot_touched,
  case when i.downside_pivot  is not null then (m.spx_low <= i.downside_pivot*1.001  and m.spx_high >= i.downside_pivot*0.999)  end as downside_pivot_touched,
  case when i.upside_target   is not null then (m.spx_low <= i.upside_target*1.001   and m.spx_high >= i.upside_target*0.999)   end as upside_target_touched,
  case when i.downside_target is not null then (m.spx_low <= i.downside_target*1.001 and m.spx_high >= i.downside_target*0.999) end as downside_target_touched
from intraday_posts i
join market_data m on m.date = i.date
where m.spx_low is not null and m.spx_high is not null;

-- ── WEEKLY: weekly levels vs the week's min-low / max-high (Mon–Fri) ─────────
create or replace view alma_weekly_touches as
with wk as (
  select w.date,
         w.weekly_centroid, w.weekly_upside_pivot, w.weekly_downside_pivot,
         w.weekly_upside_target, w.weekly_downside_target,
         min(m.spx_low) as wk_low, max(m.spx_high) as wk_high
  from weekly_posts w
  join market_data m
    on m.date >= w.date and m.date < (w.date + interval '7 days')
  where m.spx_low is not null
  group by w.date, w.weekly_centroid, w.weekly_upside_pivot, w.weekly_downside_pivot,
           w.weekly_upside_target, w.weekly_downside_target
)
select date, wk_low, wk_high,
  case when weekly_centroid        is not null then (wk_low <= weekly_centroid*1.001        and wk_high >= weekly_centroid*0.999)        end as centroid_touched,
  case when weekly_upside_pivot    is not null then (wk_low <= weekly_upside_pivot*1.001    and wk_high >= weekly_upside_pivot*0.999)    end as upside_pivot_touched,
  case when weekly_downside_pivot  is not null then (wk_low <= weekly_downside_pivot*1.001  and wk_high >= weekly_downside_pivot*0.999)  end as downside_pivot_touched,
  case when weekly_upside_target   is not null then (wk_low <= weekly_upside_target*1.001   and wk_high >= weekly_upside_target*0.999)   end as upside_target_touched,
  case when weekly_downside_target is not null then (wk_low <= weekly_downside_target*1.001 and wk_high >= weekly_downside_target*0.999) end as downside_target_touched
from wk;

-- ── HEADLINE RATES (overall, with n per level) ──────────────────────────────
create or replace view alma_intraday_touch_rates as
select
  count(centroid_touched)                            as centroid_n,
  round(100.0*avg(centroid_touched::int), 1)         as centroid_pct,
  round(100.0*avg(upside_pivot_touched::int), 1)     as upside_pivot_pct,
  round(100.0*avg(downside_pivot_touched::int), 1)   as downside_pivot_pct,
  round(100.0*avg(upside_target_touched::int), 1)    as upside_target_pct,
  round(100.0*avg(downside_target_touched::int), 1)  as downside_target_pct
from alma_intraday_touches;

create or replace view alma_weekly_touch_rates as
select
  count(centroid_touched)                            as weeks_n,
  round(100.0*avg(centroid_touched::int), 1)         as centroid_pct,
  round(100.0*avg(upside_pivot_touched::int), 1)     as upside_pivot_pct,
  round(100.0*avg(downside_pivot_touched::int), 1)   as downside_pivot_pct,
  round(100.0*avg(upside_target_touched::int), 1)    as upside_target_pct,
  round(100.0*avg(downside_target_touched::int), 1)  as downside_target_pct
from alma_weekly_touches;

-- ── TIME SERIES: monthly touch rate (how it changes over time) ──────────────
create or replace view alma_intraday_touch_rates_monthly as
select
  date_trunc('month', date)::date as month,
  count(*)                                            as sessions,
  round(100.0*avg(centroid_touched::int), 1)         as centroid_pct,
  round(100.0*avg(upside_pivot_touched::int), 1)     as upside_pivot_pct,
  round(100.0*avg(downside_pivot_touched::int), 1)   as downside_pivot_pct
from alma_intraday_touches
group by 1
order by 1;

-- Grants (service role = what the dashboard/API uses; SQL editor uses postgres)
grant select on
  alma_intraday_touches, alma_weekly_touches,
  alma_intraday_touch_rates, alma_weekly_touch_rates,
  alma_intraday_touch_rates_monthly
to service_role, authenticated;

-- ============================================================================
-- READY-TO-RUN QUERIES
-- ============================================================================
-- 1. Headline intraday touch rates (compare to the backtest's rules table):
--    select * from alma_intraday_touch_rates;
--
-- 2. Headline weekly touch rates:
--    select * from alma_weekly_touch_rates;
--
-- 3. Monthly drift — watch a level's rate move over time:
--    select * from alma_intraday_touch_rates_monthly;
--
-- 4. Cumulative (running) centroid touch rate as of each session:
--    select date,
--      round(100.0*avg(centroid_touched::int)
--            over (order by date rows between unbounded preceding and current row), 1)
--        as cum_centroid_pct
--    from alma_intraday_touches
--    where centroid_touched is not null
--    order by date;
--
-- 5. Trailing 20-session centroid rate (rolling window):
--    select date,
--      round(100.0*avg(centroid_touched::int)
--            over (order by date rows between 19 preceding and current row), 1)
--        as roll20_centroid_pct
--    from alma_intraday_touches
--    where centroid_touched is not null
--    order by date;
-- ============================================================================
