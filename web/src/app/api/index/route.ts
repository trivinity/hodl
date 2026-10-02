import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Connection } from "@solana/web3.js";
import { RPC_URL, readProgram } from "@/lib/program";
import { indexOnce, supabaseStore } from "@/lib/indexer";

// Run by a scheduler (for example every minute or two). Reads new program events from the chain
// and saves them to Supabase. Protected by a secret so only the scheduler can start it.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret || !url || !serviceKey) {
    return NextResponse.json({ error: "Indexer is not configured. Set CRON_SECRET, NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY." }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  }
  try {
    const connection = new Connection(RPC_URL, "confirmed");
    const db = createClient(url, serviceKey, { auth: { persistSession: false } });
    const result = await indexOnce({ connection, program: readProgram(connection), store: supabaseStore(db) });
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e).slice(0, 300) }, { status: 500 });
  }
}
