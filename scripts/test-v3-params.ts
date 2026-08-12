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

async function testV3Params() {
  console.log("=== Testing V3 BTCUSDTSim Order ===");

  const symbolList = ["BTCUSDT", "cmt_btcusdt", "BTCUSDT_SIM", "SBTCUSDT"];

  for (const sym of symbolList) {
    try {
      const res = await weexRequest("POST", "/capi/v3/sim/order", {
        body: {
          symbol: sym,
          side: "BUY",
          positionSide: "LONG",
          type: "LIMIT",
          quantity: "10",
          price: "60000",
          timeInForce: "GTC",
          newClientOrderId: `sim-${Date.now()}`,
        },
        signed: true,
      });
      console.log(`🎉 SUCCESS for '${sym}':`, res);
      return;
    } catch (err) {
      console.log(`❌ Failed for '${sym}':`, (err as Error).message);
    }
  }
}

testV3Params();
