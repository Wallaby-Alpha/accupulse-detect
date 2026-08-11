CREATE TABLE public.weex_trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  alert_price numeric NOT NULL,
  alerted_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending_velocity',
  velocity_pct numeric,
  entry_price numeric,
  stop_price numeric,
  target_price numeric,
  quantity numeric,
  entry_order_id text,
  tp_order_id text,
  sl_order_id text,
  placed_at timestamptz,
  filled_at timestamptz,
  fill_price numeric,
  closed_at timestamptz,
  close_price numeric,
  close_reason text,
  realized_pnl numeric,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX weex_trades_status_idx ON public.weex_trades (status, alerted_at DESC);

CREATE TABLE public.trade_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id uuid REFERENCES public.weex_trades(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  event text NOT NULL,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX trade_events_created_idx ON public.trade_events (created_at DESC);

GRANT ALL ON public.weex_trades TO service_role;
GRANT ALL ON public.trade_events TO service_role;

ALTER TABLE public.weex_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trade_events ENABLE ROW LEVEL SECURITY;