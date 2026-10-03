// Reads swaps on a graduated token's Meteora pool out of transactions.
// Meteora reports each swap as an `EvtSwap2` event written into an inner instruction of its own program
// (not into the logs), so the log parser the rest of the site uses cannot see it. The layout below comes from
// Meteora's published IDL (checked against a real swap in tests/graduation.cts). No IDL is shipped to browsers.

export const DAMM_PROGRAM = "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG";

// 8 byte tag Anchor puts in front of events sent through a self call, then the event's own 8 byte id
const EVENT_TAG = [0xe4, 0x45, 0xa5, 0x2e, 0x51, 0xcb, 0x9a, 0x1d];
const SWAP2_ID = [189, 66, 51, 168, 38, 80, 117, 153];

export type PoolSwap = {
  pool: string;
  /** true when SOL went in and tokens came out */
  isBuy: boolean;
  /** lamports: paid (buy) or received (sell) */
  sol: bigint;
  /** raw token units: received (buy) or sold (sell) */
  tokens: bigint;
  /** market cap in SOL right after the swap */
  capSol: number;
};

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function base58Decode(s: string): Uint8Array {
  const bytes: number[] = [];
  for (const ch of s) {
    let carry = B58.indexOf(ch);
    if (carry < 0) throw new Error("bad base58");
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const ch of s) {
    if (ch !== "1") break;
    bytes.push(0);
  }
  return Uint8Array.from(bytes.reverse());
}
function base58Encode(b: Uint8Array): string {
  const digits: number[] = [];
  for (const byte of b) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = "";
  for (const byte of b) {
    if (byte !== 0) break;
    out += "1";
  }
  for (let i = digits.length - 1; i >= 0; i--) out += B58[digits[i]];
  return out;
}

const u64 = (v: DataView, o: number) => v.getBigUint64(o, true);
const u128 = (v: DataView, o: number) => (v.getBigUint64(o + 8, true) << 64n) | v.getBigUint64(o, true);

/** market cap in SOL from a pool's square root price (Q64.64). Token A is the HODL token (6 decimals), token B is SOL (9). */
export function capFromSqrtPrice(sqrtPrice: bigint): number {
  const root = Number(sqrtPrice) / 2 ** 64;
  return root * root * 1e6; // lamports per base unit * 1e6 / 1e9 = SOL per token, times 1B supply
}

/** Decode one inner instruction's data as a swap event, or null if it is anything else. */
export function decodeSwapEvent(data: Uint8Array): PoolSwap | null {
  if (data.length < 16 + 180) return null;
  for (let i = 0; i < 8; i++) if (data[i] !== EVENT_TAG[i] || data[8 + i] !== SWAP2_ID[i]) return null;
  const body = data.subarray(16);
  const v = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const direction = body[32]; // 0 = token A to B (a sell), 1 = B to A (a buy)
  const includedIn = u64(v, 52);
  const output = u64(v, 76);
  const nextSqrt = u128(v, 84);
  const isBuy = direction === 1;
  return {
    pool: base58Encode(body.subarray(0, 32)),
    isBuy,
    sol: isBuy ? includedIn : output,
    tokens: isBuy ? output : includedIn,
    capSol: capFromSqrtPrice(nextSqrt),
  };
}

/**
 * Who traded: the wallet whose balance of this token went up (a buy) or down (a sell) the most.
 * The fee payer is not always the trader (a relayer or a router can pay), so it is only the fallback.
 */
function traderFromBalances(tx: any, mint: string, isBuy: boolean, fallback: string): string {
  const pre = new Map<number, bigint>();
  for (const b of tx.meta?.preTokenBalances ?? []) if (b.mint === mint) pre.set(b.accountIndex, BigInt(b.uiTokenAmount.amount));
  let best: { owner: string; score: bigint } | null = null;
  for (const b of tx.meta?.postTokenBalances ?? []) {
    if (b.mint !== mint || !b.owner) continue;
    const delta = BigInt(b.uiTokenAmount.amount) - (pre.get(b.accountIndex) ?? 0n);
    const score = isBuy ? delta : -delta;
    if (score > 0n && (!best || score > best.score)) best = { owner: b.owner, score };
  }
  return best?.owner ?? fallback;
}

/** All swaps for one pool inside a fetched transaction (from getTransaction), in order. */
export function swapsInTransaction(tx: any, poolAddress: string, mint: string): { swap: PoolSwap; trader: string }[] {
  const inner = tx?.meta?.innerInstructions;
  if (!inner) return [];
  const msg = tx.transaction?.message;
  let keys: any;
  try {
    keys = msg.getAccountKeys({ accountKeysFromLookups: tx.meta.loadedAddresses });
  } catch {
    return [];
  }
  const payer = keys.get(0)?.toBase58?.() ?? "";
  const out: { swap: PoolSwap; trader: string }[] = [];
  for (const group of inner) {
    for (const ix of group.instructions) {
      if (keys.get(ix.programIdIndex)?.toBase58?.() !== DAMM_PROGRAM) continue;
      let swap: PoolSwap | null = null;
      try {
        swap = decodeSwapEvent(base58Decode(ix.data));
      } catch {
        swap = null;
      }
      if (swap && swap.pool === poolAddress) out.push({ swap, trader: traderFromBalances(tx, mint, swap.isBuy, payer) });
    }
  }
  return out;
}
