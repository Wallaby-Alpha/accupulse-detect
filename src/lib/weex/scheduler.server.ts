/**
 * In-process 1-minute trade engine scheduler.
 * Automatically runs the WEEX trade engine tick every 60 seconds during local server execution.
 */
import { runTradeEngine } from "./engine.server";

let schedulerStarted = false;

export function initTradeEngineScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;

  console.log("⚡ [WEEX Engine] Local 1-minute trade-tick scheduler initialized.");

  // Run an initial tick shortly after startup (5s delay)
  setTimeout(async () => {
    try {
      const res = await runTradeEngine();
      console.log(
        `⚡ [WEEX Engine] Initial tick completed. Processed: ${res.processed}, Errors: ${res.errors}`,
      );
    } catch (err) {
      console.error("⚡ [WEEX Engine] Initial tick error:", err);
    }
  }, 5_000);

  // Scheduled tick every 60 seconds
  setInterval(async () => {
    try {
      const res = await runTradeEngine();
      if (res.processed > 0 || res.errors > 0) {
        console.log(
          `⚡ [WEEX Engine] Minute tick completed. Processed: ${res.processed}, Errors: ${res.errors}`,
        );
      }
    } catch (err) {
      console.error("⚡ [WEEX Engine] Minute tick error:", err);
    }
  }, 60_000);
}
