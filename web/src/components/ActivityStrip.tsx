import Link from "next/link";
import { ActivityItem, CurveView } from "@/lib/program";
import { ago, short, sol } from "@/lib/format";

const VERB = { buy: "bought", sell: "sold", launch: "launched", claim: "claimed" } as const;

/** a row of the latest happenings across all tokens */
export default function ActivityStrip({ items, curves }: { items: ActivityItem[] | null; curves: CurveView[] | null }) {
  const symbolOf = new Map((curves ?? []).map((c) => [c.mint.toBase58(), c.symbol]));
  if (items === null) return null;
  if (items.length === 0) return null;
  return (
    <section className="activity" aria-label="Latest activity">
      <h2 className="activity-h">Live activity</h2>
      <ul className="activity-row">
        {items.map((a, i) => (
          <li key={a.sig + i}>
            <Link href={`/token/${a.mint}`} className={`act act-${a.kind}`}>
              <span className="act-who">{short(a.who)}</span> {VERB[a.kind]}
              {a.kind !== "launch" && a.sol > 0n ? ` ${sol(a.sol, 3)} SOL of` : ""} <strong>{symbolOf.get(a.mint) ?? short(a.mint)}</strong>
              <span className="muted"> · {ago(a.ts)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
