import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";

import { getTradingDesk } from "@/lib/trading-desk.functions";
import { WEEX_CONFIG } from "@/lib/weex/config";

const deskQuery = queryOptions({
  queryKey: ["trading-desk"],
  queryFn: () => getTradingDesk(),
  refetchInterval: 30_000,
});

export const Route = createFileRoute("/trades")({
  head: () => ({
    meta: [
      { title: "WEEX Demo Execution Desk — Stage 1 Auto Trading" },
      {
        name: "description",
        content:
          "Live monitor for the automated WEEX demo trading engine: velocity-filtered Stage 1 signals, open limit orders, active positions, realized PnL and win rate.",
      },
      { property: "og:title", content: "WEEX Demo Execution Desk" },
      {
        property: "og:description",
        content:
          "Automated Stage 1 execution on WEEX demo: bracket orders, 60-minute time exits, realized PnL and win rate.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(deskQuery),
  component: TradingDesk,
});

function fmt(value: number | null | undefined, digits = 6): string {
  if (value === null || value === undefined) return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n >= 1 ? n.toFixed(4) : n.toPrecision(digits);
}

function ts(value: string | null | undefined): string {
  return value ? new Date(value).toISOString().slice(5, 16).replace("T", " ") : "—";
}

const STATUS_STYLE: Record<string, string> = {
  pending_velocity: "text-muted-foreground",
  order_open: "text-primary",
  filled: "text-foreground",
  closed: "text-muted-foreground",
  CLOSED: "text-muted-foreground",
  discarded: "text-muted-foreground",
  expired: "text-muted-foreground",
  blocked: "text-destructive",
};

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

function TradingDesk() {
  const { data } = useSuspenseQuery(deskQuery);
  const { stats } = data;

  const active = data.trades.filter((t) =>
    ["pending_velocity", "order_open", "filled", "blocked"].includes(t.status),
  );
  const history = data.trades.filter((t) =>
    ["closed", "CLOSED", "discarded", "expired"].includes(t.status),
  );

  return (
    <main className="min-h-screen bg-background px-6 py-10">
      <div className="mx-auto max-w-5xl">
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
              className="rounded-md border border-border bg-card px-3.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
            >
              🔍 Scanner Overview
            </Link>
            <Link
              to="/trades"
              className="rounded-md bg-emerald-600 px-3.5 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-emerald-500"
            >
              ⚡ WEEX Trading Desk &amp; Performance Dashboard
            </Link>
          </nav>
        </header>

        <div className="flex items-center gap-3">
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-muted-foreground">
            WEEX · Contracts
          </p>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 font-mono text-[11px] font-medium text-emerald-500 border border-emerald-500/20">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            WEEX V3 SIM PAPER TRADING ACTIVE
          </span>
        </div>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-foreground">
          Automated Execution Desk
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Every Stage 1 alert waits {WEEX_CONFIG.VELOCITY_DELAY_MINUTES} minutes, is
          discarded if it has dropped {(WEEX_CONFIG.VELOCITY_MAX_DROP * 100).toFixed(1)}%
          or more, then places a limit buy at −2.5% with a +3.5% / −1.5% bracket sized to
          ${WEEX_CONFIG.FIXED_RISK_USD} of risk. Unfilled orders expire after{" "}
          {WEEX_CONFIG.ORDER_EXPIRY_HOURS}h; filled positions are market-closed at{" "}
          {WEEX_CONFIG.TIME_EXIT_MINUTES}m.{" "}
          <Link to="/" className="underline underline-offset-4">
            Scanner status
          </Link>
        </p>

        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Stat label="Active positions" value={String(stats.openPositions)} />
          <Stat label="Open limit orders" value={String(stats.openOrders)} />
          <Stat label="Awaiting velocity" value={String(stats.pendingVelocity)} />
          <Stat
            label="Realized PnL"
            value={`${stats.realizedPnl >= 0 ? "+" : "−"}$${Math.abs(stats.realizedPnl).toFixed(2)}`}
          />
          <Stat
            label="Win rate"
            value={
              stats.winRate === null
                ? "—"
                : `${stats.winRate.toFixed(0)}% (${stats.closedCount})`
            }
          />
        </div>

        <Section title="Active signals & positions">
          {active.length === 0 ? (
            <Empty>No live signals. New Stage 1 alerts appear here immediately.</Empty>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/40 text-left text-[11px] uppercase tracking-widest text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Symbol</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Alert</th>
                  <th className="px-4 py-2 font-medium">Entry</th>
                  <th className="px-4 py-2 font-medium">TP / SL</th>
                  <th className="px-4 py-2 font-medium">Qty</th>
                  <th className="px-4 py-2 font-medium">Since</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {active.map((t) => (
                  <tr key={t.id} className="bg-card font-mono text-xs">
                    <td className="px-4 py-2 text-foreground">{t.symbol}</td>
                    <td className={`px-4 py-2 ${STATUS_STYLE[t.status] ?? ""}`}>
                      {t.status.replace("_", " ")}
                      {t.last_error ? (
                        <span className="block text-destructive">{t.last_error}</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2">{fmt(t.alert_price)}</td>
                    <td className="px-4 py-2">
                      {fmt(t.fill_price ?? t.entry_price)}
                      {t.fill_price ? <span className="text-primary"> ✓</span> : null}
                    </td>
                    <td className="px-4 py-2">
                      {fmt(t.target_price)} / {fmt(t.stop_price)}
                    </td>
                    <td className="px-4 py-2">{fmt(t.quantity, 4)}</td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {ts(t.filled_at ?? t.alerted_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <Section title="Closed & discarded">
          {history.length === 0 ? (
            <Empty>Nothing settled yet.</Empty>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/40 text-left text-[11px] uppercase tracking-widest text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Symbol</th>
                  <th className="px-4 py-2 font-medium">Outcome</th>
                  <th className="px-4 py-2 font-medium">Entry → Exit</th>
                  <th className="px-4 py-2 font-medium">Velocity</th>
                  <th className="px-4 py-2 font-medium text-right">PnL</th>
                  <th className="px-4 py-2 font-medium text-right">Closed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {history.map((t) => {
                  const pnl = Number(t.realized_pnl ?? 0);
                  return (
                    <tr key={t.id} className="bg-card font-mono text-xs">
                      <td className="px-4 py-2 text-foreground">{t.symbol}</td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {(t.close_reason ?? t.status).replace(/_/g, " ")}
                      </td>
                      <td className="px-4 py-2">
                        {t.fill_price ? `${fmt(t.fill_price)} → ${fmt(t.close_price)}` : "—"}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {t.velocity_pct === null
                          ? "—"
                          : `${Number(t.velocity_pct).toFixed(2)}%`}
                      </td>
                      <td
                        className={`px-4 py-2 text-right ${
                          t.realized_pnl === null
                            ? "text-muted-foreground"
                            : pnl >= 0
                              ? "text-primary"
                              : "text-destructive"
                        }`}
                      >
                        {t.realized_pnl === null ? "—" : `$${pnl.toFixed(2)}`}
                      </td>
                      <td className="px-4 py-2 text-right text-muted-foreground">
                        {ts(t.closed_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Section>

        <Section title="Execution log">
          {data.events.length === 0 ? (
            <Empty>No events logged yet.</Empty>
          ) : (
            <ul className="divide-y divide-border">
              {data.events.map((e) => (
                <li key={e.id} className="flex gap-4 bg-card px-4 py-2 font-mono text-xs">
                  <span className="w-24 shrink-0 text-muted-foreground">
                    {ts(e.created_at)}
                  </span>
                  <span className="w-24 shrink-0 text-foreground">{e.symbol}</span>
                  <span className="w-32 shrink-0 text-muted-foreground">
                    {e.event.replace(/_/g, " ")}
                  </span>
                  <span className="text-foreground">{e.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
        {title}
      </h2>
      <div className="mt-3 overflow-x-auto rounded-lg border border-border">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="bg-card px-4 py-6 text-sm text-muted-foreground">{children}</p>;
}
