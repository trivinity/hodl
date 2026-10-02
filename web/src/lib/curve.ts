// Mirrors programs/hold_launchpad/src/math.rs. Keep the two in sync.
export const BPS = 10_000n;
export const TOTAL_SUPPLY = 1_000_000_000_000_000n; // 1B tokens, 6 decimals
export const INIT_VIRTUAL_SOL = 30_000_000_000n; // 30 SOL
export const INIT_VIRTUAL_TOKENS = 1_073_000_000_000_000n;
export const INIT_REAL_TOKENS = 793_100_000_000_000n;
export const LAMPORTS = 1_000_000_000n;
export const TOKEN_UNIT = 1_000_000n;

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

export type Buy = { tokensOut: bigint; cost: bigint; fee: bigint; net: bigint };
export type SellQ = { gross: bigint; fee: bigint; net: bigint };

export function buyQuote(vs: bigint, vt: bigint, realTokens: bigint, solIn: bigint, feeBps: bigint): Buy | null {
  if (solIn <= 0n || realTokens <= 0n) return null;
  const k = vs * vt;
  let fee = ceilDiv(solIn * feeBps, BPS);
  let net = solIn - fee;
  let cost = solIn;
  let newVt = ceilDiv(k, vs + net);
  let tokensOut = vt - newVt;
  if (tokensOut > realTokens) {
    tokensOut = realTokens;
    const vtAfter = vt - tokensOut;
    const vsAfter = ceilDiv(k, vtAfter);
    net = vsAfter - vs;
    cost = ceilDiv(net * BPS, BPS - feeBps);
    fee = cost - net;
  }
  if (tokensOut <= 0n) return null;
  return { tokensOut, cost, fee, net };
}

export function sellQuote(vs: bigint, vt: bigint, tokensIn: bigint, feeBps: bigint): SellQ | null {
  if (tokensIn <= 0n) return null;
  const k = vs * vt;
  const newVt = vt + tokensIn;
  const newVs = ceilDiv(k, newVt);
  const gross = vs - newVs;
  if (gross <= 0n) return null;
  const fee = (gross * feeBps) / BPS;
  return { gross, fee, net: gross - fee };
}

/** 0..max_bps, linear fade over decaySecs */
export function decayTaxBps(heldSecs: number, decaySecs: number, maxBps: number): number {
  if (decaySecs <= 0 || heldSecs <= 0) return maxBps;
  if (heldSecs >= decaySecs) return 0;
  return Math.floor((maxBps * (decaySecs - heldSecs)) / decaySecs);
}

/** holder part of a trade fee when the fee is split between creator and holders */
export function holderFeePart(fee: bigint, creatorBps: number, holderBps: number): bigint {
  const total = BigInt(creatorBps + holderBps);
  return total === 0n ? 0n : (fee * BigInt(holderBps)) / total;
}

/** platform part of a trade fee: fee * platform_bps / total_bps (mirrors platform_fee_part in math.rs) */
export function platformFeePart(fee: bigint, totalBps: number, platformBps: number): bigint {
  return totalBps === 0 ? 0n : (fee * BigInt(platformBps)) / BigInt(totalBps);
}

/** how a trade fee is shared: platform first, then holders and creator split the rest (mirrors the program) */
export function splitFee(fee: bigint, creatorBps: number, holderBps: number, platformBps: number) {
  const platform = platformFeePart(fee, creatorBps + holderBps + platformBps, platformBps);
  const rest = fee - platform;
  const holders = holderFeePart(rest, creatorBps, holderBps);
  return { platform, holders, creator: rest - holders };
}

export const ACC_SCALE = 1_000_000_000_000n;
export const MIN_REWARD_TRACKED = 1_000_000n;

/** share of a sell tax that goes to holders */
export function rewardShare(tax: bigint, rewardBps: number): bigint {
  return (tax * BigInt(rewardBps)) / BPS;
}

/** lamports actually paid out to holders for a sell (rounding dust stays in the pool) */
export function rewardDistributed(amount: bigint, totalTracked: bigint): bigint {
  if (amount <= 0n || totalTracked < MIN_REWARD_TRACKED) return 0n;
  const inc = (amount * ACC_SCALE) / totalTracked;
  return (inc * totalTracked) / ACC_SCALE;
}

/** what a position can claim right now */
export function rewardOwed(tracked: bigint, acc: bigint, debt: bigint, pending: bigint): bigint {
  const total = (tracked * acc) / ACC_SCALE;
  return pending + (total > debt ? total - debt : 0n);
}

export function weightedAvgTs(oldBal: bigint, oldTs: bigint, add: bigint, now: bigint): bigint {
  const total = oldBal + add;
  if (total === 0n || oldBal === 0n) return now;
  return (oldBal * oldTs + add * now) / total;
}

/** SOL per whole token */
export function priceSol(vs: bigint, vt: bigint): number {
  if (vt === 0n) return 0;
  return (Number(vs) / 1e9) / (Number(vt) / 1e6);
}

export function marketCapSol(vs: bigint, vt: bigint): number {
  return priceSol(vs, vt) * 1_000_000_000;
}

export function progress(realTokens: bigint): number {
  const sold = INIT_REAL_TOKENS - realTokens;
  return Math.max(0, Math.min(1, Number(sold) / Number(INIT_REAL_TOKENS)));
}
