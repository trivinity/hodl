// Reads HODL program events from the chain and stores them, so the site does not have to
// re-read hundreds of transactions on every page load.
// Imports are kept light and relative so tests can run this file directly.
import * as anchor from "@anchor-lang/core";
import { PublicKey, type Connection } from "@solana/web3.js";
import { swapsInTransaction } from "./poolSwaps.ts";

export type CurveRow = {
  mint: string;
  creator: string;
  name: string;
  symbol: string;
  uri: string;
  fee_bps: number;
  holder_fee_bps: number;
  platform_fee_bps: number;
  max_tax_bps: number;
  decay_secs: number;
  holder_sell_bps: number;
  window_secs: number;
  reward_bps: number;
  created_at: string;
  create_sig: string;
};
export type TradeRow = {
  sig: string;
  idx: number;
  mint: string;
  trader: string;
  is_buy: boolean;
  sol: number;
  tokens: number;
  tax: number;
  rewards: number;
  fee_to_holders: number;
  fee_to_platform: number;
  virtual_sol: number;
  virtual_tokens: number;
  ts: string;
  slot: number;
};
export type ClaimRow = { sig: string; idx: number; mint: string; claimer: string; amount: number; ts: string; slot: number };
/** A token that finished graduating: the Meteora pool it now trades on and what went into it. */
export type GraduationRow = { mint: string; pool: string; lp_sol: number; lp_tokens: number; sig: string; ts: string; slot: number };
/** Pool trading fees paid out to the treasury. */
export type PoolFeeRow = { sig: string; idx: number; mint: string; amount: number; ts: string; slot: number };
/** A swap on the Meteora pool of a graduated token. cap_sol is the market cap right after it. */
export type PoolTradeRow = { sig: string; idx: number; mint: string; pool: string; trader: string; is_buy: boolean; sol: number; tokens: number; cap_sol: number; ts: string; slot: number };
export type Rows = { curves: CurveRow[]; trades: TradeRow[]; claims: ClaimRow[]; graduations: GraduationRow[]; poolFees: PoolFeeRow[]; poolTrades: PoolTradeRow[] };
const emptyRows = (): Rows => ({ curves: [], trades: [], claims: [], graduations: [], poolFees: [], poolTrades: [] });

/** Where the indexer keeps its rows and its place in the chain. Supabase in production, memory in tests. */
export interface Store {
  /** `id` picks which place in the chain: "main" for the HODL program, "pool:<address>" for a Meteora pool */
  getCursor(id?: string): Promise<string | null>;
  save(rows: Rows, cursor: { sig: string; slot: number } | null, id?: string): Promise<void>;
  /** every graduated token and its pool, so their swaps can be read too */
  pools(): Promise<{ mint: string; pool: string }[]>;
}

export type IndexResult = {
  signatures: number;
  transactions: number;
  curves: number;
  trades: number;
  claims: number;
  graduations: number;
  poolFees: number;
  poolTrades: number;
  /** true if the run could not reach the saved cursor: some older transactions may have been skipped */
  gap: boolean;
  cursor: string | null;
};

// all HODL amounts are below 2^53 (total supply is 1e15), so plain numbers are exact
const num = (x: any) => Number(x.toString());
const iso = (unix: number) => new Date(unix * 1000).toISOString();

/** Turn the events of one transaction into rows. Pure, so it is easy to test. */
export function eventsToRows(sig: string, slot: number, blockTime: number | null, events: { name: string; data: any }[]): Rows {
  const rows = emptyRows();
  events.forEach((e, idx) => {
    const d = e.data;
    const name = e.name.toLowerCase();
    if (name === "curvecreated") {
      rows.curves.push({
        mint: d.mint.toBase58(),
        creator: d.creator.toBase58(),
        name: d.name,
        symbol: d.symbol,
        uri: d.uri,
        fee_bps: d.feeBps,
        holder_fee_bps: d.holderFeeBps,
        platform_fee_bps: d.platformFeeBps,
        max_tax_bps: d.maxTaxBps,
        decay_secs: num(d.decaySecs),
        holder_sell_bps: d.holderSellBps,
        window_secs: num(d.windowSecs),
        reward_bps: d.rewardBps,
        created_at: iso(num(d.ts)),
        create_sig: sig,
      });
    } else if (name === "trade") {
      rows.trades.push({
        sig,
        idx,
        mint: d.mint.toBase58(),
        trader: d.trader.toBase58(),
        is_buy: d.isBuy,
        sol: num(d.sol),
        tokens: num(d.tokens),
        tax: num(d.tax),
        rewards: num(d.rewards),
        fee_to_holders: num(d.feeToHolders),
        fee_to_platform: num(d.feeToPlatform),
        virtual_sol: num(d.virtualSol),
        virtual_tokens: num(d.virtualTokens),
        ts: iso(num(d.ts)),
        slot,
      });
    } else if (name === "rewardsclaimed") {
      rows.claims.push({
        sig,
        idx,
        mint: d.mint.toBase58(),
        claimer: d.claimer.toBase58(),
        amount: num(d.amount),
        ts: iso(blockTime ?? Math.floor(Date.now() / 1000)),
        slot,
      });
    } else if (name === "graduated") {
      rows.graduations.push({
        mint: d.mint.toBase58(),
        pool: d.pool.toBase58(),
        lp_sol: num(d.lpSol),
        lp_tokens: num(d.lpTokens),
        sig,
        ts: iso(blockTime ?? Math.floor(Date.now() / 1000)),
        slot,
      });
    } else if (name === "poolfeesclaimed") {
      rows.poolFees.push({ sig, idx, mint: d.mint.toBase58(), amount: num(d.amount), ts: iso(blockTime ?? Math.floor(Date.now() / 1000)), slot });
    }
  });
  return rows;
}

/** Newest-first list of signatures newer than `untilSig`. */
export async function collectNewSignatures(connection: Connection, programId: PublicKey, untilSig: string | null, maxPages = 50) {
  const out: { signature: string; slot: number; err: any; blockTime?: number | null }[] = [];
  let before: string | undefined;
  for (let i = 0; i < maxPages; i++) {
    const page = await connection.getSignaturesForAddress(programId, { before, until: untilSig ?? undefined, limit: 100 }, "confirmed");
    out.push(...page);
    if (page.length < 100) return { sigs: out, gap: false };
    before = page[page.length - 1].signature;
  }
  return { sigs: out, gap: untilSig !== null };
}

export async function indexOnce(opts: { connection: Connection; program: anchor.Program<any>; store: Store; batch?: number }): Promise<IndexResult> {
  const { connection, program, store } = opts;
  const batch = opts.batch ?? 5;
  const parser = new anchor.EventParser(program.programId, program.coder);

  const cursor = await store.getCursor();
  const { sigs, gap } = await collectNewSignatures(connection, program.programId, cursor);
  const oldestFirst = sigs.reverse().filter((s) => !s.err);

  const rows = emptyRows();
  let transactions = 0;
  let last: { sig: string; slot: number } | null = null;
  let stop = false;

  for (let i = 0; i < oldestFirst.length && !stop; i += batch) {
    const slice = oldestFirst.slice(i, i + batch);
    const txs = await Promise.all(slice.map((s) => connection.getTransaction(s.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 })));
    for (let j = 0; j < slice.length; j++) {
      const tx = txs[j];
      // a transaction the RPC cannot show yet: stop here so the next run picks it up and nothing is skipped
      if (!tx?.meta?.logMessages) {
        stop = true;
        break;
      }
      const events = [...parser.parseLogs(tx.meta.logMessages)] as { name: string; data: any }[];
      const r = eventsToRows(slice[j].signature, slice[j].slot, tx.blockTime ?? null, events);
      rows.curves.push(...r.curves);
      rows.trades.push(...r.trades);
      rows.claims.push(...r.claims);
      rows.graduations.push(...r.graduations);
      rows.poolFees.push(...r.poolFees);
      transactions++;
      last = { sig: slice[j].signature, slot: slice[j].slot };
    }
  }

  await store.save(rows, last);

  // swaps on the Meteora pools of graduated tokens
  let poolTrades = 0;
  for (const { mint, pool } of (await store.pools()).slice(0, MAX_POOLS_PER_RUN)) {
    poolTrades += await indexPool({ connection, store, mint, pool, batch });
  }

  return {
    poolTrades,
    signatures: oldestFirst.length,
    transactions,
    curves: rows.curves.length,
    trades: rows.trades.length,
    claims: rows.claims.length,
    graduations: rows.graduations.length,
    poolFees: rows.poolFees.length,
    gap,
    cursor: last?.sig ?? cursor,
  };
}

const MAX_POOLS_PER_RUN = 25;
const DAMM_ID = new PublicKey("cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG");

/** Read the new swaps of one pool and save them. Returns how many swaps were found. */
export async function indexPool(opts: { connection: Connection; store: Store; mint: string; pool: string; batch?: number }): Promise<number> {
  const { connection, store, mint, pool } = opts;
  const batch = opts.batch ?? 5;
  const id = `pool:${pool}`;
  const { sigs } = await collectNewSignatures(connection, new PublicKey(pool), await store.getCursor(id), 10);
  const oldestFirst = sigs.reverse().filter((x) => !x.err);
  const rows = emptyRows();
  let last: { sig: string; slot: number } | null = null;
  let stop = false;
  for (let i = 0; i < oldestFirst.length && !stop; i += batch) {
    const slice = oldestFirst.slice(i, i + batch);
    const txs = await Promise.all(slice.map((x) => connection.getTransaction(x.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 })));
    for (let j = 0; j < slice.length; j++) {
      const tx = txs[j];
      if (!tx?.meta) {
        stop = true; // not readable yet: the next run picks it up
        break;
      }
      swapsInTransaction(tx, pool, mint).forEach(({ swap, trader }, idx) => {
        rows.poolTrades.push({
          sig: slice[j].signature,
          idx,
          mint,
          pool,
          trader,
          is_buy: swap.isBuy,
          sol: num(swap.sol),
          tokens: num(swap.tokens),
          cap_sol: swap.capSol,
          ts: iso(tx.blockTime ?? Math.floor(Date.now() / 1000)),
          slot: slice[j].slot,
        });
      });
      last = { sig: slice[j].signature, slot: slice[j].slot };
    }
  }
  if (rows.poolTrades.length || last) await store.save(rows, last, id);
  return rows.poolTrades.length;
}

/** Store backed by a Supabase client (server side, service role key). Upserts make every run safe to repeat. */
export function supabaseStore(db: any): Store {
  const must = (res: { error: { message: string } | null }, what: string) => {
    if (res.error) throw new Error(`${what}: ${res.error.message}`);
  };
  return {
    async getCursor(id = "main") {
      const res = await db.from("indexer_state").select("last_sig").eq("id", id).maybeSingle();
      must(res, "read cursor");
      return res.data?.last_sig ?? null;
    },
    async pools() {
      const res = await db.from("graduations").select("mint,pool");
      must(res, "read pools");
      return (res.data ?? []) as { mint: string; pool: string }[];
    },
    async save(rows, cursor, id = "main") {
      if (rows.poolTrades.length) must(await db.from("pool_trades").upsert(rows.poolTrades, { onConflict: "sig,idx" }), "save pool trades");
      if (rows.curves.length) must(await db.from("curves").upsert(rows.curves, { onConflict: "mint" }), "save curves");
      if (rows.trades.length) must(await db.from("trades").upsert(rows.trades, { onConflict: "sig,idx" }), "save trades");
      if (rows.claims.length) must(await db.from("claims").upsert(rows.claims, { onConflict: "sig,idx" }), "save claims");
      if (rows.graduations.length) must(await db.from("graduations").upsert(rows.graduations, { onConflict: "mint" }), "save graduations");
      if (rows.poolFees.length) must(await db.from("pool_fee_claims").upsert(rows.poolFees, { onConflict: "sig,idx" }), "save pool fee claims");
      if (cursor) {
        must(
          await db.from("indexer_state").upsert({ id, last_sig: cursor.sig, last_slot: cursor.slot, updated_at: new Date().toISOString() }, { onConflict: "id" }),
          "save cursor"
        );
      }
    },
  };
}

/** In-memory store for tests and dry runs. */
export function memoryStore(): Store & { rows: Rows; cursor: string | null } {
  const s = {
    rows: emptyRows(),
    cursor: null as string | null,
    cursors: {} as Record<string, string>,
    async getCursor(id = "main") {
      return id === "main" ? s.cursor : s.cursors[id] ?? null;
    },
    async pools() {
      return s.rows.graduations.map((g) => ({ mint: g.mint, pool: g.pool }));
    },
    async save(rows: Rows, c: { sig: string; slot: number } | null, id = "main") {
      s.rows.poolTrades.push(...rows.poolTrades);
      if (id !== "main") {
        if (c) s.cursors[id] = c.sig;
        return;
      }
      s.rows.curves.push(...rows.curves);
      s.rows.trades.push(...rows.trades);
      s.rows.claims.push(...rows.claims);
      s.rows.graduations.push(...rows.graduations);
      s.rows.poolFees.push(...rows.poolFees);
      if (c) s.cursor = c.sig;
    },
  };
  return s;
}
