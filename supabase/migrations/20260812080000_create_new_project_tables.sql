-- Create trades table
CREATE TABLE IF NOT EXISTS public.weex_trades (
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

-- Create trade events table
CREATE TABLE IF NOT EXISTS public.trade_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id uuid REFERENCES public.weex_trades(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  event text NOT NULL,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create scanner runs table
CREATE TABLE IF NOT EXISTS public.scan_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scanned integer,
  passed_gates integer,
  alerts_sent integer,
  duration_ms integer,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Disable RLS for seamless write access
ALTER TABLE public.weex_trades DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.trade_events DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.scan_runs DISABLE ROW LEVEL SECURITY;

GRANT ALL ON public.weex_trades TO anon, authenticated, service_role;
GRANT ALL ON public.trade_events TO anon, authenticated, service_role;
GRANT ALL ON public.scan_runs TO anon, authenticated, service_role;
