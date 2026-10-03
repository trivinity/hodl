"use client";
import { useSyncExternalStore } from "react";

// tokens the visitor starred, remembered in their browser only
let list: string[] = [];
let loaded = false;
const subs = new Set<() => void>();

function load() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = JSON.parse(localStorage.getItem("hodl-watchlist") ?? "[]");
    if (Array.isArray(raw)) list = raw.filter((x) => typeof x === "string").slice(0, 200);
  } catch {
    /* private mode: start empty */
  }
}

export function useWatchlist(): { list: string[]; has: (mint: string) => boolean; toggle: (mint: string) => void } {
  const snapshot = useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => {
      load();
      return list;
    },
    () => [] as string[]
  );
  return {
    list: snapshot,
    has: (mint) => snapshot.includes(mint),
    toggle: (mint) => {
      list = list.includes(mint) ? list.filter((m) => m !== mint) : [mint, ...list].slice(0, 200);
      try {
        localStorage.setItem("hodl-watchlist", JSON.stringify(list));
      } catch {
        /* ignore */
      }
      subs.forEach((f) => f());
    },
  };
}
