const anchor: any = require("@anchor-lang/core");
const { BN } = anchor;
const { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } = require("@solana/web3.js");
const { getAccount, getAssociatedTokenAddressSync } = require("@solana/spl-token");
const { assert } = require("chai");
const fs = require("fs");
const path = require("path");

// needs `anchor build` first so the IDL exists
const idl = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "target/idl/hold_launchpad.json"), "utf8")
);

const FEE_BPS = 100; // 1% trade fee to the creator
const HOLDER_FEE_BPS = 100; // plus 1% trade fee to holders (2% total)
const TOTAL_FEE_BPS = FEE_BPS + HOLDER_FEE_BPS;
const MAX_TAX_BPS = 3000; // 30% sell tax at 0s held
const DECAY_SECS = 3600; // fades to 0 over an hour
const HOLDER_SELL_BPS = 5000; // one wallet can sell 50% of its balance per window
const WINDOW_SECS = 3600;
const REWARD_BPS = 5000; // half of every sell tax goes to holders

const big = (x: any) => BigInt(x.toString());

// same formula as math.rs sell_quote (gross, before fee/tax)
function sellGross(vs: bigint, vt: bigint, tokens: bigint): bigint {
  const k = vs * vt;
  const newVt = vt + tokens;
  const newVs = (k + newVt - 1n) / newVt;
  return vs - newVs;
}

describe("HODL", () => {
  // one commitment level for every read and write so balances and account state are comparable
  const envProvider = anchor.AnchorProvider.env();
  const provider = new anchor.AnchorProvider(envProvider.connection, envProvider.wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  anchor.setProvider(provider);
  const program = new anchor.Program(idl, provider);
  const walletA = provider.wallet.payer;
  const walletB = Keypair.generate();
  const walletC = Keypair.generate();
  const mint = Keypair.generate();
  let curve: any;

  const fetchCurve = async () => {
    const c: any = await (program.account as any).curve.fetch(curve);
    return { vs: big(c.virtualSol), vt: big(c.virtualTokens), realSol: big(c.realSol), rewardPool: big(c.rewardPool), raw: c };
  };
  const tokenBal = async (owner: any) => {
    const ata = getAssociatedTokenAddressSync(mint.publicKey, owner);
    return big((await getAccount(provider.connection, ata)).amount);
  };
  const lamports = async (k: any) => BigInt(await provider.connection.getBalance(k, "confirmed"));

  const buy = (who: any, sol: number) =>
    program.methods
      .buy(new BN(sol * LAMPORTS_PER_SOL), new BN(0))
      .accountsPartial({ buyer: who.publicKey, mint: mint.publicKey })
      .signers(who.publicKey.equals(walletA.publicKey) ? [] : [who])
      .rpc();

  const sell = (who: any, tokens: bigint) =>
    program.methods
      .sell(new BN(tokens.toString()), new BN(0))
      .accountsPartial({ seller: who.publicKey, mint: mint.publicKey })
      .signers(who.publicKey.equals(walletA.publicKey) ? [] : [who])
      .rpc();

  const claim = (who: any) =>
    program.methods
      .claimRewards()
      .accountsPartial({ claimer: who.publicKey, mint: mint.publicKey })
      .signers(who.publicKey.equals(walletA.publicKey) ? [] : [who])
      .rpc();

  // the curve account must always hold enough lamports to cover reserves + fees + unclaimed rewards + rent
  const assertSolvent = async () => {
    const c = await fetchCurve();
    const info = await provider.connection.getAccountInfo(curve, "confirmed");
    const rent = BigInt(await provider.connection.getMinimumBalanceForRentExemption(info!.data.length));
    const owed = c.realSol + big(c.raw.accruedFees) + c.rewardPool + rent;
    assert.isTrue(BigInt(info!.lamports) >= owed, `insolvent: has ${info!.lamports}, owes ${owed}`);
  };

  const expectError = async (p: Promise<any>, re: RegExp) => {
    try {
      await p;
    } catch (e: any) {
      const msg = String(e) + JSON.stringify(e?.logs ?? "");
      assert.match(msg, re, "wrong error: " + msg);
      return;
    }
    assert.fail("expected an error matching " + re);
  };

  const expectHolderLimit = async (p: Promise<any>) => {
    try {
      await p;
    } catch (e: any) {
      const msg = String(e) + JSON.stringify(e?.logs ?? "");
      assert.match(msg, /HolderLimitExceeded|already sold/i, "wrong error: " + msg);
      return;
    }
    assert.fail("sell should have been blocked by the wallet limit");
  };

  before(async () => {
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: walletA.publicKey,
        toPubkey: walletB.publicKey,
        lamports: 20 * LAMPORTS_PER_SOL,
      }),
      SystemProgram.transfer({
        fromPubkey: walletA.publicKey,
        toPubkey: walletC.publicKey,
        lamports: 5 * LAMPORTS_PER_SOL,
      })
    );
    await provider.sendAndConfirm(tx);
  });

  it("creates a token with its name and revokes the mint authority", async () => {
    await program.methods
      .createCurve(
        "Diamond Hands",
        "HOLD",
        "",
        FEE_BPS,
        MAX_TAX_BPS,
        new BN(DECAY_SECS),
        HOLDER_SELL_BPS,
        new BN(WINDOW_SECS),
        REWARD_BPS,
        HOLDER_FEE_BPS
      )
      .accountsPartial({ creator: walletA.publicKey, mint: mint.publicKey })
      .signers([mint])
      .rpc();

    [curve] = PublicKey.findProgramAddressSync(
      [Buffer.from("curve"), mint.publicKey.toBuffer()],
      program.programId
    );
    const info = await provider.connection.getParsedAccountInfo(mint.publicKey);
    const parsed: any = (info.value!.data as any).parsed.info;
    assert.isNull(parsed.mintAuthority, "mint authority must be revoked");
    const c = await fetchCurve();
    assert.equal(c.raw.name, "Diamond Hands");
    assert.equal(c.raw.symbol, "HOLD");
  });

  it("two wallets buy", async () => {
    await buy(walletA, 10);
    await buy(walletB, 10);
    assert.isTrue((await tokenBal(walletA.publicKey)) > 0n);
    assert.isTrue((await tokenBal(walletB.publicKey)) > 0n);
  });

  it("selling more than the wallet limit is blocked", async () => {
    const bal = await tokenBal(walletA.publicKey);
    await expectHolderLimit(sell(walletA, (bal * 60n) / 100n)); // 60% > 50%
  });

  it("a fresh buyer pays about the full 30% tax, and the tax stays in the curve", async () => {
    const bal = await tokenBal(walletA.publicKey);
    const tokens = (bal * 40n) / 100n;
    const before = await fetchCurve();
    const gross = sellGross(before.vs, before.vt, tokens);

    const sig = await sell(walletA, tokens);
    await provider.connection.confirmTransaction(sig, "confirmed");
    const txInfo: any = await provider.connection.getTransaction(sig, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    const txFee = BigInt(txInfo.meta.fee);
    const parser = new anchor.EventParser(program.programId, program.coder);
    const events = [...parser.parseLogs(txInfo.meta.logMessages)];
    const ev: any = events.find((e: any) => e.name.toLowerCase() === "trade");
    assert.isDefined(ev, "no Trade event in logs: " + txInfo.meta.logMessages.join("\n"));

    const after = await fetchCurve();
    // authoritative: this tx's own pre/post balance for the seller, plus the fee it paid
    const delta = BigInt(txInfo.meta.postBalances[0] - txInfo.meta.preBalances[0]) + txFee;
    const evSol = big(ev.data.sol);
    const evTax = big(ev.data.tax);

    // the default local wallet sees a few dozen lamports of validator noise per tx, so allow 1000
    const diff = delta > evSol ? delta - evSol : evSol - delta;
    assert.isTrue(diff < 1000n, `wallet delta ${delta} vs Trade.sol ${evSol}`);
    assert.isTrue(evTax > 0n, "tax should be non-zero");

    // received / noTax should be ~0.70 (30% tax, tiny decay from a few seconds held)
    const noTax = (gross * BigInt(10000 - TOTAL_FEE_BPS)) / 10000n;
    const ratio = Number(delta) / Number(noTax);
    assert.isAbove(ratio, 0.68, "tax too high: " + ratio);
    assert.isBelow(ratio, 0.71, "tax too low: " + ratio);

    // half the tax went to holders: reserves shrink by gross minus the part of the tax that stayed
    const evRewards = big(ev.data.rewards);
    assert.isTrue(evRewards > 0n, "holders should have received part of the tax");
    const ratioRewards = Number(evRewards) / Number(evTax);
    assert.isAbove(ratioRewards, 0.499);
    assert.isBelow(ratioRewards, 0.501);
    const reserveDrop = before.realSol - after.realSol;
    assert.equal(reserveDrop, gross - (evTax - evRewards), "reserves must shrink by gross - tax kept in pool");
    assert.isTrue(after.rewardPool >= evRewards, "reward pool must hold the holder share");
    await assertSolvent();
  });

  it("another wallet is not locked out by wallet A's sell", async () => {
    const bal = await tokenBal(walletB.publicKey);
    await sell(walletB, (bal * 40n) / 100n); // would have failed under a shared pool cap
  });

  it("wallet A hits its own limit for this window", async () => {
    const bal = await tokenBal(walletA.publicKey);
    // sold 40% of the starting balance, so another 20% of the starting balance is over 50%
    const startBal = (bal * 100n) / 60n;
    await expectHolderLimit(sell(walletA, (startBal * 20n) / 100n));
  });

  it("a holder claims rewards from someone else's sell tax", async () => {
    const before = await fetchCurve();
    const sig = await claim(walletB);
    await provider.connection.confirmTransaction(sig, "confirmed");
    const txInfo: any = await provider.connection.getTransaction(sig, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    // B's own balance change from the tx meta (the provider wallet pays the fee, not B)
    const keys: any[] = txInfo.transaction.message.getAccountKeys().keySegments().flat();
    const i = keys.findIndex((k: any) => k.equals(walletB.publicKey));
    const gained = BigInt(txInfo.meta.postBalances[i] - txInfo.meta.preBalances[i]);
    const after = await fetchCurve();
    assert.isTrue(gained > 0n, "claim paid nothing");
    assert.equal(before.rewardPool - after.rewardPool, gained, "pool must drop by exactly what was paid");
    await assertSolvent();
  });

  it("claiming twice pays nothing the second time", async () => {
    await expectError(claim(walletB), /NothingToClaim|No fees to claim/i);
  });

  it("a wallet that buys after the sell gets none of the old rewards", async () => {
    await buy(walletC, 1);
    await expectError(claim(walletC), /NothingToClaim|No fees to claim/i);
    await assertSolvent();
  });

  it("trade fee is split between the creator and the other holders", async () => {
    const before = await fetchCurve();
    const sig = await buy(walletC, 1);
    await provider.connection.confirmTransaction(sig, "confirmed");
    const txInfo: any = await provider.connection.getTransaction(sig, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    const parser = new anchor.EventParser(program.programId, program.coder);
    const ev: any = [...parser.parseLogs(txInfo.meta.logMessages)].find((e: any) => e.name.toLowerCase() === "trade");
    const after = await fetchCurve();
    const fee = big(ev.data.sol) - (after.realSol - before.realSol); // total fee = what was paid minus what entered the reserves
    const toHolders = big(ev.data.feeToHolders);
    assert.isTrue(toHolders > 0n, "holders should get part of the fee");
    const share = Number(toHolders) / Number(fee);
    assert.isAbove(share, 0.499);
    assert.isBelow(share, 0.501);
    assert.equal(
      big(after.raw.accruedFees) - big(before.raw.accruedFees) + toHolders,
      fee,
      "fee must be fully accounted for: creator part + holder part"
    );
    await assertSolvent();
  });

  it("creator can claim its fees", async () => {
    const c = await fetchCurve();
    assert.isTrue(big(c.raw.accruedFees) > 0n);
    await program.methods.claimFees().accountsPartial({ creator: walletA.publicKey, curve }).rpc();
    assert.equal(big((await fetchCurve()).raw.accruedFees), 0n);
    await assertSolvent();
  });

  it("once every holder has claimed, nothing is stranded in the reward pool", async () => {
    for (const w of [walletA, walletB, walletC]) {
      try {
        await claim(w);
      } catch (e: any) {
        assert.match(String(e) + JSON.stringify(e?.logs ?? ""), /NothingToClaim|No fees to claim/i);
      }
    }
    const c = await fetchCurve();
    assert.isTrue(c.rewardPool < 100n, `reward pool should be empty after everyone claims, has ${c.rewardPool}`);
    await assertSolvent();
  });

  it("rejects parameters that would make a token impossible to sell", async () => {
    const tryCreate = (decaySecs: number, windowSecs: number) => {
      const m = Keypair.generate();
      return program.methods
        .createCurve("Bad", "BAD", "", 100, 3000, new BN(decaySecs), 5000, new BN(windowSecs), 5000, 0)
        .accountsPartial({ creator: walletA.publicKey, mint: m.publicKey })
        .signers([m])
        .rpc();
    };
    await expectError(tryCreate(366 * 86400, 3600), /BadParams|Bad curve parameters/i); // tax fade over a year
    await expectError(tryCreate(3600, 31 * 86400), /BadParams|Bad curve parameters/i); // sell window over 30 days
    // 50% per window must work out to at least 20% of the balance per day: 2.5 days is the longest window allowed
    await expectError(tryCreate(3600, 3 * 86400), /BadParams|Bad curve parameters/i);
    await tryCreate(365 * 86400, 216000); // exactly at the limits is allowed
  });

  it("holders can still sell after the curve fills up", async () => {
    const m = Keypair.generate();
    const [c2] = PublicKey.findProgramAddressSync([Buffer.from("curve"), m.publicKey.toBuffer()], program.programId);
    await program.methods
      .createCurve("Full", "FULL", "", 100, 3000, new BN(3600), 5000, new BN(3600), 5000, 0)
      .accountsPartial({ creator: walletA.publicKey, mint: m.publicKey })
      .signers([m])
      .rpc();
    await program.methods
      .buy(new BN(150 * LAMPORTS_PER_SOL), new BN(0)) // more than the curve can take: the last buy is clamped
      .accountsPartial({ buyer: walletA.publicKey, mint: m.publicKey })
      .rpc();
    const full: any = await (program.account as any).curve.fetch(c2);
    assert.isTrue(full.complete, "curve should be complete");
    const ata = getAssociatedTokenAddressSync(m.publicKey, walletA.publicKey);
    const bal = big((await getAccount(provider.connection, ata)).amount);
    await program.methods
      .sell(new BN(((bal * 10n) / 100n).toString()), new BN(0))
      .accountsPartial({ seller: walletA.publicKey, mint: m.publicKey })
      .rpc();
    const after: any = await (program.account as any).curve.fetch(c2);
    assert.isTrue(big(after.realSol) < big(full.realSol), "the sell should have paid out of the pool");
  });
});
