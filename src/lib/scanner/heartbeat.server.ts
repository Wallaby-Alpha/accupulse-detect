/**
 * Telegram Heartbeat Alert Scheduler.
 * Dispatches a system heartbeat to Telegram immediately on startup and every 5 minutes thereafter.
 */
import { sendTelegramMessage } from "./telegram";

let heartbeatStarted = false;

export function formatHeartbeatMessage(): string {
  const now = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";
  return [
    "💓 ACCUPULSE SYSTEM HEARTBEAT",
    "━━━━━━━━━━━━━━━━━━━━━━━━━",
    "Status: 🟢 ONLINE & ACTIVE",
    "WEEX Engine: DEMO TRADING ACTIVE",
    "Heartbeat Interval: Every 5 minutes",
    `Timestamp: ${now}`,
    "━━━━━━━━━━━━━━━━━━━━━━━━━",
    "Scanner & WEEX execution desk active.",
  ].join("\n");
}

export async function sendHeartbeat(): Promise<void> {
  try {
    const text = formatHeartbeatMessage();
    await sendTelegramMessage(text);
    console.log("💓 [Telegram Heartbeat] Sent heartbeat alert successfully.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("💓 [Telegram Heartbeat] Failed to send heartbeat alert:", message);
  }
}

export function initTelegramHeartbeatScheduler(): void {
  if (heartbeatStarted) return;
  heartbeatStarted = true;

  console.log("💓 [Telegram Heartbeat] Initializing 5-minute Telegram heartbeat scheduler.");

  // Send a heartbeat alert immediately on server startup
  sendHeartbeat().catch((err) =>
    console.error("💓 [Telegram Heartbeat] Startup send error:", err),
  );

  // Send heartbeat every 5 minutes (300,000 ms)
  setInterval(() => {
    sendHeartbeat().catch((err) =>
      console.error("💓 [Telegram Heartbeat] Interval send error:", err),
    );
  }, 5 * 60_000);
}
