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

async function cancelAll() {
  console.log("🚨 EMERGENCY ORDER CANCELLATION RUNNING...");

  const symbols = ["cmt_crvusdt", "cmt_inxusdt", "cmt_btcusdt", "cmt_ethusdt", "cmt_capusdt", "cmt_giggleusdt"];

  for (const symbol of symbols) {
    try {
      const openOrders = await weexRequest<{ order_id?: string; orderId?: string }[]>(
        "GET",
        "/capi/v2/order/currentOrders",
        { query: { symbol }, signed: true }
      );

      console.log(`Open orders for ${symbol}:`, openOrders);

      if (Array.isArray(openOrders)) {
        for (const order of openOrders) {
          const oid = order.order_id ?? order.orderId;
          if (oid) {
            console.log(`Cancelling order ${oid} for ${symbol}...`);
            await weexRequest("POST", "/capi/v2/order/cancelOrder", {
              body: { symbol, order_id: oid },
              signed: true,
            });
            console.log(`✅ Order ${oid} CANCELLED!`);
          }
        }
      }
    } catch (err) {
      console.error(`Error checking/cancelling ${symbol}:`, err);
    }
  }
}

cancelAll();
