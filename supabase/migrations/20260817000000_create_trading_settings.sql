CREATE TABLE IF NOT EXISTS trading_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    is_trading_enabled BOOLEAN NOT NULL DEFAULT true,
    tp_percent NUMERIC NOT NULL DEFAULT 3.5,
    sl_percent NUMERIC NOT NULL DEFAULT 1.5,
    pullback_percent NUMERIC NOT NULL DEFAULT 1.0,
    notional_size_usd NUMERIC NOT NULL DEFAULT 140.0,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- Ensure only one row ever exists (Optional but good practice for global settings)
CREATE UNIQUE INDEX IF NOT EXISTS ensure_single_row ON trading_settings ((true));

-- Insert default row
INSERT INTO trading_settings (is_trading_enabled) 
VALUES (true)
ON CONFLICT DO NOTHING;

-- Setup RLS
ALTER TABLE trading_settings ENABLE ROW LEVEL SECURITY;

-- Allow read access for everyone (so the UI can display it without auth)
CREATE POLICY "Public Read Access" ON trading_settings
    FOR SELECT USING (true);

-- Allow updates (you may want to restrict this later, but keeping simple for now)
CREATE POLICY "Public Update Access" ON trading_settings
    FOR UPDATE USING (true);
