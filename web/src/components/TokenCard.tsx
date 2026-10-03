import Link from "next/link";
import Avatar from "@/components/Avatar";
import MiniMelt from "@/components/MiniMelt";
import { CurveView } from "@/lib/program";
import { marketCapSol, priceSol, progress } from "@/lib/curve";
import { compact, duration, price, sol } from "@/lib/format";

const pct = (bps: number) => (bps / 100).toFixed(bps % 100 === 0 ? 0 : 1);

export default function TokenCard({ c }: { c: CurveView }) {
  const p = progress(c.realTokens);
  const waiting = c.rewardPool;
  return (
    <Link href={`/token/${c.mint.toBase58()}`} className="tcard">
      <div className="tcard-top">
        <Avatar id={c.mint.toBase58()} symbol={c.symbol} uri={c.uri} size={40} />
        <span className="tcard-name">
          <strong>{c.name}</strong>
          <span className="muted">{c.symbol}</span>
        </span>
        <span className="tcard-cap">
          <strong>{compact(marketCapSol(c.vs, c.vt), 1)} SOL</strong>
          <span className="muted">market cap</span>
        </span>
      </div>

      <div className="tcard-melt">
        <MiniMelt maxBps={c.maxTaxBps} decaySecs={c.decaySecs} />
        <span className="muted">
          {pct(c.maxTaxBps)}% tax, 0 after {duration(c.decaySecs)}
        </span>
      </div>

      <div className="chips">
        <span className="chip-info">{pct(c.rewardBps)}% of tax to holders</span>
        {c.holderFeeBps > 0 && <span className="chip-info">{pct(c.holderFeeBps)}% fee to holders</span>}
        {waiting > 0n && <span className="chip-info chip-hot">{sol(waiting, 3)} SOL waiting</span>}
      </div>

      <div className="tcard-foot">
        <span className="row-bar" aria-label={`${Math.round(p * 100)} percent sold`}>
          <span style={{ width: `${Math.max(2, p * 100)}%` }} />
        </span>
        <span className="muted">
          {Math.round(p * 100)}% sold · {price(priceSol(c.vs, c.vt))} each
        </span>
      </div>
    </Link>
  );
}
