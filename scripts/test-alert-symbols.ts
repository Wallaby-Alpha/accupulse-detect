import { fetchTickers, fetchKlines, fetchDepth } from "../src/lib/scanner/mexc";
import { checkHardGates, scoreSymbol } from "../src/lib/scanner/scoring";
import { SCANNER_CONFIG } from "../src/lib/scanner/config";

async function main() {
  console.log("=== Testing Scoring & Stage Classification for Target Symbols ===");

  const symbols = ["GIGGLEUSDT", "CAPUSDT", "ASSETUSDT", "CRVUSDT"];
  const tickers = await fetchTickers();
  const btcK1h = await fetchKlines("BTCUSDT", "60m", 200);

  const filtered = tickers.filter((t) => t.symbol.endsWith("USDT")).sort((a, b) => Number(b.quoteVolume) - Number(a.quoteVolume));

  for (const sym of symbols) {
    const rank = filtered.findIndex((t) => t.symbol === sym) + 1;
    const t = tickers.find((x) => x.symbol === sym);
    console.log(`\n------------------ ${sym} ------------------`);
    console.log(`24h Volume Rank: ${rank} out of ${filtered.length} | Quote Volume: $${t?.quoteVolume ?? 0}`);

    if (!t) {
      console.log(`Symbol ${sym} not found in MEXC tickers.`);
      continue;
    }

    try {
      const k1h = await fetchKlines(t.symbol, "60m", 200);
      const k4h = await fetchKlines(t.symbol, "4h", 120);
      const k1d = await fetchKlines(t.symbol, "1d", 90);
      const depth = await fetchDepth(t.symbol, 20);

      const gate = checkHardGates(
        { ticker: t, klines1h: k1h, klines4h: k4h, klines1d: k1d, btcKlines1h: btcK1h, depth },
        SCANNER_CONFIG,
      );
      console.log(`Hard Gate Pass: ${gate.pass} | Reason: ${gate.reason}`);

      const score = scoreSymbol({
        ticker: t,
        klines1h: k1h,
        klines4h: k4h,
        klines1d: k1d,
        btcKlines1h: btcK1h,
        depth,
      });

      console.log(`Stage: ${score.stage}`);
      console.log(`Final Score: ${score.finalScore} (Alert Threshold: ${SCANNER_CONFIG.THRESHOLDS.SCORE_ALERT_THRESHOLD})`);
      console.log(`Should Alert: ${score.shouldAlert}`);
      console.log(`Components:`, score.components);
    } catch (err) {
      console.error(`Error scoring ${sym}:`, err);
    }
  }
}

main();
