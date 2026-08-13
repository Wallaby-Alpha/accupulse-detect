import type { ScoreResult } from "./scoring";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/telegram";

function fmtPrice(value: number): string {
  if (value >= 1) return value.toFixed(4);
  if (value >= 0.01) return value.toFixed(5);
  return value.toPrecision(4);
}

export function formatAlert(r: ScoreResult): string {
  const price = r.currentPrice;
  const limitEntry = price * 0.975;
  const target = limitEntry * 1.035;
  const stop = limitEntry * 0.985;

  return [
    "🎯 STAGE 1 ACCUMULATION SIGNAL",
    "━━━━━━━━━━━━━━━━━━━━━━━━━",
    `Symbol: #${r.symbol}`,
    `Alert Price: $${fmtPrice(price)}`,
    `Score: ${r.finalScore.toFixed(2)} (Stage 1)`,
    "━━━━━━━━━━━━━━━━━━━━━━━━━",
    "",
    "⚡ MECHANICAL EXECUTION PLAN:",
    "├─ Entry Strategy: Wait 5m for candle close. Skip if 5m drop <= -1.5%",
    `├─ Limit Buy Entry: $${fmtPrice(limitEntry)} (-2.5% below Alert Price)`,
    `├─ Take Profit: $${fmtPrice(target)} (+3.5% above fill / +1.0% from Alert)`,
    `├─ Stop Loss: $${fmtPrice(stop)} (-1.5% below fill / -4.0% from Alert)`,
    "├─ Time Exit: Market Close position at t = 60m post-entry",
    "└─ Order Expiration: Cancel limit buy if unfilled after 2 hours",
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
