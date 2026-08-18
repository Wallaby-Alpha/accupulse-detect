/**
 * Symbol-Specific Consecutive Loss Circuit Breaker
 *
 * Tracks consecutive losses per symbol in memory (single-process safe, since
 * the engine runs in one pm2 process on the droplet).  On every engine start
 * the state is bootstrapped from recent Supabase trade history so a server
 * restart never resets an active cooldown.
 *
 * Thresholds (default: 2 losses → 2-hour pause) can be overridden via the
 * trading_settings table by adding `circuit_breaker_max_losses` and
 * `circuit_breaker_cooldown_minutes` columns — both are read with safe
 * fallbacks so the existing schema requires no migration.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";

/* ─────────────────────────── defaults ─────────────────────────── */

const DEFAULT_MAX_LOSSES = 2;          // consecutive losses before cooldown
const DEFAULT_COOLDOWN_MINUTES = 120;  // 2 hours

/* ─────────────────────────── in-memory state ───────────────────── */

/** Number of consecutive losing closes for each normalised symbol. */
const consecutiveLosses: Record<string, number> = {};

/** Cooldown expiry timestamp (ms) per normalised symbol. 0 = no cooldown. */
const cooldownUntil: Record<string, number> = {};

/** True once bootstrapped from Supabase so we only hit the DB once on boot. */
let bootstrapped = false;

/* ─────────────────────────── helpers ───────────────────────────── */

function sym(symbol: string): string {
  return symbol.toUpperCase().trim();
}

/** Reads optional circuit-breaker columns from the settings row (no-throw). */
async function readThresholds(): Promise<{ maxLosses: number; cooldownMs: number }> {
  try {
    const { data } = await (supabaseAdmin as any)
      .from("trading_settings")
      .select("circuit_breaker_max_losses, circuit_breaker_cooldown_minutes")
      .limit(1)
      .maybeSingle();

    const maxLosses =
      data?.circuit_breaker_max_losses != null &&
      Number.isFinite(Number(data.circuit_breaker_max_losses)) &&
      Number(data.circuit_breaker_max_losses) > 0
        ? Number(data.circuit_breaker_max_losses)
        : DEFAULT_MAX_LOSSES;

    const cooldownMinutes =
      data?.circuit_breaker_cooldown_minutes != null &&
      Number.isFinite(Number(data.circuit_breaker_cooldown_minutes)) &&
      Number(data.circuit_breaker_cooldown_minutes) > 0
        ? Number(data.circuit_breaker_cooldown_minutes)
        : DEFAULT_COOLDOWN_MINUTES;

    return { maxLosses, cooldownMs: cooldownMinutes * 60_000 };
  } catch {
    return { maxLosses: DEFAULT_MAX_LOSSES, cooldownMs: DEFAULT_COOLDOWN_MINUTES * 60_000 };
  }
}

/**
 * Bootstraps in-memory state from the last 6 hours of closed trades in
 * Supabase.  Called once on first use; subsequent calls are no-ops.
 */
async function maybeBootstrap(): Promise<void> {
  if (bootstrapped) return;
  bootstrapped = true;

  try {
    const since = new Date(Date.now() - 6 * 60 * 60_000).toISOString();
    const { data } = await supabaseAdmin
      .from("weex_trades")
      .select("symbol, close_reason, realized_pnl, closed_at")
      .eq("status", "CLOSED")
      .gte("closed_at", since)
      .order("closed_at", { ascending: true });

    if (!data?.length) return;

    // Replay recent closes in chronological order to rebuild streak counts.
    for (const row of data) {
      const s = sym(row.symbol);
      const isLoss =
        row.close_reason === "stop_loss" ||
        (Number.isFinite(Number(row.realized_pnl)) && Number(row.realized_pnl) < 0);

      if (isLoss) {
        consecutiveLosses[s] = (consecutiveLosses[s] ?? 0) + 1;
      } else {
        consecutiveLosses[s] = 0;
        cooldownUntil[s] = 0;
      }
    }

    // Re-apply cooldowns for any symbol still above threshold.
    const { maxLosses, cooldownMs } = await readThresholds();
    for (const [s, count] of Object.entries(consecutiveLosses)) {
      if (count >= maxLosses && !cooldownUntil[s]) {
        // Find the most recent losing close timestamp.
        const lastLoss = data
          .filter(
            (r) =>
              sym(r.symbol) === s &&
              (r.close_reason === "stop_loss" ||
                (Number.isFinite(Number(r.realized_pnl)) && Number(r.realized_pnl) < 0)),
          )
          .at(-1);

        if (lastLoss?.closed_at) {
          const expiry = Date.parse(lastLoss.closed_at) + cooldownMs;
          if (expiry > Date.now()) {
            cooldownUntil[s] = expiry;
            console.log(
              `[CIRCUIT BREAKER] Bootstrap: ${s} has ${count} consecutive losses — cooldown active until ${new Date(expiry).toISOString()}`,
            );
          }
        }
      }
    }
  } catch (err) {
    console.error("[CIRCUIT BREAKER] Bootstrap error:", err);
  }
}

/* ─────────────────────────── public API ────────────────────────── */

/**
 * Returns true (and logs the reason) if the symbol is currently in a
 * consecutive-loss cooldown.  Call this in `registerSignal` before anything
 * else.
 */
export async function isInCooldown(symbol: string): Promise<{ blocked: boolean; reason: string }> {
  await maybeBootstrap();

  const s = sym(symbol);
  const until = cooldownUntil[s] ?? 0;

  if (until > Date.now()) {
    const untilIso = new Date(until).toISOString();
    return {
      blocked: true,
      reason: `${s} is in consecutive-loss cooldown until ${untilIso} (${consecutiveLosses[s]} consecutive losses)`,
    };
  }

  return { blocked: false, reason: "" };
}

/**
 * Records the outcome of a closed trade and updates streak state.
 * Call this immediately after a trade is persisted as CLOSED.
 *
 * @param symbol     Normalised symbol (e.g. "CAPUSDT")
 * @param isWin      true  = net positive close (take_profit, break-even exit)
 *                   false = net negative close (stop_loss, time_exit at a loss)
 */
export async function recordTradeOutcome(symbol: string, isWin: boolean): Promise<void> {
  await maybeBootstrap();

  const s = sym(symbol);

  if (isWin) {
    const prev = consecutiveLosses[s] ?? 0;
    consecutiveLosses[s] = 0;
    cooldownUntil[s] = 0;
    if (prev > 0) {
      console.log(`[CIRCUIT BREAKER] ${s} WIN — streak reset (was ${prev} consecutive losses)`);
    }
    return;
  }

  // Loss path
  consecutiveLosses[s] = (consecutiveLosses[s] ?? 0) + 1;
  const count = consecutiveLosses[s];

  const { maxLosses, cooldownMs } = await readThresholds();

  if (count >= maxLosses) {
    const expiry = Date.now() + cooldownMs;
    cooldownUntil[s] = expiry;
    const untilIso = new Date(expiry).toISOString();

    console.warn(
      `[CIRCUIT BREAKER] ${s} has ${count} consecutive losses — cooldown ACTIVATED until ${untilIso}`,
    );

    // Persist the cooldown event to trade_events for visibility in the UI.
    try {
      await supabaseAdmin.from("trade_events").insert({
        trade_id: null,
        symbol: s,
        event: "symbol_cooldown_activated",
        detail: `${s} has ${count} consecutive losses. Pausing new signals for ${cooldownMs / 60_000} minutes until ${untilIso}.`,
      });
    } catch {
      /* non-critical — don't block execution */
    }
  } else {
    console.log(`[CIRCUIT BREAKER] ${s} LOSS — consecutive count now ${count}/${maxLosses}`);
  }
}
