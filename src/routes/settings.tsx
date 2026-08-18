import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useSuspenseQuery, useMutation, queryOptions } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Power, Save, ShieldAlert, Percent, DollarSign } from "lucide-react";

import { getTradingSettingsFn, updateTradingSettingsFn } from "@/lib/trading-settings.functions";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";

const settingsQuery = queryOptions({
  queryKey: ["trading-settings"],
  queryFn: () => getTradingSettingsFn(),
  refetchInterval: 15_000,
});

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [{ title: "Trading Engine Settings" }],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(settingsQuery),
  component: SettingsPage,
});

function SettingsPage() {
  const { data: initialSettings } = useSuspenseQuery(settingsQuery);
  const router = useRouter();

  // Local state for optimistic updates and form management
  const [isEnabled, setIsEnabled] = useState(initialSettings.is_trading_enabled);
  const [tpPercent, setTpPercent] = useState(initialSettings.tp_percent.toString());
  const [slPercent, setSlPercent] = useState(initialSettings.sl_percent.toString());
  const [pullbackPercent, setPullbackPercent] = useState(initialSettings.pullback_percent.toString());
  const [notionalSize, setNotionalSize] = useState(initialSettings.notional_size_usd.toString());

  const updateMutation = useMutation({
    mutationFn: (updates: typeof initialSettings) => updateTradingSettingsFn({ data: updates }),
    onSuccess: () => {
      toast.success("Settings saved successfully!", {
        description: "The trading engine will use these immediately.",
      });
      router.invalidate();
    },
    onError: () => {
      toast.error("Failed to save settings. Please try again.");
    },
  });

  const handleSave = () => {
    updateMutation.mutate({
      is_trading_enabled: isEnabled,
      tp_percent: Number(tpPercent),
      sl_percent: Number(slPercent),
      pullback_percent: Number(pullbackPercent),
      notional_size_usd: Number(notionalSize),
    });
  };

  const handleKillSwitch = (checked: boolean) => {
    setIsEnabled(checked);
    // Instant save for Kill Switch for maximum safety
    updateMutation.mutate({
      is_trading_enabled: checked,
      tp_percent: Number(tpPercent),
      sl_percent: Number(slPercent),
      pullback_percent: Number(pullbackPercent),
      notional_size_usd: Number(notionalSize),
    });
    if (!checked) {
      toast.error("SYSTEM HALTED", { description: "Trading Engine is now offline." });
    } else {
      toast.success("SYSTEM ACTIVE", { description: "Trading Engine is now scanning for trades." });
    }
  };

  return (
    <div className="container mx-auto max-w-2xl py-12 px-4 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Trading Settings</h1>
        <p className="text-muted-foreground">
          Configure live trading parameters and system overrides. Changes are applied instantly to the next alert.
        </p>
      </div>

      <Card className={isEnabled ? "border-primary/20 shadow-primary/10" : "border-destructive/50 bg-destructive/5"}>
        <CardHeader className="flex flex-row items-center justify-between pb-4">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-xl">
              <Power className={isEnabled ? "text-primary" : "text-destructive"} size={20} />
              Master Kill Switch
            </CardTitle>
            <CardDescription>
              {isEnabled 
                ? "The trading engine is currently active and processing webhooks."
                : "The trading engine is offline. It will ignore all incoming signals."}
            </CardDescription>
          </div>
          <Switch 
            checked={isEnabled} 
            onCheckedChange={handleKillSwitch}
            className="scale-125"
          />
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert size={18} className="text-muted-foreground" />
            Risk & Entry Parameters
          </CardTitle>
          <CardDescription>
            Adjust the dual-tranche setup and protection brackets.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="notionalSize">Total Notional Position Size</Label>
            <div className="relative">
              <DollarSign className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input 
                id="notionalSize" 
                type="number" 
                step="1"
                min="10"
                className="pl-9" 
                value={notionalSize} 
                onChange={(e) => setNotionalSize(e.target.value)} 
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Total USD size across both tranches (e.g., $140 total means two $70 entries).
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="tpPercent">Take Profit (%)</Label>
              <div className="relative">
                <Percent className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input 
                  id="tpPercent" 
                  type="number" 
                  step="0.1" 
                  min="0.1"
                  value={tpPercent} 
                  onChange={(e) => setTpPercent(e.target.value)} 
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="slPercent">Stop Loss (%)</Label>
              <div className="relative">
                <Percent className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input 
                  id="slPercent" 
                  type="number" 
                  step="0.1" 
                  min="0.1"
                  value={slPercent} 
                  onChange={(e) => setSlPercent(e.target.value)} 
                />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="pullbackPercent">Pullback Entry Offset (%)</Label>
            <div className="relative">
              <Percent className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input 
                id="pullbackPercent" 
                type="number" 
                step="0.1" 
                min="0.1"
                value={pullbackPercent} 
                onChange={(e) => setPullbackPercent(e.target.value)} 
              />
            </div>
            <p className="text-xs text-muted-foreground">
              How far down the second tranche limit order is placed (e.g., 1.0 means -1.0% from Tranche 1).
            </p>
          </div>

        </CardContent>
        <CardFooter className="bg-muted/50 py-4 flex justify-between items-center">
          <p className="text-sm text-muted-foreground">
            {updateMutation.isPending ? "Saving..." : "Unsaved changes apply on save."}
          </p>
          <Button onClick={handleSave} disabled={updateMutation.isPending} className="gap-2">
            <Save size={16} />
            Save Parameters
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
