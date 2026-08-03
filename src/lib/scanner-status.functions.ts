import { createServerFn } from "@tanstack/react-start";

export const getScannerStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("scan_runs")
    .select("created_at,scanned,passed_gates,alerts_sent,duration_ms,error")
    .order("created_at", { ascending: false })
    .limit(8);

  if (error) return { runs: [], error: "Status unavailable" };
  return { runs: data ?? [], error: null as string | null };
});
