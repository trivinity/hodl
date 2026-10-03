"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import dynamic from "next/dynamic";
import { CLUSTER_LABEL } from "@/lib/program";
import { useConfig } from "@/lib/useConfig";

// the wallet button reads window state, so it only renders in the browser
const WalletMultiButton = dynamic(
  async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false }
);

function SolBalance() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [lamports, setLamports] = useState<number | null>(null);
  useEffect(() => {
    if (!publicKey) {
      setLamports(null);
      return;
    }
    let live = true;
    const load = () =>
      connection
        .getBalance(publicKey)
        .then((b) => live && setLamports(b))
        .catch(() => live && setLamports(null));
    load();
    const id = setInterval(load, 4000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [connection, publicKey]);
  if (!publicKey) return null;
  return (
    <span className="net" title={publicKey.toBase58()}>
      {lamports === null ? "…" : (lamports / 1e9).toFixed(3)} SOL
    </span>
  );
}

export default function Header() {
  const config = useConfig();
  return (
    <>
    {config?.paused && (
      <div className="banner" role="status">
        New buys and new tokens are paused right now. Selling and claiming rewards still work.
      </div>
    )}
    <header className="top">
      <Link href="/" className="wordmark" aria-label="HODL home">
        HODL
      </Link>
      <nav className="nav">
        <Link href="/">Tokens</Link>
        <Link href="/create">Launch</Link>
        <Link href="/earnings">Earnings</Link>
      </nav>
      <span className="net" title="Network this site is talking to">
        {CLUSTER_LABEL}
      </span>
      <SolBalance />
      <WalletMultiButton />
    </header>
    </>
  );
}
