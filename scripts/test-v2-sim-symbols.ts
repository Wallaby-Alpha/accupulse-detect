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

async function testSimSymbols() {
  console.log("=== TESTING V2 SIM SYMBOL VARIANTS ===");

  const symbolsToTest = [
    "cmt_btcsusdt",
    "cmt_simbtcusdt",
    "cmt_sbbtcusdt",
    "cmt_demobtcusdt",
    "btcsusdt",
  ];

  for (const sym of symbolsToTest) {
    try {
      console.log(`Testing symbol ${sym} on /capi/v2/order/placeOrder...`);
      const res = await weexRequest("POST", "/capi/v2/order/placeOrder", {
        body: {
          symbol: sym,
          client_oid: `test-${Date.now()}`,
          size: "1",
          type: "1",
          order_type: "0",
          match_price: "0",
          price: "50000",
          marginMode: 3,
        },
        signed: true,
      });
      console.log(`  ✅ ${sym} response:`, JSON.stringify(res, null, 2));
    } catch (err) {
      console.log(`  ❌ ${sym} error:`, (err as Error).message);
    }
  }
}

testSimSymbols();
