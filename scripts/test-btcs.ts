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

async function testBtcs() {
  console.log("=== Testing BTCSUSDT on /capi/v3/sim/order ===");

  const payload = {
    symbol: "BTCSUSDT",
    side: "BUY",
    positionSide: "LONG",
    type: "LIMIT",
    quantity: "0.001",
    price: "50000",
    timeInForce: "GTC",
    newClientOrderId: `sim-${Date.now()}`,
  };

  try {
    console.log("URL: https://api-contract.weex.com/capi/v3/sim/order");
    console.log("Body:", JSON.stringify(payload));
    const res = await weexRequest("POST", "/capi/v3/sim/order", {
      body: payload,
      signed: true,
    });
    console.log("🎉 SUCCESS on /capi/v3/sim/order:", res);
  } catch (err) {
    console.error("❌ Error on /capi/v3/sim/order:", (err as Error).message);
  }
}

testBtcs();
