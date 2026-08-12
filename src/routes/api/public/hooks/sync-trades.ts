import { createFileRoute } from "@tanstack/react-router";
import { saveLocalTrade, saveLocalEvent, type LocalTradeRow, type LocalEventRow } from "@/lib/weex/local-store.server";

async function handle(req: { request: Request }) {
  try {
    const body = await req.request.json() as {
      trade?: LocalTradeRow;
      trades?: LocalTradeRow[];
      event?: LocalEventRow;
      events?: LocalEventRow[];
    };

    let count = 0;
    if (body.trade) {
      saveLocalTrade(body.trade);
      count++;
    }
    if (body.trades && Array.isArray(body.trades)) {
      for (const t of body.trades) saveLocalTrade(t);
      count += body.trades.length;
    }
    if (body.event) {
      saveLocalEvent(body.event);
    }
    if (body.events && Array.isArray(body.events)) {
      for (const e of body.events) saveLocalEvent(e);
    }

    return Response.json({ ok: true, syncedTrades: count });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/public/hooks/sync-trades")({
  server: {
    handlers: {
      POST: handle,
      GET: handle,
    },
  },
});
