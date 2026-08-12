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

async function testThorough() {
  console.log("=== Testing WEEX V3 Order Endpoints ===");

  const testCases = [
    { path: "/capi/v3/sim/order", body: { symbol: "BTCUSDT", side: "BUY", positionSide: "LONG", type: "LIMIT", quantity: "0.001", price: "50000", timeInForce: "GTC", newClientOrderId: `sim-${Date.now()}` } },
    { path: "/capi/v3/sim/order", body: { symbol: "cmt_btcusdt", side: "BUY", positionSide: "LONG", type: "LIMIT", quantity: "0.001", price: "50000", timeInForce: "GTC", newClientOrderId: `sim-${Date.now()}` } },
    { path: "/capi/v3/order", body: { symbol: "BTCUSDT", side: "BUY", positionSide: "LONG", type: "LIMIT", quantity: "0.001", price: "50000", timeInForce: "GTC", newClientOrderId: `sim-${Date.now()}` } },
    { path: "/capi/v3/order", body: { symbol: "cmt_btcusdt", side: "BUY", positionSide: "LONG", type: "LIMIT", quantity: "0.001", price: "50000", timeInForce: "GTC", newClientOrderId: `sim-${Date.now()}` } },
  ];

  for (const tc of testCases) {
    try {
      console.log(`\nURL: https://api-contract.weex.com${tc.path}`);
      console.log(`Body:`, JSON.stringify(tc.body));
      const res = await weexRequest("POST", tc.path, {
        body: tc.body,
        signed: true,
      });
      console.log(`🎉 SUCCESS:`, res);
    } catch (err) {
      console.log(`❌ Error:`, (err as Error).message);
    }
  }
}

testThorough();
