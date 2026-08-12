import { createServerFn } from "@tanstack/react-start";
import { readLocalEvents, readLocalTrades } from "./weex/local-store.server";

export type DeskTrade = {
  id: string;
  symbol: string;
  alert_price: number;
  alerted_at: string;
  status: string;
  velocity_pct?: number | null;
  entry_price?: number | null;
  stop_price?: number | null;
  target_price?: number | null;
  quantity?: number | null;
  filled_at?: string | null;
  fill_price?: number | null;
  closed_at?: string | null;
  close_price?: number | null;
  close_reason?: string | null;
  realized_pnl?: number | null;
  last_error?: string | null;
};

export type DeskEvent = {
  id: string;
  symbol: string;
  event: string;
  detail: string | null;
  created_at: string;
};

export const getTradingDesk = createServerFn({ method: "GET" }).handler(async () => {
  let dbTrades: DeskTrade[] = [];
  let dbEvents: DeskEvent[] = [];

  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [tradesRes, eventsRes] = await Promise.all([
      supabaseAdmin
        .from("weex_trades")
        .select(
          "id,symbol,alert_price,alerted_at,status,velocity_pct,entry_price,stop_price,target_price,quantity,filled_at,fill_price,closed_at,close_price,close_reason,realized_pnl,last_error",
        )
        .order("alerted_at", { ascending: false })
        .limit(60),
      supabaseAdmin
        .from("trade_events")
        .select("id,symbol,event,detail,created_at")
        .order("created_at", { ascending: false })
        .limit(40),
    ]);
    dbTrades = (tradesRes.data ?? []) as DeskTrade[];
    dbEvents = (eventsRes.data ?? []) as DeskEvent[];
  } catch {
    /* fallback to local store */
  }

  const localTrades = readLocalTrades() as unknown as DeskTrade[];
  const localEvents = readLocalEvents() as unknown as DeskEvent[];

  const tradeMap = new Map<string, DeskTrade>();
  for (const t of dbTrades) if (t.id) tradeMap.set(t.id, t);
  for (const t of localTrades) if (t.id) tradeMap.set(t.id, t);

  const eventMap = new Map<string, DeskEvent>();
  for (const e of dbEvents) if (e.id) eventMap.set(e.id, e);
  for (const e of localEvents) if (e.id) eventMap.set(e.id, e);

  const trades = Array.from(tradeMap.values());
  const events = Array.from(eventMap.values());

  const closed = trades.filter((t) => t.status === "closed");
  const wins = closed.filter((t) => Number(t.realized_pnl ?? 0) > 0).length;

  return {
    trades,
    events,
    stats: {
      openPositions: trades.filter((t) => t.status === "filled").length,
      openOrders: trades.filter((t) => t.status === "order_open").length,
      pendingVelocity: trades.filter((t) => t.status === "pending_velocity").length,
      closedCount: closed.length,
      realizedPnl: closed.reduce((sum, t) => sum + Number(t.realized_pnl ?? 0), 0),
      winRate: closed.length > 0 ? (wins / closed.length) * 100 : null,
    },
    error: null,
  };
});
