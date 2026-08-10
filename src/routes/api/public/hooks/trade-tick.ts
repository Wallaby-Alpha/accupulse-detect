import { createFileRoute } from "@tanstack/react-router";

async function handle() {
  try {
    const { runTradeEngine } = await import("@/lib/weex/engine.server");
    const result = await runTradeEngine();
    return Response.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Trade engine tick failed:", message);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/public/hooks/trade-tick")({
  server: {
    handlers: {
      POST: handle,
      GET: handle,
    },
  },
});
