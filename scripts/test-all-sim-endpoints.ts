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

async function discoverSimEndpoints() {
  console.log("=== Discovering WEEX Sim Endpoints ===");

  const paths = [
    "/capi/v3/sim/account",
    "/capi/v3/sim/position",
    "/capi/v3/sim/symbols",
    "/capi/v3/sim/contract",
    "/capi/v3/sim/order/openOrders",
    "/capi/v3/sim/trade/account",
    "/capi/v3/market/time",
  ];

  for (const p of paths) {
    try {
      const res = await weexRequest("GET", p, { signed: p.includes("account") || p.includes("position") || p.includes("Orders") });
      console.log(`🎉 GET ${p} SUCCESS:`, res);
    } catch (err) {
      console.log(`❌ GET ${p} FAILED:`, (err as Error).message);
    }
  }
}

discoverSimEndpoints();
