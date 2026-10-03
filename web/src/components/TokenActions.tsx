"use client";
import { useState } from "react";
import { useWatchlist } from "@/lib/useWatchlist";

/** copy the token address, copy a link to the page, and star the token for the watchlist */
export default function TokenActions({ mint }: { mint: string }) {
  const [done, setDone] = useState<"addr" | "link" | null>(null);
  const watch = useWatchlist();
  const starred = watch.has(mint);

  async function copy(what: "addr" | "link") {
    try {
      await navigator.clipboard.writeText(what === "addr" ? mint : window.location.href);
      setDone(what);
      setTimeout(() => setDone(null), 1500);
    } catch {
      /* clipboard blocked: nothing to do */
    }
  }

  return (
    <div className="tactions">
      <button type="button" className="chipbtn" onClick={() => copy("addr")} title={mint}>
        {done === "addr" ? "Copied" : "Copy address"}
      </button>
      <button type="button" className="chipbtn" onClick={() => copy("link")}>
        {done === "link" ? "Link copied" : "Share"}
      </button>
      <button type="button" className={starred ? "chipbtn chipbtn-on" : "chipbtn"} aria-pressed={starred} onClick={() => watch.toggle(mint)}>
        {starred ? "★ Watching" : "☆ Watch"}
      </button>
    </div>
  );
}
