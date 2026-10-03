"use client";
import { useMemo, useRef, useState } from "react";
import type { PricePoint } from "@/lib/program";
import { INTERVALS, autoInterval, toCandles } from "@/lib/candles";
import { ago, capLabel, usdLabel } from "@/lib/format";
import { useSolUsd, useUnit } from "@/lib/useUnit";
import UnitToggle from "@/components/UnitToggle";

const W = 640;
const H = 280;
const PAD = { l: 56, r: 14, t: 12, b: 26 };
const MAX_CANDLES = 60;

type Mode = "candles" | "line";

/** Market cap over time. Candles (pick the candle size) or a line through every trade. Pure SVG, no chart library. */
export default function PriceChart({ points, live, note }: { points: PricePoint[]; live: number | null; note?: string }) {
  const [mode, setMode] = useState<Mode>("candles");
  const [pick, setPick] = useState<number | null>(null); // null = choose automatically
  const [probe, setProbe] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const [unit] = useUnit();
  const solUsd = useSolUsd();
  const inUsd = unit === "USD" && solUsd !== null;
  const conv = (v: number) => (inUsd ? v * solUsd! : v);
  const label = (v: number) => (inUsd ? usdLabel(v) : capLabel(v));

  const now = Math.floor(Date.now() / 1000);
  const all = useMemo(() => {
    const a = [...points];
    if (live !== null && live > 0) a.push({ t: now, cap: live });
    return a;
  }, [points, live, now]);

  const span = all.length ? now - all[0].t : 0;
  const interval = pick ?? autoInterval(span, MAX_CANDLES);
  const candles = useMemo(() => toCandles(all, interval).slice(-MAX_CANDLES), [all, interval]);

  if (all.length === 0) return <p className="notice">No trades yet. The chart starts with the first trade.</p>;

  // what is drawn: candles or the raw trade line, both in the chosen unit
  const lineSeries = all;
  const t0 = mode === "candles" ? candles[0].t : lineSeries[0].t;
  const t1 = mode === "candles" ? candles[candles.length - 1].t + interval : Math.max(now, lineSeries[0].t + 1);
  const values = mode === "candles" ? candles.flatMap((c) => [c.h, c.l]) : lineSeries.map((p) => p.cap);
  let lo = conv(Math.min(...values));
  let hi = conv(Math.max(...values));
  if (hi - lo < hi * 0.02) {
    lo = hi * 0.9;
    hi = hi * 1.1;
  }
  const padY = (hi - lo) * 0.1;
  lo = Math.max(0, lo - padY);
  hi += padY;

  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const x = (t: number) => PAD.l + ((t - t0) / (t1 - t0)) * iw;
  const y = (v: number) => PAD.t + ih - ((v - lo) / (hi - lo)) * ih;

  const first = mode === "candles" ? candles[0].o : lineSeries[0].cap;
  const lastCap = mode === "candles" ? candles[candles.length - 1].c : lineSeries[lineSeries.length - 1].cap;
  const up = lastCap >= first;
  const colour = up ? "var(--buy)" : "var(--sell)";

  const count = mode === "candles" ? candles.length : lineSeries.length;
  const sel = probe !== null ? Math.min(probe, count - 1) : null;
  const shownCap = sel !== null ? (mode === "candles" ? candles[sel].c : lineSeries[sel].cap) : lastCap;
  const shownTime = sel !== null ? (mode === "candles" ? candles[sel].t : lineSeries[sel].t) : null;
  const change = first > 0 ? ((shownCap - first) / first) * 100 : 0;
  const hov = sel !== null && mode === "candles" ? candles[sel] : null;

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < count; i++) {
      const t = mode === "candles" ? candles[i].t + interval / 2 : lineSeries[i].t;
      const d = Math.abs(x(t) - px);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    setProbe(best);
  }

  const lineD = lineSeries.map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.t).toFixed(1)} ${y(conv(p.cap)).toFixed(1)}`).join(" ");
  const slot = (iw * interval) / (t1 - t0);
  const bodyW = Math.max(2, Math.min(16, slot * 0.7));

  return (
    <figure className="pchart">
      <div className="pchart-top">
        <div className="melt-read" aria-live="polite">
          <span className="melt-read-main" style={{ color: colour }}>
            {label(conv(hov ? hov.c : shownCap))}
            {inUsd ? "" : " SOL"}
          </span>
          <span className="melt-read-sub">
            market cap · {change >= 0 ? "+" : ""}
            {change.toFixed(Math.abs(change) < 10 ? 1 : 0)}%{shownTime !== null && shownTime < now - 5 ? ` · ${ago(shownTime)}` : ""}
          </span>
          {hov && (
            <span className="melt-read-sub ohlc">
              O {label(conv(hov.o))} · H {label(conv(hov.h))} · L {label(conv(hov.l))} · C {label(conv(hov.c))}
            </span>
          )}
        </div>
        <UnitToggle />
      </div>
      <div className="pchart-bar">
        <div className="seg" role="group" aria-label="Chart style">
          <button type="button" className={mode === "candles" ? "seg-on" : ""} onClick={() => setMode("candles")}>
            Candles
          </button>
          <button type="button" className={mode === "line" ? "seg-on" : ""} onClick={() => setMode("line")}>
            Line
          </button>
        </div>
        {mode === "candles" && (
          <div className="seg" role="group" aria-label="Candle size">
            {INTERVALS.map((i) => (
              <button key={i.secs} type="button" className={interval === i.secs ? "seg-on" : ""} onClick={() => setPick(i.secs)}>
                {i.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        className="melt-svg melt-scrub"
        role="img"
        aria-label={`Market cap went from ${label(conv(first))} to ${label(conv(lastCap))}`}
        onPointerMove={onMove}
        onPointerLeave={() => setProbe(null)}
      >
        <defs>
          <linearGradient id="pcFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={colour} stopOpacity="0.25" />
            <stop offset="1" stopColor={colour} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((f) => {
          const v = lo + (hi - lo) * f;
          return (
            <g key={f}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className="melt-grid" />
              <text x={PAD.l - 8} y={y(v) + 4} textAnchor="end" className="melt-tick">
                {label(v)}
              </text>
            </g>
          );
        })}
        {mode === "candles" ? (
          candles.map((c, i) => {
            const cx = x(c.t + interval / 2);
            const upC = c.c >= c.o;
            const col = upC ? "var(--buy)" : "var(--sell)";
            const top = y(conv(Math.max(c.o, c.c)));
            const bottom = y(conv(Math.min(c.o, c.c)));
            return (
              <g key={c.t} opacity={sel !== null && sel !== i ? 0.55 : 1}>
                <line x1={cx} x2={cx} y1={y(conv(c.h))} y2={y(conv(c.l))} stroke={col} strokeWidth={1.5} />
                <rect x={cx - bodyW / 2} y={top} width={bodyW} height={Math.max(1.5, bottom - top)} fill={col} rx={1} />
              </g>
            );
          })
        ) : (
          <>
            {lineSeries.length > 1 && <path d={`${lineD} L ${x(lineSeries[lineSeries.length - 1].t)} ${y(lo)} L ${x(t0)} ${y(lo)} Z`} fill="url(#pcFill)" />}
            {lineSeries.length > 1 ? (
              <path d={lineD} fill="none" stroke={colour} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
            ) : (
              <circle cx={x(lineSeries[0].t)} cy={y(conv(lineSeries[0].cap))} r={5} fill={colour} />
            )}
            {lineSeries.length <= 60 &&
              lineSeries.map((p, i) => (p.isBuy === undefined ? null : <circle key={i} cx={x(p.t)} cy={y(conv(p.cap))} r={3} fill={p.isBuy ? "var(--buy)" : "var(--sell)"} />))}
            {sel !== null && (
              <g>
                <line x1={x(lineSeries[sel].t)} x2={x(lineSeries[sel].t)} y1={PAD.t} y2={y(lo)} className="melt-probe" />
                <circle cx={x(lineSeries[sel].t)} cy={y(conv(lineSeries[sel].cap))} r={5} fill={colour} stroke="var(--card)" strokeWidth={2} />
              </g>
            )}
          </>
        )}
        <text x={PAD.l} y={H - 7} className="melt-tick" textAnchor="start">
          {ago(t0)}
        </text>
        <text x={W - PAD.r} y={H - 7} className="melt-tick" textAnchor="end">
          now
        </text>
      </svg>
      {points.length === 0 && <figcaption className="melt-cap">Trade history is not available yet. The chart fills in as trades happen.</figcaption>}
      {inUsd && process.env.NEXT_PUBLIC_CLUSTER_LABEL !== "mainnet" && (
        <figcaption className="melt-cap">Dollar values use the real SOL price. Test SOL on this network is worth nothing.</figcaption>
      )}
      {note && <figcaption className="melt-cap">{note}</figcaption>}
    </figure>
  );
}
