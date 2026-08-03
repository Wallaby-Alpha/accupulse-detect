import { SCANNER_CONFIG, type ScannerConfig } from "./config";
import type { Depth, Kline, Ticker } from "./mexc";
import {
  clip,
  closes,
  ema,
  highs,
  last,
  lows,
  mean,
  rollingMean,
  sma,
  stdev,
  trueRange,
  volumes,
} from "./indicators";

export type SymbolData = {
  ticker: Ticker;
  klines1h: Kline[];
  klines4h: Kline[];
  klines1d: Kline[];
  btcKlines1h: Kline[];
  depth?: Depth | null;
};

export type ScoreResult = {
  symbol: string;
  currentPrice: number;
  finalScore: number;
  baseScore: number;
  stage: string;
  shouldAlert: boolean;
  status: string;
  boosts: { supportBounce: number; volumeRamp: number; squeezeExpansion: number };
  penalties: string[];
  trend4h: "BULLISH" | "BEARISH" | "NEUTRAL";
  trend1d: "BULLISH" | "BEARISH" | "NEUTRAL";
  components: {
    relativeStrength: number;
    volatilityCompression: number;
    trendStructure: number;
    volumeAcceleration: number;
    breakoutReadiness: number;
    orderBookImbalance: number;
  };
  extras: { distanceToHighPct: number; ema20ExtensionPct: number };
};

/* ---------------- Stage 0 hard gates ---------------- */

export function checkHardGates(
  data: SymbolData,
  config: ScannerConfig = SCANNER_CONFIG,
): { pass: boolean; reason: string } {
  const g = config.GATES;
  const k = data.klines1h;

  if (k.length < g.MIN_LOOKBACK_CANDLES) return { pass: false, reason: "insufficient_history" };

  const vol24hUsd = Number(data.ticker.quoteVolume);
  if (!Number.isFinite(vol24hUsd) || vol24hUsd < g.MIN_24H_VOLUME_USD)
    return { pass: false, reason: "low_volume" };

  const bid = Number(data.ticker.bidPrice);
  const ask = Number(data.ticker.askPrice);
  if (!bid || !ask) return { pass: false, reason: "empty_order_book" };

  const spreadBps = ((ask - bid) / bid) * 10000;
  if (spreadBps > g.MAX_SPREAD_BPS)
    return { pass: false, reason: `spread_too_wide_${spreadBps.toFixed(0)}bps` };

  const c = closes(k);
  const ema20 = last(ema(c, 20));
  const price = last(c);
  const extension = (price - ema20) / ema20;
  if (extension > g.MAX_EMA20_EXTENSION_PCT)
    return {
      pass: false,
      reason: `overextended_${(extension * 100).toFixed(1)}pct_above_ema20`,
    };

  if (g.TIMEFRAME_CONFLUENCE_ENABLED && data.klines1d.length >= 20) {
    const dc = closes(data.klines1d);
    const dEma20 = last(ema(dc, 20));
    if (last(dc) < dEma20 * 0.95) return { pass: false, reason: "macro_daily_bearish" };
  }

  return { pass: true, reason: "passed" };
}

/* ---------------- Base signals ---------------- */

export function relativeStrengthScore(coin: Kline[], btc: Kline[]): number {
  if (coin.length < 24 || btc.length < 24) return 0.5;
  const c = closes(coin);
  const b = closes(btc);
  const perf = (s: number[], n: number) =>
    (s[s.length - 1]! - s[s.length - 1 - n]!) / s[s.length - 1 - n]!;
  const rs6h = perf(c, 6) - perf(b, 6);
  const rs24h = perf(c, 24) - perf(b, 24);
  const rs = 0.65 * rs6h + 0.35 * rs24h;
  return clip((rs + 0.01) / 0.04, 0, 1);
}

export function volatilityCompressionScore(k: Kline[]): number {
  const c = closes(k);
  const tr = trueRange(k);
  const bbw: number[] = c.map((_, i) => {
    if (i < 19) return NaN;
    const m = sma(c, 20, i);
    const s = stdev(c, 20, i);
    return m ? (s * 4) / m : NaN;
  });
  const tail = bbw.slice(-50).filter(Number.isFinite);
  const bbwNow = last(bbw);
  const lo = Math.min(...tail);
  const hi = Math.max(...tail);
  const pct = (bbwNow - lo) / (hi - lo + 1e-8);
  const bbwScore = 1 - clip(pct, 0, 1);

  const atr = rollingMean(tr, 20);
  const atrTail = atr.slice(-50).filter(Number.isFinite);
  const atrRatio = last(atr) / (mean(atrTail) + 1e-8);
  const atrScore = 1 - clip((atrRatio - 0.5) / 0.8, 0, 1);

  return clip(0.6 * bbwScore + 0.4 * atrScore, 0, 1);
}

export function trendStructureScore(k: Kline[]): number {
  const c = closes(k);
  if (c.length < 50) return 0;
  const e20 = ema(c, 20);
  const e50 = ema(c, 50);
  const price = last(c);
  let score = 0;
  if (price > last(e20)) score += 0.35;
  if (last(e20) > last(e50)) score += 0.35;
  if (last(e20) > e20[e20.length - 3]!) score += 0.3;
  return score;
}

export function volumeAccelerationScore(k: Kline[]): number {
  const v = volumes(k);
  if (v.length < 25) return 0;
  const recent5 = mean(v.slice(-5));
  const prev20 = mean(v.slice(-25, -5)) + 1e-8;
  const ratio = recent5 / prev20;
  if (ratio >= 1.2 && ratio <= 3.0) return clip((ratio - 1.2) / 1.8, 0.4, 1);
  if (ratio > 3.0) return 0.5;
  return clip(ratio / 1.2, 0, 0.4);
}

export function breakoutReadinessScore(k: Kline[]): {
  score: number;
  distancePct: number;
} {
  const c = closes(k);
  const h = highs(k);
  const price = last(c);
  const periodHigh = Math.max(...h.slice(-20));
  const distance = (periodHigh - price) / price;
  if (distance >= 0 && distance <= 0.03)
    return { score: 1 - distance / 0.03, distancePct: distance * 100 };
  return { score: 0, distancePct: distance * 100 };
}

export function trendOf(k: Kline[]): "BULLISH" | "BEARISH" | "NEUTRAL" {
  const c = closes(k);
  if (c.length < 50) return "NEUTRAL";
  const e20 = last(ema(c, 20));
  const e50 = last(ema(c, 50));
  const price = last(c);
  if (price > e20 && e20 > e50) return "BULLISH";
  if (price < e20 && e20 < e50) return "BEARISH";
  return "NEUTRAL";
}

/* ---------------- Structural boosts ---------------- */

export function supportBounceBoost(k: Kline[], boost: number): number {
  const c = closes(k);
  const l = lows(k);
  const recentLow = Math.min(...l.slice(-5));
  const support = Math.min(...l.slice(-30));
  if (Math.abs(recentLow - support) / support < 0.015) {
    if (last(c) > c[c.length - 2]! && c[c.length - 2]! > recentLow) return boost;
  }
  return 0;
}

export function volumeRampSlopeBoost(k: Kline[], boost: number): number {
  const v = volumes(k);
  if (v.length < 20) return 0;
  const a = mean(v.slice(-20, -10));
  const b = mean(v.slice(-10, -5));
  const c = mean(v.slice(-5));
  return c > b && b > a && c / (a + 1e-8) < 6 ? boost : 0;
}

export function squeezeExpansionBoost(k: Kline[], boost: number): number {
  const tr = trueRange(k);
  const atr = rollingMean(tr, 20).filter(Number.isFinite);
  if (atr.length < 10) return 0;
  const prior = mean(atr.slice(-10, -2));
  const now = last(atr);
  const c = closes(k);
  const expanding = now > prior * 1.15;
  const upside = last(c) > c[c.length - 2]!;
  return expanding && upside ? boost : 0;
}

export function erraticWicks(k: Kline[]): boolean {
  const recent = k.slice(-10);
  const ratios = recent.map((c) => {
    const high = Number(c[2]);
    const low = Number(c[3]);
    const open = Number(c[1]);
    const close = Number(c[4]);
    const body = Math.abs(close - open) + 1e-8;
    return (high - low) / body;
  });
  return mean(ratios) > 6;
}

/* ---------------- Pipeline ---------------- */

export function scoreSymbol(
  data: SymbolData,
  config: ScannerConfig = SCANNER_CONFIG,
): ScoreResult {
  const symbol = data.ticker.symbol;
  const price = Number(data.ticker.lastPrice);
  const gate = checkHardGates(data, config);

  const empty: ScoreResult = {
    symbol,
    currentPrice: price,
    finalScore: 0,
    baseScore: 0,
    stage: "Stage 0 (Noise)",
    shouldAlert: false,
    status: `GATED: ${gate.reason}`,
    boosts: { supportBounce: 0, volumeRamp: 0, squeezeExpansion: 0 },
    penalties: [],
    trend4h: "NEUTRAL",
    trend1d: "NEUTRAL",
    components: {
      relativeStrength: 0,
      volatilityCompression: 0,
      trendStructure: 0,
      volumeAcceleration: 0,
      breakoutReadiness: 0,
      orderBookImbalance: 0,
    },
    extras: { distanceToHighPct: 0, ema20ExtensionPct: 0 },
  };
  if (!gate.pass) return empty;

  const k = data.klines1h;
  const w = config.BASE_WEIGHTS;

  const sRs = relativeStrengthScore(k, data.btcKlines1h);
  const sVc = volatilityCompressionScore(k);
  const sTs = trendStructureScore(k);
  const sVa = volumeAccelerationScore(k);
  const trend4h = trendOf(data.klines4h);
  const trend1d = trendOf(data.klines1d);
  const sMtf = trend4h === "BULLISH" ? 1 : trend4h === "BEARISH" ? 0.2 : 0.5;
  const br = breakoutReadinessScore(k);
  const sLs = 1;

  let sOb = 0.5;
  if (data.depth?.bids?.length && data.depth?.asks?.length) {
    const bidVol = data.depth.bids.slice(0, 10).reduce((a, b) => a + Number(b[1]), 0);
    const askVol =
      data.depth.asks.slice(0, 10).reduce((a, b) => a + Number(b[1]), 0) + 1e-8;
    sOb = clip(bidVol / askVol / 2, 0, 1);
  }

  const baseScore =
    sRs * w.relative_strength_vs_btc +
    sVc * w.volatility_compression +
    sTs * w.trend_structure +
    sVa * w.volume_acceleration +
    sMtf * w.multi_timeframe_alignment +
    br.score * w.breakout_readiness +
    sLs * w.liquidity_spread +
    sOb * w.order_book_imbalance;

  const bSupport = supportBounceBoost(k, config.BOOSTS.support_bounce_boost);
  const bRamp = volumeRampSlopeBoost(k, config.BOOSTS.volume_ramp_slope_boost);
  const bSqueeze = squeezeExpansionBoost(
    k,
    config.BOOSTS.squeeze_expansion_trigger_boost,
  );
  const boosted = Math.min(baseScore + bSupport + bRamp + bSqueeze, 1);

  const penalties: string[] = [];
  let mult = 1;
  if (trend4h === "BEARISH") {
    mult *= 1 - config.PENALTIES.timeframe_conflict_penalty;
    penalties.push("4h timeframe conflict");
  }
  const c = closes(k);
  const ema20 = last(ema(c, 20));
  const extension = (last(c) - ema20) / ema20;
  if (extension > config.GATES.MAX_EMA20_EXTENSION_PCT * 0.75) {
    mult *= 1 - config.PENALTIES.overextension_penalty;
    penalties.push("late-stage extension");
  }
  if (erraticWicks(k)) {
    mult *= 1 - config.PENALTIES.erratic_wick_penalty;
    penalties.push("erratic wicks");
  }

  const finalScore = Math.round(boosted * mult * 100) / 100;

  let stage: string;
  if (sVc > 0.7 && sVa < 0.5) stage = "Stage 2 (Compression Squeeze)";
  else if (br.score > 0.6 && sVa >= 0.5) stage = "Stage 3 (Breakout Readiness)";
  else if (sRs > 0.6) stage = "Stage 1 (Quiet Accumulation)";
  else stage = "Stage 4 (Active Expansion)";

  return {
    symbol,
    currentPrice: price,
    finalScore,
    baseScore: Math.round(baseScore * 100) / 100,
    stage,
    shouldAlert: finalScore >= config.THRESHOLDS.SCORE_ALERT_THRESHOLD,
    status: "OK",
    boosts: {
      supportBounce: bSupport,
      volumeRamp: bRamp,
      squeezeExpansion: bSqueeze,
    },
    penalties,
    trend4h,
    trend1d,
    components: {
      relativeStrength: round2(sRs),
      volatilityCompression: round2(sVc),
      trendStructure: round2(sTs),
      volumeAcceleration: round2(sVa),
      breakoutReadiness: round2(br.score),
      orderBookImbalance: round2(sOb),
    },
    extras: {
      distanceToHighPct: Math.round(br.distancePct * 100) / 100,
      ema20ExtensionPct: Math.round(extension * 10000) / 100,
    },
  };
}

const round2 = (v: number) => Math.round(v * 100) / 100;
