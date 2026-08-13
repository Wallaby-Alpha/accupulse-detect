import { createFileRoute } from "@tanstack/react-router";

import {
  isStageOne,
  passesMoverFilter,
  MAJOR_CAP_EXCLUSIONS,
  MOVER_LOOKBACK_ALERTS,
  RUNUP_TRACKING_HOURS,
} from "@/lib/scanner/alert-filter";
import { SCANNER_CONFIG } from "@/lib/scanner/config";

import {
  buildUniverse,
  fetchDepth,
  fetchKlines,
  fetchTickers,
  mapLimit,
  type Kline,
  type Ticker,
} from "@/lib/scanner/mexc";
import { checkHardGates, scoreSymbol, type ScoreResult } from "@/lib/scanner/scoring";
import { formatAlert, sendTelegramMessage } from "@/lib/scanner/telegram";

const INTERVAL_1H = "60m";

export async function runScan() {
  const started = Date.now();
  const cfg = SCANNER_CONFIG;

  const tickers = await fetchTickers();
  const tickerBySymbol = new Map(tickers.map((t) => [t.symbol, t]));
  const btcTicker = tickerBySymbol.get("BTCUSDT");
  const universe = buildUniverse(tickers, cfg.SCAN_CONFIG.UNIVERSE_SIZE);

  const btcKlines1h = await fetchKlines("BTCUSDT", INTERVAL_1H, 200);

  type Candidate = { ticker: Ticker; k1h: Kline[]; k4h: Kline[]; k1d: Kline[] };

  const fetched = await mapLimit(universe, 3, async (t): Promise<Candidate | null> => {
    if (Number(t.quoteVolume) < cfg.GATES.MIN_24H_VOLUME_USD) return null;
    const k1h = await fetchKlines(t.symbol, INTERVAL_1H, 200);
    if (k1h.length < cfg.GATES.MIN_LOOKBACK_CANDLES) return null;

    // Cheap pre-gate before spending two more requests per symbol.
    const preGate = checkHardGates(
      {
        ticker: t,
        klines1h: k1h,
        klines4h: [],
        klines1d: [],
        btcKlines1h,
        depth: null,
      },
      { ...cfg, GATES: { ...cfg.GATES, TIMEFRAME_CONFLUENCE_ENABLED: false } },
    );
    if (!preGate.pass) return null;

    const [k4h, k1d] = await Promise.all([
      fetchKlines(t.symbol, "4h", 120),
      fetchKlines(t.symbol, "1d", 90),
    ]);
    return { ticker: t, k1h, k4h, k1d };
  });

  const candidates = fetched.filter((c): c is Candidate => c !== null);

  // First pass without order book depth, to pick which symbols deserve a depth call.
  const firstPass = candidates
    .map((c) => ({
      candidate: c,
      result: scoreSymbol({
        ticker: c.ticker,
        klines1h: c.k1h,
        klines4h: c.k4h,
        klines1d: c.k1d,
        btcKlines1h,
        depth: null,
      }),
    }))
    .filter((x) => x.result.status === "OK")
    .sort((a, b) => b.result.finalScore - a.result.finalScore);

  const withDepth = firstPass.slice(0, cfg.SCAN_CONFIG.DEPTH_CANDIDATES);
  const depths = await mapLimit(withDepth, 5, (x) => fetchDepth(x.candidate.ticker.symbol, 20));

  const finalResults: ScoreResult[] = withDepth
    .map((x, i) =>
      scoreSymbol({
        ticker: x.candidate.ticker,
        klines1h: x.candidate.k1h,
        klines4h: x.candidate.k4h,
        klines1d: x.candidate.k1d,
        btcKlines1h,
        depth: depths[i] ?? null,
      }),
    )
    .sort((a, b) => b.finalScore - a.finalScore);

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // --- Update rolling run-up tracking for recent alerts ---
  try {
    const trackingCutoff = new Date(
      Date.now() - RUNUP_TRACKING_HOURS * 60 * 60_000,
    ).toISOString();
    const { data: pending } = await supabaseAdmin
      .from("alert_history")
      .select("id,symbol,alert_price,max_runup_pct,alerted_at")
      .eq("tracking_done", false);
    for (const row of pending ?? []) {
      const expired = row.alerted_at < trackingCutoff;
      const last = Number(tickerBySymbol.get(row.symbol)?.lastPrice ?? 0);
      const runup =
        last > 0 && Number(row.alert_price) > 0
          ? (last / Number(row.alert_price) - 1) * 100
          : 0;
      const best = Math.max(Number(row.max_runup_pct), runup);
      if (best > Number(row.max_runup_pct) || expired) {
        await supabaseAdmin
          .from("alert_history")
          .update({ max_runup_pct: best, tracking_done: expired })
          .eq("id", row.id);
      }
    }
  } catch (err) {
    console.error("Runup tracking DB error:", err);
  }

  const onCooldown = new Set<string>();
  try {
    const cooldownCutoff = new Date(
      Date.now() - cfg.THRESHOLDS.RE_ALERT_COOLDOWN_MINUTES * 60_000,
    ).toISOString();
    const { data: cooldowns, error: cdErr } = await supabaseAdmin
      .from("alert_cooldowns")
      .select("symbol,last_alert_at")
      .gte("last_alert_at", cooldownCutoff);
    if (!cdErr && Array.isArray(cooldowns)) {
      for (const c of cooldowns) onCooldown.add(c.symbol);
    }
  } catch {
    /* ignore missing table error */
  }

  // Dispatch gate: Stage 1 only, no major caps, no chronic flatliners.
  const stageOne = finalResults.filter(
    (r) =>
      r.shouldAlert &&
      isStageOne(r.stage) &&
      !onCooldown.has(r.symbol) &&
      !MAJOR_CAP_EXCLUSIONS.has(r.symbol),
  );

  const toAlert: ScoreResult[] = [];
  for (const r of stageOne) {
    if (toAlert.length >= cfg.THRESHOLDS.TOP_COINS_PER_SCAN) break;
    let runups: number[] = [];
    try {
      const { data: history, error: histErr } = await supabaseAdmin
        .from("alert_history")
        .select("max_runup_pct")
        .eq("symbol", r.symbol)
        .order("alerted_at", { ascending: false })
        .limit(MOVER_LOOKBACK_ALERTS);
      if (!histErr && Array.isArray(history)) {
        runups = history.map((h) => Number(h.max_runup_pct));
      }
    } catch {
      /* fallback */
    }
    if (passesMoverFilter(runups)) toAlert.push(r);
  }

  const { registerSignal } = await import("@/lib/weex/engine.server");

  let alertsSent = 0;
  for (const r of toAlert) {
    // 1. Hand signal to WEEX demo execution engine FIRST (guaranteed trade registration)
    try {
      await registerSignal(r.symbol, r.currentPrice);
    } catch (error) {
      console.error(`WEEX registerSignal failed for ${r.symbol}:`, error);
    }

    // 2. Dispatch Telegram alert
    try {
      await sendTelegramMessage(formatAlert(r));
      alertsSent++;
    } catch (error) {
      console.error(`Telegram alert failed for ${r.symbol}:`, error);
    }

    // 3. Database cooldown tracking (isolated try/catch so DB errors never block trading)
    try {
      await supabaseAdmin.from("alert_cooldowns").upsert(
        {
          symbol: r.symbol,
          last_alert_at: new Date().toISOString(),
          last_score: r.finalScore,
          last_stage: r.stage,
        },
        { onConflict: "symbol" },
      );
    } catch {
      /* ignore missing table error */
    }

    // 4. Database history tracking
    try {
      await supabaseAdmin.from("alert_history").insert({
        symbol: r.symbol,
        alert_price: r.currentPrice,
        stage: r.stage,
        score: r.finalScore,
      });
    } catch {
      /* ignore missing table error */
    }
  }



  const summary = {
    scanned: universe.length,
    passedGates: finalResults.length,
    alertsSent,
    durationMs: Date.now() - started,
    btcChange24h: btcTicker ? Number(btcTicker.priceChangePercent) : null,
    top: finalResults.slice(0, 10).map((r) => ({
      symbol: r.symbol,
      score: r.finalScore,
      stage: r.stage,
      price: r.currentPrice,
      components: r.components,
    })),
  };

  await supabaseAdmin.from("scan_runs").insert({
    scanned: summary.scanned,
    passed_gates: summary.passedGates,
    alerts_sent: summary.alertsSent,
    duration_ms: summary.durationMs,
  });

  return summary;
}

async function handle() {
  try {
    const summary = await runScan();
    return Response.json({ ok: true, ...summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Scan failed:", message);
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.from("scan_runs").insert({ error: message });
    } catch {
      /* logging failure must not mask the scan failure */
    }
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/public/hooks/scan")({
  server: {
    handlers: {
      POST: handle,
      GET: handle,
    },
  },
});
