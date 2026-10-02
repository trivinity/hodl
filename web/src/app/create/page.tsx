"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { Keypair } from "@solana/web3.js";
import { BN } from "@anchor-lang/core";
import TaxMelt from "@/components/TaxMelt";
import { walletProgram } from "@/lib/program";
import { duration } from "@/lib/format";
import { friendlyError } from "@/lib/errors";

const PRESETS = {
  gentle: { label: "Gentle", maxTax: 15, decayH: 24, limit: 75, windowH: 24, reward: 25 },
  standard: { label: "Standard", maxTax: 30, decayH: 168, limit: 50, windowH: 24, reward: 50 },
  strict: { label: "Strict", maxTax: 40, decayH: 240, limit: 35, windowH: 24, reward: 75 },
} as const;
type PresetKey = keyof typeof PRESETS;

export default function Create() {
  const router = useRouter();
  const { connection } = useConnection();
  const wallet = useAnchorWallet();

  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [image, setImage] = useState("");
  const [devBuy, setDevBuy] = useState("");
  const [preset, setPreset] = useState<PresetKey>("standard");
  const [maxTax, setMaxTax] = useState<number>(PRESETS.standard.maxTax);
  const [decayH, setDecayH] = useState<number>(PRESETS.standard.decayH);
  const [limit, setLimit] = useState<number>(PRESETS.standard.limit);
  const [windowH, setWindowH] = useState<number>(PRESETS.standard.windowH);
  const [reward, setReward] = useState<number>(PRESETS.standard.reward);
  const [fee, setFee] = useState<number>(1);
  const [feeMode, setFeeMode] = useState<"creator" | "holders" | "split">("creator");
  const creatorFeePct = feeMode === "holders" ? 0 : fee;
  const holderFeePct = feeMode === "creator" ? 0 : fee;
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function pick(k: PresetKey) {
    const p = PRESETS[k];
    setPreset(k);
    setMaxTax(p.maxTax);
    setDecayH(p.decayH);
    setLimit(p.limit);
    setWindowH(p.windowH);
    setReward(p.reward);
  }

  const problems: string[] = [];
  if (name.trim().length < 1 || name.length > 32) problems.push("Name must be 1 to 32 characters.");
  if (symbol.trim().length < 1 || symbol.length > 10) problems.push("Symbol must be 1 to 10 characters.");
  if (maxTax < 0 || maxTax > 50) problems.push("Max sell tax must be between 0 and 50%.");
  if (decayH * 3600 < 60) problems.push("Tax fade time must be at least 1 minute.");
  if (limit < 1 || limit > 100) problems.push("Wallet sell limit must be between 1 and 100%.");
  if (windowH * 3600 < 60) problems.push("Limit window must be at least 1 minute.");
  if (windowH > 720) problems.push("Limit window can be at most 30 days.");
  if (windowH > 0 && (limit / windowH) * 24 < 20)
    problems.push("Holders must be able to sell at least 20% of their tokens per day. Raise the percent or shorten the window.");
  if (reward < 0 || reward > 100) problems.push("Holder reward share must be between 0 and 100%.");
  if (fee < 0 || creatorFeePct + holderFeePct > 5) problems.push("The total trade fee must be between 0 and 5%.");
  if (devBuy && !(Number(devBuy) > 0)) problems.push("Launch buy must be a positive amount of SOL.");

  async function launch() {
    if (!wallet || problems.length) return;
    setBusy(true);
    setError(null);
    try {
      const program = walletProgram(connection, wallet as any);
      const mint = Keypair.generate();
      setStatus("Creating your token. Approve in your wallet.");
      await program.methods
        .createCurve(
          name.trim(),
          symbol.trim().toUpperCase(),
          image.trim(),
          Math.round(creatorFeePct * 100),
          Math.round(maxTax * 100),
          new BN(Math.round(decayH * 3600)),
          Math.round(limit * 100),
          new BN(Math.round(windowH * 3600)),
          Math.round(reward * 100),
          Math.round(holderFeePct * 100)
        )
        .accountsPartial({ creator: wallet.publicKey, mint: mint.publicKey })
        .signers([mint])
        .rpc();

      if (devBuy && Number(devBuy) > 0) {
        setStatus("Token created. Buying your first tokens. Approve again.");
        await program.methods
          .buy(new BN(Math.round(Number(devBuy) * 1e9)), new BN(0))
          .accountsPartial({ buyer: wallet.publicKey, mint: mint.publicKey })
          .rpc();
      }
      router.push(`/token/${mint.publicKey.toBase58()}`);
    } catch (e) {
      setError(friendlyError(e));
      setStatus(null);
      setBusy(false);
    }
  }

  return (
    <div className="create">
      <div className="create-form">
        <h1 className="h1">Launch a token</h1>

        <div className="field">
          <label htmlFor="name">Name</label>
          <input id="name" value={name} maxLength={32} onChange={(e) => setName(e.target.value)} placeholder="Diamond Hands" />
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="symbol">Symbol</label>
            <input id="symbol" value={symbol} maxLength={10} onChange={(e) => setSymbol(e.target.value)} placeholder="HOLD" />
          </div>
          <div className="field">
            <label htmlFor="devbuy">Your first buy (SOL, optional)</label>
            <input id="devbuy" inputMode="decimal" value={devBuy} onChange={(e) => setDevBuy(e.target.value)} placeholder="0.5" />
          </div>
        </div>
        <div className="field">
          <label htmlFor="image">Image link (optional)</label>
          <input id="image" value={image} maxLength={128} onChange={(e) => setImage(e.target.value)} placeholder="https://…" />
        </div>

        <fieldset className="field">
          <legend>How strict should holding be?</legend>
          <div className="seg seg-wide">
            {(Object.keys(PRESETS) as PresetKey[]).map((k) => (
              <button type="button" key={k} className={preset === k ? "seg-on" : ""} onClick={() => pick(k)} aria-pressed={preset === k}>
                {PRESETS[k].label}
              </button>
            ))}
          </div>
        </fieldset>

        <details className="adv">
          <summary>Fine-tune the rules</summary>
          <div className="field-row">
            <div className="field">
              <label htmlFor="maxtax">Sell tax on day one (%)</label>
              <input id="maxtax" type="number" min={0} max={50} value={maxTax} onChange={(e) => setMaxTax(Number(e.target.value))} />
            </div>
            <div className="field">
              <label htmlFor="decay">Tax fades to 0 after (hours)</label>
              <input id="decay" type="number" min={0.02} step="any" value={decayH} onChange={(e) => setDecayH(Number(e.target.value))} />
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="limit">One wallet can sell (% of its tokens)</label>
              <input id="limit" type="number" min={1} max={100} value={limit} onChange={(e) => setLimit(Number(e.target.value))} />
            </div>
            <div className="field">
              <label htmlFor="win">…per window of (hours)</label>
              <input id="win" type="number" min={0.02} step="any" value={windowH} onChange={(e) => setWindowH(Number(e.target.value))} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="reward">Share of sell tax paid to holders (%)</label>
            <input id="reward" type="number" min={0} max={100} value={reward} onChange={(e) => setReward(Number(e.target.value))} />
          </div>
          <fieldset className="field">
            <legend>Who gets the trade fee?</legend>
            <div className="seg seg-wide">
              {([
                ["creator", "Me"],
                ["holders", "Holders"],
                ["split", "Both"],
              ] as const).map(([k, label]) => (
                <button type="button" key={k} className={feeMode === k ? "seg-on" : ""} onClick={() => setFeeMode(k)} aria-pressed={feeMode === k}>
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="field">
            <label htmlFor="fee">{feeMode === "split" ? "Fee for each side (%)" : "Trade fee (%)"}</label>
            <input id="fee" type="number" min={0} max={5} step="any" value={fee} onChange={(e) => setFee(Number(e.target.value))} />
            <small>
              Charged on every buy and sell.{" "}
              {feeMode === "creator" && `${creatorFeePct}% goes to you.`}
              {feeMode === "holders" && `${holderFeePct}% is shared by holders.`}
              {feeMode === "split" && `${creatorFeePct}% to you and ${holderFeePct}% to holders, ${creatorFeePct + holderFeePct}% in total.`}
            </small>
          </div>
        </details>

        {problems.length > 0 && (name || symbol) && (
          <ul className="problems">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}

        <button className="btn btn-primary btn-block" disabled={!wallet || busy || problems.length > 0} onClick={launch}>
          {!wallet ? "Connect a wallet to launch" : busy ? "Launching…" : "Launch token"}
        </button>
        {status && <p className="notice">{status}</p>}
        {error && <p className="notice notice-bad">{error}</p>}
      </div>

      <aside className="create-side">
        <TaxMelt
          maxBps={Math.max(0, Math.round(maxTax * 100))}
          decaySecs={Math.max(60, Math.round(decayH * 3600))}
          scrub
          caption={`Buyers who sell right away pay ${maxTax}%. After ${duration(decayH * 3600)} the tax is 0.`}
        />
        <p className="side-note">
          Each wallet can sell {limit}% of its tokens per {duration(windowH * 3600)}. {reward}% of every sell tax is paid out to holders and the rest stays in the pool, lifting the
          price for everyone still holding. {creatorFeePct > 0 ? `You earn ${creatorFeePct}% of every trade.` : "You earn no trade fee."}{holderFeePct > 0 ? ` Holders earn ${holderFeePct}% of every trade.` : ""}
        </p>
      </aside>
    </div>
  );
}
