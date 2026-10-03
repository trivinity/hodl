"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import TaxMelt from "@/components/TaxMelt";
import TokenCard from "@/components/TokenCard";
import StatsStrip from "@/components/StatsStrip";
import HowItWorks from "@/components/HowItWorks";
import ActivityStrip from "@/components/ActivityStrip";
import { ActivityItem, CurveView, listCurves, loadActivity, readProgram } from "@/lib/program";
import { marketCapSol, progress } from "@/lib/curve";

type Sort = "new" | "close" | "big";

export default function Home() {
  const { connection } = useConnection();
  const [curves, setCurves] = useState<CurveView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("new");
  const [activity, setActivity] = useState<ActivityItem[] | null>(null);
  const knownMints = useRef<Set<string>>(new Set());
  useEffect(() => {
    knownMints.current = new Set((curves ?? []).map((c) => c.mint.toBase58()));
  }, [curves]);

  const curvesReady = curves !== null;
  useEffect(() => {
    // wait for the token list, so activity can be limited to tokens that exist on this network
    if (!curvesReady) return;
    let live = true;
    const load = async () => {
      try {
        const items = await loadActivity(connection, readProgram(connection), 14, knownMints.current.size ? knownMints.current : undefined);
        if (live) setActivity(items);
      } catch {
        /* the strip simply stays hidden if the network is slow */
      }
    };
    load();
    const t = setInterval(load, 30000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [connection, curvesReady]);

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const list = await listCurves(readProgram(connection));
        if (live) {
          setCurves(list);
          setError(null);
        }
      } catch (e: any) {
        if (live) setError(String(e?.message ?? e));
      }
    };
    load();
    const t = setInterval(load, 8000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [connection]);

  const sorted = useMemo(() => {
    if (!curves) return [];
    const c = [...curves];
    if (sort === "new") c.sort((a, b) => b.createdAt - a.createdAt);
    if (sort === "close") c.sort((a, b) => progress(b.realTokens) - progress(a.realTokens));
    if (sort === "big") c.sort((a, b) => marketCapSol(b.vs, b.vt) - marketCapSol(a.vs, a.vt));
    return c;
  }, [curves, sort]);

  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <h1>Early sellers pay. Holders don’t.</h1>
          <p className="lede">
            Every token on HODL charges a sell tax that melts to zero the longer you hold. Part of every tax is paid straight
            to the people who stayed, and the rest stays in the pool.
          </p>
          <div className="hero-actions">
            <Link href="/create" className="btn btn-primary">
              Launch a token
            </Link>
            <a href="#tokens" className="btn btn-ghost">
              Browse tokens
            </a>
          </div>
        </div>
        <div className="hero-art">
          <TaxMelt maxBps={3000} decaySecs={7 * 86400} scrub caption="Drag across the line. This is the standard setting: 30% tax at first, 0% after 7 days." />
        </div>
      </section>

      <StatsStrip curves={curves} />
      <HowItWorks />
      <ActivityStrip items={activity} curves={curves} />

      <section id="tokens" className="list-wrap">
        <div className="list-head">
          <h2>Tokens</h2>
          <div className="seg" role="tablist" aria-label="Sort tokens">
            {(
              [
                ["new", "Newest"],
                ["close", "Closest to full"],
                ["big", "Biggest"],
              ] as [Sort, string][]
            ).map(([k, label]) => (
              <button key={k} role="tab" aria-selected={sort === k} className={sort === k ? "seg-on" : ""} onClick={() => setSort(k)}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <p className="notice notice-bad">
            Can’t reach the network: {error}. Check that your validator is running and NEXT_PUBLIC_RPC_URL points at it.
          </p>
        )}
        {!error && curves === null && <p className="notice">Loading tokens…</p>}
        {curves && curves.length === 0 && (
          <div className="empty">
            <p>No tokens yet.</p>
            <Link href="/create" className="btn btn-primary">
              Launch the first one
            </Link>
          </div>
        )}

        <div className="tgrid">
          {sorted.map((c) => (
            <TokenCard key={c.address.toBase58()} c={c} />
          ))}
        </div>
      </section>
    </>
  );
}
