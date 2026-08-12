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

import { weexRequest } from "../src/lib/weex/client.server";

async function testV2Placement() {
  console.log("=== TESTING V2 ORDER PLACEMENT & WEEX ACCOUNT SYNC ===");

  // Test 1: Place V2 order with sim parameter / header
  try {
    const res = await weexRequest("POST", "/capi/v2/order/placeOrder", {
      body: {
        symbol: "cmt_btcusdt",
        client_oid: `test-v2-sim-${Date.now()}`,
        size: "1",
        type: "1", // open long
        order_type: "0",
        match_price: "0",
        price: "50000",
        marginMode: 3,
        is_demo: "1",
        simulated: "1",
      },
      headers: {
        "papertrading": "1",
        "X-SIMULATED-TRADING": "1",
      },
      signed: true,
    });
    console.log("1. V2 placeOrder response:", JSON.stringify(res, null, 2));
  } catch (err) {
    console.log("1. V2 placeOrder error:", (err as Error).message);
  }

  // Test 2: Immediately query V2 current orders
  try {
    const res = await weexRequest("GET", "/capi/v2/order/current", {
      query: { symbol: "cmt_btcusdt" },
      signed: true,
    });
    console.log("2. GET /capi/v2/order/current response:", JSON.stringify(res, null, 2));
  } catch (err) {
    console.log("2. GET /capi/v2/order/current error:", (err as Error).message);
  }
}

testV2Placement();
