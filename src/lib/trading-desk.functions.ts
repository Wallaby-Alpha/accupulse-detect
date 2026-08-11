import { createServerFn } from "@tanstack/react-start";

export const getTradingDesk = createServerFn({ method: "GET" }).handler(async () => {
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

  const trades = tradesRes.data ?? [];
  const closed = trades.filter((t) => t.status === "closed");
  const wins = closed.filter((t) => Number(t.realized_pnl) > 0).length;

  return {
    trades,
    events: eventsRes.data ?? [],
    stats: {
      openPositions: trades.filter((t) => t.status === "filled").length,
      openOrders: trades.filter((t) => t.status === "order_open").length,
      pendingVelocity: trades.filter((t) => t.status === "pending_velocity").length,
      closedCount: closed.length,
      realizedPnl: closed.reduce((sum, t) => sum + Number(t.realized_pnl ?? 0), 0),
      winRate: closed.length > 0 ? (wins / closed.length) * 100 : null,
    },
    error: tradesRes.error ? "Trading data unavailable" : null,
  };
});
