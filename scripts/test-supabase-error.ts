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
  console.log("Testing Supabase insert into weex_trades...");
  const res = await supabaseAdmin
    .from("weex_trades")
    .insert({ symbol: "GIGGLEUSDT", alert_price: 0.045, status: "pending_velocity" })
    .select();
  
  console.log("Insert result:", JSON.stringify(res, null, 2));
}

main();
