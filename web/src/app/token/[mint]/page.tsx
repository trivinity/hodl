"use client";
import { use, useCallback, useEffect, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import Avatar from "@/components/Avatar";
import TaxMelt from "@/components/TaxMelt";
import TradePanel from "@/components/TradePanel";
import { useConfig } from "@/lib/useConfig";
import { CurveView, TradeView, getCurve, loadTrades, readProgram, curvePda } from "@/lib/program";
import { marketCapSol, priceSol, progress, INIT_REAL_TOKENS } from "@/lib/curve";
import { ago, compact, duration, price, short, sol, tokens } from "@/lib/format";

export default function TokenPage({ params }: { params: Promise<{ mint: string }> }) {
  const { mint: mintStr } = use(params);
  const { connection } = useConnection();
  const config = useConfig();
  const [curve, setCurve] = useState<CurveView | null>(null);
  const [missing, setMissing] = useState(false);
  const [trades, setTrades] = useState<TradeView[]>([]);
  const [held, setHeld] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const mint = new PublicKey(mintStr);
      const program = readProgram(connection);
      const c = await getCurve(program, mint);
      if (!c) {
        setMissing(true);
        return;
      }
      setCurve(c);
      loadTrades(connection, program, curvePda(mint), mint).then(setTrades).catch(() => {});
    } catch {
      setMissing(true);
    }
  }, [connection, mintStr]);

  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  if (missing) return <p className="notice notice-bad">No HODL token found at this address.</p>;
  if (!curve) return <p className="notice">Loading token…</p>;

  const p = progress(curve.realTokens);
  const soldTokens = INIT_REAL_TOKENS - curve.realTokens;

  return (
    <div className="token">
      <div className="token-main">
        <header className="token-head">
          <Avatar id={curve.mint.toBase58()} symbol={curve.symbol} uri={curve.uri} size={64} />
          <div>
            <h1 className="h1">
              {curve.name} <span className="muted">{curve.symbol}</span>
            </h1>
            <p className="muted">
              Created {ago(curve.createdAt)} by {short(curve.creator.toBase58())}
            </p>
          </div>
        </header>

        <dl className="stats">
          <div>
            <dt>Price</dt>
            <dd>{price(priceSol(curve.vs, curve.vt))} SOL</dd>
          </div>
          <div>
            <dt>Market cap</dt>
            <dd>{compact(marketCapSol(curve.vs, curve.vt), 1)} SOL</dd>
          </div>
          <div>
            <dt>In the pool</dt>
            <dd>{sol(curve.realSol, 2)} SOL</dd>
          </div>
          <div>
            <dt>Sold from curve</dt>
            <dd>{tokens(soldTokens, 1)}</dd>
          </div>
        </dl>

        <div className="bar" aria-label={`${Math.round(p * 100)} percent of the curve is sold`}>
          <span style={{ width: `${Math.max(1, p * 100)}%` }} />
        </div>
        <p className="muted bar-note">{Math.round(p * 100)}% of the curve sold. Trading ends when it is full.</p>

        <h2 className="h2">The rules for this token</h2>
        <TaxMelt
          maxBps={curve.maxTaxBps}
          decaySecs={curve.decaySecs}
          heldSecs={held ?? undefined}
          scrub
          caption={`Sell tax starts at ${curve.maxTaxBps / 100}% and reaches 0 after ${duration(curve.decaySecs)}. Each wallet can sell ${curve.holderSellBps / 100}% of its tokens per ${duration(curve.windowSecs)}. ${curve.rewardBps / 100}% of every sell tax is paid out to holders. Trade fee: ${curve.feeBps / 100}% to the creator${curve.holderFeeBps > 0 ? ` and ${curve.holderFeeBps / 100}% to holders` : ""}. Until this token graduates it can only be bought and sold here: it cannot be sent to another wallet or traded on another exchange.`}
        />

        <h2 className="h2">Recent trades</h2>
        {trades.length === 0 ? (
          <p className="muted">No trades yet.</p>
        ) : (
          <table className="trades">
            <thead>
              <tr>
                <th>Wallet</th>
                <th>Side</th>
                <th className="num">SOL</th>
                <th className="num">Tokens</th>
                <th className="num">Tax</th>
                <th className="num">When</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => (
                <tr key={t.sig}>
                  <td>{short(t.trader)}</td>
                  <td className={t.isBuy ? "buy" : "sell"}>{t.isBuy ? "Buy" : "Sell"}</td>
                  <td className="num">{sol(t.sol, 3)}</td>
                  <td className="num">{tokens(t.tokens, 1)}</td>
                  <td className="num">{t.tax > 0n ? `${sol(t.tax, 4)}` : "0"}</td>
                  <td className="num">{ago(t.ts)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <aside className="token-side">
        <TradePanel curve={curve} onTraded={load} onHeld={setHeld} paused={Boolean(config?.paused)} />
      </aside>
    </div>
  );
}
