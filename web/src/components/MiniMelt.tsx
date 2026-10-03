import { decayTaxBps } from "@/lib/curve";

/** a tiny drawing of one token's sell tax: starts high, melts to zero, stays at zero */
export default function MiniMelt({ maxBps, decaySecs }: { maxBps: number; decaySecs: number }) {
  const W = 120;
  const H = 34;
  const xEnd = W * 0.72; // the fade takes 72% of the width, the rest is the zero part
  const top = 4;
  const bottom = H - 4;
  const y = (bps: number) => bottom - (bps / Math.max(maxBps, 1)) * (bottom - top);
  const line = `M 2 ${y(maxBps)} L ${xEnd} ${y(0)} L ${W - 2} ${y(0)}`;
  void decayTaxBps; // (kept for symmetry with the big chart; the shape only depends on max and fade)
  return (
    <svg className="mini" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Sell tax starts at ${maxBps / 100} percent and fades to zero over ${Math.round(decaySecs / 3600)} hours`} preserveAspectRatio="none">
      <path d={`${line} L ${W - 2} ${bottom} L 2 ${bottom} Z`} className="mini-fill" />
      <path d={line} className="mini-line" />
    </svg>
  );
}
