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

async function compareOrderEndpoints() {
  console.log("=== WEEX ORDER ENDPOINT COMPARISON TEST ===");

  // 1. Query current orders via POST /capi/v2/order/current
  try {
    const v2Current = await weexRequest("POST", "/capi/v2/order/current", {
      body: { symbol: "cmt_btcusdt" },
      signed: true,
    });
    console.log("POST /capi/v2/order/current (cmt_btcusdt):", JSON.stringify(v2Current, null, 2));
  } catch (err) {
    console.log("POST /capi/v2/order/current error:", (err as Error).message);
  }

  // 2. Query V2 current orders without symbol
  try {
    const v2CurrentAll = await weexRequest("POST", "/capi/v2/order/current", {
      body: {},
      signed: true,
    });
    console.log("POST /capi/v2/order/current (all):", JSON.stringify(v2CurrentAll, null, 2));
  } catch (err) {
    console.log("POST /capi/v2/order/current (all) error:", (err as Error).message);
  }

  // 3. Query V3 sim order detail for our recent BTC order 782116078410006720
  try {
    const simDetail = await weexRequest("GET", "/capi/v3/sim/order/detail", {
      query: { symbol: "BTCSUSDT", orderId: "782116078410006720" },
      signed: true,
    });
    console.log("GET /capi/v3/sim/order/detail (782116078410006720):", JSON.stringify(simDetail, null, 2));
  } catch (err) {
    console.log("GET /capi/v3/sim/order/detail error:", (err as Error).message);
  }
}

compareOrderEndpoints();
