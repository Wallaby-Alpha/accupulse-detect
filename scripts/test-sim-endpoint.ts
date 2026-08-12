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

async function testSimulatedEndpoints() {
  console.log("=== Testing WEEX V3 Simulated Endpoints ===");

  const simEndpoints = [
    { method: "POST", path: "/capi/v3/sim/order" },
    { method: "GET", path: "/capi/v3/sim/order/pending" },
    { method: "GET", path: "/capi/v3/sim/account" },
    { method: "GET", path: "/capi/v2/mix/account/account" },
  ];

  for (const ep of simEndpoints) {
    try {
      const res = await weexRequest(ep.method as "GET" | "POST", ep.path, {
        signed: true,
        query: ep.method === "GET" ? { symbol: "cmt_crvusdt" } : undefined,
        body: ep.method === "POST" ? {
          symbol: "cmt_crvusdt",
          client_oid: `sim-${Date.now()}`,
          size: "30",
          type: "1",
          order_type: "0",
          match_price: "0",
          price: "0.2500",
          marginMode: 3,
        } : undefined,
      });
      console.log(`🎉 Endpoint ${ep.path} SUCCESS:`, res);
    } catch (err) {
      console.log(`❌ Endpoint ${ep.path} FAILED:`, (err as Error).message);
    }
  }
}

testSimulatedEndpoints();
