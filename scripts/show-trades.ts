import fs from "node:fs";
import path from "node:path";

const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*"?([^"#\r\n]+)"?/);
    if (match && match[1] && match[2]) {
      process.env[match[1]] = match[2].trim();
    }
  }
}

import { readLocalTrades } from "../src/lib/weex/local-store.server";

async function main() {
  const trades = readLocalTrades();

  const totalTrades = trades.length;
  const closed = trades.filter((t) => ["closed", "take_profit", "stop_loss", "time_exit"].includes(t.status));
  const wins = trades.filter((t) => (t.realized_pnl_pct ?? 0) > 0 || t.close_reason === "take_profit" || t.status === "take_profit");
  const losses = trades.filter((t) => (t.realized_pnl_pct ?? 0) < 0 || t.close_reason === "stop_loss" || t.status === "stop_loss");
  const openPositions = trades.filter((t) => t.status === "filled");
  const openOrders = trades.filter((t) => t.status === "order_open" || t.status === "pending_velocity");

  const winRate = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;
  const totalPnl = trades.reduce((acc, t) => acc + (t.realized_pnl_pct ?? 0), 0);

  console.log("\n=========================================================================");
  console.log("             ACCUPULSE WEEX PAPER TRADING PERFORMANCE LOGS              ");
  console.log("=========================================================================\n");

  console.log(`📈 PERFORMANCE SUMMARY:`);
  console.log(`   - Total Signals Received : ${totalTrades}`);
  console.log(`   - Win Rate               : ${winRate.toFixed(1)}%`);
  console.log(`   - Realized Net PnL       : ${totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)}%`);
  console.log(`   - Closed Trades (Wins)   : ${wins.length}`);
  console.log(`   - Closed Trades (Losses) : ${losses.length}`);
  console.log(`   - Active Positions       : ${openPositions.length}`);
  console.log(`   - Pending / Open Orders  : ${openOrders.length}\n`);

  console.log("-------------------------------------------------------------------------");
  console.log("RECENT TRADES LIST:");
  console.log("-------------------------------------------------------------------------");

  if (trades.length === 0) {
    console.log("  (No trades recorded yet)");
  } else {
    for (const t of trades.slice(0, 15)) {
      const pnlStr = t.realized_pnl_pct !== null && t.realized_pnl_pct !== undefined
        ? `${t.realized_pnl_pct >= 0 ? "+" : ""}${t.realized_pnl_pct.toFixed(2)}%`
        : "—";
      const timeStr = t.alerted_at ? new Date(t.alerted_at).toISOString().slice(5, 16).replace("T", " ") : "—";
      console.log(
        `• [${t.symbol.padEnd(12)}] Status: ${t.status.padEnd(16)} | Entry: ${String(t.entry_price ?? "—").padEnd(8)} | PnL: ${pnlStr.padEnd(8)} | ${timeStr}`
      );
    }
  }
  console.log("\n=========================================================================\n");
}

main();
