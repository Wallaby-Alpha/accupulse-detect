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

async function checkAccount() {
  console.log("=== Checking WEEX Account Details & Margin Mode ===");

  try {
    const accountInfo = await weexRequest("GET", "/capi/v2/account/account", {
      query: { symbol: "cmt_crvusdt" },
      signed: true,
    });
    console.log("Account Info:", JSON.stringify(accountInfo, null, 2));
  } catch (err) {
    console.error("Account info error:", err);
  }

  try {
    const settings = await weexRequest("GET", "/capi/v2/account/settings", {
      signed: true,
    });
    console.log("Account Settings:", JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error("Account settings error:", err);
  }
}

checkAccount();
