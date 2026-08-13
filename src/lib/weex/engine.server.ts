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
  cancelOrder,
  cancelPlanOrder,
  getOrderDetail,
  getTicker,
  getWeexCredentials,
  isDemoMode,
  isFilled,
  marketCloseLong,
  placeLimitBuy,
  placePlanOrder,
  toContractSize,
  WeexError,
} from "./client.server";
import { saveLocalTrade } from "./local-store.server";

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

async function update(id: string, patch: Record<string, unknown>): Promise<void> {
  await supabaseAdmin
    .from("weex_trades")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
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

  const tradeId = crypto.randomUUID();
  const now = new Date().toISOString();

  let id = tradeId;
  try {
    const { data, error } = await supabaseAdmin
      .from("weex_trades")
      .insert({ id: tradeId, symbol: targetSymbol, alert_price: alertPrice, status: "pending_velocity", alerted_at: now })
      .select("id")
      .single();
    if (data?.id) id = data.id;
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
    const size = await toContractSize(weexSymbol, plan.quantity);
    const orderId = await placeLimitBuy(
      weexSymbol,
      plan.entry,
      size,
      `entry-${trade.id.slice(0, 20)}`,
    );
    await update(trade.id, {
      status: "order_open",
      velocity_pct: velocityPct,
      entry_price: plan.entry,
      stop_price: plan.stop,
      target_price: plan.target,
      quantity: plan.quantity,
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
    await update(trade.id, {
      status: "filled",
      filled_at: new Date().toISOString(),
      fill_price: fill,
    });
    await logEvent(
      trade.id,
      trade.symbol,
      isLive ? "live_order_filled" : "order_filled",
      `Filled @ ${fill.toPrecision(6)} — ${WEEX_CONFIG.TIME_EXIT_MINUTES}m timer started`,
    );
    await attachBracket({ ...trade, fill_price: fill });
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

/** OCO bracket: take-profit limit + stop-loss trigger, both closing the long. */
async function attachBracket(trade: TradeRow): Promise<void> {
  const weexSymbol = toWeexSymbol(trade.symbol);
  try {
    const size = await toContractSize(weexSymbol, Number(trade.quantity));
    const tp = await placePlanOrder(
      weexSymbol,
      Number(trade.target_price),
      Number(trade.target_price),
      size,
      `tp-${trade.id.slice(0, 20)}`,
      "0",
    );
    const sl = await placePlanOrder(
      weexSymbol,
      Number(trade.stop_price),
      Number(trade.stop_price),
      size,
      `sl-${trade.id.slice(0, 20)}`,
      "1",
    );
    await update(trade.id, { tp_order_id: tp, sl_order_id: sl });
    await logEvent(
      trade.id,
      trade.symbol,
      "bracket_attached",
      `TP ${Number(trade.target_price).toPrecision(6)} / SL ${Number(trade.stop_price).toPrecision(6)}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await update(trade.id, { last_error: `Bracket failed: ${message}` });
    await logEvent(trade.id, trade.symbol, "bracket_error", message);
  }
}

async function closeTrade(
  trade: TradeRow,
  price: number,
  reason: "take_profit" | "stop_loss" | "time_exit",
): Promise<void> {
  const fill = Number(trade.fill_price ?? trade.entry_price);
  const pnl = (price - fill) * Number(trade.quantity);
  await update(trade.id, {
    status: "closed",
    closed_at: new Date().toISOString(),
    close_price: price,
    close_reason: reason,
    realized_pnl: pnl,
  });
  await logEvent(
    trade.id,
    trade.symbol,
    reason,
    `Closed @ ${price.toPrecision(6)} · PnL $${pnl.toFixed(2)}`,
  );
}

async function handleFilled(trade: TradeRow): Promise<void> {
  const weexSymbol = toWeexSymbol(trade.symbol);
  const price = await getTicker(weexSymbol);

  // Exchange brackets do the closing; we detect which leg triggered.
  if (price !== null) {
    if (price >= Number(trade.target_price)) {
      await closeTrade(trade, Number(trade.target_price), "take_profit");
      return;
    }
    if (price <= Number(trade.stop_price)) {
      await closeTrade(trade, Number(trade.stop_price), "stop_loss");
      return;
    }
  }

  const deadline =
    Date.parse(trade.filled_at ?? trade.alerted_at) +
    WEEX_CONFIG.TIME_EXIT_MINUTES * 60_000;
  if (Date.now() < deadline) return;

  for (const [id, kind] of [
    [trade.tp_order_id, "tp"],
    [trade.sl_order_id, "sl"],
  ] as const) {
    if (!id) continue;
    try {
      await cancelPlanOrder(weexSymbol, id);
    } catch (error) {
      console.error(`Cancel ${kind} plan order failed:`, error);
    }
  }

  let closePrice = price ?? Number(trade.fill_price ?? trade.entry_price);
  try {
    const size = await toContractSize(weexSymbol, Number(trade.quantity));
    await marketCloseLong(weexSymbol, size, `exit-${trade.id.slice(0, 20)}`);
    closePrice = (await getTicker(weexSymbol)) ?? closePrice;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await update(trade.id, { last_error: `Time exit close failed: ${message}` });
    await logEvent(trade.id, trade.symbol, "time_exit_error", message);
    return;
  }

  await closeTrade(trade, closePrice, "time_exit");
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
      await update(row.id, { last_error: message });
      await logEvent(row.id, row.symbol, "engine_error", message);
    }
  }

  return { processed: data?.length ?? 0, errors };
}
