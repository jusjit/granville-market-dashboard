-- Create tables for Reference Data panel snapshots (VIX Futures + CME FedWatch)

-- VIX Futures monthly contracts snapshots
CREATE TABLE IF NOT EXISTS vix_futures_snapshots (
  id BIGSERIAL PRIMARY KEY,
  captured_at TIMESTAMP WITH TIME ZONE NOT NULL,
  contracts JSONB NOT NULL,  -- {"F1": 16.45, "F2": 17.82, "F3": 18.10, ...}
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- CME FedWatch (Fed Funds rate probabilities) snapshots
CREATE TABLE IF NOT EXISTS fed_watch_snapshots (
  id BIGSERIAL PRIMARY KEY,
  captured_at TIMESTAMP WITH TIME ZONE NOT NULL,
  rates JSONB NOT NULL,  -- {"1.25-1.50": 12.5, "1.50-1.75": 45.2, "1.75-2.00": 38.1, ...}
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_vix_futures_captured ON vix_futures_snapshots(captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_fed_watch_captured ON fed_watch_snapshots(captured_at DESC);
