"use client";
import { useState } from "react";
import type { PricePoint } from "@/lib/program";
import { allTimeHigh, windowStats } from "@/lib/stats";
import { capIn } from "@/lib/format";
import { useSolUsd, useUnit } from "@/lib/useUnit";

const WINDOWS = [
  { id: "5m", secs: 300 },
  { id: "1h", secs: 3600 },
  { id: "24h", secs: 86400 },
] as const;

/** Price change, volume and who traded in the last 5 minutes, hour or day, plus the all time high. */
export default function StatsBar({ points, live }: { points: PricePoint[]; live: number | null }) {
  const [win, setWin] = useState<(typeof WINDOWS)[number]["id"]>("24h");
  const [unit] = useUnit();
  const solUsd = useSolUsd();
  const now = Math.floor(Date.now() / 1000);
  const s = windowStats(points, WINDOWS.find((w) => w.id === win)!.secs, now, live);
  const ath = allTimeHigh(points, live);
  const volume = unit === "USD" && solUsd ? `$${Math.round(s.volume * solUsd).toLocaleString("en-US")}` : `${s.volume.toLocaleString("en-US", { maximumFractionDigits: 2 })} SOL`;
  const change = s.change === null ? "–" : `${s.change >= 0 ? "+" : ""}${s.change.toFixed(Math.abs(s.change) < 10 ? 1 : 0)}%`;

  return (
    <section className="sbar" aria-label="Trading stats">
      <div className="sbar-head">
        <div className="seg" role="group" aria-label="Stats window">
          {WINDOWS.map((w) => (
            <button key={w.id} type="button" className={win === w.id ? "seg-on" : ""} onClick={() => setWin(w.id)}>
              {w.id}
            </button>
          ))}
        </div>
        {ath !== null && <span className="muted sbar-ath">All time high {capIn(ath, unit, solUsd)}</span>}
      </div>
      <dl className="sbar-grid">
        <div>
          <dt>Price change</dt>
          <dd className={s.change === null ? "" : s.change >= 0 ? "buy" : "sell"}>{change}</dd>
        </div>
        <div>
          <dt>Volume</dt>
          <dd>{volume}</dd>
        </div>
        <div>
          <dt>Buys / sells</dt>
          <dd>
            <span className="buy">{s.buys}</span> / <span className="sell">{s.sells}</span>
          </dd>
        </div>
        <div>
          <dt>Buyers / sellers</dt>
          <dd>
            <span className="buy">{s.buyers}</span> / <span className="sell">{s.sellers}</span>
          </dd>
        </div>
      </dl>
    </section>
  );
}
