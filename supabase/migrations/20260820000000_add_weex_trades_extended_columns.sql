-- Add all extended state columns that the engine references but were never migrated.
-- Every column uses IF NOT EXISTS and nullable defaults so existing rows are unaffected.

ALTER TABLE public.weex_trades
  ADD COLUMN IF NOT EXISTS t1_quantity        numeric,
  ADD COLUMN IF NOT EXISTS t2_quantity        numeric,
  ADD COLUMN IF NOT EXISTS t1_fill_price      numeric,
  ADD COLUMN IF NOT EXISTS t2_limit_price     numeric,
  ADD COLUMN IF NOT EXISTS t2_fill_price      numeric,
  ADD COLUMN IF NOT EXISTS t2_order_id        text,
  ADD COLUMN IF NOT EXISTS t2_placed_at       timestamptz,
  ADD COLUMN IF NOT EXISTS t2_filled          boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS t2_expired         boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS t2_error           text,
  ADD COLUMN IF NOT EXISTS tp1_price          numeric,
  ADD COLUMN IF NOT EXISTS tp2_price          numeric,
  ADD COLUMN IF NOT EXISTS tp1_filled         boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS tp1_order_id       text,
  ADD COLUMN IF NOT EXISTS tp2_order_id       text,
  ADD COLUMN IF NOT EXISTS sl_moved_to_be     boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS high_water_price   numeric,
  ADD COLUMN IF NOT EXISTS remaining_quantity  numeric;
