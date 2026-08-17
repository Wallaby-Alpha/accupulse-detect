/** WEEX live contract trading configuration. */

export const WEEX_BASE_URL = "https://api-contract.weex.com";

function parseEnvNum(key: string, fallback: number): number {
  const val = process.env[key];
  if (val !== undefined && val !== "") {
    const parsed = Number(val);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export const WEEX_CONFIG = {
  /** Fixed Notional Position Value ($140.00 USD). */
  get NOTIONAL_POSITION_USD(): number {
    return parseEnvNum("NOTIONAL_POSITION_USD", parseEnvNum("NOTIONAL_USD", 140.0));
  },
  /** Legacy risk usd getter for backward compatibility. */
  get FIXED_RISK_USD(): number {
    return parseEnvNum("FIXED_RISK_USD", parseEnvNum("RISK_AMOUNT_USD", 2.1));
  },
  /** Velocity filter window after the alert. */
  get VELOCITY_DELAY_MINUTES(): number {
    return parseEnvNum("VELOCITY_DELAY_MINUTES", 5);
  },
  /** Discard the signal if the 5m move is at or below this. */
  get VELOCITY_MAX_DROP(): number {
    return parseEnvNum("VELOCITY_MAX_DROP", -0.015);
  },
  /** Limit entry offset from alert price. */
  get ENTRY_OFFSET(): number {
    return parseEnvNum("ENTRY_OFFSET", -0.025);
  },
  /** Stop loss offset from the limit entry fill. */
  get STOP_OFFSET(): number {
    return parseEnvNum("STOP_OFFSET", -0.015);
  },
  /** Initial TP1 offset (+2.0%). */
  get TP1_OFFSET(): number {
    return parseEnvNum("TP1_OFFSET", 0.020);
  },
  /** Runner TP2 offset (+3.5% default, up to +5.0%). */
  get TP2_OFFSET(): number {
    return parseEnvNum("TP2_OFFSET", parseEnvNum("TARGET_OFFSET", 0.035));
  },
  /** Break-even stop loss trigger offset (+1.5% MFE). */
  get BREAKEVEN_TRIGGER_OFFSET(): number {
    return parseEnvNum("BREAKEVEN_TRIGGER_OFFSET", 0.015);
  },
  /** Take profit offset from the limit entry fill (legacy target alias). */
  get TARGET_OFFSET(): number {
    return parseEnvNum("TARGET_OFFSET", 0.035);
  },
  /** Cancel an unfilled limit buy after this many hours. */
  get ORDER_EXPIRY_HOURS(): number {
    return parseEnvNum("ORDER_EXPIRY_HOURS", 2);
  },
  /** Hard market close this long after the entry fills. */
  get TIME_EXIT_MINUTES(): number {
    return parseEnvNum("TIME_EXIT_MINUTES", 60);
  },
  /** Dynamic leverage used for position (5x). */
  LEVERAGE: 5,
};

/** MEXC spot symbol (BTCUSDT) -> WEEX contract symbol (cmt_btcusdt). */
export function toWeexSymbol(mexcSymbol: string): string {
  const clean = String(mexcSymbol || "").trim().toLowerCase();
  return clean.startsWith("cmt_") ? clean : `cmt_${clean}`;
}

/**
 * Fixed $140.00 Notional Position Sizing & Split Target Architecture:
 * Target Notional Position Value = $140.00 USD
 * Contract Quantity = $140.00 / Limit Entry Price
 *
 * TP1 (+2.0%) = 50% Position Size
 * TP2 (+3.5% to +5.0%) = 50% Runner Size
 * Initial SL (-1.5%) = 100% Position Size
 * Break-Even Trigger (+1.5% MFE) = Move SL to Entry Price
 */
export function planPrices(alertPrice: number) {
  const notionalPositionUsd = WEEX_CONFIG.NOTIONAL_POSITION_USD; // $140.00 USD
  const entry = alertPrice * (1 + WEEX_CONFIG.ENTRY_OFFSET);
  const stop = entry * (1 + WEEX_CONFIG.STOP_OFFSET);
  const tp1 = entry * (1 + WEEX_CONFIG.TP1_OFFSET);
  const tp2 = entry * (1 + WEEX_CONFIG.TP2_OFFSET);
  const breakevenTrigger = entry * (1 + WEEX_CONFIG.BREAKEVEN_TRIGGER_OFFSET);

  // Contract Quantity = $140.00 / Limit Entry Price
  const quantity = notionalPositionUsd / entry;

  return { entry, stop, tp1, tp2, target: tp2, breakevenTrigger, quantity, notionalPositionUsd };
}
