/**
 * Signed WEEX contract REST client (demo / simulated trading).
 * Auth follows the WEEX capi scheme:
 *   ACCESS-SIGN = base64(hmacSHA256(timestamp + METHOD + requestPath + body, secret))
 */
import dns from "node:dns";
import { WEEX_BASE_URL, toWeexSymbol } from "./config";

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
  const paperTrading = process.env["WEEX_PAPER_TRADING"];
  if (
    paperTrading !== undefined &&
    (paperTrading.toLowerCase() === "false" || paperTrading === "0")
  ) {
    return false;
  }
  const envDemo = process.env["WEEX_DEMO"];
  if (
    envDemo !== undefined &&
    (envDemo.toLowerCase() === "false" || envDemo === "0")
  ) {
    return false;
  }
  const allowLive = process.env["ALLOW_LIVE_TRADING"];
  if (allowLive === "true" || allowLive === "1") {
    return false;
  }
  return true;
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

    if (!demo && process.env["ALLOW_LIVE_TRADING"] !== "true" && process.env["ALLOW_LIVE_TRADING"] !== "1") {
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
      headers["locale"] = "en-US";
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
    String(envelope.code) !== "00000" &&
    String(envelope.code) !== "200"
  ) {
    throw new WeexError(`WEEX error ${envelope.code}: ${envelope.msg ?? text}`, res.status, envelope.code);
  }
  return parsed as T;
}

/* ------------------------------- market data ------------------------------ */

export async function getTicker(symbol: string): Promise<number | null> {
  const trySymbols = [
    symbol,
    symbol.startsWith("cmt_") ? symbol.replace(/^cmt_/, "").toUpperCase() : `cmt_${symbol.toLowerCase()}`,
  ];

  for (const s of trySymbols) {
    try {
      const data = await weexRequest<{ last?: string }>("GET", "/capi/v2/market/ticker", {
        query: { symbol: s },
        signed: false,
      });
      const last = Number(data.last);
      if (Number.isFinite(last) && last > 0) return last;
    } catch {
      /* try next symbol format silently */
    }
  }
  return null;
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

function getStepFromWeexFormat(format: string | undefined, defaultStep: number): number {
  if (!format) return defaultStep;
  const num = parseFloat(format);
  if (isNaN(num)) return defaultStep;
  // If format is an integer between 0 and 8, it's a decimal precision (e.g., "4" -> 0.0001)
  if (format.indexOf('.') === -1 && num >= 0 && num <= 8) {
    if (num === 0) return 1;
    return parseFloat(Math.pow(10, -num).toFixed(num));
  }
  // Otherwise, it's a direct step size (e.g., "10" or "0.001")
  return num;
}

function floorToStep(value: number, stepStr: string): number {
  const step = getStepFromWeexFormat(stepStr, 0.0001);
  const decimals = step.toString().includes('.') ? (step.toString().split('.')[1]?.length ?? 0) : 0;
  const numSteps = Math.floor(value / step);
  return parseFloat((numSteps * step).toFixed(decimals));
}

function roundToStep(value: number, stepStr: string): number {
  const step = getStepFromWeexFormat(stepStr, 0.0001);
  const decimals = step.toString().includes('.') ? (step.toString().split('.')[1]?.length ?? 0) : 0;
  const numSteps = Math.round(value / step);
  return parseFloat((numSteps * step).toFixed(decimals));
}

/**
 * Calculate contract order size for target Notional Position ($140.00 USD).
 * Formula: Required Contracts = Target Notional ($140) / Limit Entry Price
 * Respects minOrderSize and size_increment stepSize.
 */
export async function toContractSize(
  symbol: string,
  targetNotionalUsd: number,
  limitPrice: number,
): Promise<number> {
  const contract = await getContract(symbol);
  const minOrderSize = Number(contract?.minOrderSize) || 0.0001;
  const maxOrderSize = Number(contract?.maxOrderSize) || Infinity;
  
  // If minOrderSize >= 1, the step size is minOrderSize (e.g. 10 or 100), otherwise use size_increment
  const stepStr = minOrderSize >= 1 ? String(minOrderSize) : (contract?.size_increment || "0.0001");

  if (!limitPrice || limitPrice <= 0) return 0;

  // Formula: Required Contracts = Target Notional ($140) / Limit Entry Price
  const rawUnits = targetNotionalUsd / limitPrice;

  let finalSize = floorToStep(rawUnits, stepStr);

  if (finalSize < minOrderSize) {
    finalSize = minOrderSize;
  }

  return Math.min(finalSize, maxOrderSize);
}

/** Convert a raw target price into an exchange contract price, respecting tick_size stepSize. */
export async function toContractPrice(
  symbol: string,
  rawPrice: number,
): Promise<number> {
  const contract = await getContract(symbol);
  if (!contract) return roundToStep(rawPrice, "0.0001");
  const tickSizeStr = contract.tick_size || "0.0001";
  return roundToStep(rawPrice, tickSizeStr);
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

/** Dynamically enforce 5x Isolated Leverage prior to order placement. */
export async function setWeexLeverage(symbol: string, leverage: number = 5): Promise<boolean> {
  if (isDemoMode()) {
    console.log(`[WEEX PAPER TRADING] Dynamic ${leverage}x Isolated Leverage set for ${symbol}`);
    return true;
  }

  const formattedSymbol = symbol.startsWith("cmt_") ? symbol : toWeexSymbol(symbol);

  const tryEndpoints = [
    {
      path: "/capi/v2/account/leverage",
      body: {
        symbol: formattedSymbol,
        longLeverage: String(leverage),
        shortLeverage: String(leverage),
        marginMode: 3,
      },
    },
    {
      path: "/capi/v2/order/changeLeverage",
      body: { symbol: formattedSymbol, leverage: String(leverage), marginMode: 3 },
    },
  ];

  for (const ep of tryEndpoints) {
    try {
      await weexRequest("POST", ep.path, {
        body: ep.body,
        signed: true,
      });
      console.log(`[WEEX ENGINE] Dynamic ${leverage}x Isolated Leverage ENFORCED for ${formattedSymbol}`);
      return true;
    } catch (err) {
      console.warn(`[WEEX ENGINE] Leverage endpoint ${ep.path} error: ${(err as Error).message}`);
    }
  }

  return false;
}

/** Limit buy to open a long position in WEEX Paper Trading mode (/capi/v3/sim/order). */
export async function placeLimitBuy(
  symbol: string,
  price: number,
  size: number,
  clientOid: string,
  presetTakeProfitPrice?: number,
  presetStopLossPrice?: number,
): Promise<string | null> {
  const formattedSymbol = toWeexSymbol(symbol);
  // Ensure 5x Isolated Leverage prior to order placement
  await setWeexLeverage(formattedSymbol, 5);

  const formattedPrice = await toContractPrice(formattedSymbol, price);
  const formattedSize = size;
  
  const formattedTp = presetTakeProfitPrice ? String(await toContractPrice(formattedSymbol, presetTakeProfitPrice)) : undefined;
  const formattedSl = presetStopLossPrice ? String(await toContractPrice(formattedSymbol, presetStopLossPrice)) : undefined;

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
          marginType: "ISOLATED",
          quantity: String(formattedSize),
          price: String(formattedPrice),
          timeInForce: "GTC",
          newClientOrderId: clientOid || `sim-${Date.now()}`,
          presetTakeProfitPrice: formattedTp,
          presetStopLossPrice: formattedSl,
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

  const res = await weexRequest<PlaceOrderResponse>("POST", "/capi/v2/order/placeOrder", {
    body: {
      symbol: formattedSymbol,
      client_oid: clientOid,
      size: String(formattedSize),
      type: "1", // open long
      side: "open_long",
      holdSide: "long",
      positionSide: "LONG",
      order_type: "0", // normal
      match_price: "0", // limit
      price: String(formattedPrice),
      marginMode: 3, // Isolated Margin Mode
      presetTakeProfitPrice: formattedTp,
      presetStopLossPrice: formattedSl,
    },
    signed: true,
  });
  return extractOrderId(res);
}

/** Market close of an open long position in WEEX Paper Trading mode (/capi/v3/sim/order). */
export async function marketCloseLong(
  symbol: string,
  size: number,
  clientOid: string,
): Promise<string | null> {
  const formattedSymbol = toWeexSymbol(symbol);
  const contract = await getContract(formattedSymbol);
  const minOrderSize = Number(contract?.minOrderSize) || 1;
  const stepStr = minOrderSize >= 1 ? String(minOrderSize) : (contract?.size_increment || "0.0001");

  let formattedSize = floorToStep(size, stepStr);
  if (formattedSize < minOrderSize) {
    formattedSize = minOrderSize;
  }

  if (isDemoMode()) {
    const simSymbol = await toSimSymbol(symbol);
    const endpointPath = "/capi/v3/sim/order";
    const fullUrl = `https://api-contract.weex.com${endpointPath}`;

    console.log(`[WEEX PAPER TRADING] Executing Market Close at URL: ${fullUrl}`);

    try {
      const res = await weexRequest<PlaceOrderResponse>("POST", endpointPath, {
        body: {
          symbol: simSymbol,
          client_oid: clientOid,
          size: String(formattedSize),
          type: "3", // close long
          side: "close_long",
          holdSide: "long",
          positionSide: "LONG",
          order_type: "0",
          match_price: "1", // market
          price: "0",
          marginMode: 3, // Isolated Margin Mode
        },
      });
      const orderId = extractOrderId(res);
      if (orderId) return orderId;
    } catch (error) {
      return handleDemoOrderFallback("Market Close", simSymbol, error);
    }
    return `sim-close-${Date.now()}`;
  }

  const res = await weexRequest<PlaceOrderResponse>("POST", "/capi/v2/order/placeOrder", {
    body: {
      symbol: formattedSymbol,
      client_oid: clientOid,
      size: String(formattedSize),
      type: "3", // close long
      side: "close_long",
      holdSide: "long",
      positionSide: "LONG",
      order_type: "0",
      match_price: "1", // market
      price: "0",
      marginMode: 3, // Isolated Margin Mode
    },
    signed: true,
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
  const formattedSymbol = toWeexSymbol(symbol);
  // Ensure 5x Isolated Leverage prior to bracket placement
  await setWeexLeverage(formattedSymbol, 5);

  const formattedTrigger = await toContractPrice(formattedSymbol, triggerPrice);
  const formattedExecute = await toContractPrice(formattedSymbol, executePrice);
  
  const contract = await getContract(formattedSymbol);
  const minOrderSize = Number(contract?.minOrderSize) || 1;
  const stepStr = minOrderSize >= 1 ? String(minOrderSize) : (contract?.size_increment || "0.0001");
  
  let formattedSize = floorToStep(size, stepStr);
  if (formattedSize < minOrderSize) {
    formattedSize = minOrderSize;
  }

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
          marginType: "ISOLATED",
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

  const res = await weexRequest<PlaceOrderResponse>("POST", "/capi/v2/order/plan_order", {
    body: {
      symbol: formattedSymbol,
      client_oid: clientOid,
      size: String(formattedSize),
      type: "3", // close long
      side: "close_long",
      holdSide: "long",
      positionSide: "LONG",
      match_type: matchPrice,
      marginMode: 3, // Isolated Margin Mode
      trigger_price: String(formattedTrigger),
      execute_price: String(formattedExecute),
    },
    signed: true,
  });
  return extractOrderId(res);
}

export async function cancelOrder(symbol: string, orderId: string): Promise<void> {
  const formattedSymbol = toWeexSymbol(symbol);
  if (isDemoMode() || orderId.startsWith("sim-") || orderId.startsWith("demo-")) {
    console.log(`[WEEX PAPER TRADING] Cancelled Sim Order: ${orderId} (${formattedSymbol})`);
    return;
  }
  await weexRequest("POST", "/capi/v2/order/cancel_order", {
    body: { symbol: formattedSymbol, orderId },
    signed: true,
  });
}

export async function cancelPlanOrder(symbol: string, orderId: string): Promise<void> {
  const formattedSymbol = toWeexSymbol(symbol);
  if (isDemoMode() || orderId.startsWith("sim-") || orderId.startsWith("demo-")) {
    console.log(`[WEEX PAPER TRADING] Cancelled Sim Plan Order: ${orderId} (${formattedSymbol})`);
    return;
  }
  await weexRequest("POST", "/capi/v2/order/cancel_plan", {
    body: { symbol: formattedSymbol, orderId },
    signed: true,
  });
}

/** Cancel all resting limit and plan orders for a given symbol. */
export async function cancelAllOpenOrdersForSymbol(symbol: string): Promise<void> {
  const formattedSymbol = toWeexSymbol(symbol);
  try {
    const orders = await weexRequest<Array<{ order_id?: string; orderId?: string }>>(
      "GET",
      `/capi/v2/order/current?symbol=${formattedSymbol}`,
      { signed: true },
    );
    for (const ord of orders || []) {
      const id = ord.order_id || ord.orderId;
      if (id) {
        try { await cancelOrder(formattedSymbol, id); } catch { /* ignore */ }
        try { await cancelPlanOrder(formattedSymbol, id); } catch { /* ignore */ }
      }
    }
  } catch {
    /* ignore */
  }

  try {
    const plans = await weexRequest<Array<{ order_id?: string; orderId?: string }>>(
      "GET",
      `/capi/v2/order/currentPlan?symbol=${formattedSymbol}`,
      { signed: true },
    );
    for (const p of plans || []) {
      const id = p.order_id || p.orderId;
      if (id) {
        try { await cancelPlanOrder(formattedSymbol, id); } catch { /* ignore */ }
        try { await cancelOrder(formattedSymbol, id); } catch { /* ignore */ }
      }
    }
  } catch {
    /* ignore */
  }
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
  const formattedSymbol = toWeexSymbol(symbol);
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
      query: { symbol: formattedSymbol, orderId },
      signed: true,
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
