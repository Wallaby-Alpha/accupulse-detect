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

async function testWebDemoEndpoints() {
  console.log("=== WEEX DEMO ACCOUNT & SYNC DISCOVERY ===");

  // 1. GET /capi/v2/order/current
  try {
    const res = await weexRequest("GET", "/capi/v2/order/current", {
      query: { symbol: "cmt_btcusdt" },
      signed: true,
    });
    console.log("1. GET /capi/v2/order/current:", JSON.stringify(res, null, 2));
  } catch (err) {
    console.log("1. GET /capi/v2/order/current error:", (err as Error).message);
  }

  // 2. GET /capi/v2/mix/order/current
  try {
    const res = await weexRequest("GET", "/capi/v2/mix/order/current", {
      query: { symbol: "cmt_btcusdt" },
      signed: true,
    });
    console.log("2. GET /capi/v2/mix/order/current:", JSON.stringify(res, null, 2));
  } catch (err) {
    console.log("2. GET /capi/v2/mix/order/current error:", (err as Error).message);
  }

  // 3. GET /capi/v2/mix/account/accounts
  try {
    const res = await weexRequest("GET", "/capi/v2/mix/account/accounts", {
      query: { productType: "umcbl" },
      signed: true,
    });
    console.log("3. GET /capi/v2/mix/account/accounts:", JSON.stringify(res, null, 2));
  } catch (err) {
    console.log("3. GET /capi/v2/mix/account/accounts error:", (err as Error).message);
  }

  // 4. GET /capi/v2/mix/account/account (symbol)
  try {
    const res = await weexRequest("GET", "/capi/v2/mix/account/account", {
      query: { symbol: "cmt_btcusdt", marginCoin: "USDT" },
      signed: true,
    });
    console.log("4. GET /capi/v2/mix/account/account:", JSON.stringify(res, null, 2));
  } catch (err) {
    console.log("4. GET /capi/v2/mix/account/account error:", (err as Error).message);
  }
}

testWebDemoEndpoints();
