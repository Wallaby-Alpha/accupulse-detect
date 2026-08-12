import fs from "node:fs";
import path from "node:path";
import dns from "node:dns";

try {
  dns.setDefaultResultOrder("ipv4first");
} catch {
  /* ignore */
}

// Load .env variables synchronously before importing server modules
const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*"?([^"#\r\n]+)"?/);
    if (match && match[1] && match[2]) {
      if (!process.env[match[1]]) {
        process.env[match[1]] = match[2].trim();
      }
    }
  }
}

import { runScan } from "../src/routes/api/public/hooks/scan";
import { sendHeartbeat } from "../src/lib/scanner/heartbeat.server";
import { runTradeEngine } from "../src/lib/weex/engine.server";

console.log("🚀 [AccuPulse Daemon] Starting local background runner...");

// 1. Send initial heartbeat immediately on daemon start
sendHeartbeat().catch((err) =>
  console.error("❌ [Daemon] Initial heartbeat failed:", err),
);

// 2. Schedule Telegram Heartbeat every 5 minutes (300,000 ms)
const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;
setInterval(() => {
  console.log(`⏰ [Daemon] Triggering 5m Telegram heartbeat at ${new Date().toISOString()}`);
  sendHeartbeat().catch((err) =>
    console.error("❌ [Daemon] Scheduled heartbeat failed:", err),
  );
}, HEARTBEAT_INTERVAL_MS);

// 3. Schedule Market Scanner every 3 minutes (180,000 ms)
const SCANNER_INTERVAL_MS = 3 * 60 * 1000;
setInterval(async () => {
  try {
    console.log(`🔍 [Daemon] Running market scanner at ${new Date().toISOString()}...`);
    const summary = await runScan();
    console.log(
      `🔍 [Daemon] Scan completed: ${summary.scanned} scanned, ${summary.passedGates} passed, ${summary.alertsSent} alerts sent (${summary.durationMs}ms)`,
    );
  } catch (err) {
    console.error("❌ [Daemon] Market scanner error:", err);
  }
}, SCANNER_INTERVAL_MS);

// 4. Schedule WEEX Trade Engine Tick every 1 minute (60,000 ms)
const TRADE_TICK_INTERVAL_MS = 60 * 1000;
setInterval(async () => {
  try {
    const res = await runTradeEngine();
    if (res.processed > 0 || res.errors > 0) {
      console.log(
        `⚡ [Daemon] Trade tick executed. Processed: ${res.processed}, Errors: ${res.errors}`,
      );
    }
  } catch (err) {
    console.error("❌ [Daemon] Trade tick error:", err);
  }
}, TRADE_TICK_INTERVAL_MS);

console.log(
  "✅ [AccuPulse Daemon] Running persistently. Heartbeat: 5m | Scanner: 3m | Trade Tick: 1m",
);
