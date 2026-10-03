import { NextResponse } from "next/server";

// SOL price in US dollars for the "USD" display option. Fetched on the server and cached for a minute,
// so visitors' browsers never talk to the price service themselves.
export const revalidate = 60;

async function coingecko(): Promise<number | null> {
  const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd", { next: { revalidate: 60 } });
  if (!res.ok) return null;
  const v = (await res.json())?.solana?.usd;
  return typeof v === "number" && v > 0 ? v : null;
}

async function jupiter(): Promise<number | null> {
  const mint = "So11111111111111111111111111111111111111112";
  const res = await fetch(`https://lite-api.jup.ag/price/v3?ids=${mint}`, { next: { revalidate: 60 } });
  if (!res.ok) return null;
  const v = (await res.json())?.[mint]?.usdPrice;
  return typeof v === "number" && v > 0 ? v : null;
}

export async function GET() {
  for (const source of [coingecko, jupiter]) {
    try {
      const usd = await source();
      if (usd) return NextResponse.json({ usd }, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } });
    } catch {
      /* try the next source */
    }
  }
  return NextResponse.json({ error: "Price unavailable." }, { status: 503 });
}
