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

import { getWeexSupportedSymbols, normalizeSymbol } from "../src/lib/weex/symbols.server";
import { supabaseAdmin } from "../src/integrations/supabase/client.server";

async function main() {
  console.log("=== Checking WEEX Futures Contract Availability & Database History ===");

  const targetSymbols = ["GIGGLEUSDT", "CAPUSDT", "ASSETUSDT", "CRVUSDT"];
  const supported = await getWeexSupportedSymbols();
  console.log(`WEEX Contract Universe Total: ${supported.size} symbols.`);

  for (const sym of targetSymbols) {
    const norm = normalizeSymbol(sym);
    const isSupported = supported.has(norm);
    console.log(`Symbol: '${sym}' (Normalized: '${norm}') -> Listed on WEEX Futures: ${isSupported}`);
  }

  console.log("\n=== Querying Supabase weex_trades Table ===");
  const { data: trades, error: tradesErr } = await supabaseAdmin
    .from("weex_trades")
    .select("*")
    .order("alerted_at", { ascending: false })
    .limit(20);

  if (tradesErr) console.error("Error fetching weex_trades:", tradesErr);
  else console.log(`weex_trades records (${trades?.length}):`, trades);

  console.log("\n=== Querying Supabase alert_history Table ===");
  const { data: history, error: historyErr } = await supabaseAdmin
    .from("alert_history")
    .select("*")
    .order("alerted_at", { ascending: false })
    .limit(20);

  if (historyErr) console.error("Error fetching alert_history:", historyErr);
  else console.log(`alert_history records (${history?.length}):`, history);

  console.log("\n=== Querying Supabase trade_events Table ===");
  const { data: events, error: eventsErr } = await supabaseAdmin
    .from("trade_events")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(30);

  if (eventsErr) console.error("Error fetching trade_events:", eventsErr);
  else console.log(`trade_events records (${events?.length}):`, events);
}

main();
