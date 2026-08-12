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

async function diagnoseAccount() {
  console.log("=========================================================");
  console.log("   WEEX API ACCOUNT & DEMO ENDPOINT DIAGNOSTIC SCAN      ");
  console.log("=========================================================\n");

  const queryEndpoints = [
    { name: "V3 Sim Pending Orders (BTCSUSDT)", method: "GET", path: "/capi/v3/sim/order/pending", query: { symbol: "BTCSUSDT" } },
    { name: "V3 Pending Orders (BTCUSDT)", method: "GET", path: "/capi/v3/order/pending", query: { symbol: "BTCUSDT" } },
    { name: "V3 Sim User Account", method: "GET", path: "/capi/v3/sim/account/info" },
    { name: "V3 User Account", method: "GET", path: "/capi/v3/account/info" },
    { name: "V2 Account Settings", method: "GET", path: "/capi/v2/account/settings" },
    { name: "V2 Account Info (cmt_btcusdt)", method: "GET", path: "/capi/v2/account/account", query: { symbol: "cmt_btcusdt" } },
  ];

  for (const ep of queryEndpoints) {
    try {
      console.log(`Checking ${ep.name} (${ep.method} ${ep.path})...`);
      const res = await weexRequest(ep.method as "GET" | "POST", ep.path, {
        query: ep.query,
        signed: true,
      });
      console.log(`  ✅ Response:`, JSON.stringify(res, null, 2));
    } catch (err) {
      console.log(`  ❌ Error:`, (err as Error).message);
    }
    console.log("---------------------------------------------------------");
  }
}

diagnoseAccount();
