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

import { weexRequest, toContractPrice, toContractSize, getTicker } from "../src/lib/weex/client.server";

async function testSimOrder() {
  console.log("=== Testing WEEX V3 Simulated Order Placement ===");

  const symbol = "cmt_crvusdt";
  const ticker = await getTicker(symbol);
  if (!ticker) {
    console.error("No ticker");
    return;
  }

  const rawPrice = ticker * 0.95;
  const price = await toContractPrice(symbol, rawPrice);
  const size = await toContractSize(symbol, 100 / rawPrice);

  console.log(`Testing /capi/v3/sim/order with Symbol: ${symbol}, Price: ${price}, Size: ${size}`);

  const symbolVariants = ["cmt_crvusdt", "CRVUSDT", "cmt_crvusdt".toUpperCase()];

  try {
    const res = await weexRequest("POST", "/capi/v3/sim/order", {
      body: {
        symbol: "CRVUSDT",
        side: "BUY",
        positionSide: "LONG",
        type: "LIMIT",
        quantity: String(size),
        price: String(price),
        timeInForce: "GTC",
        newClientOrderId: `sim-${Date.now()}`,
      },
      signed: true,
    });
    console.log(`🎉 SUCCESS with V3 Sim Order:`, res);
  } catch (err) {
    console.log(`❌ Failed with V3 Sim Order:`, (err as Error).message);
  }
}

testSimOrder();
