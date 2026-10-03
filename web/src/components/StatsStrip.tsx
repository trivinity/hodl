import { CurveView } from "@/lib/program";
import { sol } from "@/lib/format";

/** three live numbers, all read from the chain */
export default function StatsStrip({ curves }: { curves: CurveView[] | null }) {
  const n = curves?.length ?? 0;
  const inPools = (curves ?? []).reduce((a, c) => a + c.realSol, 0n);
  const waiting = (curves ?? []).reduce((a, c) => a + c.rewardPool, 0n);
  const items: [string, string][] = [
    ["Tokens launched", curves ? String(n) : "…"],
    ["SOL in pools", curves ? sol(inPools, 2) : "…"],
    ["Rewards waiting for holders", curves ? `${sol(waiting, 3)} SOL` : "…"],
  ];
  return (
    <dl className="strip" aria-label="Live numbers">
      {items.map(([label, value]) => (
        <div key={label}>
          <dd>{value}</dd>
          <dt>{label}</dt>
        </div>
      ))}
    </dl>
  );
}
