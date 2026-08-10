/**
 * Signed WEEX contract REST client (demo / simulated trading).
 * Auth follows the WEEX capi scheme:
 *   ACCESS-SIGN = base64(hmacSHA256(timestamp + METHOD + requestPath + body, secret))
 */
import { WEEX_BASE_URL } from "./config";

export type WeexCredentials = {
  key: string;
  secret: string;
  passphrase: string;
};

export function getWeexCredentials(): WeexCredentials | null {
  const key = process.env["WEEX_API_KEY"];
  const secret = process.env["WEEX_API_SECRET"];
  const passphrase = process.env["WEEX_API_PASSPHRASE"];
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

  if (options.signed !== false) {
    const creds = getWeexCredentials();
    if (!creds) throw new WeexError("WEEX API credentials are not configured", 0);
    const timestamp = Date.now().toString();
    headers["ACCESS-KEY"] = creds.key;
    headers["ACCESS-SIGN"] = await sign(
      `${timestamp}${method}${requestPath}${bodyText}`,
      creds.secret,
    );
    headers["ACCESS-TIMESTAMP"] = timestamp;
    headers["ACCESS-PASSPHRASE"] = creds.passphrase;
    // Demo / simulated trading flags.
    headers["X-SIMULATED-TRADING"] = "1";
    headers["paptrading"] = "1";
  }

  const res = await fetch(`${WEEX_BASE_URL}${requestPath}`, {
    method,
    headers,
    ...(bodyText ? { body: bodyText } : {}),
  });

  const text = await res.text();
  if (!res.ok) {
    console.error(`WEEX ${method} ${requestPath} failed [${res.status}]: ${text}`);
    throw new WeexError(`WEEX ${res.status}: ${text}`, res.status);
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
    throw new WeexError(`WEEX error ${envelope.code}: ${envelope.msg ?? text}`, res.status);
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
};

let contractCache: { at: number; map: Map<string, Contract> } | null = null;

export async function getContract(symbol: string): Promise<Contract | null> {
  if (!contractCache || Date.now() - contractCache.at > 60 * 60_000) {
    const list = await weexRequest<Contract[]>("GET", "/capi/v2/market/contracts", {
      signed: false,
    });
    contractCache = { at: Date.now(), map: new Map(list.map((c) => [c.symbol, c])) };
  }
  return contractCache.map.get(symbol) ?? null;
}

function roundTo(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.floor(value * f) / f;
}

/** Convert a coin quantity into exchange contract size, respecting increments. */
export async function toContractSize(
  symbol: string,
  coinQuantity: number,
): Promise<number> {
  const contract = await getContract(symbol);
  if (!contract) return roundTo(coinQuantity, 4);
  const contractVal = Number(contract.contract_val) || 1;
  const decimals = Number(contract.size_increment) || 0;
  return Math.max(roundTo(coinQuantity / contractVal, decimals), 1 / 10 ** decimals);
}

/* --------------------------------- orders --------------------------------- */

type PlaceOrderResponse = { order_id?: string; orderId?: string; data?: { orderId?: string } };

function extractOrderId(res: PlaceOrderResponse): string | null {
  return res.order_id ?? res.orderId ?? res.data?.orderId ?? null;
}

/** Limit buy to open a long position. */
export async function placeLimitBuy(
  symbol: string,
  price: number,
  size: number,
  clientOid: string,
): Promise<string | null> {
  const res = await weexRequest<PlaceOrderResponse>("POST", "/capi/v2/order/placeOrder", {
    body: {
      symbol,
      client_oid: clientOid,
      size: String(size),
      type: "1", // open long
      order_type: "0", // normal
      match_price: "0", // limit
      price: String(price),
ようこそ: undefined,
    },
  });
  return extractOrderId(res);
}

/** Market close of an open long position. */
export async function marketCloseLong(
  symbol: string,
  size: number,
  clientOid: string,
): Promise<string | null> {
  const res = await weexRequest<PlaceOrderResponse>("POST", "/capi/v2/order/placeOrder", {
    body: {
      symbol,
      client_oid: clientOid,
      size: String(size),
      type: "3", // close long
      order_type: "0",
      match_price: "1", // market
      price: "0",
    },
  });
  return extractOrderId(res);
}

/** Trigger (plan) order used for the OCO bracket legs. */
export async function placePlanOrder(
  symbol: string,
  triggerPrice: number,
  executePrice: number,
  size: number,
  clientOid: string,
  matchPrice: "0" | "1",
): Promise<string | null> {
  const res = await weexRequest<PlaceOrderResponse>("POST", "/capi/v2/order/plan_order", {
    body: {
      symbol,
      client_oid: clientOid,
      size: String(size),
      type: "3", // close long
      match_type: matchPrice,
      trigger_price: String(triggerPrice),
      execute_price: String(executePrice),
    },
  });
  return extractOrderId(res);
}

export async function cancelOrder(symbol: string, orderId: string): Promise<void> {
  await weexRequest("POST", "/capi/v2/order/cancel_order", {
    body: { symbol, orderId },
  });
}

export async function cancelPlanOrder(symbol: string, orderId: string): Promise<void> {
  await weexRequest("POST", "/capi/v2/order/cancel_plan", {
    body: { symbol, orderId },
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
