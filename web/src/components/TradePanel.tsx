"use client";
import { useEffect, useMemo, useState } from "react";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { BN } from "@anchor-lang/core";
import {
  CurveView,
  PositionView,
  getPosition,
  getTokenBalance,
  walletProgram,
} from "@/lib/program";
import { buyQuote, decayTaxBps, sellQuote, weightedAvgTs, rewardShare, rewardDistributed, rewardOwed, splitFee, TOKEN_UNIT } from "@/lib/curve";
import { duration, sol, tokens } from "@/lib/format";
import { friendlyError } from "@/lib/errors";

type Props = {
  curve: CurveView;
  onTraded: () => void;
  onHeld: (heldSecs: number | null) => void;
  /** true when the admin has paused new buys and new tokens */
  paused?: boolean;
};

const pct = (bps: number) => (bps / 100).toFixed(bps % 100 === 0 ? 0 : 2);

export default function TradePanel({ curve, onTraded, onHeld, paused = false }: Props) {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const [mode, setMode] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const totalFeeBps = curve.feeBps + curve.holderFeeBps + curve.platformFeeBps;
  const [balance, setBalance] = useState<bigint>(0n);
  const [pos, setPos] = useState<PositionView | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // the program counts hold time with the chain's clock, so track its offset from this browser's clock
  const [clockOffset, setClockOffset] = useState(0);
  useEffect(() => {
    let live = true;
    const sync = async () => {
      try {
        const slot = await connection.getSlot("confirmed");
        const bt = await connection.getBlockTime(slot);
        if (live && bt) setClockOffset(bt - Math.floor(Date.now() / 1000));
      } catch {
        /* keep the last offset */
      }
    };
    sync();
    const t = setInterval(sync, 15000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [connection]);
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000) + clockOffset), 1000);
    setNow(Math.floor(Date.now() / 1000) + clockOffset);
    return () => clearInterval(t);
  }, [clockOffset]);

  async function refreshWallet() {
    if (!wallet) {
      setBalance(0n);
      setPos(null);
      return;
    }
    const program = walletProgram(connection, wallet as any);
    const [b, p] = await Promise.all([
      getTokenBalance(connection, curve.mint, wallet.publicKey),
      getPosition(program, curve.mint, wallet.publicKey).catch(() => null),
    ]);
    setBalance(b);
    setPos(p);
  }
  useEffect(() => {
    refreshWallet();
    const t = setInterval(refreshWallet, 6000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet?.publicKey?.toBase58(), curve.mint.toBase58()]);

  // how long this wallet's tokens have been held, as the program will count it
  const held = useMemo(() => {
    if (!wallet || balance === 0n) return null;
    const tracked = pos ? (pos.tracked < balance ? pos.tracked : balance) : 0n;
    const oldTs = pos && pos.avgTs !== 0n ? pos.avgTs : BigInt(now);
    const eff = weightedAvgTs(tracked, oldTs, balance - tracked, BigInt(now));
    return Math.max(0, now - Number(eff));
  }, [wallet, balance, pos, now]);

  useEffect(() => onHeld(held), [held, onHeld]);

  const taxBps = decayTaxBps(held ?? 0, curve.decaySecs, curve.maxTaxBps);

  // sell room in the current window
  const room = useMemo(() => {
    const windowOpen = pos && pos.windowStart !== 0n && now - Number(pos.windowStart) < curve.windowSecs;
    const base = windowOpen ? pos!.windowBase : balance;
    const sold = windowOpen ? pos!.windowSold : 0n;
    const cap = (base * BigInt(curve.holderSellBps)) / 10_000n;
    let r = cap > sold ? cap - sold : 0n;
    if (r > balance) r = balance;
    const resetIn = windowOpen ? Number(pos!.windowStart) + curve.windowSecs - now : 0;
    return { room: r, resetIn };
  }, [pos, balance, now, curve.windowSecs, curve.holderSellBps]);

  const parsed = useMemo(() => {
    const n = Number(amount);
    if (!amount || !isFinite(n) || n <= 0) return null;
    return n;
  }, [amount]);

  const buyQ = useMemo(() => {
    if (mode !== "buy" || parsed === null) return null;
    return buyQuote(curve.vs, curve.vt, curve.realTokens, BigInt(Math.round(parsed * 1e9)), BigInt(totalFeeBps));
  }, [mode, parsed, curve, totalFeeBps]);

  const sellTokens = useMemo(() => (mode === "sell" && parsed !== null ? BigInt(Math.round(parsed * Number(TOKEN_UNIT))) : null), [mode, parsed]);
  const sellQ = useMemo(() => {
    if (sellTokens === null || sellTokens <= 0n) return null;
    const q = sellQuote(curve.vs, curve.vt, sellTokens, BigInt(totalFeeBps));
    if (!q) return null;
    const tax = (q.gross * BigInt(taxBps)) / 10_000n;
    return { ...q, tax, receive: q.net - tax };
  }, [sellTokens, curve, taxBps]);

  // part of the tax that goes to holders, and what this wallet can claim right now
  const toHolders = useMemo(() => {
    if (!sellQ || !sellTokens) return 0n;
    const myTracked = pos ? (pos.tracked < balance ? pos.tracked : balance) : 0n;
    const soldTracked = sellTokens < myTracked ? sellTokens : myTracked;
    const trackedAfter = curve.totalTracked > soldTracked ? curve.totalTracked - soldTracked : 0n;
    return rewardDistributed(rewardShare(sellQ.tax, curve.rewardBps), trackedAfter);
  }, [sellQ, sellTokens, pos, balance, curve.totalTracked, curve.rewardBps]);

  const claimable = useMemo(
    () => (pos ? rewardOwed(pos.tracked, curve.accPerToken, pos.rewardDebt, pos.pendingRewards) : 0n),
    [pos, curve.accPerToken]
  );

  async function claimRewards() {
    if (!wallet) return;
    setBusy(true);
    setMsg(null);
    try {
      const program = walletProgram(connection, wallet as any);
      await program.methods.claimRewards().accountsPartial({ claimer: wallet.publicKey, mint: curve.mint }).rpc();
      setMsg({ ok: true, text: `Claimed about ${sol(claimable, 5)} SOL of holder rewards.` });
      await refreshWallet();
      onTraded();
    } catch (e) {
      setMsg({ ok: false, text: friendlyError(e) });
    } finally {
      setBusy(false);
    }
  }

  const overRoom = sellTokens !== null && sellTokens > room.room;
  const overBalance = sellTokens !== null && sellTokens > balance;

  function setPct(p: number) {
    const base = room.room;
    const t = (base * BigInt(p)) / 100n;
    setAmount((Number(t) / 1e6).toString());
  }

  async function submit() {
    if (!wallet || parsed === null) return;
    setBusy(true);
    setMsg(null);
    try {
      const program = walletProgram(connection, wallet as any);
      if (mode === "buy" && buyQ) {
        const minOut = (buyQ.tokensOut * 98n) / 100n;
        await program.methods
          .buy(new BN(Math.round(parsed * 1e9)), new BN(minOut.toString()))
          .accountsPartial({ buyer: wallet.publicKey, mint: curve.mint })
          .rpc();
        setMsg({ ok: true, text: `Bought ${tokens(buyQ.tokensOut)} ${curve.symbol}. Your hold clock started.` });
      } else if (mode === "sell" && sellQ && sellTokens) {
        const minOut = (sellQ.receive * 97n) / 100n;
        await program.methods
          .sell(new BN(sellTokens.toString()), new BN(minOut.toString()))
          .accountsPartial({ seller: wallet.publicKey, mint: curve.mint })
          .rpc();
        setMsg({ ok: true, text: `Sold ${tokens(sellTokens)} ${curve.symbol} for about ${sol(sellQ.receive, 4)} SOL.` });
      }
      setAmount("");
      await refreshWallet();
      onTraded();
    } catch (e) {
      setMsg({ ok: false, text: friendlyError(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="trade" aria-label="Trade">
      <div className="seg seg-wide" role="tablist">
        <button role="tab" aria-selected={mode === "buy"} className={mode === "buy" ? "seg-on seg-buy" : ""} onClick={() => { setMode("buy"); setAmount(""); setMsg(null); }}>
          Buy
        </button>
        <button role="tab" aria-selected={mode === "sell"} className={mode === "sell" ? "seg-on seg-sell" : ""} onClick={() => { setMode("sell"); setAmount(""); setMsg(null); }}>
          Sell
        </button>
      </div>

      {wallet && pos && (
        <div className="rewards">
          <div>
            <span>Holder rewards</span>
            <strong>{sol(claimable, 5)} SOL</strong>
          </div>
          <button className="btn" disabled={busy || claimable === 0n} onClick={claimRewards}>
            {busy ? "Waiting…" : "Claim"}
          </button>
        </div>
      )}

      {curve.complete ? (
        <p className="notice">This token’s curve is full. Trading here has ended.</p>
      ) : mode === "buy" ? (
        <>
          <label className="trade-label" htmlFor="amt">
            Amount in SOL
          </label>
          <input id="amt" className="trade-input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.0" />
          <div className="quick">
            {[0.1, 0.5, 1, 5].map((v) => (
              <button key={v} onClick={() => setAmount(String(v))}>
                {v} SOL
              </button>
            ))}
          </div>
          <dl className="calc">
            <div>
              <dt>You get about</dt>
              <dd>{buyQ ? `${tokens(buyQ.tokensOut)} ${curve.symbol}` : "–"}</dd>
            </div>
            {curve.feeBps > 0 && (
              <div>
                <dt>Fee to creator ({pct(curve.feeBps)}%)</dt>
                <dd>{buyQ ? `${sol(splitFee(buyQ.fee, curve.feeBps, curve.holderFeeBps, curve.platformFeeBps).creator, 5)} SOL` : "–"}</dd>
              </div>
            )}
            {curve.holderFeeBps > 0 && (
              <div>
                <dt>Fee to holders ({pct(curve.holderFeeBps)}%)</dt>
                <dd>{buyQ ? `${sol(splitFee(buyQ.fee, curve.feeBps, curve.holderFeeBps, curve.platformFeeBps).holders, 5)} SOL` : "–"}</dd>
              </div>
            )}
            {curve.platformFeeBps > 0 && (
              <div>
                <dt>Platform fee ({pct(curve.platformFeeBps)}%)</dt>
                <dd>{buyQ ? `${sol(splitFee(buyQ.fee, curve.feeBps, curve.holderFeeBps, curve.platformFeeBps).platform, 5)} SOL` : "–"}</dd>
              </div>
            )}
          </dl>
          {paused && <p className="notice notice-bad">New buys are paused right now. You can still sell and claim rewards.</p>}
          <button className="btn btn-buy btn-block" disabled={!wallet || busy || !buyQ || paused} onClick={submit}>
            {!wallet ? "Connect a wallet" : busy ? "Waiting for wallet…" : "Buy"}
          </button>
        </>
      ) : (
        <>
          <div className="mine">
            <span>You hold</span>
            <strong>
              {tokens(balance)} {curve.symbol}
            </strong>
          </div>
          <label className="trade-label" htmlFor="amt">
            Amount of {curve.symbol} to sell
          </label>
          <input id="amt" className="trade-input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.0" />
          <div className="quick">
            {[25, 50, 100].map((p) => (
              <button key={p} onClick={() => setPct(p)}>
                {p === 100 ? "Max now" : `${p}% of room`}
              </button>
            ))}
          </div>

          <div className="taxbox" data-hot={taxBps > 0}>
            <div className="taxbox-main">
              <span className="taxbox-pct">{(taxBps / 100).toFixed(taxBps % 100 === 0 ? 0 : 1)}%</span>
              <span>sell tax right now</span>
            </div>
            <p>
              {balance === 0n
                ? "Buy first to start your hold clock."
                : taxBps === 0
                ? `You have held for ${duration(held ?? 0)}. No tax.`
                : `Held ${duration(held ?? 0)}. Reaches 0% in ${duration(Math.max(0, curve.decaySecs - (held ?? 0)))}.`}
            </p>
          </div>

          <dl className="calc">
            <div>
              <dt>You can sell now</dt>
              <dd>
                {tokens(room.room)} {curve.symbol}
              </dd>
            </div>
            {room.resetIn > 0 && (
              <div>
                <dt>Limit resets in</dt>
                <dd>{duration(room.resetIn)}</dd>
              </div>
            )}
            {curve.feeBps > 0 && (
              <div>
                <dt>Fee to creator ({pct(curve.feeBps)}%)</dt>
                <dd>{sellQ ? `${sol(splitFee(sellQ.fee, curve.feeBps, curve.holderFeeBps, curve.platformFeeBps).creator, 5)} SOL` : "–"}</dd>
              </div>
            )}
            {curve.holderFeeBps > 0 && (
              <div>
                <dt>Fee to holders ({pct(curve.holderFeeBps)}%)</dt>
                <dd>{sellQ ? `${sol(splitFee(sellQ.fee, curve.feeBps, curve.holderFeeBps, curve.platformFeeBps).holders, 5)} SOL` : "–"}</dd>
              </div>
            )}
            {curve.platformFeeBps > 0 && (
              <div>
                <dt>Platform fee ({pct(curve.platformFeeBps)}%)</dt>
                <dd>{sellQ ? `${sol(splitFee(sellQ.fee, curve.feeBps, curve.holderFeeBps, curve.platformFeeBps).platform, 5)} SOL` : "–"}</dd>
              </div>
            )}
            <div>
              <dt>Sell tax ({(taxBps / 100).toFixed(taxBps % 100 === 0 ? 0 : 1)}%)</dt>
              <dd>{sellQ ? `${sol(sellQ.tax, 5)} SOL` : "–"}</dd>
            </div>
            {curve.rewardBps > 0 && (
              <div>
                <dt>Of that, paid to holders</dt>
                <dd>{sellQ ? `${sol(toHolders, 5)} SOL` : "–"}</dd>
              </div>
            )}
            <div>
              <dt>You receive about</dt>
              <dd>{sellQ ? `${sol(sellQ.receive, 5)} SOL` : "–"}</dd>
            </div>
          </dl>

          {overBalance ? (
            <p className="notice notice-bad">You only hold {tokens(balance)} {curve.symbol}.</p>
          ) : overRoom ? (
            <p className="notice notice-bad">
              Over your limit. You can sell up to {tokens(room.room)} {curve.symbol} now{room.resetIn > 0 ? `, more in ${duration(room.resetIn)}` : ""}.
            </p>
          ) : null}

          <button className="btn btn-sell btn-block" disabled={!wallet || busy || !sellQ || overRoom || overBalance} onClick={submit}>
            {!wallet ? "Connect a wallet" : busy ? "Waiting for wallet…" : taxBps > 0 ? `Sell and pay ${(taxBps / 100).toFixed(0)}% tax` : "Sell"}
          </button>
        </>
      )}
      {msg && <p className={msg.ok ? "notice notice-ok" : "notice notice-bad"}>{msg.text}</p>}
    </section>
  );
}
