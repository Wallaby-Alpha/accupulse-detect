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

import { placeLimitBuy } from "../src/lib/weex/client.server";

async function placeDemoBtcOrder() {
  console.log("=== Placing WEEX Paper Trading BTC Limit Buy @ $50,000 ===");

  const symbol = "BTCUSDT";
  const entryPrice = 50000;
  const coinQuantity = 0.001; // $50 order

  try {
    const orderId = await placeLimitBuy(symbol, entryPrice, coinQuantity, `btc-demo-${Date.now()}`);
    console.log(`\n🎉 SUCCESS! Paper Trading Limit Buy Order Placed on WEEX Paper Trading!`);
    console.log(`   - Order ID: ${orderId}`);
  } catch (err) {
    console.error("❌ Order placement failed:", (err as Error).message);
  }
}

placeDemoBtcOrder();
