const anchor: any = require("@anchor-lang/core");
const { BN } = anchor;
const { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } = require("@solana/web3.js");
const {
  getAccount,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferInstruction,
} = require("@solana/spl-token");
const { assert } = require("chai");
const fs = require("fs");
const path = require("path");

// needs `anchor build` first so the IDL exists
const idl = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "target/idl/hold_launchpad.json"), "utf8")
);

const FEE_BPS = 100; // 1% trade fee to the creator
const HOLDER_FEE_BPS = 100; // plus 1% trade fee to holders (2% total)
const PLATFORM_FEE_BPS = 100; // 1% platform fee, set when the config is created
const TOTAL_FEE_BPS = FEE_BPS + HOLDER_FEE_BPS + PLATFORM_FEE_BPS;
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

  const sellAndFetch = async (who: any, tokens: bigint) => {
    const sig = await sell(who, tokens);
    await provider.connection.confirmTransaction(sig, "confirmed");
    const tx: any = await provider.connection.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    const parser = new anchor.EventParser(program.programId, program.coder);
    return [...parser.parseLogs(tx.meta.logMessages)].find((e: any) => e.name.toLowerCase() === "trade")!.data;
  };

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
    const owed = c.realSol + big(c.raw.accruedFees) + big(c.raw.accruedPlatformFees) + c.rewardPool + rent;
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

  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId);
  const treasury = Keypair.generate();
  // the account that holds the program's code and records who may upgrade it
  const [programData] = PublicKey.findProgramAddressSync(
    [program.programId.toBuffer()],
    new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111")
  );
  const fetchConfig = async () => (program.account as any).config.fetch(configPda);

  before(async () => {
    // one-time program setup. Only the upgrade authority (the local wallet) may do it.
    if (!(await (program.account as any).config.fetchNullable(configPda))) {
      await program.methods
        .initConfig(treasury.publicKey, PLATFORM_FEE_BPS)
        .accountsPartial({ authority: walletA.publicKey, program: program.programId, programData })
        .rpc();
    }
    const cfg: any = await fetchConfig();
    assert.equal(cfg.platformFeeBps, PLATFORM_FEE_BPS, "tests expect a 1% platform fee");
    // the treasury must be a real funded account, like a multisig vault, or tiny payouts would fail the rent check
    await provider.sendAndConfirm(
      new Transaction().add(SystemProgram.transfer({ fromPubkey: walletA.publicKey, toPubkey: cfg.treasury, lamports: LAMPORTS_PER_SOL / 100 }))
    );
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

    // an indexer needs to see token creation: the CurveCreated event is in the creation transaction
    const sigs = await provider.connection.getSignaturesForAddress(curve, { limit: 5 }, "confirmed");
    const createSig = sigs[sigs.length - 1].signature;
    const ctx: any = await provider.connection.getTransaction(createSig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    const created: any = [...new anchor.EventParser(program.programId, program.coder).parseLogs(ctx.meta.logMessages)].find(
      (e: any) => e.name.toLowerCase() === "curvecreated"
    );
    assert.isDefined(created, "CurveCreated event missing");
    assert.equal(created.data.symbol, "HOLD");
    assert.equal(created.data.mint.toBase58(), mint.publicKey.toBase58());

    // the token also carries its name and symbol on chain (Metaplex metadata), and it cannot be changed
    const META = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
    const [metaPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("metadata"), META.toBuffer(), mint.publicKey.toBuffer()],
      META
    );
    const metaInfo = await provider.connection.getAccountInfo(metaPda);
    assert.isNotNull(metaInfo, "metadata account must exist");
    const text = Buffer.from(metaInfo!.data).toString("utf8");
    assert.include(text, "Diamond Hands");
    assert.include(text, "HOLD");
    assert.equal(metaInfo!.owner.toBase58(), META.toBase58());
    // Metaplex layout: key(1) update_authority(32) mint(32) name(4+32) symbol(4+10) uri(4+200) fee(2) creators(1) primary_sale(1) is_mutable(1)
    const d = Buffer.from(metaInfo!.data);
    assert.equal(new PublicKey(d.subarray(33, 65)).toBase58(), mint.publicKey.toBase58(), "metadata must belong to this mint");
    assert.equal(d[323], 0, "metadata must be immutable");
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

  it("trade fee is split three ways: platform, holders and creator", async () => {
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
    const toPlatform = big(ev.data.feeToPlatform);
    assert.isTrue(toHolders > 0n && toPlatform > 0n, "holders and platform should both get a part");
    // 1% platform, 1% holders, 1% creator out of 3% total: a third each
    assert.isAbove(Number(toPlatform) / Number(fee), 0.333);
    assert.isBelow(Number(toPlatform) / Number(fee), 0.334);
    assert.isAbove(Number(toHolders) / Number(fee), 0.333);
    assert.isBelow(Number(toHolders) / Number(fee), 0.334);
    assert.equal(
      big(after.raw.accruedFees) - big(before.raw.accruedFees) + toHolders + toPlatform,
      fee,
      "fee must be fully accounted for: creator part + holder part + platform part"
    );
    assert.equal(big(after.raw.accruedPlatformFees) - big(before.raw.accruedPlatformFees), toPlatform);
    await assertSolvent();
  });

  it("anyone can send platform fees to the treasury, and only to the treasury", async () => {
    const cfg: any = await fetchConfig();
    const owed = big((await fetchCurve()).raw.accruedPlatformFees);
    assert.isTrue(owed > 0n);
    const before = await lamports(cfg.treasury);
    // the trigger needs no special permission: the provider wallet is just an ordinary payer here
    await program.methods.claimPlatformFees().accountsPartial({ curve, treasury: cfg.treasury }).rpc();
    assert.equal((await lamports(cfg.treasury)) - before, owed, "the treasury receives exactly what was owed");
    assert.equal(big((await fetchCurve()).raw.accruedPlatformFees), 0n);
    // sending it anywhere else is refused
    await expectError(
      program.methods.claimPlatformFees().accountsPartial({ curve, treasury: walletB.publicKey }).rpc(),
      /ConstraintAddress|address/i
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

  describe("wallet splitting", () => {
    // a short tax fade (60s) so tokens can age inside a test
    const m = Keypair.generate();
    const w1 = Keypair.generate(); // aged holder
    const w2 = Keypair.generate(); // fresh wallet that only receives transferred tokens
    const w3 = Keypair.generate(); // split-at-buy wallets
    const w4 = Keypair.generate();
    const [c2] = PublicKey.findProgramAddressSync([Buffer.from("curve"), m.publicKey.toBuffer()], program.programId);
    const ataOf = (w: any) => getAssociatedTokenAddressSync(m.publicKey, w.publicKey);
    const balOf = async (w: any) => big((await getAccount(provider.connection, ataOf(w))).amount);
    const buyM = (w: any, sol: number) =>
      program.methods
        .buy(new BN(sol * LAMPORTS_PER_SOL), new BN(0))
        .accountsPartial({ buyer: w.publicKey, mint: m.publicKey })
        .signers([w])
        .rpc();
    const sellM = async (w: any, tokens: bigint) => {
      const sig = await program.methods
        .sell(new BN(tokens.toString()), new BN(0))
        .accountsPartial({ seller: w.publicKey, mint: m.publicKey })
        .signers([w])
        .rpc();
      await provider.connection.confirmTransaction(sig, "confirmed");
      const tx: any = await provider.connection.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      const parser = new anchor.EventParser(program.programId, program.coder);
      return [...parser.parseLogs(tx.meta.logMessages)].find((e: any) => e.name.toLowerCase() === "trade")!.data as any;
    };
    const chainTime = async () => (await provider.connection.getBlockTime(await provider.connection.getSlot("confirmed")))!;

    before(async () => {
      const tx = new Transaction();
      for (const w of [w1, w2, w3, w4]) {
        tx.add(SystemProgram.transfer({ fromPubkey: walletA.publicKey, toPubkey: w.publicKey, lamports: 3 * LAMPORTS_PER_SOL }));
      }
      await provider.sendAndConfirm(tx);
      await program.methods
        .createCurve("Aged", "AGED", "", 100, 3000, new BN(60), 5000, new BN(3600), 0, 0)
        .accountsPartial({ creator: walletA.publicKey, mint: m.publicKey })
        .signers([m])
        .rpc();
    });

    it("tokens sent to a fresh wallet pay the full starting tax, even when the sender's tokens are aged", async () => {
      await buyM(w1, 1);
      const boughtAt = await chainTime();
      while ((await chainTime()) - boughtAt < 62) await new Promise((r) => setTimeout(r, 1000));

      // the sender's own tokens have aged past the 60s fade: no tax
      const w1bal = await balOf(w1);
      const aged = await sellM(w1, w1bal / 10n);
      assert.equal(big(aged.tax), 0n, "aged tokens should pay no tax");

      // move half to a brand new wallet that has never bought anything
      const move = big((await balOf(w1)) / 2n);
      const t = new Transaction().add(
        createAssociatedTokenAccountIdempotentInstruction(w1.publicKey, ataOf(w2), w2.publicKey, m.publicKey),
        createTransferInstruction(ataOf(w1), ataOf(w2), w1.publicKey, move)
      );
      await provider.sendAndConfirm(t, [w1]);

      // the fresh wallet sells 40% of what it received: full 30% tax
      const w2bal = await balOf(w2);
      assert.equal(w2bal, move);
      const sellAmt = (w2bal * 40n) / 100n;
      const st: any = await (program.account as any).curve.fetch(c2);
      const gross = sellGross(big(st.virtualSol), big(st.virtualTokens), sellAmt);
      const ev = await sellM(w2, sellAmt);
      assert.equal(big(ev.tax), (gross * 3000n) / 10000n, "transferred tokens must pay exactly the starting tax");
    });

    it("splitting at buy does not raise the share a person can sell", async () => {
      await buyM(w3, 1);
      await buyM(w4, 1);
      const b3 = await balOf(w3);
      const b4 = await balOf(w4);
      // each wallet is capped at 50% of its own balance, so no wallet can go past that
      await expectError(sellM(w3, (b3 * 51n) / 100n), /HolderLimitExceeded|already sold/i);
      await expectError(sellM(w4, (b4 * 51n) / 100n), /HolderLimitExceeded|already sold/i);
      const s3 = b3 / 2n;
      const s4 = b4 / 2n;
      await sellM(w3, s3);
      await sellM(w4, s4);
      // together they sold exactly half of what they hold together: the same as one wallet would
      const total = b3 + b4;
      assert.isTrue((s3 + s4) * 2n <= total && (s3 + s4) * 2n >= total - 2n, "split wallets sold more than half in total");
    });
  });

  describe("moving tokens away", () => {
    const m = Keypair.generate();
    const h1 = Keypair.generate(); // buys, then moves everything to a cold wallet
    const h2 = Keypair.generate(); // keeps holding
    const cold = Keypair.generate();
    const x = Keypair.generate(); // sells early and pays the tax
    const ataOf = (w: any) => getAssociatedTokenAddressSync(m.publicKey, w.publicKey);
    const balOf = async (w: any) => big((await getAccount(provider.connection, ataOf(w))).amount);
    const buyM = (w: any, sol: number) =>
      program.methods.buy(new BN(sol * LAMPORTS_PER_SOL), new BN(0)).accountsPartial({ buyer: w.publicKey, mint: m.publicKey }).signers([w]).rpc();
    const claimM = (w: any) =>
      program.methods.claimRewards().accountsPartial({ claimer: w.publicKey, mint: m.publicKey }).signers([w]).rpc();

    it("a wallet that moved all its tokens away earns nothing more, and the holder who stayed does", async () => {
      const fund = new Transaction();
      for (const w of [h1, h2, x]) {
        fund.add(SystemProgram.transfer({ fromPubkey: walletA.publicKey, toPubkey: w.publicKey, lamports: 3 * LAMPORTS_PER_SOL }));
      }
      await provider.sendAndConfirm(fund);
      await program.methods
        .createCurve("Moved", "MOVE", "", 100, 3000, new BN(3600), 5000, new BN(3600), 5000, 0)
        .accountsPartial({ creator: walletA.publicKey, mint: m.publicKey })
        .signers([m])
        .rpc();

      await buyM(h1, 1);
      await buyM(h2, 1);
      await buyM(x, 2);

      // h1 sends every token to a cold wallet with a plain token transfer
      const all = await balOf(h1);
      await provider.sendAndConfirm(
        new Transaction().add(
          createAssociatedTokenAccountIdempotentInstruction(h1.publicKey, ataOf(cold), cold.publicKey, m.publicKey),
          createTransferInstruction(ataOf(h1), ataOf(cold), h1.publicKey, all)
        ),
        [h1]
      );
      assert.equal(await balOf(h1), 0n);

      // someone sells early, so half of the tax goes to holders
      const xBal = await balOf(x);
      await program.methods
        .sell(new BN(((xBal * 40n) / 100n).toString()), new BN(0))
        .accountsPartial({ seller: x.publicKey, mint: m.publicKey })
        .signers([x])
        .rpc();

      // h1 holds nothing now: nothing to claim. h2 stayed: gets paid.
      await expectError(claimM(h1), /NothingToClaim|No fees to claim/i);
      const before = await lamports(h2.publicKey);
      await claimM(h2);
      assert.isTrue((await lamports(h2.publicKey)) > before, "the holder who stayed should have been paid");
    });
  });

  describe("admin controls", () => {
    const stranger = Keypair.generate();
    const newAdmin = Keypair.generate();
    const createTok = (m: any) =>
      program.methods
        .createCurve("Paused", "PAUSE", "", 100, 3000, new BN(3600), 5000, new BN(3600), 5000, 0)
        .accountsPartial({ creator: walletA.publicKey, mint: m.publicKey })
        .signers([m])
        .rpc();

    before(async () => {
      await provider.sendAndConfirm(
        new Transaction().add(
          SystemProgram.transfer({ fromPubkey: walletA.publicKey, toPubkey: stranger.publicKey, lamports: LAMPORTS_PER_SOL }),
          SystemProgram.transfer({ fromPubkey: walletA.publicKey, toPubkey: newAdmin.publicKey, lamports: LAMPORTS_PER_SOL })
        )
      );
    });

    it("a stranger cannot pause, change the fee, or set the treasury", async () => {
      await expectError(
        program.methods.setPaused(true).accountsPartial({ admin: stranger.publicKey }).signers([stranger]).rpc(),
        /Unauthorized|Not allowed|ConstraintAddress/i
      );
      await expectError(
        program.methods.setPlatformFee(0).accountsPartial({ admin: stranger.publicKey }).signers([stranger]).rpc(),
        /Unauthorized|Not allowed|ConstraintAddress/i
      );
      await expectError(
        program.methods.setTreasury(stranger.publicKey).accountsPartial({ admin: stranger.publicKey }).signers([stranger]).rpc(),
        /Unauthorized|Not allowed|ConstraintAddress/i
      );
      assert.isFalse((await fetchConfig()).paused);
    });

    it("pausing stops new buys and new tokens, but never selling or claiming", async () => {
      // someone holds tokens on the main test token before the pause
      const bal = await tokenBal(walletB.publicKey);
      assert.isTrue(bal > 0n);
      await program.methods.setPaused(true).accountsPartial({ admin: walletA.publicKey }).rpc();
      try {
        await expectError(buy(walletB, 1), /Paused|paused/i);
        await expectError(createTok(Keypair.generate()), /Paused|paused/i);
        // selling still works while paused (use a small piece, inside the daily limit)
        const ev = (await sellAndFetch(walletB, bal / 100n)) as any;
        assert.isTrue(big(ev.sol) > 0n, "sell must pay out while paused");
        // claiming rewards still works while paused (or has nothing to claim, but is not blocked by the pause)
        try {
          await claim(walletB);
        } catch (e: any) {
          assert.match(String(e) + JSON.stringify(e?.logs ?? ""), /NothingToClaim|No fees to claim/i);
        }
      } finally {
        await program.methods.setPaused(false).accountsPartial({ admin: walletA.publicKey }).rpc();
      }
      await buy(walletB, 0.01); // trading is back
    });

    it("a new token locks in the platform fee it launched with", async () => {
      const m1 = Keypair.generate();
      await createTok(m1);
      const [c1] = PublicKey.findProgramAddressSync([Buffer.from("curve"), m1.publicKey.toBuffer()], program.programId);
      assert.equal((await (program.account as any).curve.fetch(c1)).platformFeeBps, PLATFORM_FEE_BPS);

      await program.methods.setPlatformFee(200).accountsPartial({ admin: walletA.publicKey }).rpc();
      const m2 = Keypair.generate();
      await createTok(m2);
      const [c2] = PublicKey.findProgramAddressSync([Buffer.from("curve"), m2.publicKey.toBuffer()], program.programId);
      assert.equal((await (program.account as any).curve.fetch(c2)).platformFeeBps, 200, "new token gets the new fee");
      assert.equal((await (program.account as any).curve.fetch(c1)).platformFeeBps, PLATFORM_FEE_BPS, "old token keeps its fee");
      // the fee can never go above 2%
      await expectError(
        program.methods.setPlatformFee(201).accountsPartial({ admin: walletA.publicKey }).rpc(),
        /BadParams|Bad curve parameters/i
      );
      await program.methods.setPlatformFee(PLATFORM_FEE_BPS).accountsPartial({ admin: walletA.publicKey }).rpc();
    });

    it("admin hands over in two steps, and the wrong address cannot accept", async () => {
      await program.methods.proposeAdmin(newAdmin.publicKey).accountsPartial({ admin: walletA.publicKey }).rpc();
      // nothing changes until the proposed admin signs
      assert.equal((await fetchConfig()).admin.toBase58(), walletA.publicKey.toBase58());
      await expectError(
        program.methods.acceptAdmin().accountsPartial({ newAdmin: stranger.publicKey }).signers([stranger]).rpc(),
        /NotPendingAdmin|not the proposed admin/i
      );
      await program.methods.acceptAdmin().accountsPartial({ newAdmin: newAdmin.publicKey }).signers([newAdmin]).rpc();
      assert.equal((await fetchConfig()).admin.toBase58(), newAdmin.publicKey.toBase58());
      // the old admin lost its powers
      await expectError(
        program.methods.setPaused(true).accountsPartial({ admin: walletA.publicKey }).rpc(),
        /Unauthorized|Not allowed|ConstraintAddress/i
      );
      // hand it back so other tests keep working
      await program.methods.proposeAdmin(walletA.publicKey).accountsPartial({ admin: newAdmin.publicKey }).signers([newAdmin]).rpc();
      await program.methods.acceptAdmin().accountsPartial({ newAdmin: walletA.publicKey }).rpc();
      assert.equal((await fetchConfig()).admin.toBase58(), walletA.publicKey.toBase58());
    });

    it("setup can only be done once", async () => {
      await expectError(
        program.methods.initConfig(treasury.publicKey, 100).accountsPartial({ authority: walletA.publicKey, program: program.programId, programData }).rpc(),
        /already in use|custom program error|0x0/i
      );
    });
  });
});
