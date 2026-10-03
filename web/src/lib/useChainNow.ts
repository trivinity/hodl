"use client";
import { useEffect, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";

/** the chain's idea of "now" in seconds, ticking every second (the program counts hold time with chain time, not the browser's) */
export function useChainNow(): number {
  const { connection } = useConnection();
  const [offset, setOffset] = useState(0);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    let live = true;
    const sync = async () => {
      try {
        const slot = await connection.getSlot("confirmed");
        const bt = await connection.getBlockTime(slot);
        if (live && bt) setOffset(bt - Math.floor(Date.now() / 1000));
      } catch {
        /* keep the last offset */
      }
    };
    sync();
    const t = setInterval(sync, 30000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [connection]);
  useEffect(() => {
    const tick = () => setNow(Math.floor(Date.now() / 1000) + offset);
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [offset]);
  return now;
}
