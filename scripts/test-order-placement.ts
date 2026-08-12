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

import { placeLimitBuy, toContractPrice, toContractSize, getTicker } from "../src/lib/weex/client.server";

async function testOrder() {
  console.log("=== Testing Order Placement with Precision Formatting ===");

  const symbol = "cmt_crvusdt";
  const ticker = await getTicker(symbol);
  console.log(`${symbol} Ticker Price:`, ticker);

  if (!ticker) {
    console.error("Failed to fetch ticker");
    return;
  }

  const rawEntry = ticker * 0.95; // -5% below price
  const formattedPrice = await toContractPrice(symbol, rawEntry);
  const size = await toContractSize(symbol, 100 / rawEntry);

  console.log(`Raw Entry: ${rawEntry} -> Formatted Price (${symbol}): ${formattedPrice} | Size: ${size}`);

  try {
    const orderId = await placeLimitBuy(symbol, rawEntry, size, `test-${Date.now()}`);
    console.log(`🎉 SUCCESS! Order placed on WEEX Demo! Order ID: ${orderId}`);
  } catch (err) {
    console.error("❌ Order placement error:", err);
  }
}

testOrder();
