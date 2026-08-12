-- Grant access to anon and authenticated roles for weex_trades and trade_events
GRANT ALL ON public.weex_trades TO anon, authenticated;
GRANT ALL ON public.trade_events TO anon, authenticated;

-- Add RLS policies allowing all operations for weex_trades and trade_events
DROP POLICY IF EXISTS "Allow public all on weex_trades" ON public.weex_trades;
CREATE POLICY "Allow public all on weex_trades"
ON public.weex_trades FOR ALL
TO public
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public all on trade_events" ON public.trade_events;
CREATE POLICY "Allow public all on trade_events"
ON public.trade_events FOR ALL
TO public
USING (true)
WITH CHECK (true);
