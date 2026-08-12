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

async function cancelSpecificOrders() {
  console.log("🚨 CANCELING SPECIFIC ORDER IDS...");

  const ordersToCancel = [
    { symbol: "cmt_crvusdt", order_id: "782111679566577856" },
    { symbol: "cmt_crvusdt", order_id: "782111583672205504" },
  ];

  for (const { symbol, order_id } of ordersToCancel) {
    try {
      const res = await weexRequest("POST", "/capi/v2/order/cancelOrder", {
        body: { symbol, order_id },
        signed: true,
      });
      console.log(`✅ CANCELED order ${order_id} for ${symbol}:`, res);
    } catch (err) {
      console.error(`Error canceling ${order_id}:`, (err as Error).message);
    }
  }

  // Also query unfilled orders endpoint
  try {
    const unfilled = await weexRequest("GET", "/capi/v2/order/unfilled", {
      query: { symbol: "cmt_crvusdt" },
      signed: true,
    });
    console.log("Unfilled orders (cmt_crvusdt):", unfilled);
  } catch (err) {
    console.error("Unfilled endpoint error:", (err as Error).message);
  }
}

cancelSpecificOrders();
