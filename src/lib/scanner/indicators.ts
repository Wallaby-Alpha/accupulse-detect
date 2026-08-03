import type { Kline } from "./mexc";

export const closes = (k: Kline[]) => k.map((c) => Number(c[4]));
export const highs = (k: Kline[]) => k.map((c) => Number(c[2]));
export const lows = (k: Kline[]) => k.map((c) => Number(c[3]));
export const volumes = (k: Kline[]) => k.map((c) => Number(c[5]));

export const clip = (v: number, lo: number, hi: number) =>
  Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;

export const mean = (v: number[]) =>
  v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;

export function ema(values: number[], span: number): number[] {
  const alpha = 2 / (span + 1);
  const out: number[] = [];
  let prev = values[0] ?? 0;
  for (let i = 0; i < values.length; i++) {
    prev = i === 0 ? values[0]! : values[i]! * alpha + prev * (1 - alpha);
    out.push(prev);
  }
  return out;
}

export function sma(values: number[], period: number, endIndex: number): number {
  const slice = values.slice(Math.max(0, endIndex - period + 1), endIndex + 1);
  return mean(slice);
}

export function stdev(values: number[], period: number, endIndex: number): number {
  const slice = values.slice(Math.max(0, endIndex - period + 1), endIndex + 1);
  const m = mean(slice);
  return Math.sqrt(mean(slice.map((v) => (v - m) ** 2)));
}

export function last<T>(arr: T[]): T {
  return arr[arr.length - 1]!;
}

/** True range series. */
export function trueRange(k: Kline[]): number[] {
  const h = highs(k);
  const l = lows(k);
  const c = closes(k);
  return k.map((_, i) => {
    if (i === 0) return h[i]! - l[i]!;
    return Math.max(
      h[i]! - l[i]!,
      Math.abs(h[i]! - c[i - 1]!),
      Math.abs(l[i]! - c[i - 1]!),
    );
  });
}

export function rollingMean(values: number[], period: number): number[] {
  return values.map((_, i) =>
    i + 1 < period ? NaN : mean(values.slice(i - period + 1, i + 1)),
  );
}
