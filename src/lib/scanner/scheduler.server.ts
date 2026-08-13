/**
 * In-process 3-minute market scanner scheduler.
 * Automatically runs the MEXC market scanner every 3 minutes during production server execution.
 */
import { runScan } from "../../routes/api/public/hooks/scan";

let scannerStarted = false;

export function initScannerScheduler(): void {
  if (scannerStarted) return;
  scannerStarted = true;

  console.log("🔍 [Market Scanner] In-process 3-minute scanner scheduler initialized.");

  // Run an initial market scan shortly after startup (10s delay)
  setTimeout(async () => {
    try {
      console.log(`🔍 [Market Scanner] Initial startup scan running...`);
      const summary = await runScan();
      console.log(
        `🔍 [Market Scanner] Initial scan completed: ${summary.scanned} scanned, ${summary.passedGates} passed, ${summary.alertsSent} alerts sent (${summary.durationMs}ms)`,
      );
    } catch (err) {
      console.error("🔍 [Market Scanner] Initial scan error:", err);
    }
  }, 10_000);

  // Scheduled scan every 3 minutes (180,000 ms)
  setInterval(async () => {
    try {
      console.log(`🔍 [Market Scanner] Running scheduled market scan at ${new Date().toISOString()}...`);
      const summary = await runScan();
      console.log(
        `🔍 [Market Scanner] Scan completed: ${summary.scanned} scanned, ${summary.passedGates} passed, ${summary.alertsSent} alerts sent (${summary.durationMs}ms)`,
      );
    } catch (err) {
      console.error("🔍 [Market Scanner] Scheduled scan error:", err);
    }
  }, 3 * 60_000);
}
