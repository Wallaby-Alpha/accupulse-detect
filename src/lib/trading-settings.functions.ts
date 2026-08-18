import { createServerFn } from "@tanstack/react-start";
import { getTradingSettings, updateTradingSettings, type TradingSettings } from "./weex/settings.server";

export const getTradingSettingsFn = createServerFn({ method: "GET" }).handler(async () => {
  return await getTradingSettings();
});

export const updateTradingSettingsFn = createServerFn({ method: "POST" })
  .validator((data: Partial<TradingSettings>) => data)
  .handler(async ({ data }) => {
    await updateTradingSettings(data);
    return { success: true };
  });
