"use client";
import { useEffect, useSyncExternalStore } from "react";

export type Unit = "SOL" | "USD";

// one shared choice for the whole site, remembered in the browser
let unit: Unit = "SOL";
let loaded = false;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

function load() {
  if (loaded) return;
  loaded = true;
  try {
    if (localStorage.getItem("hodl-unit") === "USD") unit = "USD";
  } catch {
    /* private mode: keep SOL */
  }
}

export function useUnit(): [Unit, (u: Unit) => void] {
  const u = useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => {
      load();
      return unit;
    },
    () => "SOL" as Unit
  );
  const set = (next: Unit) => {
    unit = next;
    try {
      localStorage.setItem("hodl-unit", next);
    } catch {
      /* ignore */
    }
    emit();
  };
  return [u, set];
}

// SOL price in dollars, fetched through our own cached route
let usd: number | null = null;
let fetchedAt = 0;
const usdSubs = new Set<() => void>();

async function refreshUsd() {
  if (Date.now() - fetchedAt < 60_000) return;
  fetchedAt = Date.now();
  try {
    const res = await fetch("/api/sol-price");
    if (!res.ok) return;
    const v = (await res.json())?.usd;
    if (typeof v === "number" && v > 0) {
      usd = v;
      usdSubs.forEach((f) => f());
    }
  } catch {
    /* no price: the site stays in SOL */
  }
}

export function useSolUsd(): number | null {
  useEffect(() => {
    refreshUsd();
    const t = setInterval(refreshUsd, 120_000);
    return () => clearInterval(t);
  }, []);
  return useSyncExternalStore(
    (cb) => {
      usdSubs.add(cb);
      return () => usdSubs.delete(cb);
    },
    () => usd,
    () => null
  );
}
