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

async function cancelV3Order2() {
  console.log("🚨 CANCELING ORDER 782115774734008512...");

  const methods = [
    { method: "DELETE", path: "/capi/v3/order", body: { symbol: "BTCUSDT", orderId: "782115774734008512" } },
    { method: "POST", path: "/capi/v2/order/cancel_order", body: { symbol: "cmt_btcusdt", orderId: "782115774734008512" } },
  ];

  for (const m of methods) {
    try {
      const res = await weexRequest(m.method as "POST" | "DELETE", m.path, {
        body: m.body,
        signed: true,
      });
      console.log(`✅ Cancelled via ${m.method} ${m.path}:`, res);
    } catch (err) {
      console.log(`❌ Failed ${m.method} ${m.path}:`, (err as Error).message);
    }
  }
}

cancelV3Order2();
