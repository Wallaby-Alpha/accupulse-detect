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

async function cancelSimOrder() {
  console.log("🚨 CANCELING SIM ORDER 782115810788245696...");

  try {
    const res = await weexRequest("DELETE", "/capi/v3/sim/order", {
      body: {
        symbol: "BTCSUSDT",
        orderId: "782115810788245696",
      },
      signed: true,
    });
    console.log("✅ Cancelled Sim order:", res);
  } catch (err) {
    console.error("Cancel error:", (err as Error).message);
  }
}

cancelSimOrder();
