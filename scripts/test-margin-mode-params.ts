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

async function testMarginModes() {
  console.log("=== Testing numeric integer marginMode values ===");
  const symbol = "cmt_crvusdt";
  const size = "30";
  const price = "0.2500";

  for (let m = 0; m <= 5; m++) {
    try {
      const res = await weexRequest("POST", "/capi/v2/order/placeOrder", {
        body: {
          symbol,
          client_oid: `test-${Date.now()}`,
          size,
          type: "1", // open long
          order_type: "0",
          match_price: "0",
          price,
          marginMode: m,
        },
      });
      console.log(`🎉 SUCCESS with marginMode: ${m}:`, res);
      return;
    } catch (err) {
      console.log(`❌ Failed with marginMode: ${m}:`, (err as Error).message);
    }
  }
}

testMarginModes();
