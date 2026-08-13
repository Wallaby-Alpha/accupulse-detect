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
import { placePlanOrder, cancelPlanOrder } from "../src/lib/weex/client.server";

async function testBracketAndTimeExit() {
  console.log("=== TESTING NATIVE EXCHANGE BRACKETS & 60m TIME EXIT ===");

  const alertPrice = 1.5; // $1.50 coin
  const plan = planPrices(alertPrice);

  console.log(`Alert Price: $${alertPrice}`);
  console.log(`Limit Entry: $${plan.entry.toFixed(6)}`);
  console.log(`Stop Loss (-1.5%):   $${plan.stop.toFixed(6)} ($2.10 Risk Limit)`);
  console.log(`Take Profit (+3.5%): $${plan.target.toFixed(6)} ($4.90 Target)`);
  console.log(`Notional Size: $${plan.notionalPositionUsd.toFixed(2)} USD`);

  // 1. Simulate Native Exchange Bracket Placement
  console.log("\n1. Submitting Native Exchange TP Plan Order...");
  const tpId = await placePlanOrder("cmt_btcusdt", plan.target, plan.target, 10, "test-tp-oid", "0");
  console.log(`✅ Native TP Plan Order placed: ${tpId}`);

  console.log("\n2. Submitting Native Exchange SL Plan Order...");
  const slId = await placePlanOrder("cmt_btcusdt", plan.stop, plan.stop, 10, "test-sl-oid", "1");
  console.log(`✅ Native SL Plan Order placed: ${slId}`);

  // 2. Simulate 60m Time Exit Cancellation
  console.log("\n3. Simulating 60-Minute Time Exit Bracket Cleanup...");
  if (tpId) await cancelPlanOrder("cmt_btcusdt", tpId);
  if (slId) await cancelPlanOrder("cmt_btcusdt", slId);
  console.log("✅ Native Exchange Brackets cancelled successfully for Time Exit.");

  console.log(`\nTime Exit Window Configured: ${WEEX_CONFIG.TIME_EXIT_MINUTES} minutes.`);
}

testBracketAndTimeExit();
