"use client";
import { useState } from "react";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { walletProgram, getConfig, readProgram, CLUSTER_LABEL, type ConfigView } from "@/lib/program";
import { useConfig } from "@/lib/useConfig";
import { friendlyError } from "@/lib/errors";
import { short } from "@/lib/format";

// Not linked from the menu on purpose. Anyone can open it and read the settings,
// but only the admin wallet can change anything: the program checks that, not this page.
export default function Admin() {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const config = useConfig();
  const [fresh, setFresh] = useState<ConfigView | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [feePct, setFeePct] = useState("");
  const [treasury, setTreasury] = useState("");
  const [nextAdmin, setNextAdmin] = useState("");

  const cfg = fresh ?? config;
  const me = wallet?.publicKey.toBase58();
  const isAdmin = Boolean(cfg && me && cfg.admin === me);
  const isPending = Boolean(cfg && me && cfg.pendingAdmin === me);

  async function run(label: string, send: (p: ReturnType<typeof walletProgram>) => Promise<string>, confirmText?: string) {
    if (!wallet) return;
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setMsg(null);
    try {
      await send(walletProgram(connection, wallet as any));
      setFresh(await getConfig(readProgram(connection)));
      setMsg({ ok: true, text: `${label}: done.` });
    } catch (e) {
      setMsg({ ok: false, text: friendlyError(e) });
    } finally {
      setBusy(false);
    }
  }

  if (!cfg) {
    return (
      <div className="create-form">
        <h1 className="h1">Admin</h1>
        <p className="notice">{config === null ? "Loading settings, or the program has not been set up on this network yet." : ""}</p>
      </div>
    );
  }

  const feeBps = Math.round(Number(feePct) * 100);
  const feeOk = feePct !== "" && Number.isFinite(Number(feePct)) && feeBps >= 0 && feeBps <= 200;
  let treasuryKey: PublicKey | null = null;
  let nextAdminKey: PublicKey | null = null;
  try { if (treasury) treasuryKey = new PublicKey(treasury); } catch { /* invalid */ }
  try { if (nextAdmin) nextAdminKey = new PublicKey(nextAdmin); } catch { /* invalid */ }

  return (
    <div className="create-form">
      <h1 className="h1">Admin</h1>
      <p className="muted">Network: {CLUSTER_LABEL}. Anyone can read this page. Only the admin wallet can change anything.</p>

      <dl className="calc">
        <div><dt>Trading</dt><dd>{cfg.paused ? "PAUSED (no new buys or new tokens)" : "Live"}</dd></div>
        <div><dt>Platform fee for new tokens</dt><dd>{cfg.platformFeeBps / 100}%</dd></div>
        <div><dt>Admin</dt><dd title={cfg.admin}>{short(cfg.admin)}</dd></div>
        <div><dt>Treasury</dt><dd title={cfg.treasury}>{short(cfg.treasury)}</dd></div>
        {cfg.pendingAdmin && <div><dt>Waiting to accept admin</dt><dd title={cfg.pendingAdmin}>{short(cfg.pendingAdmin)}</dd></div>}
      </dl>

      {!wallet && <p className="notice">Connect a wallet to continue.</p>}
      {wallet && !isAdmin && !isPending && <p className="notice">This wallet is not the admin, so the controls are hidden. Connect the admin wallet ({short(cfg.admin)}).</p>}

      {isPending && (
        <section className="field">
          <label>You have been proposed as the new admin</label>
          <button className="btn btn-primary btn-block" disabled={busy} onClick={() => run("Admin accepted", (p) => p.methods.acceptAdmin().accountsPartial({ newAdmin: wallet!.publicKey }).rpc())}>
            Accept admin
          </button>
        </section>
      )}

      {isAdmin && (
        <>
          <section className="field">
            <label>Pause button</label>
            <p className="muted">Stops new buys and new tokens. Selling and claiming rewards keep working, so nobody is trapped.</p>
            {cfg.paused ? (
              <button className="btn btn-buy btn-block" disabled={busy} onClick={() => run("Trading resumed", (p) => p.methods.setPaused(false).accountsPartial({ admin: wallet!.publicKey }).rpc())}>
                {busy ? "Waiting for wallet…" : "Resume trading"}
              </button>
            ) : (
              <button className="btn btn-sell btn-block" disabled={busy} onClick={() => run("Trading paused", (p) => p.methods.setPaused(true).accountsPartial({ admin: wallet!.publicKey }).rpc(), "Pause new buys and new tokens for everyone?")}>
                {busy ? "Waiting for wallet…" : "Pause trading"}
              </button>
            )}
          </section>

          <section className="field">
            <label htmlFor="fee">Platform fee for new tokens (%, max 2)</label>
            <input id="fee" inputMode="decimal" value={feePct} onChange={(e) => setFeePct(e.target.value)} placeholder={String(cfg.platformFeeBps / 100)} />
            <small>Tokens that already exist keep the fee they launched with.</small>
            <button className="btn btn-block" disabled={busy || !feeOk} onClick={() => run("Fee updated", (p) => p.methods.setPlatformFee(feeBps).accountsPartial({ admin: wallet!.publicKey }).rpc())}>
              Update fee
            </button>
          </section>

          <section className="field">
            <label htmlFor="treasury">Treasury address (where platform fees are sent)</label>
            <input id="treasury" value={treasury} onChange={(e) => setTreasury(e.target.value.trim())} placeholder={cfg.treasury} />
            <button className="btn btn-block" disabled={busy || !treasuryKey} onClick={() => run("Treasury updated", (p) => p.methods.setTreasury(treasuryKey!).accountsPartial({ admin: wallet!.publicKey }).rpc(), "Platform fees will be sent to this new address from now on. Is it correct?")}>
              Update treasury
            </button>
          </section>

          <section className="field">
            <label htmlFor="next">Hand admin to another wallet (step 1 of 2)</label>
            <input id="next" value={nextAdmin} onChange={(e) => setNextAdmin(e.target.value.trim())} placeholder="Wallet address" />
            <small>Nothing changes until that wallet opens this page and clicks Accept admin.</small>
            <button className="btn btn-block" disabled={busy || !nextAdminKey} onClick={() => run("Proposed", (p) => p.methods.proposeAdmin(nextAdminKey!).accountsPartial({ admin: wallet!.publicKey }).rpc())}>
              Propose new admin
            </button>
          </section>
        </>
      )}

      {msg && <p className={msg.ok ? "notice notice-ok" : "notice notice-bad"}>{msg.text}</p>}
    </div>
  );
}
