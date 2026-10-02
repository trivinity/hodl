"use client";
import { useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { RPC_URL } from "@/lib/program";
import "@solana/wallet-adapter-react-ui/styles.css";

export default function Providers({ children }: { children: React.ReactNode }) {
  // Wallet Standard wallets (Phantom, Solflare, Backpack...) are detected automatically
  const wallets = useMemo(() => [], []);
  return (
    <ConnectionProvider endpoint={RPC_URL} config={{ commitment: "confirmed" }}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
