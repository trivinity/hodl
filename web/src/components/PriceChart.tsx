"use client";
import { useMemo, useRef, useState } from "react";
import type { PricePoint } from "@/lib/program";
import { ago, capLabel } from "@/lib/format";

const W = 640;
const H = 260;
const PAD = { l: 52, r: 14, t: 16, b: 28 };
const RANGES = [
  { id: "1h", label: "1h", secs: 3600 },
  { id: "24h", label: "24h", secs: 86400 },
  { id: "all", label: "All", secs: 0 },
] as const;

/** Market cap over time: one point per trade, plus a live "now" point. Pure SVG, no chart library. */
export default function PriceChart({ points, live, note }: { points: PricePoint[]; live: number | null; note?: string }) {
  const [range, setRange] = useState<(typeof RANGES)[number]["id"]>("all");
  const [probe, setProbe] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);

  const now = Math.floor(Date.now() / 1000);
  const series = useMemo(() => {
    const all = [...points];
    if (live !== null && live > 0) all.push({ t: now, cap: live });
    const secs = RANGES.find((r) => r.id === range)!.secs;
    if (secs === 0 || all.length === 0) return all;
    const from = now - secs;
    const inside = all.filter((p) => p.t >= from);
    const before = all.filter((p) => p.t < from);
    // carry the price that was valid when the window opened, so the line starts at the left edge
    if (before.length) inside.unshift({ t: from, cap: before[before.length - 1].cap });
    return inside;
  }, [points, live, range, now]);

  if (series.length === 0) {
    return <p className="notice">No trades yet. The chart starts with the first trade.</p>;
  }

  const t0 = series[0].t;
  const t1 = Math.max(series[series.length - 1].t, t0 + 1);
  const caps = series.map((p) => p.cap);
  let lo = Math.min(...caps);
  let hi = Math.max(...caps);
  if (hi - lo < hi * 0.02) {
    lo = hi * 0.9;
    hi = hi * 1.1;
  }
  const padY = (hi - lo) * 0.12;
  lo = Math.max(0, lo - padY);
  hi += padY;

  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const x = (t: number) => PAD.l + ((t - t0) / (t1 - t0)) * iw;
  const y = (v: number) => PAD.t + ih - ((v - lo) / (hi - lo)) * ih;

  const line = series.map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.t).toFixed(1)} ${y(p.cap).toFixed(1)}`).join(" ");
  const area = `${line} L ${x(series[series.length - 1].t)} ${y(lo)} L ${x(t0)} ${y(lo)} Z`;

  const first = series[0].cap;
  const last = series[series.length - 1].cap;
  const up = last >= first;
  const colour = up ? "var(--buy)" : "var(--sell)";
  const shown = probe !== null ? series[probe] : series[series.length - 1];
  const change = first > 0 ? ((shown.cap - first) / first) * 100 : 0;

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    let bestD = Infinity;
    series.forEach((p, i) => {
      const d = Math.abs(x(p.t) - px);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    setProbe(best);
  }

  return (
    <figure className="pchart">
      <div className="pchart-top">
        <div className="melt-read" aria-live="polite">
          <span className="melt-read-main" style={{ color: colour }}>
            {capLabel(shown.cap)} SOL
          </span>
          <span className="melt-read-sub">
            market cap · {change >= 0 ? "+" : ""}
            {change.toFixed(Math.abs(change) < 10 ? 1 : 0)}%{probe !== null && shown.t < now - 5 ? ` · ${ago(shown.t)}` : ""}
          </span>
        </div>
        <div className="seg" role="group" aria-label="Chart range">
          {RANGES.map((r) => (
            <button key={r.id} type="button" className={range === r.id ? "seg-on" : ""} onClick={() => setRange(r.id)}>
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        className="melt-svg melt-scrub"
        role="img"
        aria-label={`Market cap went from ${capLabel(first)} to ${capLabel(last)} SOL`}
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
                {capLabel(v)}
              </text>
            </g>
          );
        })}
        {series.length > 1 && <path d={area} fill="url(#pcFill)" />}
        <path d={line} fill="none" stroke={colour} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
        {series.length <= 60 &&
          series.map((p, i) =>
            p.isBuy === undefined ? null : <circle key={i} cx={x(p.t)} cy={y(p.cap)} r={3} fill={p.isBuy ? "var(--buy)" : "var(--sell)"} />
          )}
        <text x={PAD.l} y={H - 8} className="melt-tick" textAnchor="start">
          {ago(t0)}
        </text>
        <text x={W - PAD.r} y={H - 8} className="melt-tick" textAnchor="end">
          now
        </text>
        {probe !== null && (
          <g>
            <line x1={x(shown.t)} x2={x(shown.t)} y1={PAD.t} y2={y(lo)} className="melt-probe" />
            <circle cx={x(shown.t)} cy={y(shown.cap)} r={5} fill={colour} stroke="var(--card)" strokeWidth={2} />
          </g>
        )}
      </svg>
      {note && <figcaption className="melt-cap">{note}</figcaption>}
    </figure>
  );
}
