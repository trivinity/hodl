// Turns trade prices into candlesticks. Pure, so it can be tested without a browser.
export type Point = { t: number; cap: number };
export type Candle = { t: number; o: number; h: number; l: number; c: number };

/** Each candle covers `interval` seconds. A candle opens where the last one closed, so there are no gaps in the price. */
export function toCandles(points: Point[], interval: number): Candle[] {
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const out: Candle[] = [];
  let prevClose: number | null = null;
  for (const p of sorted) {
    const bucket = Math.floor(p.t / interval) * interval;
    const last = out[out.length - 1];
    if (last && last.t === bucket) {
      last.h = Math.max(last.h, p.cap);
      last.l = Math.min(last.l, p.cap);
      last.c = p.cap;
    } else {
      const o: number = prevClose ?? p.cap;
      out.push({ t: bucket, o, h: Math.max(o, p.cap), l: Math.min(o, p.cap), c: p.cap });
    }
    prevClose = p.cap;
  }
  return out;
}

export const INTERVALS = [
  { secs: 60, label: "1m" },
  { secs: 300, label: "5m" },
  { secs: 900, label: "15m" },
  { secs: 3600, label: "1h" },
  { secs: 86400, label: "1d" },
] as const;

/** the smallest candle size that fits the whole history in at most `max` candles */
export function autoInterval(spanSecs: number, max = 60): number {
  for (const i of INTERVALS) if (spanSecs / i.secs <= max) return i.secs;
  return INTERVALS[INTERVALS.length - 1].secs;
}
