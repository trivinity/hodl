const { assert } = require("chai");
const { base58Decode, decodeSwapEvent, capFromSqrtPrice } = require("../web/src/lib/poolSwaps.ts");
const { PublicKey } = require("@solana/web3.js");

// builds the bytes Meteora writes for a swap event
function swapBytes(pool: any, direction: number, included: bigint, output: bigint, nextSqrt: bigint) {
  const b = Buffer.alloc(16 + 180);
  Buffer.from([0xe4, 0x45, 0xa5, 0x2e, 0x51, 0xcb, 0x9a, 0x1d, 189, 66, 51, 168, 38, 80, 117, 153]).copy(b, 0);
  pool.toBuffer().copy(b, 16);
  b[16 + 32] = direction;
  b.writeBigUInt64LE(included, 16 + 52);
  b.writeBigUInt64LE(output, 16 + 76);
  b.writeBigUInt64LE(nextSqrt & ((1n << 64n) - 1n), 16 + 84);
  b.writeBigUInt64LE(nextSqrt >> 64n, 16 + 92);
  return new Uint8Array(b);
}

describe("pool swap decoder", () => {
  const pool = PublicKey.unique();
  it("reads a buy and a sell", () => {
    const sp = 1n << 64n; // price 1 lamport per base unit
    const buy = decodeSwapEvent(swapBytes(pool, 1, 1_000n, 5_000n, sp));
    assert.deepInclude(buy, { pool: pool.toBase58(), isBuy: true, sol: 1_000n, tokens: 5_000n });
    const sell = decodeSwapEvent(swapBytes(pool, 0, 7_000n, 900n, sp));
    assert.deepInclude(sell, { isBuy: false, sol: 900n, tokens: 7_000n });
    assert.closeTo(buy.capSol, 1e6, 1e-6); // 1 lamport per base unit = 1e6 SOL for a 1B supply of 6 decimal tokens
  });
  it("ignores anything that is not a swap", () => {
    const b = swapBytes(pool, 1, 1n, 1n, 1n << 64n);
    b[9] = 0;
    assert.isNull(decodeSwapEvent(b));
    assert.isNull(decodeSwapEvent(new Uint8Array(10)));
  });
  it("decodes base58 like web3.js", () => {
    const k = PublicKey.unique();
    assert.deepEqual(Buffer.from(base58Decode(k.toBase58())), k.toBuffer());
  });
  it("matches the pool price formula the site already uses", () => {
    const sp = (3n << 64n) / 2n; // 1.5
    assert.closeTo(capFromSqrtPrice(sp), 2.25 * 1e6, 1e-3);
  });
});
