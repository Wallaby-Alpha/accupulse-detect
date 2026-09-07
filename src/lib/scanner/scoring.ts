import { SCANNER_CONFIG, type ScannerConfig } from "./config";
import type { Depth, Kline, Ticker } from "./mexc";
import {
  atr,
  clip,
  closes,
  ema,
  highs,
  last,
  lows,
  mean,
  rollingMean,
  rsi,
  sma,
  stdev,
  trueRange,
  volumes,
} from "./indicators";

const BLACKLIST = new Set([
  "SN85/USDT", "SN64/USDT", "BOSON/USDT", "EUR/USDT", "NOS/USDT",
  "ALEO/USDT", "TLOS/USDT", "XMR/USDT", "EIGEN/USDT", "FAR/USDT",
  "TTMION/USDT", "ROAM/USDT", "NOCON/USDT", "NAVX/USDT", "INODON/USDT",
  "NEMON/USDT", "FON/USDT", "GOATED/USDT"
].map(s => s.replace("/", "")));

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
  const k = data.klines1h; // in 5m mode, this holds 5m klines

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
    
  if (BLACKLIST.has(data.ticker.symbol)) {
    return { pass: false, reason: "blacklisted" };
  }

  // BTC condition: below 5m EMA(50)
  if (data.btcKlines1h && data.btcKlines1h.length >= 50) {
    const btcCloses = closes(data.btcKlines1h);
    const btcEma50 = last(ema(btcCloses, 50));
    const btcPrice = last(btcCloses);
    if (btcPrice >= btcEma50) {
      return { pass: false, reason: "btc_above_ema50" };
    }
  } else {
    return { pass: false, reason: "insufficient_btc_history" };
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
  const c = closes(k);
  const v = volumes(k);
  
  // Rule 1: RSI(14) < 25
  const rsiVals = rsi(c, 14);
  const currentRsi = last(rsiVals);
  if (currentRsi >= 25) {
    return { ...empty, status: `GATED: rsi_too_high_${currentRsi.toFixed(1)}` };
  }
  
  // Rule 2: Current volume > 1.8 * Volume SMA(20)
  const volSma = sma(v, 20, v.length - 2); // SMA of previous 20 candles, or current? The rule says "Current volume > 1.8 * Volume SMA(20)". Let's just use sma(v, 20, v.length - 1)
  const volSma20 = sma(v, 20, v.length - 1);
  const currentVol = last(v);
  if (currentVol <= 1.8 * volSma20) {
    return { ...empty, status: `GATED: volume_too_low` };
  }
  
  // Rule 3: ATR(14) % is above threshold (Fixed at 1.5% minimum for high volatility)
  const atrVals = atr(k, 14);
  const currentAtr = last(atrVals);
  const atrPct = (currentAtr / price) * 100;
  if (atrPct < 1.5) {
    return { ...empty, status: `GATED: atr_pct_too_low_${atrPct.toFixed(2)}` };
  }

  // BTC Rule and Blacklist are handled in checkHardGates

  return {
    symbol,
    currentPrice: price,
    finalScore: 1.0,
    baseScore: 1.0,
    stage: "Long-Only Signal",
    shouldAlert: true,
    status: "OK",
    boosts: {
      supportBounce: 0,
      volumeRamp: 0,
      squeezeExpansion: 0,
    },
    penalties: [],
    trend4h: "NEUTRAL",
    trend1d: "NEUTRAL",
    components: {
      relativeStrength: currentRsi,
      volatilityCompression: atrPct,
      trendStructure: 0,
      volumeAcceleration: currentVol / volSma20,
      breakoutReadiness: 0,
      orderBookImbalance: 0,
    },
    extras: {
      distanceToHighPct: 0,
      ema20ExtensionPct: 0,
    },
  };
}

const round2 = (v: number) => Math.round(v * 100) / 100;
