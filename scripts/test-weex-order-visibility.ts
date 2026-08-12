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

async function checkOrderVisibility() {
  console.log("=== WEEX ORDER VISIBILITY & ACCOUNT SYNC TEST ===");

  // 1. Query V2 open orders
  try {
    const v2Orders = await weexRequest("GET", "/capi/v2/order/currentOrders", {
      query: { symbol: "cmt_btcusdt" },
      signed: true,
    });
    console.log("V2 currentOrders (cmt_btcusdt):", JSON.stringify(v2Orders, null, 2));
  } catch (err) {
    console.log("V2 currentOrders error:", (err as Error).message);
  }

  // 2. Query V2 open plan orders
  try {
    const v2Plans = await weexRequest("GET", "/capi/v2/order/currentPlan", {
      query: { symbol: "cmt_btcusdt" },
      signed: true,
    });
    console.log("V2 currentPlan (cmt_btcusdt):", JSON.stringify(v2Plans, null, 2));
  } catch (err) {
    console.log("V2 currentPlan error:", (err as Error).message);
  }

  // 3. Query V3 sim pending orders
  try {
    const v3SimOrders = await weexRequest("GET", "/capi/v3/sim/order/pending", {
      query: { symbol: "BTCSUSDT" },
      signed: true,
    });
    console.log("V3 sim pending orders (BTCSUSDT):", JSON.stringify(v3SimOrders, null, 2));
  } catch (err) {
    console.log("V3 sim pending orders error:", (err as Error).message);
  }

  // 4. Query V3 live pending orders
  try {
    const v3Orders = await weexRequest("GET", "/capi/v3/order/pending", {
      query: { symbol: "BTCUSDT" },
      signed: true,
    });
    console.log("V3 pending orders (BTCUSDT):", JSON.stringify(v3Orders, null, 2));
  } catch (err) {
    console.log("V3 pending orders error:", (err as Error).message);
  }
}

checkOrderVisibility();
