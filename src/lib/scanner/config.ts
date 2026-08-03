export const SCANNER_CONFIG = {
  GATES: {
    MIN_24H_VOLUME_USD: 250000,
    MAX_SPREAD_BPS: 80,
    MIN_LOOKBACK_CANDLES: 100,
    MAX_EMA20_EXTENSION_PCT: 0.2,
    TIMEFRAME_CONFLUENCE_ENABLED: true,
  },
  BASE_WEIGHTS: {
    relative_strength_vs_btc: 0.2,
    volatility_compression: 0.2,
    trend_structure: 0.15,
    volume_acceleration: 0.15,
    multi_timeframe_alignment: 0.1,
    breakout_readiness: 0.1,
    liquidity_spread: 0.05,
    order_book_imbalance: 0.05,
  },
  BOOSTS: {
    support_bounce_boost: 0.08,
    volume_ramp_slope_boost: 0.07,
    squeeze_expansion_trigger_boost: 0.1,
  },
  PENALTIES: {
    overextension_penalty: 0.5,
    timeframe_conflict_penalty: 0.3,
    erratic_wick_penalty: 0.25,
  },
  THRESHOLDS: {
    SCORE_ALERT_THRESHOLD: 0.55,
    TOP_COINS_PER_SCAN: 10,
    RE_ALERT_COOLDOWN_MINUTES: 120,
  },
  SCAN_CONFIG: {
    SCAN_INTERVAL_SECONDS: 300,
    CANDLE_INTERVAL: "60m",
    UNIVERSE_SIZE: 150,
    DEPTH_CANDIDATES: 25,
  },
} as const;

export type ScannerConfig = typeof SCANNER_CONFIG;
