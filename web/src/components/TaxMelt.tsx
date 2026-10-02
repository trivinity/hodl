"use client";
import { useMemo, useRef, useState } from "react";
import { decayTaxBps } from "@/lib/curve";
import { duration } from "@/lib/format";

type Props = {
  maxBps: number;
  decaySecs: number;
  /** marks where the viewer is on the curve */
  heldSecs?: number;
  /** let people drag across the curve to read it */
  scrub?: boolean;
  caption?: string;
};

const W = 640;
const H = 300;
const PAD = { l: 44, r: 16, t: 20, b: 36 };

export default function TaxMelt({ maxBps, decaySecs, heldSecs, scrub = false, caption }: Props) {
  const ref = useRef<SVGSVGElement>(null);
  const [probe, setProbe] = useState<number | null>(null);
  const xMax = decaySecs * 1.25;
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const x = (s: number) => PAD.l + (Math.min(s, xMax) / xMax) * iw;
  const y = (bps: number) => PAD.t + ih - (bps / Math.max(maxBps, 1)) * ih;

  const line = useMemo(
    () => `M ${x(0)} ${y(maxBps)} L ${x(decaySecs)} ${y(0)} L ${x(xMax)} ${y(0)}`,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [maxBps, decaySecs]
  );
  const area = `${line} L ${x(xMax)} ${y(0)} L ${x(0)} ${y(0)} Z`;

  const at = probe ?? heldSecs ?? null;
  const taxAt = at === null ? null : decayTaxBps(at, decaySecs, maxBps);

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!scrub || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const frac = (px - PAD.l) / iw;
    setProbe(Math.max(0, Math.min(1, frac)) * xMax);
  }

  return (
    <figure className="melt">
      <div className="melt-read" aria-live="polite">
        {at !== null && taxAt !== null ? (
          <>
            <span className="melt-read-main">{(taxAt / 100).toFixed(taxAt % 100 === 0 ? 0 : 1)}% tax</span>
            <span className="melt-read-sub">
              {probe !== null ? "if you sell after " : "you have held "}
              {duration(at)}
            </span>
          </>
        ) : (
          <>
            <span className="melt-read-main">{(maxBps / 100).toFixed(0)}% to 0%</span>
            <span className="melt-read-sub">over {duration(decaySecs)} of holding</span>
          </>
        )}
      </div>
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Sell tax falls from ${maxBps / 100} percent to zero over ${duration(decaySecs)}`}
        onPointerMove={onMove}
        onPointerLeave={() => setProbe(null)}
        className={scrub ? "melt-svg melt-scrub" : "melt-svg"}
      >
        <defs>
          <linearGradient id="meltFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--sell)" stopOpacity="0.28" />
            <stop offset="1" stopColor="var(--sell)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(maxBps * f)} y2={y(maxBps * f)} className="melt-grid" />
            <text x={PAD.l - 8} y={y(maxBps * f) + 4} textAnchor="end" className="melt-tick">
              {Math.round((maxBps * f) / 100)}%
            </text>
          </g>
        ))}
        <path d={area} fill="url(#meltFill)" />
        <path d={line} pathLength={1} className="melt-line" />
        <text x={x(0)} y={H - 10} className="melt-tick" textAnchor="start">
          buy
        </text>
        <text x={x(decaySecs)} y={H - 10} className="melt-tick" textAnchor="middle">
          {duration(decaySecs)}
        </text>
        {at !== null && taxAt !== null && (
          <g>
            <line x1={x(at)} x2={x(at)} y1={PAD.t} y2={y(0)} className="melt-probe" />
            <circle cx={x(at)} cy={y(taxAt)} r={6} className="melt-dot" />
          </g>
        )}
      </svg>
      {caption && <figcaption className="melt-cap">{caption}</figcaption>}
    </figure>
  );
}
