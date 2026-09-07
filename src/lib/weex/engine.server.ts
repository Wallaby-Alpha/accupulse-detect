/**
 * WEEX demo trading execution engine.
 *
 * Lifecycle of one Stage 1 signal:
 *   pending_velocity -> (5m velocity filter) -> discarded
 *                                            -> order_open -> expired
 *                                                          -> filled -> closed (tp | sl | time_exit)
 *
 * The engine is tick-driven (cron every minute) and fully idempotent: each tick
 * only advances rows whose timers have elapsed.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendTelegramMessage } from "@/lib/scanner/telegram";
import { isSymbolSupportedOnWeex, normalizeSymbol } from "./symbols.server";

import { WEEX_CONFIG, planPrices, toWeexSymbol } from "./config";
import { getTradingSettings } from "./settings.server";
import { isInCooldown, recordTradeOutcome } from "./circuit-breaker.server";
import {
  cancelAllOpenOrdersForSymbol,
  cancelOrder,
  cancelPlanOrder,
  floorToStep,
  getContract,
  getContractStepSize,
  getContractTickSize,
  getOrderDetail,
  getTicker,
  getWeexCredentials,
  isDemoMode,
  isFilled,
  marketBuyLong,
  marketCloseLong,
  placeLimitBuy,
  placePlanOrder,
  roundToStep,
  splitQuantity5050,
  toContractSize,
  WeexError,
} from "./client.server";
import { readLocalTrades, saveLocalTrade } from "./local-store.server";

type TradeRow = {
  id: string;
  symbol: string;
  alert_price: number;
  alerted_at: string;
  status: string;
  entry_price: number | null;
  stop_price: number | null;
  target_price: number | null;
  quantity: number | null;
  entry_order_id: string | null;
  tp_order_id: string | null;
  sl_order_id: string | null;
  placed_at: string | null;
  filled_at: string | null;
  fill_price: number | null;
  closed_at?: string | null;
  // Extended columns (added via migration 20260820000000)
  t1_quantity?: number | null;
  t2_quantity?: number | null;
  t1_fill_price?: number | null;
  t2_limit_price?: number | null;
  t2_fill_price?: number | null;
  t2_order_id?: string | null;
  t2_placed_at?: string | null;
  t2_filled?: boolean | null;
  t2_expired?: boolean | null;
  t2_error?: string | null;
  tp1_price?: number | null;
  tp2_price?: number | null;
  tp1_filled?: boolean | null;
  tp1_order_id?: string | null;
  tp2_order_id?: string | null;
  sl_moved_to_be?: boolean | null;
  high_water_price?: number | null;
  remaining_quantity?: number | null;
};

async function logEvent(
  tradeId: string | null,
  symbol: string,
  event: string,
  detail?: string,
): Promise<void> {
  await supabaseAdmin.from("trade_events").insert({
    trade_id: tradeId,
    symbol,
    event,
    detail: detail ?? null,
  });
}

const SUPABASE_COLUMNS = new Set([
  "id",
  "symbol",
  "alert_price",
  "alerted_at",
  "status",
  "velocity_pct",
  "entry_price",
  "stop_price",
  "target_price",
  "quantity",
  "entry_order_id",
  "tp_order_id",
  "sl_order_id",
  "placed_at",
  "filled_at",
  "fill_price",
  "closed_at",
  "close_price",
  "close_reason",
  "realized_pnl",
  "last_error",
  "created_at",
  "updated_at",
  // Extended columns added in migration 20260820000000
  "t1_quantity",
  "t2_quantity",
  "t1_fill_price",
  "t2_limit_price",
  "t2_fill_price",
  "t2_order_id",
  "t2_placed_at",
  "t2_filled",
  "t2_expired",
  "t2_error",
  "tp1_price",
  "tp2_price",
  "tp1_filled",
  "tp1_order_id",
  "tp2_order_id",
  "sl_moved_to_be",
  "high_water_price",
  "remaining_quantity",
]);

async function update(id: string, patch: Record<string, unknown>): Promise<void> {
  const updated_at = new Date().toISOString();
  const dbPatch: Record<string, unknown> = { updated_at };
  for (const [k, v] of Object.entries(patch)) {
    if (SUPABASE_COLUMNS.has(k)) {
      dbPatch[k] = v;
    }
  }

  const { error } = await supabaseAdmin
    .from("weex_trades")
    .update(dbPatch as any)
    .eq("id", id);

  if (error) {
    throw new Error(`Supabase update failed for trade ${id}: ${error.message}`);
  }

  try {
    const localTrades = readLocalTrades();
    const trade = localTrades.find((t) => t.id === id);
    if (trade) {
      Object.assign(trade, patch, { updated_at });
      saveLocalTrade(trade);
    }
  } catch {
    /* ignore local update errors */
  }
}

/** Spot price from MEXC — the same source the alert price came from. */
async function mexcPrice(symbol: string): Promise<number | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`https://api.mexc.com/api/v3/ticker/price?symbol=${symbol}`, {
      signal: controller.signal,
    }).finally(() => clearTimeout(timeoutId));
    
    if (!res.ok) return null;
    const data = (await res.json()) as { price?: string };
    const price = Number(data.price);
    return Number.isFinite(price) && price > 0 ? price : null;
  } catch {
    return null;
  }
}

/**
 * Asserts that a stop-loss price is strictly below entry price for a LONG position.
 * Throws a descriptive error if the SL price is invalid (>= entry), preventing a
 * stop-loss plan order that would immediately trigger or be rejected by WEEX.
 */
function assertValidSL(slPrice: number, entryPrice: number, context: string): void {
  if (slPrice >= entryPrice) {
    throw new Error(
      `Invalid SL price ${slPrice.toPrecision(8)} >= entry ${entryPrice.toPrecision(8)} (${context}). ` +
      `Check sl_percent sign or calculation.`,
    );
  }
  if (slPrice <= 0) {
    throw new Error(`Invalid SL price ${slPrice} <= 0 (${context}).`);
  }
}

/**
 * Checks if an active position or pending order already exists for the target symbol.
 * Guards against both normal active statuses AND orphaned trades where an exchange order
 * was placed (entry_order_id IS NOT NULL) but not yet closed (closed_at IS NULL),
 * even if status is unexpectedly set to 'order_error' due to a partial failure.
 */
export async function hasActiveTradeForSymbol(symbol: string): Promise<boolean> {
  const targetSymbol = normalizeSymbol(symbol);
  const activeStatuses = ["pending_velocity", "order_open", "filled"];

  // 1. Check Supabase database first (authoritative source)
  try {
    // Check standard active statuses
    const { data: activeData } = await supabaseAdmin
      .from("weex_trades")
      .select("id")
      .eq("symbol", targetSymbol)
      .in("status", activeStatuses)
      .limit(1);

    if (activeData && activeData.length > 0) return true;

    // Also block if there is any trade with a placed entry order that is not yet closed.
    // This catches orphaned 'order_error' trades where Tranche 1 filled on the exchange
    // but the engine set the status to error (e.g. PENDLE 229180db pattern).
    const { data: orphanData } = await supabaseAdmin
      .from("weex_trades")
      .select("id")
      .eq("symbol", targetSymbol)
      .not("entry_order_id", "is", null)
      .is("closed_at", null)
      .limit(1);

    if (orphanData && orphanData.length > 0) return true;
  } catch {
    // If Supabase fails, fall back to local store
    const localTrades = readLocalTrades();
    return localTrades.some(
      (t) =>
        normalizeSymbol(t.symbol) === targetSymbol &&
        (activeStatuses.includes(t.status) ||
          (t.entry_order_id != null && t.closed_at == null)),
    );
  }

  return false;
}

/** Called by the scanner right after a Stage 1 Telegram alert is dispatched. */
export async function registerSignal(
  symbol: string,
  alertPrice: number,
): Promise<void> {
  const targetSymbol = normalizeSymbol(symbol);
  const isSupported = await isSymbolSupportedOnWeex(targetSymbol);

  if (!isSupported) {
    const detail = `Symbol not supported on WEEX API`;
    await logEvent(null, symbol, "signal_skipped", detail);
    console.log(`[WEEX ENGINE] Skipped signal for ${symbol}: Symbol not supported on WEEX API`);
    return;
  }

  // Circuit Breaker: consecutive-loss cooldown guard
  const cooldown = await isInCooldown(targetSymbol);
  if (cooldown.blocked) {
    await logEvent(null, targetSymbol, "signal_skipped", cooldown.reason);
    console.log(`[WEEX ENGINE] Signal blocked by circuit breaker: ${cooldown.reason}`);
    return;
  }

  // Single Active Trade Per Symbol Guard
  const activeExists = await hasActiveTradeForSymbol(targetSymbol);
  if (activeExists) {
    const detail = `Active position or pending order already exists for ${targetSymbol}`;
    await logEvent(null, targetSymbol, "signal_skipped", detail);
    console.log(`[WEEX ENGINE] Skipped signal for ${targetSymbol}: ${detail}`);
    return;
  }

  const tradeId = crypto.randomUUID() as `${string}-${string}-${string}-${string}-${string}`;
  const now = new Date().toISOString();

  let id = tradeId;
  try {
    const { data, error } = await supabaseAdmin
      .from("weex_trades")
      .insert({ id: tradeId, symbol: targetSymbol, alert_price: alertPrice, status: "pending_velocity", alerted_at: now })
      .select("id")
      .single();
    if (data?.id) id = data.id as `${string}-${string}-${string}-${string}-${string}`;
    if (error) console.log(`[Supabase] registerSignal insert: ${error.message}`);
  } catch (err) {
    console.log(`[Supabase] registerSignal exception: ${(err as Error).message}`);
  }

  saveLocalTrade({
    id,
    symbol: targetSymbol,
    alert_price: alertPrice,
    alerted_at: now,
    status: "pending_velocity",
    created_at: now,
    updated_at: now,
  });

  await logEvent(
    id,
    targetSymbol,
    "signal_received",
    `Alert price ${alertPrice}; velocity check in ${WEEX_CONFIG.VELOCITY_DELAY_MINUTES}m`,
  );
}

/* ------------------------------ state handlers ---------------------------- */


async function handlePendingVelocity(trade: TradeRow): Promise<void> {
  const settings = await getTradingSettings();
  if (!settings.is_trading_enabled) {
    await logEvent(trade.id, trade.symbol, "signal_skipped", "Trading disabled via Master Kill Switch");
    await update(trade.id, { status: "discarded", closed_at: new Date().toISOString(), close_reason: "kill_switch" });
    return;
  }
  
  // Immediately place limit order at 0.3% below alert price
  const weexSymbol = toWeexSymbol(trade.symbol);
  if (!getWeexCredentials()) {
    await update(trade.id, {
      status: "blocked",
      last_error: "WEEX API credentials are not configured",
    });
    await logEvent(trade.id, trade.symbol, "order_error", "WEEX credentials missing");
    return;
  }

  const contract = await getContract(weexSymbol);
  const stepStr = getContractStepSize(contract);
  const tickStr = getContractTickSize(contract);
  const maxOrderSize = Number(contract?.maxOrderSize) || Infinity;

  const limitPrice = roundToStep(Number(trade.alert_price) * 0.997, tickStr);
  // Enforce MIN_ORDER_NOTIONAL_USD ($15.00) to prevent WEEX Error -1058 rejection
  const targetNotional = Math.max(
    WEEX_CONFIG.MIN_ORDER_NOTIONAL_USD,
    settings.notional_size_usd || WEEX_CONFIG.NOTIONAL_POSITION_USD
  );
  let qty = floorToStep(targetNotional / limitPrice, stepStr);
  if (qty > maxOrderSize) qty = floorToStep(maxOrderSize, stepStr);

  if (qty <= 0) {
    const errMsg = `Calculated quantity ${qty} is <= 0 for ${trade.symbol}`;
    await update(trade.id, {
      status: "discarded",
      closed_at: new Date().toISOString(),
      close_reason: "invalid_contract_size",
      last_error: errMsg,
    });
    await logEvent(trade.id, trade.symbol, "size_rejected", errMsg);
    return;
  }

  try {
    const limitOrderId = await placeLimitBuy(
      weexSymbol,
      limitPrice,
      qty,
      `t1-${trade.id.slice(0, 18)}`,
    );

    const now = new Date().toISOString();
    await update(trade.id, {
      status: "order_open",
      entry_price: limitPrice,
      quantity: qty,
      entry_order_id: limitOrderId,
      placed_at: now,
      remaining_quantity: qty,
      last_error: null,
    });

    await logEvent(
      trade.id,
      trade.symbol,
      "limit_placed",
      `Placed limit entry @ ${limitPrice.toPrecision(6)} for ${qty} contracts.`,
    );
  } catch (error) {
    const rawMsg = error instanceof Error ? error.message : String(error);
    await update(trade.id, { status: "order_error", last_error: rawMsg });
    await logEvent(trade.id, trade.symbol, "order_error", rawMsg);
  }
}

async function handleOrderOpen(trade: TradeRow): Promise<void> {
  const weexSymbol = toWeexSymbol(trade.symbol);
  const detail = trade.entry_order_id
    ? await getOrderDetail(weexSymbol, trade.entry_order_id)
    : null;

  if (isFilled(detail)) {
    const fill = Number(detail?.price_avg) || Number(trade.entry_price);
    
    // Calculate ATR for SL/TP
    const { fetchKlines } = await import("@/lib/scanner/mexc");
    const { atr, last } = await import("@/lib/scanner/indicators");
    const klines = await fetchKlines(trade.symbol, "5m", 20);
    let currentAtr = fill * 0.015; // default 1.5% if fetch fails
    if (klines && klines.length > 14) {
      const atrVals = atr(klines, 14);
      currentAtr = last(atrVals);
    }
    
    const contract = await getContract(weexSymbol);
    const tickStr = getContractTickSize(contract);
    const stepStr = getContractStepSize(contract);

    // Calibrated SL (-3.5%) and Split Targets: TP1 (+3.5%), TP2 (+6.0%) based on MAE/MFE backtest
    const slPrice = roundToStep(fill * (1 + WEEX_CONFIG.STOP_OFFSET), tickStr); // -3.5%
    const tp1Price = roundToStep(fill * (1 + WEEX_CONFIG.TP1_OFFSET), tickStr);  // +3.5%
    const tp2Price = roundToStep(fill * (1 + WEEX_CONFIG.TP2_OFFSET), tickStr);  // +6.0%

    const totalQty = Number(trade.quantity);
    const tp1Qty = floorToStep(totalQty * 0.5, stepStr);
    const tp2Qty = floorToStep(totalQty - tp1Qty, stepStr);

    let slOrderId: string | null = null;
    let tp1OrderId: string | null = null;
    let tp2OrderId: string | null = null;

    try {
      assertValidSL(slPrice, fill, `SL for ${trade.symbol}`);
      // Initial 100% Stop Loss plan order
      slOrderId = await placePlanOrder(weexSymbol, slPrice, slPrice, totalQty, `sl-${trade.id.slice(0, 14)}`, "1");
      
      // TP1 covering 50%
      if (tp1Qty > 0) {
        tp1OrderId = await placePlanOrder(weexSymbol, tp1Price, tp1Price, tp1Qty, `tp1-${trade.id.slice(0, 13)}`, "0");
      }
      // TP2 covering remaining 50%
      if (tp2Qty > 0) {
        tp2OrderId = await placePlanOrder(weexSymbol, tp2Price, tp2Price, tp2Qty, `tp2-${trade.id.slice(0, 13)}`, "0");
      }
    } catch(err) {
      console.warn("Bracket plan order error:", err);
    }

    const combinedTp = [tp1OrderId, tp2OrderId].filter(Boolean).join(",");

    await update(trade.id, {
      status: "filled",
      filled_at: new Date().toISOString(),
      fill_price: fill,
      stop_price: slPrice,
      target_price: tp2Price,
      tp1_price: tp1Price,
      tp2_price: tp2Price,
      sl_order_id: slOrderId,
      tp_order_id: combinedTp || null,
      tp1_order_id: tp1OrderId,
      tp2_order_id: tp2OrderId,
      t1_quantity: tp1Qty,
      t2_quantity: tp2Qty,
      remaining_quantity: totalQty,
      sl_moved_to_be: false,
    });

    await logEvent(
      trade.id,
      trade.symbol,
      "order_filled",
      `Filled @ ${fill.toPrecision(6)}. Calibrated SL @ ${slPrice.toPrecision(6)} (-3.5%), TP1 @ ${tp1Price.toPrecision(6)} (+3.5%), TP2 @ ${tp2Price.toPrecision(6)} (+6.0%).`,
    );
    return;
  }

  if (detail?.status === "canceled" || detail?.status === "cancelled") {
    await update(trade.id, {
      status: "CLOSED",
      closed_at: new Date().toISOString(),
      close_reason: "order_cancelled",
    });
    return;
  }

  const expiry = Date.parse(trade.placed_at ?? trade.alerted_at) + 15 * 60_000;
  if (Date.now() >= expiry) {
    try {
      if (trade.entry_order_id) await cancelOrder(weexSymbol, trade.entry_order_id);
    } catch (error) {
      console.error("Cancel expired limit order failed:", error);
    }
    await update(trade.id, {
      status: "expired",
      closed_at: new Date().toISOString(),
      close_reason: "unfilled_15m_expiry",
    });
    await logEvent(trade.id, trade.symbol, "order_expired", "Unfilled after 15m — cancelled");
  }
}

export function isPositionAlreadyClosedError(error: unknown): boolean {
  if (!error) return false;
  const errObj = error as { code?: string | number; message?: string; msg?: string };
  const codeStr = error instanceof WeexError
    ? String(error.code ?? "")
    : String(errObj.code ?? "");
  const rawMsg = error instanceof Error
    ? error.message
    : String(errObj.message ?? errObj.msg ?? error);
  const codeMatch = codeStr === "40015" || codeStr === "-40015" || rawMsg.includes("40015");
  const msgMatch =
    rawMsg.toLowerCase().includes("position side invalid") ||
    rawMsg.toLowerCase().includes("position side is invalid") ||
    rawMsg.toLowerCase().includes("position already closed");
  return codeMatch || msgMatch;
}

async function closeTradeWithPnl(
  trade: TradeRow,
  closePrice: number,
  reason: "take_profit" | "stop_loss" | "time_exit" | "already_closed" | "early_exit",
  customPnl?: number,
): Promise<void> {
  const weexSymbol = toWeexSymbol(trade.symbol);

  // Cancel remaining native exchange plan orders (TP1, TP2, SL)
  const allPlanIds = [
    trade.tp_order_id,
    trade.sl_order_id,
    trade.tp1_order_id,
    trade.tp2_order_id,
  ]
    .filter(Boolean)
    .join(",")
    .split(",");

  for (const id of allPlanIds) {
    if (id) {
      try {
        await cancelPlanOrder(weexSymbol, id);
      } catch {
        /* ignore cleanup errors */
      }
    }
  }

  const fill = Number(trade.fill_price ?? trade.entry_price);
  const totalQty = Number(trade.quantity ?? 0);

  let pnl = customPnl;
  if (pnl === undefined) {
    pnl = (closePrice - fill) * totalQty;
  }

  await update(trade.id, {
    status: "CLOSED",
    closed_at: new Date().toISOString(),
    close_price: closePrice,
    close_reason: reason,
    realized_pnl: pnl,
  });

  await logEvent(
    trade.id,
    trade.symbol,
    reason,
    `Closed @ ${closePrice.toFixed(6)} · PnL $${pnl.toFixed(2)} (${reason})`,
  );

  const isWin = reason === "take_profit" || pnl > 0;
  try {
    await recordTradeOutcome(trade.symbol, isWin);
  } catch {
  }
}

export async function checkTimeExits(
  trade: TradeRow,
  currentPrice?: number | null,
  forceEarlyExit: boolean = false
): Promise<boolean> {
  const timeoutMs = WEEX_CONFIG.TIME_EXIT_MINUTES * 60_000; // 180m (3h) stagnation timeout
  const deadline = Date.parse(trade.filled_at ?? trade.alerted_at) + timeoutMs;

  if (!forceEarlyExit && Date.now() < deadline) return false;

  // Stagnation rule: If position has gained >= +1.5% and is still alive, let the runner ride
  if (!forceEarlyExit && currentPrice) {
    const fill = Number(trade.fill_price ?? trade.entry_price);
    if (fill > 0) {
      const gainPct = ((currentPrice - fill) / fill) * 100;
      if (gainPct >= 1.5) {
        return false; // Holding profit, don't kill runner
      }
    }
  }

  const weexSymbol = toWeexSymbol(trade.symbol);
  const reason = forceEarlyExit ? "early_exit" : "time_exit";
  console.log(
    `[WEEX ENGINE] ${reason} triggered for ${trade.symbol}. Cancelling native brackets & market closing...`,
  );

  try {
    await cancelAllOpenOrdersForSymbol(weexSymbol);
  } catch {
    /* ignore cancel errors */
  }

  let closePrice = currentPrice ?? Number(trade.fill_price ?? trade.entry_price);
  const totalQty = Number(trade.quantity ?? 0);

  try {
    if (totalQty > 0) {
      await marketCloseLong(weexSymbol, totalQty, `exit-${trade.id.slice(0, 20)}`);
    }
    closePrice = (await getTicker(weexSymbol)) ?? closePrice;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isPositionAlreadyClosedError(error)) {
      await update(trade.id, {
        status: "CLOSED",
        closed_at: new Date().toISOString(),
        close_price: closePrice,
        close_reason: "already_closed_on_exchange",
        last_error: `WEEX 40015: ${message}`,
      });
      return true;
    }
    await update(trade.id, { last_error: `${reason} close failed: ${message}` });
    return false;
  }

  await closeTradeWithPnl(trade, closePrice, reason as any);
  return true;
}

async function handleFilled(trade: TradeRow): Promise<void> {
  const weexSymbol = toWeexSymbol(trade.symbol);
  const price = await getTicker(weexSymbol);
  if (price === null) {
    await checkTimeExits(trade, null);
    return;
  }

  const fillPrice = Number(trade.fill_price ?? trade.entry_price);

  // Dynamic Breakeven Adjustment: When price reaches +3.0% gain, move Stop Loss to Entry ($0.00 risk)
  const beThreshold = fillPrice * (1 + WEEX_CONFIG.BREAKEVEN_TRIGGER_OFFSET); // +3.0%
  if (price >= beThreshold && !trade.sl_moved_to_be) {
    console.log(`[WEEX ENGINE] +3.0% gain reached for ${trade.symbol}! Moving Stop Loss to Breakeven @ ${fillPrice}`);
    try {
      const contract = await getContract(weexSymbol);
      const tickStr = getContractTickSize(contract);
      const bePrice = roundToStep(fillPrice, tickStr);

      // Cancel old SL plan order if present
      if (trade.sl_order_id) {
        try { await cancelPlanOrder(weexSymbol, trade.sl_order_id); } catch { /* ignore */ }
      }

      // Place new Breakeven SL plan order
      const remainingQty = Number(trade.remaining_quantity ?? trade.quantity ?? 0);
      if (remainingQty > 0) {
        const newSlId = await placePlanOrder(weexSymbol, bePrice, bePrice, remainingQty, `be-${trade.id.slice(0, 14)}`, "1");
        await update(trade.id, {
          stop_price: bePrice,
          sl_order_id: newSlId,
          sl_moved_to_be: true,
        });
        await logEvent(trade.id, trade.symbol, "sl_moved_to_be", `SL moved to Breakeven @ ${bePrice.toFixed(6)} (+3.0% MFE hit)`);
      }
    } catch (beErr) {
      console.error(`[WEEX ENGINE] Failed to move SL to breakeven for ${trade.symbol}:`, beErr);
    }
  }

  // Check TP / SL natively handled by exchange
  // If price <= stop_price or price >= target_price, wait for exchange to close it.
  // We can just rely on the exchange to handle the plan orders, or check if they are triggered.
  // For safety, we can manually check if it went past TP/SL and close it if plan orders failed.
  const stopPrice = Number(trade.stop_price);
  const targetPrice = Number(trade.target_price);
  
  if (stopPrice > 0 && price <= stopPrice) {
    // Usually exchange handles this, but if we are here, maybe it didn't
    await closeTradeWithPnl(trade, price, "stop_loss");
    return;
  }
  if (targetPrice > 0 && price >= targetPrice) {
    await closeTradeWithPnl(trade, price, "take_profit");
    return;
  }
  
  await checkTimeExits(trade, price);
}

/* ---------------------------------- tick ---------------------------------- */

export async function runTradeEngine(): Promise<{
  processed: number;
  errors: number;
}> {
  // Fetch ALL columns so handleFilled has full state (tp1_filled, sl_moved_to_be, etc.)
  const { data, error } = await supabaseAdmin
    .from("weex_trades")
    .select("*")
    .in("status", ["pending_velocity", "order_open", "filled"])
    .order("alerted_at", { ascending: true })
    .limit(50);

  if (error) throw new Error(error.message);

  let errors = 0;
  for (const row of (data ?? []) as TradeRow[]) {
    try {
      if (row.status === "pending_velocity") await handlePendingVelocity(row);
      else if (row.status === "order_open") await handleOrderOpen(row);
      else if (row.status === "filled") await handleFilled(row);
    } catch (err) {
      errors++;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Trade engine failed for ${row.symbol}:`, message);
      if (isPositionAlreadyClosedError(err)) {
        await update(row.id, {
          status: "CLOSED",
          closed_at: new Date().toISOString(),
          close_reason: "already_closed_on_exchange",
          last_error: `WEEX 40015: ${message}`,
        });
        await logEvent(row.id, row.symbol, "position_already_closed", message);
      } else {
        await update(row.id, { last_error: message });
        await logEvent(row.id, row.symbol, "engine_error", message);
      }
    }
  }

  return { processed: data?.length ?? 0, errors };
}

/**
 * Startup orphan recovery: scans for trades where an entry order was placed on WEEX
 * but the engine set status to 'order_error' (e.g. PENDLE bug: T2 margin failure).
 * If the exchange position is still open, recovers to 'filled'. If already closed,
 * marks the record CLOSED. Should be called once at engine startup before the first tick.
 */
export async function recoverOrphanedTrades(): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("weex_trades")
    .select("*")
    .eq("status", "order_error")
    .not("entry_order_id", "is", null)
    .is("closed_at", null)
    .limit(20);

  if (error || !data || data.length === 0) return;

  console.log(`[WEEX ENGINE] Orphan recovery: found ${data.length} orphaned trade(s) to inspect.`);

  for (const row of data as TradeRow[]) {
    const weexSymbol = toWeexSymbol(row.symbol);
    try {
      // Use ticker as a proxy for whether we can communicate with the exchange.
      // Attempt to place an emergency SL if ticker is reachable.
      const ticker = await getTicker(weexSymbol);
      const fill = Number(row.fill_price ?? row.entry_price ?? 0);
      const qty = Number(row.quantity ?? 0);

      if (fill <= 0 || qty <= 0) {
        // No fill info — we can't recover; close record cleanly.
        await update(row.id, {
          status: "CLOSED",
          closed_at: new Date().toISOString(),
          close_reason: "orphan_no_fill_data",
        });
        await logEvent(row.id, row.symbol, "orphan_closed", "Orphaned order_error with no fill data — marked CLOSED.");
        continue;
      }

      // Attempt to place an emergency SL plan order at the original stop price.
      const contract = await getContract(weexSymbol);
      const stepStr = getContractStepSize(contract);
      const tickStr = getContractTickSize(contract);
      const emergencySlPrice = Number(row.stop_price ?? 0) > 0
        ? Number(row.stop_price)
        : roundToStep(fill * (1 + WEEX_CONFIG.STOP_OFFSET), tickStr);

      let emergencySlId: string | null = null;
      try {
        const recoveredQty = floorToStep(qty, stepStr);
        if (recoveredQty > 0) {
          emergencySlId = await placePlanOrder(
            weexSymbol, emergencySlPrice, emergencySlPrice, recoveredQty,
            `emer-sl-${row.id.slice(0, 14)}`, "1",
          );
        }
      } catch (slErr) {
        // Position may already be closed on exchange — this is fine, we'll still mark recovered.
        const slMsg = slErr instanceof Error ? slErr.message : String(slErr);
        console.warn(`[WEEX ENGINE] Orphan SL placement failed for ${row.symbol}: ${slMsg}`);
        if (isPositionAlreadyClosedError(slErr)) {
          // Exchange says position is already gone — close the record.
          await update(row.id, {
            status: "CLOSED",
            closed_at: new Date().toISOString(),
            close_reason: "orphan_already_closed_on_exchange",
            close_price: ticker ?? fill,
            last_error: slMsg,
          });
          await logEvent(row.id, row.symbol, "orphan_closed",
            `Orphaned trade confirmed closed on exchange (40015). Marked CLOSED @ ${(ticker ?? fill).toPrecision(6)}.`);
          continue;
        }
      }

      // Recover the trade to 'filled' — engine will now monitor it each tick.
      await update(row.id, {
        status: "filled",
        sl_order_id: emergencySlId ?? row.sl_order_id,
        filled_at: row.filled_at ?? new Date().toISOString(),
        last_error: null,
      });

      await logEvent(row.id, row.symbol, "orphan_recovered",
        `Orphaned order_error trade recovered to 'filled'. Emergency SL ${emergencySlId ?? "(none)"} @ ${emergencySlPrice.toPrecision(6)}. Engine monitoring resumed.`);

      console.log(`[WEEX ENGINE] Orphan recovered: ${row.symbol} (${row.id.slice(0, 8)}) → status=filled, emergency SL=${emergencySlId ?? "none"}.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[WEEX ENGINE] Orphan recovery failed for ${row.symbol}: ${msg}`);
      await logEvent(row.id, row.symbol, "orphan_recovery_error", msg);
    }
  }
}
