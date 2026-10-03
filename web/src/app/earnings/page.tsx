"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Transaction } from "@solana/web3.js";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import Avatar from "@/components/Avatar";
import { CurveView, MyPosition, getTokenBalance, listCurves, listPositions, readProgram, walletProgram } from "@/lib/program";
import { decayTaxBps, rewardOwed, sellQuote, weightedAvgTs } from "@/lib/curve";
import { duration, sol, tokens } from "@/lib/format";
import { friendlyError } from "@/lib/errors";
import { useChainNow } from "@/lib/useChainNow";

type Row = {
  curve: CurveView;
  balance: bigint;
  claimable: bigint;
  held: number;
  taxBps: number;
  /** what selling everything right now would pay out, after fees and tax (ignores the per-wallet sell limit) */
  worth: bigint;
};

export default function Earnings() {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const now = useChainNow();
  const [data, setData] = useState<{ curves: CurveView[]; positions: MyPosition[]; balances: Map<string, bigint> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    if (!wallet) return;
    try {
      const program = readProgram(connection);
      const [curves, positions] = await Promise.all([listCurves(program), listPositions(program, wallet.publicKey)]);
      const balances = new Map<string, bigint>();
      await Promise.all(positions.map(async (p) => balances.set(p.mint.toBase58(), await getTokenBalance(connection, p.mint, wallet.publicKey))));
      setData({ curves, positions, balances });
      setError(null);
    } catch (e) {
      setError(friendlyError(e));
    }
  }, [connection, wallet]);

  useEffect(() => {
    setData(null);
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  const rows: Row[] = useMemo(() => {
    if (!data) return [];
    const byMint = new Map(data.curves.map((c) => [c.mint.toBase58(), c]));
    const out: Row[] = [];
    for (const p of data.positions) {
      const curve = byMint.get(p.mint.toBase58());
      if (!curve) continue; // a token from an older version of the program
      const balance = data.balances.get(p.mint.toBase58()) ?? 0n;
      // same rule as the program: only tokens still in the wallet earn
      const eff = p.tracked < balance ? p.tracked : balance;
      const claimable = rewardOwed(eff, curve.accPerToken, p.rewardDebt, p.pendingRewards);
      if (balance === 0n && claimable === 0n) continue; // nothing here any more
      const oldTs = p.avgTs !== 0n ? p.avgTs : BigInt(now);
      const heldTs = weightedAvgTs(eff, oldTs, balance - eff, BigInt(now));
      const held = Math.max(0, now - Number(heldTs));
      const taxBps = decayTaxBps(held, curve.decaySecs, curve.maxTaxBps);
      let worth = 0n;
      if (balance > 0n) {
        const q = sellQuote(curve.vs, curve.vt, balance, BigInt(curve.feeBps + curve.holderFeeBps + curve.platformFeeBps));
        if (q) worth = q.net - (q.gross * BigInt(taxBps)) / 10_000n;
      }
      out.push({ curve, balance, claimable, held, taxBps, worth });
    }
    return out.sort((a, b) => (b.claimable > a.claimable ? 1 : b.claimable < a.claimable ? -1 : 0));
  }, [data, now]);

  const totalClaimable = rows.reduce((a, r) => a + r.claimable, 0n);
  const totalWorth = rows.reduce((a, r) => a + r.worth, 0n);
  const claimRows = rows.filter((r) => r.claimable > 0n);

  async function claim(list: Row[]) {
    if (!wallet || list.length === 0) return;
    setBusy(true);
    setMsg(null);
    try {
      const program = walletProgram(connection, wallet as any);
      // a few claims fit in one transaction; more are sent as several
      for (let i = 0; i < list.length; i += 3) {
        const tx = new Transaction();
        for (const r of list.slice(i, i + 3)) {
          tx.add(await program.methods.claimRewards().accountsPartial({ claimer: wallet.publicKey, mint: r.curve.mint }).instruction());
        }
        await program.provider.sendAndConfirm!(tx);
      }
      setMsg({ ok: true, text: `Claimed about ${sol(list.reduce((a, r) => a + r.claimable, 0n), 5)} SOL.` });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: friendlyError(e) });
    } finally {
      setBusy(false);
    }
  }

  if (!wallet) {
    return (
      <div className="create-form">
        <h1 className="h1">Your earnings</h1>
        <p className="notice">Connect a wallet to see the tokens you hold and the rewards waiting for you.</p>
      </div>
    );
  }

  return (
    <div className="earn">
      <h1 className="h1">Your earnings</h1>

      <dl className="strip earn-strip" aria-label="Your totals">
        <div>
          <dd>{data ? `${sol(totalClaimable, 5)} SOL` : "…"}</dd>
          <dt>Ready to claim</dt>
        </div>
        <div>
          <dd>{data ? rows.length : "…"}</dd>
          <dt>Tokens you hold</dt>
        </div>
        <div>
          <dd>{data ? `${sol(totalWorth, 3)} SOL` : "…"}</dd>
          <dt>Worth if you sold everything today</dt>
        </div>
      </dl>

      <div className="earn-actions">
        <button className="btn btn-primary" disabled={busy || claimRows.length === 0} onClick={() => claim(claimRows)}>
          {busy ? "Waiting for wallet…" : claimRows.length > 1 ? `Claim all (${claimRows.length})` : "Claim"}
        </button>
        <span className="muted">Rewards stay yours until you claim. There is no deadline.</span>
      </div>

      {msg && <p className={msg.ok ? "notice notice-ok" : "notice notice-bad"}>{msg.text}</p>}
      {error && <p className="notice notice-bad">{error}</p>}
      {!error && data === null && <p className="notice">Loading your tokens…</p>}

      {data && rows.length === 0 && (
        <div className="empty">
          <p>You don’t hold any HODL tokens yet.</p>
          <Link href="/" className="btn btn-primary">
            Browse tokens
          </Link>
        </div>
      )}

      <ul className="rows earn-rows">
        {rows.map((r) => (
          <li key={r.curve.address.toBase58()} className="earn-row">
            <Link href={`/token/${r.curve.mint.toBase58()}`} className="earn-token">
              <Avatar id={r.curve.mint.toBase58()} symbol={r.curve.symbol} uri={r.curve.uri} size={40} />
              <span className="row-name">
                <strong>{r.curve.name}</strong>
                <span className="muted">
                  {tokens(r.balance)} {r.curve.symbol}
                </span>
              </span>
            </Link>
            <span className="earn-cell">
              <strong>{(r.taxBps / 100).toFixed(r.taxBps % 100 === 0 ? 0 : 1)}%</strong>
              <span className="muted">sell tax now · held {duration(r.held)}</span>
            </span>
            <span className="earn-cell">
              <strong>{sol(r.worth, 4)} SOL</strong>
              <span className="muted">worth today</span>
            </span>
            <span className="earn-cell">
              <strong>{sol(r.claimable, 5)} SOL</strong>
              <span className="muted">to claim</span>
            </span>
            <button className="btn" disabled={busy || r.claimable === 0n} onClick={() => claim([r])}>
              Claim
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
