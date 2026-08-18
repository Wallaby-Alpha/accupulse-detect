import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { WEEX_CONFIG as FALLBACK_CONFIG } from "./config";

export interface TradingSettings {
  id?: string;
  is_trading_enabled: boolean;
  tp_percent: number;
  sl_percent: number;
  pullback_percent: number;
  notional_size_usd: number;
}

/**
 * Fetches the trading settings from the database.
 * Falls back to env/config defaults if the table is empty or on error.
 */
export async function getTradingSettings(): Promise<TradingSettings> {
  try {
    const { data, error } = await (supabaseAdmin as any)
      .from("trading_settings")
      .select("*")
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      // Fallback if not set up
      return {
        is_trading_enabled: true,
        tp_percent: FALLBACK_CONFIG.TP2_OFFSET * 100,
        sl_percent: Math.abs(FALLBACK_CONFIG.STOP_OFFSET) * 100,
        pullback_percent: Math.abs(FALLBACK_CONFIG.PULLBACK_OFFSET) * 100,
        notional_size_usd: FALLBACK_CONFIG.NOTIONAL_POSITION_USD,
      };
    }

    return {
      id: data.id,
      is_trading_enabled: data.is_trading_enabled,
      tp_percent: Number(data.tp_percent),
      sl_percent: Number(data.sl_percent),
      pullback_percent: Number(data.pullback_percent),
      notional_size_usd: Number(data.notional_size_usd),
    };
  } catch (err) {
    console.error("[Settings] Failed to fetch trading_settings:", err);
    return {
      is_trading_enabled: true,
      tp_percent: FALLBACK_CONFIG.TP2_OFFSET * 100,
      sl_percent: Math.abs(FALLBACK_CONFIG.STOP_OFFSET) * 100,
      pullback_percent: Math.abs(FALLBACK_CONFIG.PULLBACK_OFFSET) * 100,
      notional_size_usd: FALLBACK_CONFIG.NOTIONAL_POSITION_USD,
    };
  }
}

/**
 * Updates the trading settings. Ensures only one row exists.
 */
export async function updateTradingSettings(updates: Partial<TradingSettings>): Promise<void> {
  const current = await getTradingSettings();

  if (current.id) {
    await (supabaseAdmin as any)
      .from("trading_settings")
      .update(updates as any)
      .eq("id", current.id);
  } else {
    // If no row exists, create the first one
    await (supabaseAdmin as any).from("trading_settings").insert([
      {
        is_trading_enabled: updates.is_trading_enabled ?? current.is_trading_enabled,
        tp_percent: updates.tp_percent ?? current.tp_percent,
        sl_percent: updates.sl_percent ?? current.sl_percent,
        pullback_percent: updates.pullback_percent ?? current.pullback_percent,
        notional_size_usd: updates.notional_size_usd ?? current.notional_size_usd,
      } as any,
    ]);
  }
}
