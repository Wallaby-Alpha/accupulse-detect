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

import { planPrices, WEEX_CONFIG } from "../src/lib/weex/config";
import { setWeexLeverage } from "../src/lib/weex/client.server";
import { hasActiveTradeForSymbol } from "../src/lib/weex/engine.server";

async function testRiskEnhancements() {
  console.log("=== TESTING WEEX RISK MANAGEMENT ENHANCEMENTS ===");

  // 1. Verify Fixed $140.00 Notional Position Sizing
  console.log("\n--- 1. Fixed $140.00 Notional Position Sizing Verification ---");
  console.log(`Configured NOTIONAL_POSITION_USD: $${WEEX_CONFIG.NOTIONAL_POSITION_USD}`);

  const testPrices = [60000, 1.5, 0.05, 100];
  for (const price of testPrices) {
    const plan = planPrices(price);
    const notionalValue = plan.quantity * plan.entry;
    const stopLossDollarRisk = Math.abs(plan.entry - plan.stop) * plan.quantity;
    const takeProfitDollarGain = Math.abs(plan.target - plan.entry) * plan.quantity;

    console.log(`\nAlert Price: $${price}`);
    console.log(`  Entry Price (-2.5%): $${plan.entry.toFixed(6)}`);
    console.log(`  Stop Loss (-1.5%):   $${plan.stop.toFixed(6)}`);
    console.log(`  Take Profit (+3.5%): $${plan.target.toFixed(6)}`);
    console.log(`  Contract Quantity:   ${plan.quantity.toFixed(4)} coins`);
    console.log(`  Notional Value:      $${notionalValue.toFixed(2)} USD (Target: $140.00)`);
    console.log(`  Max Loss @ Stop Loss: $${stopLossDollarRisk.toFixed(2)} USD (Target: $2.10)`);
    console.log(`  Target Gain @ TP:    $${takeProfitDollarGain.toFixed(2)} USD (Target: $4.90)`);
  }

  // 2. Verify Dynamic 5x Isolated Leverage Enforcement
  console.log("\n--- 2. Dynamic 5x Isolated Leverage Enforcement ---");
  const levRes = await setWeexLeverage("BTCUSDT", 5);
  console.log(`✅ setWeexLeverage('BTCUSDT', 5) result: ${levRes}`);

  // 3. Verify Single Active Trade Per Symbol Guard
  console.log("\n--- 3. Single Active Trade Per Symbol Guard ---");
  const isBtcActive = await hasActiveTradeForSymbol("BTCUSDT");
  console.log(`Active trade check for 'BTCUSDT': ${isBtcActive ? "ACTIVE (Will skip)" : "CLEARED (Can trade)"}`);
}

testRiskEnhancements();
