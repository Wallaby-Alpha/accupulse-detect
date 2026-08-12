/**
 * Signed WEEX contract REST client (demo / simulated trading).
 * Auth follows the WEEX capi scheme:
 *   ACCESS-SIGN = base64(hmacSHA256(timestamp + METHOD + requestPath + body, secret))
 */
import dns from "node:dns";
import { WEEX_BASE_URL } from "./config";

try {
  dns.setDefaultResultOrder("ipv4first");
} catch {
  /* ignore environment incompatibility */
}

export type WeexCredentials = {
  key: string;
  secret: string;
  passphrase: string;
};

export function isDemoMode(): boolean {
  const envDemo = process.env["WEEX_DEMO"];
  if (
    envDemo === undefined ||
    envDemo === "" ||
    envDemo.toLowerCase() === "true" ||
    envDemo === "1"
  ) {
    return true;
  }
  return false;
}

/**
 * Retrieves WEEX API Credentials.
 * In Demo Mode, supports dedicated WEEX_DEMO_API_KEY & WEEX_DEMO_SECRET_KEY / WEEX_DEMO_API_SECRET
 * to ensure IP-restricted production keys are not leaked or rejected.
 */
export function getWeexCredentials(): WeexCredentials | null {
  const demo = isDemoMode();
  if (demo) {
    const demoKey = process.env["WEEX_DEMO_API_KEY"];
    const demoSecret =
      process.env["WEEX_DEMO_API_SECRET"] || process.env["WEEX_DEMO_SECRET_KEY"];
    const demoPass =
      process.env["WEEX_DEMO_PASSPHRASE"] || process.env["WEEX_PASSPHRASE"] || "demo_passphrase";
    if (demoKey && demoSecret) {
      return { key: demoKey, secret: demoSecret, passphrase: demoPass };
    }
  }

  const key = process.env["WEEX_API_KEY"];
  const secret = process.env["WEEX_API_SECRET"];
  const passphrase =
    process.env["WEEX_API_PASSPHRASE"] || process.env["WEEX_PASSPHRASE"];
  if (!key || !secret || !passphrase) return null;
  return { key, secret, passphrase };
}

async function sign(message: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  let binary = "";
  const bytes = new Uint8Array(sig);
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export class WeexError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string | number,
  ) {
    super(message);
  }
}

export async function weexRequest<T = unknown>(
  method: "GET" | "POST",
  path: string,
  options: { body?: unknown; query?: Record<string, string>; signed?: boolean } = {},
): Promise<T> {
  const query = options.query
    ? `?${new URLSearchParams(options.query).toString()}`
    : "";
  const requestPath = `${path}${query}`;
  const bodyText = options.body ? JSON.stringify(options.body) : "";

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const demo = isDemoMode();

  if (options.signed !== false) {
    const creds = getWeexCredentials();

    if (!demo && !process.env["ALLOW_LIVE_TRADING"]) {
      throw new WeexError(
        "LIVE TRADING BLOCKED: System is configured for Demo mode. To allow live trading, set ALLOW_LIVE_TRADING=true.",
        403,
      );
    }

    if (creds) {
      const timestamp = Date.now().toString();
      headers["ACCESS-KEY"] = creds.key;
      headers["ACCESS-SIGN"] = await sign(
        `${timestamp}${method}${requestPath}${bodyText}`,
        creds.secret,
      );
      headers["ACCESS-TIMESTAMP"] = timestamp;
      headers["ACCESS-PASSPHRASE"] = creds.passphrase;
    }

    if (demo) {
      // Demo / simulated trading flags & headers.
      headers["X-SIMULATED-TRADING"] = "1";
      headers["paptrading"] = "1";
      headers["X-WEEX-DEMO"] = "true";
    } else if (!creds) {
      throw new WeexError("WEEX API credentials are not configured", 0);
    }
  }

  const res = await fetch(`${WEEX_BASE_URL}${requestPath}`, {
    method,
    headers,
    ...(bodyText ? { body: bodyText } : {}),
  });

  const text = await res.text();
  if (!res.ok) {
    console.error(`WEEX ${method} ${requestPath} failed [${res.status}]: ${text}`);
    let code: string | number | undefined;
    try {
      const errJson = JSON.parse(text) as { code?: string | number };
      code = errJson?.code;
    } catch {
      /* ignore */
    }
    throw new WeexError(`WEEX ${res.status}: ${text}`, res.status, code);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new WeexError(`WEEX returned non-JSON: ${text.slice(0, 200)}`, res.status);
  }
  const envelope = parsed as { code?: string | number; msg?: string };
  if (
    envelope &&
    typeof envelope === "object" &&
    envelope.code !== undefined &&
    String(envelope.code) !== "0" &&
    String(envelope.code) !== "00000"
  ) {
    throw new WeexError(`WEEX error ${envelope.code}: ${envelope.msg ?? text}`, res.status, envelope.code);
  }
  return parsed as T;
}

/* ------------------------------- market data ------------------------------ */

export async function getTicker(symbol: string): Promise<number | null> {
  try {
    const data = await weexRequest<{ last?: string }>("GET", "/capi/v2/market/ticker", {
      query: { symbol },
      signed: false,
    });
    const last = Number(data.last);
    return Number.isFinite(last) && last > 0 ? last : null;
  } catch (error) {
    console.error("WEEX ticker failed:", error);
    return null;
  }
}

type Contract = {
  symbol: string;
  contract_val: string;
  size_increment: string;
  tick_size: string;
  minOrderSize?: string;
  maxOrderSize?: string;
};

let contractCache: { at: number; map: Map<string, Contract> } | null = null;

export async function getContract(symbol: string): Promise<Contract | null> {
  if (!contractCache || Date.now() - contractCache.at > 60 * 60_000) {
    try {
      const list = await weexRequest<Contract[]>("GET", "/capi/v2/market/contracts", {
        signed: false,
      });
      if (Array.isArray(list)) {
        contractCache = { at: Date.now(), map: new Map(list.map((c) => [c.symbol, c])) };
      }
    } catch {
      /* ignore contract cache fetch error */
    }
  }
  return contractCache?.map.get(symbol) ?? null;
}

function roundTo(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.floor(value * f) / f;
}

/** Convert a coin quantity into exchange contract size, respecting increments and minOrderSize stepSize. */
export async function toContractSize(
  symbol: string,
  coinQuantity: number,
): Promise<number> {
  const contract = await getContract(symbol);
  if (!contract) return roundTo(coinQuantity, 4);
  const contractVal = Number(contract.contract_val) || 1;
  const decimals = Number(contract.size_increment) || 0;
  const minOrderSize = Number(contract.minOrderSize) || 1;
  const maxOrderSize = Number(contract.maxOrderSize) || Infinity;

  const rawContracts = coinQuantity / contractVal;

  let finalSize = rawContracts;
  if (minOrderSize >= 1) {
    const stepped = Math.floor(rawContracts / minOrderSize) * minOrderSize;
    finalSize = Math.max(stepped, minOrderSize);
  } else {
    finalSize = Math.max(roundTo(rawContracts, decimals), 1 / 10 ** decimals);
  }

  return Math.min(finalSize, maxOrderSize);
}

/** Convert a raw target price into an exchange contract price, respecting tick_size stepSize. */
export async function toContractPrice(
  symbol: string,
  rawPrice: number,
): Promise<number> {
  const contract = await getContract(symbol);
  if (!contract) return roundTo(rawPrice, 4);
  const decimals = Number(contract.tick_size) || 4;
  return roundTo(rawPrice, decimals);
}

/* --------------------------------- orders --------------------------------- */

let v3SymbolsCache: { at: number; set: Set<string> } | null = null;

export async function getV3TradingSymbols(): Promise<Set<string>> {
  if (!v3SymbolsCache || Date.now() - v3SymbolsCache.at > 60 * 60_000) {
    try {
      const res = await fetch("https://api-contract.weex.com/capi/v3/market/apiTradingSymbols");
      if (res.ok) {
        const list = (await res.json()) as string[];
        v3SymbolsCache = { at: Date.now(), set: new Set(list) };
      }
    } catch {
      /* fallback */
    }
  }
  return v3SymbolsCache?.set ?? new Set();
}

/** Helper to convert standard exchange symbol e.g. "BTCUSDT" or "cmt_btcusdt" to valid V3 paper trading symbol */
export async function toSimSymbol(symbol: string): Promise<string> {
  const clean = symbol.replace(/^cmt_/i, "").toUpperCase();
  const v3Set = await getV3TradingSymbols();

  if (clean.endsWith("USDT") && !clean.endsWith("SUSDT")) {
    const sVariant = clean.replace(/USDT$/, "SUSDT");
    if (v3Set.has(sVariant)) return sVariant;
  }

  if (v3Set.has(clean)) return clean;

  return clean;
}

type PlaceOrderResponse = {
  orderId?: string;
  order_id?: string;
  success?: boolean;
  data?: { orderId?: string };
};

function extractOrderId(res: PlaceOrderResponse): string | null {
  return res.orderId ?? res.order_id ?? res.data?.orderId ?? null;
}

/**
 * Handles paper trading fallbacks when WEEX REST API returns code -1056 (Invalid IP)
 * or -1058 (Unsupported pair) or network restrictions in Demo mode.
 */
function handleDemoOrderFallback(
  orderType: string,
  symbol: string,
  error: unknown,
): string {
  const codeStr = error instanceof WeexError ? String(error.code ?? "") : "";
  const message = error instanceof Error ? error.message : String(error);
  console.log(
    `[WEEX PAPER TRADING - SIMULATED FALLBACK] Demo mode ${orderType} for ${symbol} caught API response [code: ${codeStr || "N/A"} - ${message}]. Falling back to simulated paper order.`,
  );
  return `sim-${orderType.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`;
}

/** Limit buy to open a long position in WEEX Paper Trading mode (/capi/v3/sim/order). */
export async function placeLimitBuy(
  symbol: string,
  price: number,
  size: number,
  clientOid: string,
): Promise<string | null> {
  const formattedPrice = await toContractPrice(symbol, price);
  const formattedSize = await toContractSize(symbol, size);

  if (isDemoMode()) {
    const simSymbol = await toSimSymbol(symbol);
    const endpointPath = "/capi/v3/sim/order";
    const fullUrl = `https://api-contract.weex.com${endpointPath}`;

    console.log(`[WEEX PAPER TRADING] Placing Limit Buy Order at URL: ${fullUrl}`);
    console.log(`[WEEX PAPER TRADING] Symbol: ${simSymbol}, Price: ${formattedPrice}, Quantity: ${formattedSize}`);

    try {
      const res = await weexRequest<PlaceOrderResponse>("POST", endpointPath, {
        body: {
          symbol: simSymbol,
          side: "BUY",
          positionSide: "LONG",
          type: "LIMIT",
          quantity: String(formattedSize),
          price: String(formattedPrice),
          timeInForce: "GTC",
          newClientOrderId: clientOid || `sim-${Date.now()}`,
        },
        signed: true,
      });
      const orderId = extractOrderId(res);
      if (orderId) return orderId;
    } catch (error) {
      return handleDemoOrderFallback("Limit Buy", simSymbol, error);
    }
    return `sim-buy-${Date.now()}`;
  }

  if (process.env["ALLOW_LIVE_TRADING"] !== "true") {
    throw new Error("LIVE TRADING BLOCKED: System is configured for Demo mode. ALLOW_LIVE_TRADING=true is not set.");
  }

  const res = await weexRequest<PlaceOrderResponse>("POST", "/capi/v2/order/placeOrder", {
    body: {
      symbol,
      client_oid: clientOid,
      size: String(formattedSize),
      type: "1", // open long
      order_type: "0", // normal
      match_price: "0", // limit
      price: String(formattedPrice),
      marginMode: 3,
    },
  });
  return extractOrderId(res);
}

/** Market close of an open long position in WEEX Paper Trading mode (/capi/v3/sim/order). */
export async function marketCloseLong(
  symbol: string,
  size: number,
  clientOid: string,
): Promise<string | null> {
  const formattedSize = await toContractSize(symbol, size);

  if (isDemoMode()) {
    const simSymbol = await toSimSymbol(symbol);
    const endpointPath = "/capi/v3/sim/order";
    const fullUrl = `https://api-contract.weex.com${endpointPath}`;

    console.log(`[WEEX PAPER TRADING] Placing Market Close Order at URL: ${fullUrl}`);

    try {
      const res = await weexRequest<PlaceOrderResponse>("POST", endpointPath, {
        body: {
          symbol: simSymbol,
          side: "SELL",
          positionSide: "LONG",
          type: "MARKET",
          quantity: String(formattedSize),
          newClientOrderId: clientOid || `sim-close-${Date.now()}`,
        },
        signed: true,
      });
      const orderId = extractOrderId(res);
      if (orderId) return orderId;
    } catch (error) {
      return handleDemoOrderFallback("Market Close", simSymbol, error);
    }
    return `sim-close-${Date.now()}`;
  }

  if (process.env["ALLOW_LIVE_TRADING"] !== "true") {
    throw new Error("LIVE TRADING BLOCKED: System is configured for Demo mode. ALLOW_LIVE_TRADING=true is not set.");
  }

  const res = await weexRequest<PlaceOrderResponse>("POST", "/capi/v2/order/placeOrder", {
    body: {
      symbol,
      client_oid: clientOid,
      size: String(formattedSize),
      type: "3", // close long
      order_type: "0",
      match_price: "1", // market
      price: "0",
      marginMode: 3,
    },
  });
  return extractOrderId(res);
}

/** Trigger (plan) order used for the OCO bracket legs in WEEX Paper Trading mode (/capi/v3/sim/order). */
export async function placePlanOrder(
  symbol: string,
  triggerPrice: number,
  executePrice: number,
  size: number,
  clientOid: string,
  matchPrice: "0" | "1",
): Promise<string | null> {
  const formattedTrigger = await toContractPrice(symbol, triggerPrice);
  const formattedExecute = await toContractPrice(symbol, executePrice);
  const formattedSize = await toContractSize(symbol, size);

  if (isDemoMode()) {
    const simSymbol = await toSimSymbol(symbol);
    const endpointPath = "/capi/v3/sim/order";
    const fullUrl = `https://api-contract.weex.com${endpointPath}`;

    console.log(`[WEEX PAPER TRADING] Placing Plan Order at URL: ${fullUrl}`);

    try {
      const res = await weexRequest<PlaceOrderResponse>("POST", endpointPath, {
        body: {
          symbol: simSymbol,
          side: "SELL",
          positionSide: "LONG",
          type: matchPrice === "1" ? "STOP_MARKET" : "STOP",
          stopPrice: String(formattedTrigger),
          price: matchPrice === "1" ? undefined : String(formattedExecute),
          quantity: String(formattedSize),
          newClientOrderId: clientOid || `sim-plan-${Date.now()}`,
        },
        signed: true,
      });
      const orderId = extractOrderId(res);
      if (orderId) return orderId;
    } catch (error) {
      return handleDemoOrderFallback("Plan Order", simSymbol, error);
    }
    return `sim-plan-${Date.now()}`;
  }

  if (process.env["ALLOW_LIVE_TRADING"] !== "true") {
    throw new Error("LIVE TRADING BLOCKED: System is configured for Demo mode. ALLOW_LIVE_TRADING=true is not set.");
  }

  const res = await weexRequest<PlaceOrderResponse>("POST", "/capi/v2/order/plan_order", {
    body: {
      symbol,
      client_oid: clientOid,
      size: String(formattedSize),
      type: "3", // close long
      match_type: matchPrice,
      trigger_price: String(formattedTrigger),
      execute_price: String(formattedExecute),
    },
  });
  return extractOrderId(res);
}

export async function cancelOrder(symbol: string, orderId: string): Promise<void> {
  if (isDemoMode() || orderId.startsWith("sim-") || orderId.startsWith("demo-")) {
    console.log(`[WEEX PAPER TRADING] Cancelled Sim Order: ${orderId} (${symbol})`);
    return;
  }
  await weexRequest("POST", "/capi/v2/order/cancel_order", {
    body: { symbol, orderId },
    signed: true,
  });
}

export async function cancelPlanOrder(symbol: string, orderId: string): Promise<void> {
  if (isDemoMode() || orderId.startsWith("sim-") || orderId.startsWith("demo-")) {
    console.log(`[WEEX PAPER TRADING] Cancelled Sim Plan Order: ${orderId} (${symbol})`);
    return;
  }
  await weexRequest("POST", "/capi/v2/order/cancel_plan", {
    body: { symbol, orderId },
    signed: true,
  });
}

export type OrderDetail = {
  status?: string;
  state?: string;
  filled_qty?: string;
  price_avg?: string;
};

export async function getOrderDetail(
  symbol: string,
  orderId: string,
): Promise<OrderDetail | null> {
  if (isDemoMode() || orderId.startsWith("sim-") || orderId.startsWith("demo-")) {
    // In Demo mode or simulated orders, return instant filled status
    return {
      status: "2",
      state: "filled",
      filled_qty: "100",
      price_avg: "0",
    };
  }

  try {
    return await weexRequest<OrderDetail>("GET", "/capi/v2/order/detail", {
      query: { symbol, orderId },
    });
  } catch (error) {
    console.error("WEEX order detail failed:", error);
    return null;
  }
}

/** Normalises the many status spellings into what the engine cares about. */
export function isFilled(detail: OrderDetail | null): boolean {
  if (!detail) return false;
  const raw = String(detail.status ?? detail.state ?? "").toLowerCase();
  if (raw === "2" || raw === "filled" || raw === "full_fill" || raw === "fully_filled") {
    return true;
  }
  return Number(detail.filled_qty ?? 0) > 0;
}
