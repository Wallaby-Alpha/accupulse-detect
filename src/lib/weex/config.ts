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
  /** Fixed dollar risk per trade ($2.00): hitting the stop loses this amount. */
  get FIXED_RISK_USD(): number {
    return parseEnvNum("FIXED_RISK_USD", parseEnvNum("RISK_AMOUNT_USD", 2.0));
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
  /** Take profit offset from the limit entry fill. */
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
  /** Leverage used for position. */
  LEVERAGE: 5,
};

/** MEXC spot symbol (BTCUSDT) -> WEEX contract symbol (cmt_btcusdt). */
export function toWeexSymbol(mexcSymbol: string): string {
  return `cmt_${mexcSymbol.toLowerCase()}`;
}

/**
 * Position Sizing Math Verification:
 * RISK_AMOUNT_USD = $2.00 represents the MAXIMUM DOLLAR LOSS on a -1.5% Stop Loss.
 *
 * Formula:
 *   Notional_Position_USD = RISK_AMOUNT_USD / Math.abs(STOP_LOSS_PCT)
 *   (e.g., 2.0 / 0.015 = $133.3333 USD Notional Value)
 *
 *   Contract_Quantity = Notional_Position_USD / Limit_Entry_Price
 */
export function planPrices(alertPrice: number) {
  const riskAmountUsd = WEEX_CONFIG.FIXED_RISK_USD; // 2.00
  const stopLossPct = Math.abs(WEEX_CONFIG.STOP_OFFSET); // 0.015

  const entry = alertPrice * (1 + WEEX_CONFIG.ENTRY_OFFSET);
  const stop = entry * (1 + WEEX_CONFIG.STOP_OFFSET);
  const target = entry * (1 + WEEX_CONFIG.TARGET_OFFSET);

  // 1. Calculate Notional Position Size ($133.33 USD)
  const notionalPositionUsd = riskAmountUsd / stopLossPct;

  // 2. Calculate Contract Quantity = Notional_Position_USD / Limit_Entry_Price
  const quantity = notionalPositionUsd / entry;

  return { entry, stop, target, quantity, notionalPositionUsd };
}
