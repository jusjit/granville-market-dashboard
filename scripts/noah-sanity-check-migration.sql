-- Noah Predict sanity-check log table
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor)
-- REMEMBER: raw SQL tables need explicit GRANTs (see CLAUDE.md gotcha)

CREATE TABLE IF NOT EXISTS noah_sanity_check_log (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL UNIQUE,
  theme TEXT NOT NULL,
  geo_monitor_read JSONB NOT NULL,
  noah_read JSONB NOT NULL,
  market_state_at_log_time JSONB NOT NULL,
  market_outcome_7d JSONB,
  market_outcome_30d JSONB,
  noah_job_id TEXT,
  status TEXT NOT NULL DEFAULT 'completed',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

GRANT ALL ON TABLE noah_sanity_check_log TO anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE noah_sanity_check_log_id_seq TO anon, authenticated, service_role;

COMMENT ON TABLE noah_sanity_check_log IS 'Weekly Noah Predict sanity check — compares geo monitor trajectory with Noah risk_current_read';
COMMENT ON COLUMN noah_sanity_check_log.theme IS 'Highest-severity theme from Trajectory Layer that week (e.g. oil_shock_risk, carry_unwind)';
COMMENT ON COLUMN noah_sanity_check_log.geo_monitor_read IS 'Trajectory Layer state at run time: severity, confidence, recent signals';
COMMENT ON COLUMN noah_sanity_check_log.noah_read IS 'Noah risk_current_read signal state + evidence summary';
COMMENT ON COLUMN noah_sanity_check_log.market_state_at_log_time IS 'Relevant market prices at log time (WTI/Brent for oil, USD/JPY for carry, etc)';
COMMENT ON COLUMN noah_sanity_check_log.market_outcome_7d IS 'Market levels 7 days after log — backfilled later';
COMMENT ON COLUMN noah_sanity_check_log.market_outcome_30d IS 'Market levels 30 days after log — backfilled later';
COMMENT ON COLUMN noah_sanity_check_log.status IS 'completed | quota_exceeded | error';
