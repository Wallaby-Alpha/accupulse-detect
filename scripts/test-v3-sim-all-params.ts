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

async function testV3SimOrderParams() {
  console.log("=== Testing /capi/v3/sim/order parameter formats ===");

  const symbolsToTest = [
    "BTCUSDT",
    "cmt_btcusdt",
    "btcusdt",
    "S_BTCUSDT",
    "SBTCUSDT",
    "BTCUSDT_SIM",
  ];

  for (const sym of symbolsToTest) {
    console.log(`\nTesting symbol: '${sym}'...`);

    const payloadVariants = [
      {
        symbol: sym,
        side: "BUY",
        positionSide: "LONG",
        type: "LIMIT",
        quantity: "0.001",
        price: "50000",
        timeInForce: "GTC",
        newClientOrderId: `sim-${Date.now()}`,
      },
      {
        symbol: sym,
        side: "BUY",
        positionSide: "BOTH",
        type: "LIMIT",
        quantity: "0.001",
        price: "50000",
        timeInForce: "GTC",
        newClientOrderId: `sim-${Date.now()}`,
      },
      {
        symbol: sym,
        side: "BUY",
        type: "LIMIT",
        quantity: "0.001",
        price: "50000",
        newClientOrderId: `sim-${Date.now()}`,
      },
    ];

    for (const body of payloadVariants) {
      try {
        console.log(`Sending POST https://api-contract.weex.com/capi/v3/sim/order with symbol=${body.symbol}...`);
        const res = await weexRequest("POST", "/capi/v3/sim/order", {
          body,
          signed: true,
        });
        console.log(`🎉 SUCCESS! Result for ${body.symbol}:`, JSON.stringify(res, null, 2));
        return;
      } catch (err) {
        console.log(`❌ Error for ${body.symbol}:`, (err as Error).message);
      }
    }
  }
}

testV3SimOrderParams();
