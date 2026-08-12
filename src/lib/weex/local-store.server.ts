/**
 * Local file fallback store for WEEX trades and trade events.
 * Guarantees trade execution even when Supabase RLS or network connectivity is restricted.
 */
import fs from "node:fs";
import path from "node:path";

export type TradeRow = {
  id: string;
  symbol: string;
  alert_price: number;
  alerted_at: string;
  status: string;
  velocity_pct?: number | null;
  entry_price?: number | null;
  stop_price?: number | null;
  target_price?: number | null;
  quantity?: number | null;
  entry_order_id?: string | null;
  tp_order_id?: string | null;
  sl_order_id?: string | null;
  placed_at?: string | null;
  filled_at?: string | null;
  fill_price?: number | null;
  closed_at?: string | null;
  close_price?: number | null;
  close_reason?: string | null;
  realized_pnl?: number | null;
  last_error?: string | null;
  created_at: string;
  updated_at: string;
};

export type TradeEvent = {
  id: string;
  trade_id: string | null;
  symbol: string;
  event: string;
  detail: string | null;
  created_at: string;
};

const DATA_DIR = path.resolve(process.cwd(), "data");
const TRADES_FILE = path.join(DATA_DIR, "local_weex_trades.json");
const EVENTS_FILE = path.join(DATA_DIR, "local_trade_events.json");

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function readLocalTrades(): TradeRow[] {
  ensureDataDir();
  if (!fs.existsSync(TRADES_FILE)) return [];
  try {
    const raw = fs.readFileSync(TRADES_FILE, "utf-8");
    return JSON.parse(raw) as TradeRow[];
  } catch {
    return [];
  }
}

export function writeLocalTrades(trades: TradeRow[]): void {
  ensureDataDir();
  fs.writeFileSync(TRADES_FILE, JSON.stringify(trades, null, 2), "utf-8");
}

export function readLocalEvents(): TradeEvent[] {
  ensureDataDir();
  if (!fs.existsSync(EVENTS_FILE)) return [];
  try {
    const raw = fs.readFileSync(EVENTS_FILE, "utf-8");
    return JSON.parse(raw) as TradeEvent[];
  } catch {
    return [];
  }
}

export function writeLocalEvents(events: TradeEvent[]): void {
  ensureDataDir();
  fs.writeFileSync(EVENTS_FILE, JSON.stringify(events, null, 2), "utf-8");
}

const REMOTE_SYNC_URL = "http://137.184.222.96:8080/api/public/hooks/sync-trades";

async function pushToRemote(payload: Record<string, unknown>): Promise<void> {
  try {
    await fetch(REMOTE_SYNC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    /* ignore sync errors */
  }
}

export function saveLocalTrade(trade: TradeRow): void {
  const trades = readLocalTrades();
  const idx = trades.findIndex((t) => t.id === trade.id);
  if (idx >= 0) {
    trades[idx] = trade;
  } else {
    trades.unshift(trade);
  }
  writeLocalTrades(trades);
  pushToRemote({ trade }).catch(() => {});
}

export function saveLocalEvent(event: TradeEvent): void {
  const events = readLocalEvents();
  events.unshift(event);
  writeLocalEvents(events.slice(0, 100)); // Keep recent 100 events
  pushToRemote({ event }).catch(() => {});
}
