/** Dispatch-side quality filters. Scoring/indicator engines are untouched. */

export const STAGE_1 = "Stage 1 (Quiet Accumulation)";

/** High-liquidity majors where 15m accumulation rarely produces +3% expansions. */
export const MAJOR_CAP_EXCLUSIONS = new Set([
  "SOLUSDT",
  "ETHUSDT",
  "DOTUSDT",
  "DOGEUSDT",
  "LTCUSDT",
  "AVAXUSDT",
  "XRPUSDT",
  "SUIUSDT",
  "BCHUSDT",
  "FILUSDT",
  "SHIBUSDT",
  "TRXUSDT",
  "ADAUSDT",
]);

export const MOVER_MIN_RUNUP_PCT = 2.0;
export const MOVER_MIN_HISTORY = 2;
export const MOVER_LOOKBACK_ALERTS = 3;
/** How long after an alert we keep updating its max run-up. */
export const RUNUP_TRACKING_HOURS = 4;

export function isStageOne(stage: string): boolean {
  return stage === STAGE_1;
}

/**
 * Dynamic "mover" tracker: suppress chronic flatliners.
 * `runups` = max run-up % of the symbol's prior alerts, newest first.
 */
export function passesMoverFilter(runups: number[]): boolean {
  if (runups.length < MOVER_MIN_HISTORY) return true;
  return runups
    .slice(0, MOVER_LOOKBACK_ALERTS)
    .some((r) => r >= MOVER_MIN_RUNUP_PCT);
}
