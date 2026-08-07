import type { ScoreResult } from "./scoring";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/telegram";

function fmtPrice(value: number): string {
  if (value >= 1) return value.toFixed(4);
  if (value >= 0.01) return value.toFixed(5);
  return value.toPrecision(4);
}

const tick = (v: number) => (v >= 0.6 ? "✓" : v >= 0.4 ? "~" : "×");

export function formatAlert(r: ScoreResult): string {
  const price = r.currentPrice;
  const limitEntry = price * 0.985;
  const target = limitEntry * 1.03;
  const stop = limitEntry * 0.975;


  const boostLines: string[] = [];
  if (r.boosts.supportBounce > 0)
    boostLines.push(`├─ Support Bounce: +${r.boosts.supportBounce.toFixed(2)} Confirmed`);
  if (r.boosts.volumeRamp > 0)
    boostLines.push(`├─ Volume Ramp Slope: +${r.boosts.volumeRamp.toFixed(2)}`);
  if (r.boosts.squeezeExpansion > 0)
    boostLines.push(
      `├─ Squeeze Expansion Trigger: +${r.boosts.squeezeExpansion.toFixed(2)}`,
    );
  boostLines.push(`└─ Timeframe Confluence: 4h ${r.trend4h} | 1d ${r.trend1d}`);

  const penaltyLine = r.penalties.length
    ? `\n⚠️ PENALTIES: ${r.penalties.join(", ")}\n`
    : "";

  return [
    "🎯 PREDICTIVE ACCUMULATION SIGNAL",
    "━━━━━━━━━━━━━━━━━━━━━━━━━",
    `Symbol: #${r.symbol}`,
    `Price: $${fmtPrice(price)}`,
    `Score: ${r.finalScore.toFixed(2)} (${r.stage})`,
    "━━━━━━━━━━━━━━━━━━━━━━━━━",
    "",
    "📈 PREDICTIVE COMPONENTS:",
    `├─ Relative Strength (vs BTC): ${r.components.relativeStrength.toFixed(2)} ${tick(r.components.relativeStrength)}`,
    `├─ Volatility Compression: ${r.components.volatilityCompression.toFixed(2)} ${tick(r.components.volatilityCompression)} (BBW/ATR Squeeze)`,
    `├─ Trend Structure: ${r.components.trendStructure.toFixed(2)} ${tick(r.components.trendStructure)} (EMA20/EMA50)`,
    `├─ Volume Acceleration: ${r.components.volumeAcceleration.toFixed(2)} ${tick(r.components.volumeAcceleration)}`,
    `└─ Breakout Readiness: ${r.components.breakoutReadiness.toFixed(2)} ${tick(r.components.breakoutReadiness)} (${r.extras.distanceToHighPct.toFixed(1)}% from 20-period high)`,
    "",
    "💰 BOOSTS & TIMEFRAME:",
    ...boostLines,
    penaltyLine,
    "🎯 EXECUTION PLAN:",
    `├─ Suggested Entry Range: $${entryLo} - $${entryHi}`,
    `├─ Conservative Stop: $${stop} (-8.0%)`,
    "└─ Target Horizon: 1h to 4h Expansion",
  ].join("\n");
}

export async function sendTelegramMessage(text: string): Promise<void> {
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const telegramKey = process.env["TELEGRAM_API_KEY"];
  const chatId = process.env["TELEGRAM_CHAT_ID"];

  if (!lovableKey) throw new Error("LOVABLE_API_KEY is not configured");
  if (!telegramKey) throw new Error("TELEGRAM_API_KEY is not configured");
  if (!chatId) throw new Error("TELEGRAM_CHAT_ID is not configured");

  const res = await fetch(`${GATEWAY_URL}/sendMessage`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": telegramKey,
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
    throw new Error(`Telegram send failed [${res.status}]: ${body}`);
  }
  const payload = (await res.json()) as { ok?: boolean; description?: string };
  if (payload.ok === false) {
    console.error("Telegram API error:", payload.description);
    throw new Error(`Telegram API error: ${payload.description}`);
  }
}
