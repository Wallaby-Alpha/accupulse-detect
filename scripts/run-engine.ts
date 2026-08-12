import { runTradeEngine } from "../src/lib/weex/engine.server";

async function main() {
  console.log("Running WEEX trade engine tick...");
  try {
    const res = await runTradeEngine();
    console.log(`Tick finished. Processed: ${res.processed}, Errors: ${res.errors}`);
  } catch (err) {
    console.error("Tick failed:", err);
  }
}

main();
