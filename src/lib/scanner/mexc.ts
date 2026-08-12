const BASE = "https://api.mexc.com/api/v3";

export type Kline = [
  number, // open time
  string, // open
  string, // high
  string, // low
  string, // close
  string, // volume (base)
  number, // close time
  string, // quote volume
];

export type Ticker = {
  symbol: string;
  lastPrice: string;
  bidPrice: string;
  askPrice: string;
  quoteVolume: string;
  priceChangePercent: string;
};

export type Depth = { bids: [string, string][]; asks: [string, string][] };

const EXCLUDE_QUOTE_SUFFIX = /(3L|3S|4L|4S|5L|5S)USDT$/;
const STABLES = new Set([
  "USDCUSDT",
  "FDUSDUSDT",
  "TUSDUSDT",
  "DAIUSDT",
  "BUSDUSDT",
  "USDEUSDT",
  "EURUSDT",
]);

async function getJson<T>(path: string, retries = 4): Promise<T> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(`${BASE}${path}`, {
        headers: { accept: "application/json" },
      });
      if (res.status === 429) {
        console.warn(`[MEXC 429] Rate limited on ${path}, retrying in ${1000 * 2 ** attempt}ms...`);
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        continue;
      }
      if (!res.ok) {
        if (attempt === retries - 1) {
          throw new Error(`MEXC ${path} failed [${res.status}]: ${await res.text()}`);
        }
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      return (await res.json()) as T;
    } catch (err) {
      if (attempt === retries - 1) throw err;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
  throw new Error(`MEXC ${path} failed after ${retries} attempts`);
}

export async function fetchTickers(): Promise<Ticker[]> {
  return getJson<Ticker[]>("/ticker/24hr");
}

export async function fetchKlines(
  symbol: string,
  interval: string,
  limit: number,
): Promise<Kline[]> {
  return getJson<Kline[]>(
    `/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
  );
}

export async function fetchDepth(symbol: string, limit = 20): Promise<Depth> {
  return getJson<Depth>(`/depth?symbol=${symbol}&limit=${limit}`);
}

/** Liquid USDT spot altcoins, ranked by 24h quote volume. */
export function buildUniverse(tickers: Ticker[], size: number): Ticker[] {
  return tickers
    .filter((t) => t.symbol.endsWith("USDT"))
    .filter((t) => !EXCLUDE_QUOTE_SUFFIX.test(t.symbol))
    .filter((t) => !STABLES.has(t.symbol))
    .filter((t) => t.symbol !== "BTCUSDT")
    .filter((t) => Number(t.quoteVolume) > 0 && Number(t.lastPrice) > 0)
    .sort((a, b) => Number(b.quoteVolume) - Number(a.quoteVolume))
    .slice(0, size);
}

/** Runs tasks with bounded concurrency to stay inside MEXC rate limits. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<(R | null)[]> {
  const results: (R | null)[] = new Array(items.length).fill(null);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = await fn(items[index]!);
      } catch {
        results[index] = null;
      }
    }
  });
  await Promise.all(workers);
  return results;
}
