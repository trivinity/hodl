"use client";
import { useEffect, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { getConfig, readProgram, type ConfigView } from "./program";

/** global settings (paused? platform fee for new tokens?), refreshed every 15 seconds */
export function useConfig(): ConfigView | null {
  const { connection } = useConnection();
  const [config, setConfig] = useState<ConfigView | null>(null);
  useEffect(() => {
    let live = true;
    const load = () =>
      getConfig(readProgram(connection))
        .then((c) => live && setConfig(c))
        .catch(() => {});
    load();
    const id = setInterval(load, 15000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [connection]);
  return config;
}
