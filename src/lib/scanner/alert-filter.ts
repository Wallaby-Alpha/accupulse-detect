/** Dispatch-side quality filters. Optimized based on MEXC MAE/MFE backtest analysis. */

import type { ScoreResult } from "./scoring";

export const STAGE_1 = "Stage 1 (Quiet Accumulation)";

/** High-liquidity majors where 15m accumulation rarely produces +3% expansions. */
export const MAJOR_CAP_EXCLUSIONS = new Set([
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "DOTUSDT",
  "DOGEUSDT",
  "LTCUSDT",
  "AVAXUSDT",
  "XRPUSDT",
  "SUIUSDT",
  "BCHUSDT",
  "FILUSDT",
  "SHIBUSDT",
  "1000SHIBUSDT",
  "TRXUSDT",
  "ADAUSDT",
  "BNBUSDT",
  "NEARUSDT",
]);

/** Calibrated Factor Thresholds from MAE/MFE Analysis */
export const MIN_ACCUMULATION_SCORE = 0.72; // Signals < 0.70 had only +1.2% avg MFE; >= 0.80 had +5.2% MFE
export const MIN_VOL_RAMP_MULT = 1.10;       // Signals < 1.0x failed 90% of the time; > 1.5x had 62.5% win rate
export const MIN_RS_DIFF_PCT = 1.50;         // Altcoin must outperform BTC by at least +1.50% (prevents lagging duds)

export const MOVER_MIN_RUNUP_PCT = 2.0;
export const MOVER_MIN_HISTORY = 2;
export const MOVER_LOOKBACK_ALERTS = 3;
/** How long after an alert we keep updating its max run-up. */
export const RUNUP_TRACKING_HOURS = 4;

export function isStageOne(stage: string): boolean {
  return stage === STAGE_1;
}

/**
 * Quality Filter based on MEXC statistical backtest:
 * 1. Filter out Major Caps (choppy, low beta).
 * 2. Only accept Stage 1 (Quiet Accumulation), rejecting Consolidation/Building.
 * 3. Enforce minimum Accumulation Score >= 0.72.
 * 4. Enforce Volume Ramp Acceleration >= 1.10x.
 */
export function passesQualityFilter(r: ScoreResult): { pass: boolean; reason?: string } {
  const sym = String(r.symbol || "").replace("/", "").toUpperCase();

  // 1. Exclude major caps
  if (MAJOR_CAP_EXCLUSIONS.has(sym)) {
    return { pass: false, reason: "Major cap exclusion: " + sym };
  }

  // 2. Discard Consolidation / Building phases (produced only 4.5% win rate in data)
  if (r.stage && (r.stage.includes("Building") || r.stage.includes("Consolidation"))) {
    return { pass: false, reason: "Phase rejected: " + r.stage + " (Only Quiet Accumulation allowed)" };
  }

  // 3. Score cutoff
  if (r.finalScore < MIN_ACCUMULATION_SCORE) {
    return { pass: false, reason: "Score too low: " + r.finalScore.toFixed(2) + " < " + String(MIN_ACCUMULATION_SCORE) };
  }

  // 4. Volume ramp acceleration cutoff
  const volRamp = r.components?.volumeAcceleration ?? 1.0;
  if (volRamp < MIN_VOL_RAMP_MULT) {
    return { pass: false, reason: "Volume ramp too weak: " + volRamp.toFixed(2) + "x < " + String(MIN_VOL_RAMP_MULT) + "x" };
  }

  return { pass: true };
}

/**
 * Dynamic 'mover' tracker: suppress chronic flatliners.
 * 'runups' = max run-up % of the symbol's prior alerts, newest first.
 */
export function passesMoverFilter(runups: number[]): boolean {
  if (runups.length < MOVER_MIN_HISTORY) return true;
  return runups
    .slice(0, MOVER_LOOKBACK_ALERTS)
    .some((r) => r >= MOVER_MIN_RUNUP_PCT);
}
