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

import { runScan } from "../src/routes/api/public/hooks/scan";

async function testScan() {
  console.log("=== Testing Scanner Run ===");
  try {
    const res = await runScan();
    console.log("🎉 Scan completed successfully:", JSON.stringify({
      scanned: res.scanned,
      passedGates: res.passedGates,
      alertsSent: res.alertsSent,
      durationMs: res.durationMs,
    }, null, 2));
  } catch (err) {
    console.error("❌ Scan failed:", err);
  }
}

testScan();
