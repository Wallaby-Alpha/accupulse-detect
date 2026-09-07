import type { ScoreResult } from "./scoring";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/telegram";

function fmtPrice(value: number): string {
  if (value >= 1) return value.toFixed(4);
  if (value >= 0.01) return value.toFixed(5);
  return value.toPrecision(4);
}

export function formatAlert(r: ScoreResult): string {
  const price = r.currentPrice;
  const limitEntry = price * 0.997; // -0.3% limit entry
  const tp1 = limitEntry * 1.035;    // +3.5% TP1 (close 50% & move SL to BE)
  const tp2 = limitEntry * 1.060;    // +6.0% TP2 (close remaining 50%)
  const stop = limitEntry * 0.965;   // -3.5% Calibrated Hard Stop Loss

  return [
    "🚨 STAGE 1 ACCUMULATION SIGNAL (OPTIMIZED)",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    `Symbol: #${r.symbol}`,
    `Alert Price: $${fmtPrice(price)}`,
    `Score: ${r.finalScore.toFixed(2)} | Phase: ${r.stage}`,
    `Vol Ramp: ${(r.components?.volumeAcceleration ?? 1.0).toFixed(2)}x`,
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "",
    "🎯 CALIBRATED EXECUTION PLAN:",
    `• Entry: $${fmtPrice(limitEntry)} (-0.3% Limit)`,
    `• Stop Loss: $${fmtPrice(stop)} (-3.5% Hard Stop Loss)`,
    `• TP1: $${fmtPrice(tp1)} (+3.5% | Close 50% & Move SL to Breakeven)`,
    `• TP2: $${fmtPrice(tp2)} (+6.0% | Close Remaining 50%)`,
    `• Breakeven Trigger: Move SL to entry at +3.0% gain`,
    `• Stagnation Exit: Close if < +1.5% after 180 min (3h)`,
  ].join("\n");
}

export async function sendTelegramMessage(text: string): Promise<void> {
  if (!process.env["TELEGRAM_CHAT_ID"] || !process.env["TELEGRAM_BOT_TOKEN"]) {
    try {
      const fs = await import("node:fs");
      const path = await import("node:path");
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
    } catch {
      /* ignore */
    }
  }

  const botToken = process.env["TELEGRAM_BOT_TOKEN"] || process.env["TELEGRAM_API_KEY"];
  const chatId = process.env["TELEGRAM_CHAT_ID"];
  const lovableKey = process.env["LOVABLE_API_KEY"];

  if (!chatId) throw new Error("TELEGRAM_CHAT_ID is not configured");

  if (botToken) {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`Telegram API failed [${res.status}]: ${body}`);
      throw new Error(`Telegram API failed [${res.status}]: ${body}`);
    }
    const payload = (await res.json()) as { ok?: boolean; description?: string };
    if (payload.ok === false) {
      console.error("Telegram API error:", payload.description);
      throw new Error(`Telegram API error: ${payload.description}`);
    }
    return;
  }

  if (lovableKey) {
    const res = await fetch(`${GATEWAY_URL}/sendMessage`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": process.env["TELEGRAM_API_KEY"] ?? "",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`Telegram gateway failed [${res.status}]: ${body}`);
      throw new Error(`Telegram gateway failed [${res.status}]: ${body}`);
    }
    const payload = (await res.json()) as { ok?: boolean; description?: string };
    if (payload.ok === false) {
      console.error("Telegram API error:", payload.description);
      throw new Error(`Telegram API error: ${payload.description}`);
    }
    return;
  }

  throw new Error("Neither TELEGRAM_BOT_TOKEN nor LOVABLE_API_KEY is configured");
}
