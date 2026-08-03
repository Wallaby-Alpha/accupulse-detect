CREATE TABLE public.alert_cooldowns (
  symbol TEXT PRIMARY KEY,
  last_alert_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_score NUMERIC NOT NULL DEFAULT 0,
  last_stage TEXT
);
GRANT ALL ON public.alert_cooldowns TO service_role;
ALTER TABLE public.alert_cooldowns ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.scan_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  scanned INTEGER NOT NULL DEFAULT 0,
  passed_gates INTEGER NOT NULL DEFAULT 0,
  alerts_sent INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  error TEXT
);
GRANT ALL ON public.scan_runs TO service_role;
ALTER TABLE public.scan_runs ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_scan_runs_created_at ON public.scan_runs (created_at DESC);