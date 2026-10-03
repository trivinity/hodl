// Numbers for the stats bar (price change, volume, buyers) computed from a token's trades. Pure, so it can be tested.
export type TradePoint = { t: number; cap: number; isBuy?: boolean; sol?: number; trader?: string };
export type WindowStats = { change: number | null; volume: number; buys: number; sells: number; buyers: number; sellers: number };

/** `live` is the market cap right now; trades are oldest first */
export function windowStats(points: TradePoint[], windowSecs: number, now: number, live: number | null): WindowStats {
  const from = now - windowSecs;
  const inside = points.filter((p) => p.t >= from && p.isBuy !== undefined);
  const before = points.filter((p) => p.t < from);
  // the price at the start of the window: the last trade before it, or the first trade if the token is younger
  const start = before.length ? before[before.length - 1].cap : points.length ? points[0].cap : null;
  const end = live ?? (points.length ? points[points.length - 1].cap : null);
  const change = start && end && start > 0 ? ((end - start) / start) * 100 : null;
  const buyers = new Set<string>();
  const sellers = new Set<string>();
  let volume = 0;
  let buys = 0;
  let sells = 0;
  for (const p of inside) {
    volume += p.sol ?? 0;
    if (p.isBuy) {
      buys++;
      if (p.trader) buyers.add(p.trader);
    } else {
      sells++;
      if (p.trader) sellers.add(p.trader);
    }
  }
  return { change, volume, buys, sells, buyers: buyers.size, sellers: sellers.size };
}

export function allTimeHigh(points: TradePoint[], live: number | null): number | null {
  const caps = points.map((p) => p.cap);
  if (live !== null && live > 0) caps.push(live);
  return caps.length ? Math.max(...caps) : null;
}
