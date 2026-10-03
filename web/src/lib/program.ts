import * as anchor from "@anchor-lang/core";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import idlJson from "../idl.json";
import { dbActivity, dbConfigured, dbTrades } from "./db";

export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "http://127.0.0.1:8899";
export const CLUSTER_LABEL = process.env.NEXT_PUBLIC_CLUSTER_LABEL || "localnet";
const PROGRAM_ID_STR = process.env.NEXT_PUBLIC_PROGRAM_ID || (idlJson as any).address;
export const PROGRAM_ID = new PublicKey(PROGRAM_ID_STR);

const idl: any = { ...(idlJson as any), address: PROGRAM_ID.toBase58() };

/** read-only program (no wallet) for browsing */
export function readProgram(connection: Connection): anchor.Program<any> {
  const dummy = Keypair.generate();
  const wallet = {
    publicKey: dummy.publicKey,
    signTransaction: async (t: any) => t,
    signAllTransactions: async (t: any) => t,
  };
  const provider = new anchor.AnchorProvider(connection, wallet as any, { commitment: "confirmed" });
  return new anchor.Program(idl, provider);
}

export function walletProgram(connection: Connection, wallet: anchor.Wallet): anchor.Program<any> {
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  return new anchor.Program(idl, provider);
}

export function configPda() {
  return PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID)[0];
}

export type ConfigView = { admin: string; pendingAdmin: string | null; treasury: string; platformFeeBps: number; paused: boolean };

/** global settings: whether trading is paused and the platform fee for new tokens. null if the program was never set up */
export async function getConfig(program: anchor.Program<any>): Promise<ConfigView | null> {
  const c = await (program.account as any).config.fetchNullable(configPda());
  return c
    ? {
        admin: c.admin.toBase58(),
        pendingAdmin: c.pendingAdmin.equals(PublicKey.default) ? null : c.pendingAdmin.toBase58(),
        treasury: c.treasury.toBase58(),
        platformFeeBps: c.platformFeeBps,
        paused: c.paused,
      }
    : null;
}

export function curvePda(mint: PublicKey) {
  return PublicKey.findProgramAddressSync([Buffer.from("curve"), mint.toBuffer()], PROGRAM_ID)[0];
}
export function positionPda(mint: PublicKey, owner: PublicKey) {
  return PublicKey.findProgramAddressSync([Buffer.from("position"), mint.toBuffer(), owner.toBuffer()], PROGRAM_ID)[0];
}
/** every HODL token is a Token-2022 token, so its token accounts live under that program */
export function ata(mint: PublicKey, owner: PublicKey, allowOwnerOffCurve = false) {
  return getAssociatedTokenAddressSync(mint, owner, allowOwnerOffCurve, TOKEN_2022_PROGRAM_ID);
}

export type CurveView = {
  address: PublicKey;
  creator: PublicKey;
  mint: PublicKey;
  name: string;
  symbol: string;
  uri: string;
  vs: bigint;
  vt: bigint;
  realSol: bigint;
  realTokens: bigint;
  feeBps: number;
  holderFeeBps: number;
  platformFeeBps: number;
  maxTaxBps: number;
  decaySecs: number;
  holderSellBps: number;
  windowSecs: number;
  createdAt: number;
  complete: boolean;
  rewardBps: number;
  totalTracked: bigint;
  accPerToken: bigint;
  rewardPool: bigint;
};

const b = (x: any) => BigInt(x.toString());

export function toCurveView(address: PublicKey, c: any): CurveView {
  return {
    address,
    creator: c.creator,
    mint: c.mint,
    name: c.name,
    symbol: c.symbol,
    uri: c.uri,
    vs: b(c.virtualSol),
    vt: b(c.virtualTokens),
    realSol: b(c.realSol),
    realTokens: b(c.realTokens),
    feeBps: c.feeBps,
    holderFeeBps: c.holderFeeBps,
    platformFeeBps: c.platformFeeBps,
    maxTaxBps: c.maxTaxBps,
    decaySecs: Number(c.decaySecs),
    holderSellBps: c.holderSellBps,
    windowSecs: Number(c.windowSecs),
    createdAt: Number(c.createdAt),
    complete: c.complete,
    rewardBps: c.rewardBps,
    totalTracked: b(c.totalTracked),
    accPerToken: b(c.accPerToken),
    rewardPool: b(c.rewardPool),
  };
}

// 8 byte discriminator + Curve::INIT_SPACE from the program. Update when the Curve struct changes;
// tokens made with an older layout have a different size and are skipped.
const CURVE_ACCOUNT_SIZE = 372;

export async function listCurves(program: anchor.Program<any>): Promise<CurveView[]> {
  if (!(program.account as any).curve) {
    throw new Error("The program IDL is missing. Run `npm run sync-idl` in the web folder after `anchor build`, then restart.");
  }
  // decode one by one so tokens made with an older program layout are skipped instead of breaking the list
  const raw = await program.provider.connection.getProgramAccounts(program.programId, {
    filters: [{ dataSize: CURVE_ACCOUNT_SIZE }, { memcmp: { offset: 0, bytes: anchor.utils.bytes.bs58.encode((program.coder.accounts as any).accountDiscriminator("curve")) } }],
  });
  const out: CurveView[] = [];
  for (const r of raw) {
    try {
      out.push(toCurveView(r.pubkey, program.coder.accounts.decode("curve", r.account.data)));
    } catch {
      /* old layout, ignore */
    }
  }
  // tokens made before the move to Token-2022 cannot trade with the current program: hide them
  const keep: CurveView[] = [];
  for (let i = 0; i < out.length; i += 100) {
    const chunk = out.slice(i, i + 100);
    const infos = await program.provider.connection.getMultipleAccountsInfo(chunk.map((c) => c.mint));
    chunk.forEach((c, j) => {
      if (infos[j]?.owner.equals(TOKEN_2022_PROGRAM_ID)) keep.push(c);
    });
  }
  return keep;
}

export async function getCurve(program: anchor.Program<any>, mint: PublicKey): Promise<CurveView | null> {
  const address = curvePda(mint);
  const c = await (program.account as any).curve.fetchNullable(address);
  return c ? toCurveView(address, c) : null;
}

export type PositionView = {
  avgTs: bigint;
  tracked: bigint;
  windowStart: bigint;
  windowBase: bigint;
  windowSold: bigint;
  rewardDebt: bigint;
  pendingRewards: bigint;
};

export async function getPosition(program: anchor.Program<any>, mint: PublicKey, owner: PublicKey): Promise<PositionView | null> {
  const p = await (program.account as any).position.fetchNullable(positionPda(mint, owner));
  if (!p) return null;
  return {
    avgTs: b(p.avgTs),
    tracked: b(p.trackedTokens ?? p.tracked),
    windowStart: b(p.windowStart),
    windowBase: b(p.windowBase),
    windowSold: b(p.windowSold),
    rewardDebt: b(p.rewardDebt),
    pendingRewards: b(p.pendingRewards),
  };
}

export async function getTokenBalance(connection: Connection, mint: PublicKey, owner: PublicKey): Promise<bigint> {
  try {
    const r = await connection.getTokenAccountBalance(ata(mint, owner));
    return BigInt(r.value.amount);
  } catch {
    return 0n;
  }
}

export type TradeView = { sig: string; isBuy: boolean; trader: string; sol: bigint; tokens: bigint; tax: bigint; rewards: bigint; ts: number };

export async function loadTrades(connection: Connection, program: anchor.Program<any>, curve: PublicKey, mint?: PublicKey): Promise<TradeView[]> {
  // fast path: the indexed copy in Supabase, if it is set up
  if (mint && dbConfigured) {
    try {
      const rows = await dbTrades(mint.toBase58());
      // an empty answer may just mean the indexer has not caught up (or points at another network): fall through to the chain
      if (rows.length === 0) throw new Error("no indexed rows");
      return rows.map((r) => ({
        sig: r.sig,
        isBuy: r.is_buy,
        trader: r.trader,
        sol: BigInt(r.sol),
        tokens: BigInt(r.tokens),
        tax: BigInt(r.tax),
        rewards: BigInt(r.rewards),
        ts: Math.floor(new Date(r.ts).getTime() / 1000),
      }));
    } catch {
      /* fall through to reading the chain */
    }
  }
  const sigs = await connection.getSignaturesForAddress(curve, { limit: 25 });
  const parser = new anchor.EventParser(program.programId, program.coder);
  const out: TradeView[] = [];
  for (const s of sigs) {
    if (s.err) continue;
    const tx = await connection.getTransaction(s.signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
    const logs = tx?.meta?.logMessages;
    if (!logs) continue;
    for (const ev of parser.parseLogs(logs)) {
      if (ev.name.toLowerCase() !== "trade") continue;
      const d: any = ev.data;
      out.push({
        sig: s.signature,
        isBuy: d.isBuy,
        trader: d.trader.toBase58(),
        sol: b(d.sol),
        tokens: b(d.tokens),
        tax: b(d.tax),
        rewards: b(d.rewards),
        ts: Number(d.ts),
      });
    }
  }
  return out;
}

export type ActivityItem = {
  sig: string;
  kind: "buy" | "sell" | "launch" | "claim";
  mint: string;
  who: string;
  sol: bigint;
  ts: number;
};

/** the latest things that happened across all tokens: from the database if it has rows, otherwise straight from the chain */
export async function loadActivity(
  connection: Connection,
  program: anchor.Program<any>,
  limit = 14,
  /** only keep activity for tokens that exist on this network (the database may hold rows from another chain) */
  knownMints?: Set<string>
): Promise<ActivityItem[]> {
  if (dbConfigured) {
    try {
      const all = await dbActivity(limit * 3);
      const rows = knownMints ? all.filter((r) => knownMints.has(r.mint)).slice(0, limit) : all.slice(0, limit);
      if (rows.length > 0) {
        return rows.map((r) => ({
          sig: r.sig,
          kind: r.is_buy ? "buy" : "sell",
          mint: r.mint,
          who: r.trader,
          sol: BigInt(r.sol),
          ts: Math.floor(new Date(r.ts).getTime() / 1000),
        }));
      }
    } catch {
      /* fall through to the chain */
    }
  }
  const sigs = (await connection.getSignaturesForAddress(program.programId, { limit }, "confirmed")).filter((s) => !s.err);
  const parser = new anchor.EventParser(program.programId, program.coder);
  const out: ActivityItem[] = [];
  for (let i = 0; i < sigs.length; i += 5) {
    const batch = sigs.slice(i, i + 5);
    const txs = await Promise.all(batch.map((s) => connection.getTransaction(s.signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" }).catch(() => null)));
    txs.forEach((tx, j) => {
      const logs = tx?.meta?.logMessages;
      if (!logs) return;
      for (const ev of parser.parseLogs(logs)) {
        const d: any = ev.data;
        const name = ev.name.toLowerCase();
        if (name === "trade") {
          out.push({ sig: batch[j].signature, kind: d.isBuy ? "buy" : "sell", mint: d.mint.toBase58(), who: d.trader.toBase58(), sol: b(d.sol), ts: Number(d.ts) });
        } else if (name === "curvecreated") {
          out.push({ sig: batch[j].signature, kind: "launch", mint: d.mint.toBase58(), who: d.creator.toBase58(), sol: 0n, ts: Number(d.ts) });
        } else if (name === "rewardsclaimed") {
          out.push({ sig: batch[j].signature, kind: "claim", mint: d.mint.toBase58(), who: d.claimer.toBase58(), sol: b(d.amount), ts: tx?.blockTime ?? Math.floor(Date.now() / 1000) });
        }
      }
    });
  }
  return out.sort((a, c) => c.ts - a.ts).slice(0, limit);
}
