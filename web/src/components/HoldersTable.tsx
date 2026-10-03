"use client";
import { useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { CurveView, HolderRow, listHolders, readProgram } from "@/lib/program";
import { decayTaxBps, rewardOwed } from "@/lib/curve";
import { duration, short, sol, tokens } from "@/lib/format";

/** Everyone holding this token through the curve: how much, for how long, the sell tax they would pay now, and rewards waiting. */
export default function HoldersTable({ curve }: { curve: CurveView }) {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [rows, setRows] = useState<HolderRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    const load = () =>
      listHolders(readProgram(connection), curve.mint)
        .then((r) => live && (setRows(r), setFailed(false)))
        .catch(() => live && setFailed(true));
    load();
    const t = setInterval(load, 15000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [connection, curve.mint]);

  if (failed && !rows) return <p className="muted">Could not load holders right now.</p>;
  if (!rows) return <p className="muted">Loading holders…</p>;
  if (rows.length === 0) return <p className="muted">No holders yet.</p>;

  const now = Math.floor(Date.now() / 1000);
  const total = curve.totalTracked > 0n ? curve.totalTracked : rows.reduce((a, r) => a + r.tracked, 0n);
  const me = publicKey?.toBase58();

  return (
    <div className="table-wrap">
      <table className="trades holders">
        <thead>
          <tr>
            <th>#</th>
            <th>Wallet</th>
            <th className="num">Tokens</th>
            <th className="num">Share</th>
            <th className="num">Held for</th>
            <th className="num">Sell tax now</th>
            <th className="num">Rewards waiting</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 50).map((r, i) => {
            const held = r.avgTs > 0 ? Math.max(0, now - r.avgTs) : 0;
            const tax = r.avgTs > 0 ? decayTaxBps(held, curve.decaySecs, curve.maxTaxBps) : curve.maxTaxBps;
            const owed = rewardOwed(r.tracked, curve.accPerToken, r.rewardDebt, r.pending);
            const share = total > 0n ? Number((r.tracked * 10000n) / total) / 100 : 0;
            const owner = r.owner.toBase58();
            return (
              <tr key={owner} className={owner === me ? "me" : undefined}>
                <td>{i + 1}</td>
                <td>
                  {short(owner)}
                  {owner === me && <span className="chip-info"> you</span>}
                  {owner === curve.creator.toBase58() && <span className="chip-info"> creator</span>}
                </td>
                <td className="num">{tokens(r.tracked, 1)}</td>
                <td className="num">{share.toFixed(share < 1 ? 2 : 1)}%</td>
                <td className="num">{r.avgTs > 0 ? duration(held) : "–"}</td>
                <td className={`num ${tax === 0 ? "buy" : ""}`}>{tax === 0 ? "0% (free)" : `${(tax / 100).toFixed(tax % 100 === 0 ? 0 : 1)}%`}</td>
                <td className="num">{owed > 0n ? `${sol(owed, 5)} SOL` : "0"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length > 50 && <p className="muted">Showing the 50 biggest of {rows.length} holders.</p>}
    </div>
  );
}
