"use client";
import { useState } from "react";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { CLUSTER_LABEL, CurveView, walletProgram } from "@/lib/program";
import { GradStep, nextStep, runGraduation } from "@/lib/graduation";
import { friendlyError } from "@/lib/errors";
import { short } from "@/lib/format";

const LABEL: Record<GradStep, string> = {
  prepare: "Switching off the transfer lock and setting the funds aside…",
  pool: "Creating the trading pool…",
  lock: "Locking the liquidity for good…",
};

const explorer = (addr: string) => `https://solscan.io/account/${addr}${CLUSTER_LABEL === "mainnet" ? "" : `?cluster=${CLUSTER_LABEL === "localnet" ? "custom&customUrl=http%3A%2F%2F127.0.0.1%3A8899" : CLUSTER_LABEL}`}`;

/** shown instead of the buy/sell box once a token is full: graduate it into a trading pool, or see where it trades now */
export default function GraduatePanel({ curve, onDone }: { curve: CurveView; onDone: () => void }) {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (curve.graduatedStage >= 3) {
    return (
      <section className="trade" aria-label="Graduated">
        <h2 className="h2" style={{ marginTop: 0 }}>
          Graduated
        </h2>
        <p>
          This token now trades on a Meteora pool. The tax and sell limits on the curve have ended, and the tokens can move freely. The pool’s liquidity is locked for good.
        </p>
        <a className="btn btn-block" href={explorer(curve.pool.toBase58())} target="_blank" rel="noopener noreferrer">
          View the pool ({short(curve.pool.toBase58())})
        </a>
        <p className="muted" style={{ marginTop: 14 }}>
          Rewards you earned on the curve are still yours: claim them on your Earnings page.
        </p>
      </section>
    );
  }

  const step = nextStep(curve.graduatedStage);
  const started = curve.graduatedStage > 0;

  async function go() {
    if (!wallet) return;
    setBusy(true);
    setError(null);
    try {
      await runGraduation(walletProgram(connection, wallet as any), curve.mint, (s, done, total) =>
        setProgress(done >= total ? "Done." : `Step ${done + 1} of ${total}: ${LABEL[s]}`)
      );
      onDone();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="trade" aria-label="Graduate this token">
      <h2 className="h2" style={{ marginTop: 0 }}>
        {started ? "Graduation in progress" : "This token is full"}
      </h2>
      <p>
        {started
          ? "Part of the graduation has run. Anyone can finish it."
          : "The curve has sold all it can. Anyone can now graduate it: the SOL raised and the leftover tokens become a trading pool on Meteora, and the liquidity is locked for good."}
      </p>
      <ul className="muted" style={{ paddingLeft: 18, margin: "10px 0 16px" }}>
        <li>The transfer lock switches off, so tokens can move freely.</li>
        <li>About 0.05 SOL of the SOL raised pays for the pool’s setup. You pay only network fees and about 0.005 SOL for two token accounts.</li>
        <li>Pool trading fees start at 30% and fade to about 1% over a week. They go to the platform treasury.</li>
      </ul>
      <button className="btn btn-primary btn-block" disabled={!wallet || busy || !step} onClick={go}>
        {!wallet ? "Connect a wallet to graduate" : busy ? "Working…" : started ? "Finish graduation" : "Graduate this token"}
      </button>
      {progress && <p className="notice">{progress}</p>}
      {error && <p className="notice notice-bad">{error}</p>}
    </section>
  );
}
