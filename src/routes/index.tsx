import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";

import { SCANNER_CONFIG } from "@/lib/scanner/config";
import { getScannerStatus } from "@/lib/scanner-status.functions";

const statusQuery = queryOptions({
  queryKey: ["scanner-status"],
  queryFn: () => getScannerStatus(),
  refetchInterval: 60_000,
});

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "MEXC Predictive Accumulation Scanner" },
      {
        name: "description",
        content:
          "Stage-based MEXC altcoin scanner detecting quiet accumulation, volatility compression and breakout readiness, with Telegram alerts every 5 minutes.",
      },
      { property: "og:title", content: "MEXC Predictive Accumulation Scanner" },
      {
        property: "og:description",
        content:
          "Stage-based MEXC altcoin scanner detecting quiet accumulation, volatility compression and breakout readiness, with Telegram alerts every 5 minutes.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(statusQuery),
  component: Index,
});

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 font-mono text-lg text-foreground">{value}</div>
    </div>
  );
}

function Index() {
  const { data } = useSuspenseQuery(statusQuery);
  const cfg = SCANNER_CONFIG;
  const latest = data.runs[0];

  const stages = [
    ["Stage 0", "Noise — rejected by hard gates"],
    ["Stage 1", "Quiet accumulation (RS vs BTC rising)"],
    ["Stage 2", "Volatility compression (BBW / ATR squeeze)"],
    ["Stage 3", "Breakout readiness near 20-period high"],
    ["Stage 4", "Momentum ignition"],
    ["Stage 5/6", "Parabolic / exhaustion — penalized & gated"],
  ];

  return (
    <main className="min-h-screen bg-background px-6 py-10">
      <div className="mx-auto max-w-4xl">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-5 mb-8">
          <div className="flex items-center gap-3">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
            </span>
            <span className="font-mono text-base font-semibold tracking-tight text-foreground">
              AccuPulse Automated Trading Platform
            </span>
          </div>
          <nav className="flex items-center gap-3">
            <Link
              to="/"
              className="rounded-md border border-border bg-accent px-3.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent/80"
            >
              🔍 Scanner Overview
            </Link>
            <Link
              to="/trades"
              className="rounded-md bg-emerald-600 px-3.5 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-emerald-500"
            >
              ⚡ WEEX Trading Desk &amp; Performance Dashboard
            </Link>
            <Link
              to="/settings"
              className="rounded-md bg-muted px-3.5 py-1.5 text-xs font-medium text-muted-foreground shadow-sm transition-colors hover:bg-muted/80"
            >
              ⚙️ Settings
            </Link>
          </nav>
        </header>

        <p className="font-mono text-xs uppercase tracking-[0.3em] text-muted-foreground">
          MEXC · Spot · USDT
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-foreground">
          Predictive Accumulation &amp; Breakout Scanner
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Runs server-side every {cfg.SCAN_CONFIG.SCAN_INTERVAL_SECONDS / 60} minutes over
          the top {cfg.SCAN_CONFIG.UNIVERSE_SIZE} altcoins by 24h volume. Setups that clear
          the hard gates and score at or above{" "}
          {cfg.THRESHOLDS.SCORE_ALERT_THRESHOLD.toFixed(2)} are pushed straight to Telegram.
        </p>

        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat
            label="Last scan (UTC)"
            value={
              latest
                ? new Date(latest.created_at).toISOString().slice(11, 16)
                : "—"
            }
          />

          <Stat label="Scanned" value={latest ? String(latest.scanned) : "—"} />
          <Stat label="Passed gates" value={latest ? String(latest.passed_gates) : "—"} />
          <Stat label="Alerts sent" value={latest ? String(latest.alerts_sent) : "—"} />
        </div>

        <section className="mt-10">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            Lifecycle model
          </h2>
          <ul className="mt-3 divide-y divide-border overflow-hidden rounded-lg border border-border">
            {stages.map(([stage, desc]) => (
              <li key={stage} className="flex gap-4 bg-card px-4 py-3 text-sm">
                <span className="w-20 shrink-0 font-mono text-muted-foreground">
                  {stage}
                </span>
                <span className="text-foreground">{desc}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-10">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            Recent runs
          </h2>
          <div className="mt-3 overflow-hidden rounded-lg border border-border">
            {data.runs.length === 0 ? (
              <p className="bg-card px-4 py-6 text-sm text-muted-foreground">
                No scans recorded yet. The first scheduled run will appear here.
              </p>
            ) : (
              <table className="w-full text-sm">
                <tbody className="divide-y divide-border">
                  {data.runs.map((run) => (
                    <tr key={run.created_at} className="bg-card">
                      <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                        {new Date(run.created_at).toISOString().slice(5, 16).replace("T", " ")}
                      </td>
                      <td className="px-4 py-2 text-foreground">
                        {run.error ? (
                          <span className="text-destructive">{run.error}</span>
                        ) : (
                          `${run.scanned} scanned · ${run.passed_gates} qualified · ${run.alerts_sent} alerts`
                        )}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs text-muted-foreground">
                        {(run.duration_ms / 1000).toFixed(1)}s
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
