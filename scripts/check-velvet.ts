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

import { supabaseAdmin } from "../src/integrations/supabase/client.server";

async function main() {
  console.log("Checking Supabase data for VELVETUSDT...");

  const { data: history } = await supabaseAdmin
    .from("alert_history")
    .select("*")
    .eq("symbol", "VELVETUSDT");
  console.log("Alert history for VELVETUSDT:", history);

  const { data: cooldown } = await supabaseAdmin
    .from("alert_cooldowns")
    .select("*")
    .eq("symbol", "VELVETUSDT");
  console.log("Cooldown for VELVETUSDT:", cooldown);

  const { data: scanRuns, error } = await supabaseAdmin
    .from("scan_runs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) console.error("Error fetching scan runs:", error);
  else {
    console.log(`Fetched ${scanRuns.length} recent scan runs:`);
    for (const r of scanRuns) {
      console.log(`Scan at ${r.created_at}: scanned=${r.scanned}, passed_gates=${r.passed_gates}, alerts_sent=${r.alerts_sent}, error=${r.error}`);
    }
  }
}

main();
