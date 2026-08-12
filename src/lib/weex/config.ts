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

export function planPrices(alertPrice: number) {
  const riskUsd = WEEX_CONFIG.FIXED_RISK_USD;
  const entry = alertPrice * (1 + WEEX_CONFIG.ENTRY_OFFSET);
  const stop = entry * (1 + WEEX_CONFIG.STOP_OFFSET);
  const target = entry * (1 + WEEX_CONFIG.TARGET_OFFSET);
  const riskPerCoin = Math.abs(entry - stop);
  const quantity = riskUsd / riskPerCoin;
  return { entry, stop, target, quantity };
}
