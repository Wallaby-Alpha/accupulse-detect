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
  floorToStep,
  getContract,
  getContractStepSize,
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
  t1_quantity?: number | null;
  t2_quantity?: number | null;
  t1_fill_price?: number | null;
  t2_limit_price?: number | null;
  t2_fill_price?: number | null;
  t2_order_id?: string | null;
  t2_placed_at?: string | null;
  t2_filled?: boolean | null;
  t2_expired?: boolean | null;
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

  const price_5m = await mexcPrice(trade.symbol);
  if (price_5m === null) {
    await logEvent(trade.id, trade.symbol, "velocity_error", "Price unavailable at 5m mark");
    return;
  }

  const velocity = (price_5m - Number(trade.alert_price)) / Number(trade.alert_price);
  const velocityPct = velocity * 100;

  // 1. 5-Minute Velocity Check (Falling Knife Filter: dropPct <= -1.5%)
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
      "velocity_filter_skip",
      `Dropped ${velocityPct.toFixed(2)}% in 5m (falling knife) — signal discarded`,
    );
    return;
  }

  const weexSymbol = toWeexSymbol(trade.symbol);
  await logEvent(
    trade.id,
    trade.symbol,
    "velocity_pass",
    `5m move ${velocityPct.toFixed(2)}% — knife check passed (> -1.5%). Executing 2 Independent Tranches ($70 Market + $70 Limit Pullback with Native Preset TP/SL).`,
  );

  if (!getWeexCredentials()) {
    await update(trade.id, {
      status: "blocked",
      velocity_pct: velocityPct,
      entry_price: price_5m,
      last_error: "WEEX API credentials are not configured",
    });
    await logEvent(trade.id, trade.symbol, "order_error", "WEEX credentials missing");
    return;
  }

  try {
    const contract = await getContract(weexSymbol);
    const stepStr = getContractStepSize(contract);
    const tickStr = contract?.tick_size || "0.0001";
    const maxOrderSize = Number(contract?.maxOrderSize) || Infinity;

    // --- TRADE 1: TRANCHE 1 (Immediate Market Buy - $70 Notional) ---
    let qty1 = floorToStep(WEEX_CONFIG.TRANCHE_NOTIONAL_USD / price_5m, stepStr);
    if (qty1 > maxOrderSize) {
      qty1 = floorToStep(maxOrderSize, stepStr);
    }

    if (qty1 <= 0) {
      await update(trade.id, {
        status: "discarded",
        velocity_pct: velocityPct,
        closed_at: new Date().toISOString(),
        close_reason: "invalid_contract_size",
        last_error: "Invalid calculated contract size for Tranche 1",
      });
      await logEvent(
        trade.id,
        trade.symbol,
        "size_rejected",
        "Invalid contract size for Tranche 1 — signal discarded",
      );
      return;
    }

    const tp1 = price_5m * (1 + WEEX_CONFIG.TP2_OFFSET); // +3.5%
    const sl1 = price_5m * (1 + WEEX_CONFIG.STOP_OFFSET); // -1.5%

    const mktOrderId = await marketBuyLong(
      weexSymbol,
      qty1,
      `t1-${trade.id.slice(0, 18)}`,
      tp1,
      sl1,
    );

    const fillPrice1 = (await getTicker(weexSymbol)) ?? price_5m;
    const now = new Date().toISOString();

    await update(trade.id, {
      status: "filled",
      velocity_pct: velocityPct,
      entry_price: fillPrice1,
      fill_price: fillPrice1,
      stop_price: sl1,
      target_price: tp1,
      quantity: qty1,
      entry_order_id: mktOrderId,
      placed_at: now,
      filled_at: now,
      remaining_quantity: qty1,
      last_error: null,
    });

    await logEvent(
      trade.id,
      trade.symbol,
      "tranche1_filled",
      `Trade 1 ($70 Market Buy) filled ${qty1} contracts @ ${fillPrice1.toPrecision(6)}. Native WEEX Preset TP (+3.5%) @ ${tp1.toPrecision(6)} & Preset SL (-1.5%) @ ${sl1.toPrecision(6)} attached to payload.`,
    );

    // --- TRADE 2: TRANCHE 2 (Pullback Limit Buy - $70 Notional @ -1.0% Pullback) ---
    const limitPrice2 = roundToStep(price_5m * (1 + WEEX_CONFIG.PULLBACK_OFFSET), tickStr);
    let qty2 = floorToStep(WEEX_CONFIG.TRANCHE_NOTIONAL_USD / limitPrice2, stepStr);
    if (qty2 > maxOrderSize) {
      qty2 = floorToStep(maxOrderSize, stepStr);
    }

    if (qty2 > 0) {
      const tp2 = limitPrice2 * (1 + WEEX_CONFIG.TP2_OFFSET); // +3.5%
      const sl2 = limitPrice2 * (1 + WEEX_CONFIG.STOP_OFFSET); // -1.5%

      const tradeId2 = crypto.randomUUID() as `${string}-${string}-${string}-${string}-${string}`;

      try {
        await supabaseAdmin.from("weex_trades").insert({
          id: tradeId2,
          symbol: trade.symbol,
          alert_price: trade.alert_price,
          status: "pending_velocity",
          alerted_at: now,
          created_at: now,
        });
      } catch {}

      const limitOrderId2 = await placeLimitBuy(
        weexSymbol,
        limitPrice2,
        qty2,
        `t2-${tradeId2.slice(0, 18)}`,
        tp2,
        sl2,
      );

      await update(tradeId2, {
        symbol: trade.symbol,
        alert_price: trade.alert_price,
        status: "order_open",
        velocity_pct: velocityPct,
        entry_price: limitPrice2,
        stop_price: sl2,
        target_price: tp2,
        quantity: qty2,
        entry_order_id: limitOrderId2,
        placed_at: now,
        remaining_quantity: qty2,
        last_error: null,
      });

      await logEvent(
        tradeId2,
        trade.symbol,
        "tranche2_submitted",
        `Trade 2 ($70 Limit Buy @ -1.0% pullback) placed for ${qty2} contracts @ ${limitPrice2.toPrecision(6)}. Native WEEX Preset TP (+3.5%) @ ${tp2.toPrecision(6)} & Preset SL (-1.5%) @ ${sl2.toPrecision(6)} attached to payload. 15m expiry timer active.`,
      );
    }

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

    await update(trade.id, {
      status: "filled",
      filled_at: new Date().toISOString(),
      fill_price: fill,
      remaining_quantity: trade.quantity,
    });

    await logEvent(
      trade.id,
      trade.symbol,
      isLive ? "live_order_filled" : "order_filled",
      `Trade 2 Limit Buy filled @ ${fill.toPrecision(6)} for ${trade.quantity} contracts. Native WEEX Preset TP (+3.5%) & SL (-1.5%) active on exchange.`,
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
      "Limit buy cancelled on exchange",
    );
    return;
  }

  const expiry =
    Date.parse(trade.placed_at ?? trade.alerted_at) + 15 * 60_000;
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
    await logEvent(
      trade.id,
      trade.symbol,
      "order_expired",
      `Unfilled after 15m — pullback limit buy cancelled`,
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
  const fill1 = Number(trade.t1_fill_price ?? trade.fill_price ?? trade.entry_price);
  if (!fill1 || fill1 <= 0) return;

  const contract = await getContract(weexSymbol);
  const stepStr = getContractStepSize(contract);

  // 1. Tranche 2 Pullback Limit Order Expiration & Fill Monitoring (15 Minutes)
  if (trade.t2_order_id && !trade.t2_filled && !trade.t2_expired) {
    const t2Expiry = Date.parse(trade.t2_placed_at ?? trade.placed_at ?? trade.alerted_at) + WEEX_CONFIG.PULLBACK_EXPIRY_MINUTES * 60_000;
    const t2Detail = await getOrderDetail(weexSymbol, trade.t2_order_id);

    if (isFilled(t2Detail)) {
      const fill2 = Number(t2Detail?.price_avg) || Number(trade.t2_limit_price);
      const qty2 = Number(trade.t2_quantity ?? 0);
      const t2SlPrice = fill2 * (1 + WEEX_CONFIG.STOP_OFFSET);
      const t2Tp1Price = fill2 * (1 + WEEX_CONFIG.TP1_OFFSET);
      const t2Tp2Price = fill2 * (1 + WEEX_CONFIG.TP2_OFFSET);

      const { sizeTP1: sizeTP1_t2, sizeTP2: sizeTP2_t2 } = splitQuantity5050(qty2, stepStr);

      let t2Tp1Id: string | null = null;
      let t2Tp2Id: string | null = null;
      let t2SlId: string | null = null;

      try {
        if (sizeTP1_t2 > 0) {
          t2Tp1Id = await placePlanOrder(weexSymbol, t2Tp1Price, t2Tp1Price, sizeTP1_t2, `tp1-t2-${trade.id.slice(0, 14)}`, "0");
        }
        if (sizeTP2_t2 > 0) {
          t2Tp2Id = await placePlanOrder(weexSymbol, t2Tp2Price, t2Tp2Price, sizeTP2_t2, `tp2-t2-${trade.id.slice(0, 14)}`, "0");
        }
        if (qty2 > 0) {
          t2SlId = await placePlanOrder(weexSymbol, t2SlPrice, t2SlPrice, qty2, `sl-t2-${trade.id.slice(0, 14)}`, "1");
        }
      } catch (err) {
        console.warn(`Tranche 2 plan orders error for ${trade.symbol}:`, (err as Error).message);
      }

      const combinedTp = [trade.tp_order_id, t2Tp1Id, t2Tp2Id].filter(Boolean).join(",");
      const combinedSl = [trade.sl_order_id, t2SlId].filter(Boolean).join(",");

      await update(trade.id, {
        t2_filled: true,
        t2_fill_price: fill2,
        tp_order_id: combinedTp,
        sl_order_id: combinedSl,
        remaining_quantity: Number(trade.quantity ?? 0),
      });

      await logEvent(
        trade.id,
        trade.symbol,
        "tranche2_filled",
        `Tranche 2 Limit Buy filled @ ${fill2.toPrecision(6)} for ${qty2} contracts ($70 USD notional). Attached TP1 (+2.0%), TP2 (+3.5%), SL (-1.5%).`,
      );
    } else if (Date.now() >= t2Expiry) {
      try {
        await cancelOrder(weexSymbol, trade.t2_order_id);
      } catch {
        /* ignore cancel error */
      }

      const activeQty = Number(trade.t1_quantity ?? trade.quantity ?? 0);
      const { sizeTP1: sizeTP1_t1 } = splitQuantity5050(activeQty, stepStr);
      const remainingQty = trade.tp1_filled ? (activeQty - sizeTP1_t1) : activeQty;

      await update(trade.id, {
        t2_expired: true,
        quantity: activeQty,
        remaining_quantity: remainingQty,
      });

      await logEvent(
        trade.id,
        trade.symbol,
        "tranche2_expired",
        `Unfilled after 15m — cancelled Tranche 2 limit buy for ${trade.symbol}`,
      );
    }
  }

  // 2. High-Water Mark (MFE) Tracking & Price Fetching
  const price = await getTicker(weexSymbol);
  if (price === null) {
    await checkTimeExits(trade, null);
    return;
  }

  const prevHigh = Number(trade.high_water_price ?? fill1);
  const newHigh = Math.max(prevHigh, price);
  if (newHigh > prevHigh) {
    await update(trade.id, { high_water_price: newHigh });
  }

  // 3. Dynamic Break-Even Trigger (MFE >= +1.5%)
  const beTriggerPrice = fill1 * (1 + WEEX_CONFIG.BREAKEVEN_TRIGGER_OFFSET);
  const slMovedToBe = Boolean(trade.sl_moved_to_be);

  if (!slMovedToBe && newHigh >= beTriggerPrice) {
    console.log(`[WEEX ENGINE] Dynamic Break-Even Triggered for ${trade.symbol}! MFE price ${newHigh.toPrecision(6)} >= ${beTriggerPrice.toPrecision(6)} (+1.5%). Moving SL to entry ${fill1.toPrecision(6)}.`);

    if (trade.sl_order_id) {
      const slIds = String(trade.sl_order_id).split(",");
      for (const id of slIds) {
        if (id) {
          try { await cancelPlanOrder(weexSymbol, id); } catch { /* ignore */ }
        }
      }
    }

    const activeQty = Number(trade.remaining_quantity ?? trade.quantity ?? 0);
    let newSlOrderId: string | null = null;
    try {
      if (activeQty > 0) {
        newSlOrderId = await placePlanOrder(
          weexSymbol,
          fill1,
          fill1,
          activeQty,
          `be-sl-${trade.id.slice(0, 18)}`,
          "1",
        );
      }
    } catch { /* ignore */ }

    await update(trade.id, {
      stop_price: fill1,
      sl_moved_to_be: true,
      sl_order_id: newSlOrderId ?? trade.sl_order_id,
    });

    await logEvent(
      trade.id,
      trade.symbol,
      "break_even_activated",
      `Protected position for ${trade.symbol} at entry price (${fill1.toPrecision(6)}) after +1.5% MFE gain`,
    );
  }

  // 4. TP1 Check (+2.0%)
  const tp1Price = Number(trade.tp1_price ?? (fill1 * (1 + WEEX_CONFIG.TP1_OFFSET)));
  const tp2Price = Number(trade.tp2_price ?? trade.target_price ?? (fill1 * (1 + WEEX_CONFIG.TP2_OFFSET)));
  const currentStop = Number(trade.stop_price ?? (fill1 * (1 + WEEX_CONFIG.STOP_OFFSET)));
  const activeQty = Number(trade.t1_quantity ?? trade.quantity ?? 0);
  const { sizeTP1, sizeTP2 } = splitQuantity5050(activeQty, stepStr);

  const tp1Filled = Boolean(trade.tp1_filled);
  if (!tp1Filled && price >= tp1Price) {
    console.log(`[WEEX ENGINE] TP1 (+2.0%) Triggered for ${trade.symbol} @ ${price.toPrecision(6)}! Banking 50% (${sizeTP1} contracts).`);
    const tp1Pnl = (tp1Price - fill1) * sizeTP1;

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
            fill1,
            fill1,
            sizeTP2,
            `be-sl-tp1-${trade.id.slice(0, 16)}`,
            "1",
          );
        }
      } catch { /* ignore */ }
    }

    await update(trade.id, {
      tp1_filled: true,
      stop_price: fill1,
      sl_moved_to_be: true,
      sl_order_id: beSlOrderId,
      remaining_quantity: sizeTP2,
    });

    await logEvent(
      trade.id,
      trade.symbol,
      "tp1_filled",
      `Banked 50% TP1 (${sizeTP1} contracts) @ ${tp1Price.toPrecision(6)} (+2.0%) · PnL $${tp1Pnl.toFixed(2)}. Remaining 50% runner (${sizeTP2}) active with Break-Even SL @ ${fill1.toPrecision(6)}`,
    );
  }

  // 5. Runner TP2 Check (+3.5% to +5.0%)
  if (price >= tp2Price) {
    console.log(`[WEEX ENGINE] Runner TP2 (+3.5% to +5.0%) Triggered for ${trade.symbol} @ ${price.toPrecision(6)}! Closing remaining position.`);
    const remainingQty = tp1Filled ? sizeTP2 : activeQty;
    const pnl1 = tp1Filled ? (tp1Price - fill1) * sizeTP1 : 0;
    const pnl2 = (tp2Price - fill1) * remainingQty;
    const totalPnl = pnl1 + pnl2;

    await closeTradeWithPnl(trade, tp2Price, "take_profit", totalPnl);
    return;
  }

  // 6. Stop-Loss Check (Initial -1.5% or Break-Even 0.0%)
  const activeStop = trade.sl_moved_to_be || trade.tp1_filled ? fill1 : currentStop;
  if (price <= activeStop) {
    console.log(`[WEEX ENGINE] Stop-Loss Triggered for ${trade.symbol} @ ${price.toPrecision(6)} (Stop: ${activeStop.toPrecision(6)}). Closing remaining position.`);
    const remainingQty = tp1Filled ? sizeTP2 : activeQty;
    const pnl1 = tp1Filled ? (tp1Price - fill1) * sizeTP1 : 0;
    const pnl2 = (activeStop - fill1) * remainingQty;
    const totalPnl = pnl1 + pnl2;

    await closeTradeWithPnl(trade, activeStop, "stop_loss", totalPnl);
    return;
  }

  // 7. Time Exit Check (60 Minutes)
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
