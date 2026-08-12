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

async function cancelV3Order() {
  console.log("🚨 CANCELING V3 ORDER 782115774734008512...");

  try {
    const res = await weexRequest("POST", "/capi/v3/order/cancel", {
      body: {
        symbol: "BTCUSDT",
        orderId: "782115774734008512",
      },
      signed: true,
    });
    console.log("✅ Cancelled V3 order:", res);
  } catch (err) {
    console.error("Cancel error:", (err as Error).message);
  }
}

cancelV3Order();
