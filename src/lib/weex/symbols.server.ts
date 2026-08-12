/**
 * WEEX Symbol Normalization and Dynamic API Symbol Whitelist Filtering.
 */
import dns from "node:dns";
import { weexRequest } from "./client.server";

try {
  dns.setDefaultResultOrder("ipv4first");
} catch {
  /* ignore */
}

export const SYMBOL_ALIASES: Record<string, string> = {
  "GOLD(PAXG)USDT": "PAXGUSDT",
  "PAXGUSDT": "PAXGUSDT",
  "BELDEXUSDT": "BDXUSDT",
};

/**
 * Normalizes exchange symbol strings:
 * - Strips leading '#' or formatting and trims whitespace.
 * - Applies custom alias mappings (e.g. GOLD(PAXG)USDT -> PAXGUSDT, BELDEXUSDT -> BDXUSDT).
 * - Returns a clean uppercase symbol string (e.g. TRUMPUSDT).
 */
export function normalizeSymbol(mexcSymbol: string): string {
  if (!mexcSymbol) return "";
  const cleaned = mexcSymbol.trim().replace(/^#+/, "");
  const upper = cleaned.toUpperCase();
  return SYMBOL_ALIASES[upper] ?? upper;
}

let apiSymbolsCache: { at: number; set: Set<string> } | null = null;
const CACHE_TTL_MS = 60 * 60_000; // 1 hour in-memory cache TTL

/**
 * Fetches the list of API-supported trading pairs directly from WEEX:
 * GET https://api-contract.weex.com/capi/v3/market/apiTradingSymbols
 *
 * Caches the list in memory for 1 hour.
 */
export async function getWeexSupportedSymbols(): Promise<Set<string>> {
  if (apiSymbolsCache && Date.now() - apiSymbolsCache.at < CACHE_TTL_MS) {
    return apiSymbolsCache.set;
  }

  const set = new Set<string>();

  try {
    const res = await fetch("https://api-contract.weex.com/capi/v3/market/apiTradingSymbols");
    if (res.ok) {
      const list = (await res.json()) as string[];
      for (const sym of list ?? []) {
        if (typeof sym === "string") {
          const upper = sym.toUpperCase();
          set.add(upper);
          if (upper.endsWith("SUSDT")) {
            set.add(upper.replace(/SUSDT$/, "USDT"));
          }
          if (upper.startsWith("CMT_")) {
            set.add(upper.replace(/^CMT_/, ""));
          }
        }
      }
    }
  } catch (error) {
    console.error("[WEEX SYMBOLS] Failed to fetch V3 apiTradingSymbols:", error);
  }

  // Fallback / secondary check against V2 contracts API
  try {
    const list = await weexRequest<Array<{ symbol?: string; underlying_index?: string; quote_currency?: string }>>(
      "GET",
      "/capi/v2/market/contracts",
      { signed: false },
    );
    for (const item of list ?? []) {
      if (item.symbol) {
        const rawUpper = item.symbol.toUpperCase();
        set.add(rawUpper);
        set.add(rawUpper.replace(/^CMT_/, ""));
      }
      if (item.underlying_index && item.quote_currency) {
        set.add(`${item.underlying_index}${item.quote_currency}`.toUpperCase());
      }
    }
  } catch {
    /* ignore fallback errors */
  }

  if (set.size > 0) {
    apiSymbolsCache = { at: Date.now(), set };
  }

  return apiSymbolsCache?.set ?? set;
}

/**
 * Validates whether an incoming MEXC alert symbol is enabled for API trading on WEEX.
 */
export async function isSymbolSupportedOnWeex(mexcSymbol: string): Promise<boolean> {
  const clean = normalizeSymbol(mexcSymbol);
  const supportedSet = await getWeexSupportedSymbols();

  if (supportedSet.has(clean)) return true;

  if (clean.endsWith("USDT") && !clean.endsWith("SUSDT")) {
    const sVariant = clean.replace(/USDT$/, "SUSDT");
    if (supportedSet.has(sVariant)) return true;
  }

  if (clean.endsWith("SUSDT")) {
    const normVariant = clean.replace(/SUSDT$/, "USDT");
    if (supportedSet.has(normVariant)) return true;
  }

  return false;
}
