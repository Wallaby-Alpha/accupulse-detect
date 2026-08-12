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

async function cancelSimOrder2() {
  console.log("🚨 CANCELING SIM ORDER 782115810788245696...");

  const endpoints = [
    { method: "POST", path: "/capi/v2/order/cancel_order", body: { symbol: "cmt_btcsusdt", orderId: "782115810788245696" } },
    { method: "POST", path: "/capi/v2/order/cancel_order", body: { symbol: "cmt_btcusdt", orderId: "782115810788245696" } },
  ];

  for (const ep of endpoints) {
    try {
      const res = await weexRequest("POST", ep.path, {
        body: ep.body,
        signed: true,
      });
      console.log(`✅ Cancelled via ${ep.path} with ${ep.body.symbol}:`, res);
    } catch (err) {
      console.log(`❌ Error ${ep.path} with ${ep.body.symbol}:`, (err as Error).message);
    }
  }
}

cancelSimOrder2();
