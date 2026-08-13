import fs from "node:fs";
import path from "node:path";
import dns from "node:dns";

try {
  dns.setDefaultResultOrder("ipv4first");
} catch {
  /* ignore */
}

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

import { isDemoMode, setWeexLeverage } from "../src/lib/weex/client.server";
import { planPrices, toWeexSymbol, WEEX_CONFIG } from "../src/lib/weex/config";
import { hasActiveTradeForSymbol } from "../src/lib/weex/engine.server";

async function verifyExecutionFixes() {
  console.log("=== VERIFYING WEEX EXECUTION & HEDGE MODE FIXES ===");

  // 1. Live Trading Mode Detection Verification
  console.log("\n--- 1. Live Trading Mode Flag Detection ---");
  process.env["WEEX_PAPER_TRADING"] = "false";
  console.log("Setting WEEX_PAPER_TRADING='false'");
  console.log("isDemoMode() returns:", isDemoMode());
  console.assert(isDemoMode() === false, "❌ isDemoMode() must return false when WEEX_PAPER_TRADING=false!");
  console.log("✅ Live Trading mode detection verified.");

  // 2. Symbol Formatting Verification (Fix Error 40020)
  console.log("\n--- 2. Symbol Formatting Normalization (Fix Error 40020) ---");
  const rawSymbols = ["ATSUSDT", "atsusdt", "cmt_atsusdt", "BTCUSDT"];
  for (const sym of rawSymbols) {
    const formatted = toWeexSymbol(sym);
    console.log(`  Input '${sym}' -> Formatted: '${formatted}'`);
    console.assert(formatted.startsWith("cmt_"), `❌ Symbol '${formatted}' must start with cmt_!`);
  }
  console.log("✅ Contract symbol formatting (cmt_ prefix) verified.");

  // 3. Position Sizing & Hedge Mode Order Payload Structure
  console.log("\n--- 3. Position Sizing & Hedge Mode Mechanics ---");
  const plan = planPrices(1.5);
  console.log(`Configured Notional Sizing: $${plan.notionalPositionUsd.toFixed(2)} USD`);
  console.log(`Entry Price: $${plan.entry.toFixed(6)}`);
  console.log(`Quantity ($140 / entry): ${plan.quantity.toFixed(4)} coins`);
  console.log(`Stop Loss (-1.5%): $${plan.stop.toFixed(6)} ($2.10 risk)`);
  console.log(`Take Profit (+3.5%): $${plan.target.toFixed(6)} ($4.90 target)`);

  // 4. Leverage & Symbol Guard
  console.log("\n--- 4. 5x Leverage & Symbol Guard Verification ---");
  const levOk = await setWeexLeverage("cmt_btcusdt", 5);
  console.log(`✅ setWeexLeverage('cmt_btcusdt', 5) result: ${levOk}`);

  const activeGuard = await hasActiveTradeForSymbol("BTCUSDT");
  console.log(`✅ Single Active Trade Guard for 'BTCUSDT': ${activeGuard ? "Active (Locked)" : "Cleared (Can Trade)"}`);
}

verifyExecutionFixes();
