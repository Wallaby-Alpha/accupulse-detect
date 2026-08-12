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

import { cancelOrder, weexRequest } from "../src/lib/weex/client.server";

async function cancelOrders() {
  console.log("🚨 CANCELING ORDERS WITH cancel_order...");

  const testOrders = [
    { symbol: "cmt_crvusdt", id: "782111679566577856" },
    { symbol: "cmt_crvusdt", id: "782111583672205504" },
  ];

  for (const o of testOrders) {
    try {
      const ok = await cancelOrder(o.symbol, o.id);
      console.log(`Cancelled ${o.id} for ${o.symbol}: ${ok}`);
    } catch (err) {
      console.error(`Cancel error for ${o.id}:`, err);
    }
  }
}

cancelOrders();
