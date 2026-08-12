/** WEEX live contract trading configuration. */

export const WEEX_BASE_URL = "https://api-contract.weex.com";

export const WEEX_CONFIG = {
  /** Fixed dollar risk per trade ($2.00): hitting the stop loses this amount. */
  FIXED_RISK_USD: Number(process.env["RISK_AMOUNT_USD"]) || 2.0,
  /** Velocity filter window after the alert. */
  VELOCITY_DELAY_MINUTES: 5,
  /** Discard the signal if the 5m move is at or below this. */
  VELOCITY_MAX_DROP: -0.015,
  /** Limit entry offset from alert price. */
  ENTRY_OFFSET: -0.025,
  /** Stop loss offset from the limit entry fill. */
  STOP_OFFSET: -0.015,
  /** Take profit offset from the limit entry fill. */
  TARGET_OFFSET: 0.035,
  /** Cancel an unfilled limit buy after this many hours. */
  ORDER_EXPIRY_HOURS: 2,
  /** Hard market close this long after the entry fills. */
  TIME_EXIT_MINUTES: 60,
  /** Leverage used for position. */
  LEVERAGE: 5,
} as const;

/** MEXC spot symbol (BTCUSDT) -> WEEX contract symbol (cmt_btcusdt). */
export function toWeexSymbol(mexcSymbol: string): string {
  return `cmt_${mexcSymbol.toLowerCase()}`;
}

export function planPrices(alertPrice: number) {
  const riskUsd = Number(process.env["RISK_AMOUNT_USD"]) || WEEX_CONFIG.FIXED_RISK_USD || 2.0;
  const entry = alertPrice * (1 + WEEX_CONFIG.ENTRY_OFFSET);
  const stop = entry * (1 + WEEX_CONFIG.STOP_OFFSET);
  const target = entry * (1 + WEEX_CONFIG.TARGET_OFFSET);
  const riskPerCoin = Math.abs(entry - stop);
  const quantity = riskUsd / riskPerCoin;
  return { entry, stop, target, quantity };
}
