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
import {
  cancelAllOpenOrdersForSymbol,
  cancelOrder,
  cancelPlanOrder,
  getContract,
  getContractStepSize,
  getOrderDetail,
  getTicker,
  getWeexCredentials,
  isDemoMode,
  isFilled,
  marketCloseLong,
  placeLimitBuy,
  placePlanOrder,
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
]);

async function update(id: string, patch: Record<string, unknown>): Promise<void> {
  const updated_at = new Date().toISOString();
  const dbPatch: Record<string, unknown> = { updated_at };
  for (const [k, v] of Object.entries(patch)) {
    if (SUPABASE_COLUMNS.has(k)) {
      dbPatch[k] = v;
    }
  }

  await supabaseAdmin
    .from("weex_trades")
    .update(dbPatch as any)
    .eq("id", id);

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
    const res = await fetch(`https://api.mexc.com/api/v3/ticker/price?symbol=${symbol}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { price?: string };
    const price = Number(data.price);
    return Number.isFinite(price) && price > 0 ? price : null;
  } catch {
    return null;
  }
}

/** Checks if an active position or pending order already exists for the target symbol. */
export async function hasActiveTradeForSymbol(symbol: string): Promise<boolean> {
  const targetSymbol = normalizeSymbol(symbol);
  const activeStatuses = ["pending_velocity", "order_open", "filled"];

  // 1. Check Supabase database first (authoritative source)
  try {
    const { data } = await supabaseAdmin
      .from("weex_trades")
      .select("id")
      .eq("symbol", targetSymbol)
      .in("status", activeStatuses)
      .limit(1);

    if (data && data.length > 0) return true;
  } catch {
    // If Supabase fails, fall back to local store
    const localTrades = readLocalTrades();
    return localTrades.some(
      (t) => normalizeSymbol(t.symbol) === targetSymbol && activeStatuses.includes(t.status),
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
  const due =
    Date.parse(trade.alerted_at) + WEEX_CONFIG.VELOCITY_DELAY_MINUTES * 60_000;
  if (Date.now() < due) return;

  const price = await mexcPrice(trade.symbol);
  if (price === null) {
    await logEvent(trade.id, trade.symbol, "velocity_error", "Price unavailable");
    return;
  }

  const velocity = (price - Number(trade.alert_price)) / Number(trade.alert_price);
  const velocityPct = velocity * 100;

  if (velocity <= WEEX_CONFIG.VELOCITY_MAX_DROP) {
    await update(trade.id, {
      status: "discarded",
      velocity_pct: velocityPct,
      closed_at: new Date().toISOString(),
      close_reason: "velocity_fail",
    });
    await logEvent(
      trade.id,
      trade.symbol,
      "velocity_fail",
      `5m move ${velocityPct.toFixed(2)}% — falling knife, signal discarded`,
    );
    return;
  }

  const plan = planPrices(Number(trade.alert_price));
  const weexSymbol = toWeexSymbol(trade.symbol);

  await logEvent(
    trade.id,
    trade.symbol,
    "velocity_pass",
    `5m move ${velocityPct.toFixed(2)}% — placing limit buy at ${plan.entry.toPrecision(6)}`,
  );

  if (!getWeexCredentials()) {
    await update(trade.id, {
      status: "blocked",
      velocity_pct: velocityPct,
      entry_price: plan.entry,
      stop_price: plan.stop,
      target_price: plan.target,
      quantity: plan.quantity,
      last_error: "WEEX API credentials are not configured",
    });
    await logEvent(trade.id, trade.symbol, "order_error", "WEEX credentials missing");
    return;
  }

  try {
    const size = await toContractSize(
      weexSymbol,
      WEEX_CONFIG.NOTIONAL_POSITION_USD,
      plan.entry,
    );

    if (size <= 0) {
      await update(trade.id, {
        status: "discarded",
        velocity_pct: velocityPct,
        closed_at: new Date().toISOString(),
        close_reason: "invalid_contract_size",
        last_error: "Invalid calculated contract size",
      });
      await logEvent(
        trade.id,
        trade.symbol,
        "size_rejected",
        "Invalid calculated contract size — signal discarded",
      );
      return;
    }

    const orderId = await placeLimitBuy(
      weexSymbol,
      plan.entry,
      size,
      `entry-${trade.id.slice(0, 20)}`,
      plan.target,
      plan.stop
    );
    await update(trade.id, {
      status: "order_open",
      velocity_pct: velocityPct,
      entry_price: plan.entry,
      stop_price: plan.stop,
      target_price: plan.target,
      quantity: size,
      entry_order_id: orderId,
      placed_at: new Date().toISOString(),
      last_error: null,
    });
    const isLive = !isDemoMode();
    await logEvent(
      trade.id,
      trade.symbol,
      isLive ? "live_order_placed" : "order_placed",
      `Limit buy ${size} contracts @ ${plan.entry.toPrecision(6)} · SL ${plan.stop.toPrecision(6)} · TP ${plan.target.toPrecision(6)} · risk $${WEEX_CONFIG.FIXED_RISK_USD}`,
    );
  } catch (error) {
    const rawMsg = error instanceof Error ? error.message : String(error);
    const codeStr = error instanceof WeexError ? String(error.code ?? "") : "";

    let cleanDetail = rawMsg;
    if (codeStr === "-1058" || codeStr === "1058" || rawMsg.includes("-1058") || rawMsg.includes("1058")) {
      cleanDetail = "Symbol not supported via WEEX API (-1058)";
    } else if (
      codeStr === "-1056" ||
      codeStr === "40018" ||
      codeStr === "-40018" ||
      rawMsg.includes("-1056") ||
      rawMsg.includes("40018") ||
      rawMsg.includes("Invalid IP")
    ) {
      cleanDetail = "Invalid IP address for WEEX API Key (40018 / -1056). Please whitelist your IP on WEEX.";
    }

    await update(trade.id, {
      status: "order_error",
      velocity_pct: velocityPct,
      last_error: cleanDetail,
    });
    await logEvent(trade.id, trade.symbol, "order_error", cleanDetail);
    console.error(`[WEEX ENGINE] Order error for ${trade.symbol}: ${cleanDetail}`);
  }
}

async function handleOrderOpen(trade: TradeRow): Promise<void> {
  const weexSymbol = toWeexSymbol(trade.symbol);
  const detail = trade.entry_order_id
    ? await getOrderDetail(weexSymbol, trade.entry_order_id)
    : null;

  if (isFilled(detail)) {
    const fill = Number(detail?.price_avg) || Number(trade.entry_price);
    const isLive = !isDemoMode();

    const contract = await getContract(weexSymbol);
    const stepStr = getContractStepSize(contract);
    const totalQty = Number(trade.quantity ?? 0);
    const { sizeTP1, sizeTP2 } = splitQuantity5050(totalQty, stepStr);

    const tp1Price = fill * (1 + WEEX_CONFIG.TP1_OFFSET);
    const tp2Price = fill * (1 + WEEX_CONFIG.TP2_OFFSET);
    const initialSlPrice = fill * (1 + WEEX_CONFIG.STOP_OFFSET);

    let tp1OrderId: string | null = null;
    let tp2OrderId: string | null = null;
    let slOrderId: string | null = null;

    try {
      if (sizeTP1 > 0) {
        tp1OrderId = await placePlanOrder(
          weexSymbol,
          tp1Price,
          tp1Price,
          sizeTP1,
          `tp1-${trade.id.slice(0, 18)}`,
          "0",
        );
      }
      if (sizeTP2 > 0) {
        tp2OrderId = await placePlanOrder(
          weexSymbol,
          tp2Price,
          tp2Price,
          sizeTP2,
          `tp2-${trade.id.slice(0, 18)}`,
          "0",
        );
      }
      if (totalQty > 0) {
        slOrderId = await placePlanOrder(
          weexSymbol,
          initialSlPrice,
          initialSlPrice,
          totalQty,
          `sl-${trade.id.slice(0, 18)}`,
          "1",
        );
      }
    } catch (err) {
      console.warn(`Attach plan orders error for ${trade.symbol}:`, (err as Error).message);
    }

    const combinedTpId = [tp1OrderId, tp2OrderId].filter(Boolean).join(",") || trade.tp_order_id;

    await update(trade.id, {
      status: "filled",
      filled_at: new Date().toISOString(),
      fill_price: fill,
      stop_price: initialSlPrice,
      target_price: tp2Price,
      tp1_price: tp1Price,
      tp2_price: tp2Price,
      tp1_order_id: tp1OrderId,
      tp2_order_id: tp2OrderId,
      tp_order_id: combinedTpId,
      sl_order_id: slOrderId || trade.sl_order_id,
      tp1_filled: false,
      sl_moved_to_be: false,
      high_water_price: fill,
      remaining_quantity: totalQty,
    });

    await logEvent(
      trade.id,
      trade.symbol,
      isLive ? "live_order_filled" : "order_filled",
      `Filled @ ${fill.toPrecision(6)} · Dual Brackets: TP1 ${sizeTP1} @ ${tp1Price.toPrecision(6)} (+2.0%), TP2 ${sizeTP2} @ ${tp2Price.toPrecision(6)} (+3.5%), SL ${totalQty} @ ${initialSlPrice.toPrecision(6)} (-1.5%)`,
    );
    return;
  }

  if (detail?.status === "canceled" || detail?.status === "cancelled") {
    await update(trade.id, {
      status: "CLOSED",
      closed_at: new Date().toISOString(),
      close_reason: "order_cancelled",
    });
    await logEvent(
      trade.id,
      trade.symbol,
      "order_cancelled",
      "Order cancelled on exchange",
    );
    return;
  }

  const expiry =
    Date.parse(trade.placed_at ?? trade.alerted_at) +
    WEEX_CONFIG.ORDER_EXPIRY_HOURS * 60 * 60_000;
  if (Date.now() >= expiry) {
    try {
      if (trade.entry_order_id) await cancelOrder(weexSymbol, trade.entry_order_id);
    } catch (error) {
      console.error("Cancel expired order failed:", error);
    }
    await update(trade.id, {
      status: "expired",
      closed_at: new Date().toISOString(),
      close_reason: "unfilled_expiry",
    });
    await logEvent(
      trade.id,
      trade.symbol,
      "order_expired",
      `Unfilled after ${WEEX_CONFIG.ORDER_EXPIRY_HOURS}h — limit buy cancelled`,
    );
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
  reason: "take_profit" | "stop_loss" | "time_exit" | "already_closed",
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
  const contract = await getContract(weexSymbol);
  const stepStr = getContractStepSize(contract);
  const { sizeTP1, sizeTP2 } = splitQuantity5050(totalQty, stepStr);

  let pnl = customPnl;
  if (pnl === undefined) {
    if (trade.tp1_filled) {
      const tp1Price = Number(trade.tp1_price ?? (fill * (1 + WEEX_CONFIG.TP1_OFFSET)));
      const pnl1 = (tp1Price - fill) * sizeTP1;
      const pnl2 = (closePrice - fill) * sizeTP2;
      pnl = pnl1 + pnl2;
    } else {
      pnl = (closePrice - fill) * totalQty;
    }
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
}

export async function checkTimeExits(
  trade: TradeRow,
  currentPrice?: number | null,
): Promise<boolean> {
  const deadline =
    Date.parse(trade.filled_at ?? trade.alerted_at) +
    WEEX_CONFIG.TIME_EXIT_MINUTES * 60_000;
  if (Date.now() < deadline) return false;

  const weexSymbol = toWeexSymbol(trade.symbol);
  console.log(
    `[WEEX ENGINE] 60-Minute Time Exit triggered for ${trade.symbol}. Cancelling native brackets & market closing...`,
  );

  // 1. Cancel all attached native exchange limit and plan orders
  try {
    await cancelAllOpenOrdersForSymbol(weexSymbol);
  } catch {
    /* ignore cancel errors */
  }

  // 2. Transmit market close order to WEEX exchange for remaining open quantity
  let closePrice = currentPrice ?? Number(trade.fill_price ?? trade.entry_price);
  const contract = await getContract(weexSymbol);
  const stepStr = getContractStepSize(contract);
  const totalQty = Number(trade.quantity ?? 0);
  const { sizeTP1, sizeTP2 } = splitQuantity5050(totalQty, stepStr);
  const activeRemainingQty = trade.tp1_filled ? sizeTP2 : totalQty;

  try {
    let size = activeRemainingQty > 0 ? activeRemainingQty : totalQty;
    if (size <= 0 && Number(trade.entry_price) > 0) {
      size = await toContractSize(weexSymbol, WEEX_CONFIG.NOTIONAL_POSITION_USD, Number(trade.entry_price));
    }
    await marketCloseLong(weexSymbol, size, `exit-${trade.id.slice(0, 20)}`);
    closePrice = (await getTicker(weexSymbol)) ?? closePrice;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isPositionAlreadyClosedError(error)) {
      console.warn(
        `[WEEX ENGINE] 40015 Position side invalid for ${trade.symbol}. Immediately marking trade as CLOSED in Supabase.`,
      );
      await update(trade.id, {
        status: "CLOSED",
        closed_at: new Date().toISOString(),
        close_price: closePrice,
        close_reason: "already_closed_on_exchange",
        last_error: `WEEX 40015: ${message}`,
      });
      await logEvent(
        trade.id,
        trade.symbol,
        "position_already_closed",
        `WEEX 40015 (position side invalid) — position already closed, marked trade as CLOSED in Supabase`,
      );
      return true;
    }
    await update(trade.id, { last_error: `Time exit close failed: ${message}` });
    await logEvent(trade.id, trade.symbol, "time_exit_error", message);
    return false;
  }

  await closeTradeWithPnl(trade, closePrice, "time_exit");
  return true;
}

async function handleFilled(trade: TradeRow): Promise<void> {
  const weexSymbol = toWeexSymbol(trade.symbol);
  const fill = Number(trade.fill_price ?? trade.entry_price);
  if (!fill || fill <= 0) return;

  const contract = await getContract(weexSymbol);
  const stepStr = getContractStepSize(contract);
  const totalQty = Number(trade.quantity ?? 0);
  const { sizeTP1, sizeTP2 } = splitQuantity5050(totalQty, stepStr);

  const tp1Price = Number(trade.tp1_price ?? (fill * (1 + WEEX_CONFIG.TP1_OFFSET)));
  const tp2Price = Number(trade.tp2_price ?? trade.target_price ?? (fill * (1 + WEEX_CONFIG.TP2_OFFSET)));
  const currentStop = Number(trade.stop_price ?? (fill * (1 + WEEX_CONFIG.STOP_OFFSET)));

  const price = await getTicker(weexSymbol);
  if (price === null) {
    await checkTimeExits(trade, null);
    return;
  }

  // 1. High-Water Mark (MFE) Tracking
  const prevHigh = Number(trade.high_water_price ?? fill);
  const newHigh = Math.max(prevHigh, price);
  if (newHigh > prevHigh) {
    await update(trade.id, { high_water_price: newHigh });
  }

  // 2. Dynamic Break-Even Trigger (+1.5% MFE)
  const beTriggerPrice = fill * (1 + WEEX_CONFIG.BREAKEVEN_TRIGGER_OFFSET);
  const slMovedToBe = Boolean(trade.sl_moved_to_be);

  if (!slMovedToBe && newHigh >= beTriggerPrice) {
    console.log(`[WEEX ENGINE] Dynamic Break-Even Triggered for ${trade.symbol}! MFE price ${newHigh.toPrecision(6)} >= ${beTriggerPrice.toPrecision(6)} (+1.5%). Moving SL to entry ${fill.toPrecision(6)}.`);

    if (trade.sl_order_id) {
      const slIds = String(trade.sl_order_id).split(",");
      for (const id of slIds) {
        if (id) {
          try { await cancelPlanOrder(weexSymbol, id); } catch { /* ignore */ }
        }
      }
    }

    const remainingQty = trade.tp1_filled ? sizeTP2 : totalQty;
    let newSlOrderId: string | null = null;
    try {
      if (remainingQty > 0) {
        newSlOrderId = await placePlanOrder(
          weexSymbol,
          fill,
          fill,
          remainingQty,
          `be-sl-${trade.id.slice(0, 18)}`,
          "1",
        );
      }
    } catch { /* ignore */ }

    await update(trade.id, {
      stop_price: fill,
      sl_moved_to_be: true,
      sl_order_id: newSlOrderId ?? trade.sl_order_id,
    });

    await logEvent(
      trade.id,
      trade.symbol,
      "trailing_be_activated",
      `Moved SL to entry price (${fill.toPrecision(6)}) for ${trade.symbol} after +1.5% MFE gain`,
    );
  }

  // 3. TP1 Check (+2.0%)
  const tp1Filled = Boolean(trade.tp1_filled);
  if (!tp1Filled && price >= tp1Price) {
    console.log(`[WEEX ENGINE] TP1 (+2.0%) Triggered for ${trade.symbol} @ ${price.toPrecision(6)}! Banking 50% (${sizeTP1} contracts).`);
    const tp1Pnl = (tp1Price - fill) * sizeTP1;

    let beSlOrderId: string | null = trade.sl_order_id ?? null;
    if (!slMovedToBe && trade.sl_order_id) {
      const slIds = String(trade.sl_order_id).split(",");
      for (const id of slIds) {
        if (id) {
          try { await cancelPlanOrder(weexSymbol, id); } catch { /* ignore */ }
        }
      }
      try {
        if (sizeTP2 > 0) {
          beSlOrderId = await placePlanOrder(
            weexSymbol,
            fill,
            fill,
            sizeTP2,
            `be-sl-tp1-${trade.id.slice(0, 16)}`,
            "1",
          );
        }
      } catch { /* ignore */ }
    }

    await update(trade.id, {
      tp1_filled: true,
      stop_price: fill,
      sl_moved_to_be: true,
      sl_order_id: beSlOrderId,
      remaining_quantity: sizeTP2,
    });

    await logEvent(
      trade.id,
      trade.symbol,
      "tp1_filled",
      `Banked 50% TP1 (${sizeTP1} contracts) @ ${tp1Price.toPrecision(6)} (+2.0%) · PnL $${tp1Pnl.toFixed(2)}. Remaining 50% runner (${sizeTP2}) active with Break-Even SL @ ${fill.toPrecision(6)}`,
    );
  }

  // 4. Runner TP2 Check (+3.5% to +5.0%)
  if (price >= tp2Price) {
    console.log(`[WEEX ENGINE] Runner TP2 (+3.5% to +5.0%) Triggered for ${trade.symbol} @ ${price.toPrecision(6)}! Closing remaining position.`);
    const activeQty = tp1Filled ? sizeTP2 : totalQty;
    const pnl1 = tp1Filled ? (tp1Price - fill) * sizeTP1 : 0;
    const pnl2 = (tp2Price - fill) * activeQty;
    const totalPnl = pnl1 + pnl2;

    await closeTradeWithPnl(trade, tp2Price, "take_profit", totalPnl);
    return;
  }

  // 5. Stop-Loss Check (Initial -1.5% or Break-Even 0.0%)
  const activeStop = trade.sl_moved_to_be || trade.tp1_filled ? fill : currentStop;
  if (price <= activeStop) {
    console.log(`[WEEX ENGINE] Stop-Loss Triggered for ${trade.symbol} @ ${price.toPrecision(6)} (Stop: ${activeStop.toPrecision(6)}). Closing remaining position.`);
    const activeQty = tp1Filled ? sizeTP2 : totalQty;
    const pnl1 = tp1Filled ? (tp1Price - fill) * sizeTP1 : 0;
    const pnl2 = (activeStop - fill) * activeQty;
    const totalPnl = pnl1 + pnl2;

    await closeTradeWithPnl(trade, activeStop, "stop_loss", totalPnl);
    return;
  }

  // 6. Time Exit Check (60 Minutes)
  await checkTimeExits(trade, price);
}

/* ---------------------------------- tick ---------------------------------- */

export async function runTradeEngine(): Promise<{
  processed: number;
  errors: number;
}> {
  const { data, error } = await supabaseAdmin
    .from("weex_trades")
    .select(
      "id,symbol,alert_price,alerted_at,status,entry_price,stop_price,target_price,quantity,entry_order_id,tp_order_id,sl_order_id,placed_at,filled_at,fill_price",
    )
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
