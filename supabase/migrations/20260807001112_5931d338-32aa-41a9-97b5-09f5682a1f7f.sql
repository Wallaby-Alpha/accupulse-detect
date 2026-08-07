CREATE TABLE public.alert_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol TEXT NOT NULL,
  alerted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  alert_price NUMERIC NOT NULL,
  stage TEXT,
  score NUMERIC,
  max_runup_pct NUMERIC NOT NULL DEFAULT 0,
  tracking_done BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX idx_alert_history_symbol_time ON public.alert_history (symbol, alerted_at DESC);
CREATE INDEX idx_alert_history_tracking ON public.alert_history (tracking_done, alerted_at DESC);
GRANT ALL ON public.alert_history TO service_role;
ALTER TABLE public.alert_history ENABLE ROW LEVEL SECURITY;