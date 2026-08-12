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

import { registerSignal, runTradeEngine } from "../src/lib/weex/engine.server";
import { supabaseAdmin } from "../src/integrations/supabase/client.server";

async function main() {
  console.log("=== Testing Signal Registration & Availability Gate for Target Tokens ===");

  const alerts = [
    { symbol: "ASSETUSDT", price: 0.123 },
    { symbol: "GIGGLEUSDT", price: 0.045 },
    { symbol: "CAPUSDT", price: 0.89 },
    { symbol: "CRVUSDT", price: 0.35 },
  ];

  for (const a of alerts) {
    console.log(`\nRegistering signal for ${a.symbol} @ $${a.price}...`);
    await registerSignal(a.symbol, a.price);
  }

  console.log("\n=== Checking weex_trades in Supabase after registration ===");
  const { data: trades } = await supabaseAdmin
    .from("weex_trades")
    .select("*")
    .order("alerted_at", { ascending: false })
    .limit(10);
  console.log(`Current active trades in weex_trades (${trades?.length}):`, trades);

  console.log("\n=== Checking trade_events in Supabase ===");
  const { data: events } = await supabaseAdmin
    .from("trade_events")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(10);
  console.log(`Latest trade events (${events?.length}):`, events);
}

main();
