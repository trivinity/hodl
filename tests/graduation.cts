const anchor: any = require("@anchor-lang/core");
const { BN } = anchor;
const { ComputeBudgetProgram, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } = require("@solana/web3.js");
const spl = require("@solana/spl-token");
const { assert } = require("chai");
const fs = require("fs");
const path = require("path");
const { indexOnce, memoryStore } = require("../web/src/lib/indexer.ts");

// Runs a whole token graduation against Meteora's real DAMM v2 program. That program must be on the test chain:
//   solana-test-validator --reset --url devnet --clone-upgradeable-program cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG
// If it is not there, this file is skipped (with a message) instead of failing.
const idl = JSON.parse(fs.readFileSync(path.join(process.cwd(), "target/idl/hold_launchpad.json"), "utf8"));
const dammIdl = JSON.parse(fs.readFileSync(path.join(process.cwd(), "tests/fixtures/damm_v2.json"), "utf8"));

const T22 = spl.TOKEN_2022_PROGRAM_ID;
const CLASSIC = spl.TOKEN_PROGRAM_ID;
const WSOL = spl.NATIVE_MINT;
const DAMM = new PublicKey("cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG");
const BPF_UPGRADEABLE = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const big = (x: any) => BigInt(x.toString());
const Q128 = 1n << 128n;
const SMIN = 4295048016n;
const SMAX = 79226673521066979257578248091n;
const isqrt = (n: bigint) => {
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
};
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

/** the opening price and the most liquidity the funds can support (same maths as Meteora's) */
function poolNumbers(tokens: bigint, sol: bigint) {
  const sp = isqrt((sol * Q128) / tokens);
  const La = (tokens * sp * SMAX) / (SMAX - sp);
  const Lb = (sol * Q128) / (sp - SMIN);
  let L = La < Lb ? La : Lb;
  const need = (l: bigint) => [ceilDiv(l * (SMAX - sp), sp * SMAX), ceilDiv(l * (sp - SMIN), Q128)];
  let [na, nb] = need(L);
  while (na > tokens || nb > sol) {
    L -= 1n;
    [na, nb] = need(L);
  }
  return { sp, L };
}

describe("graduation to a Meteora pool", function () {
  const envProvider = anchor.AnchorProvider.env();
  const provider = new anchor.AnchorProvider(envProvider.connection, envProvider.wallet, { commitment: "confirmed", preflightCommitment: "confirmed" });
  const program = new anchor.Program(idl, provider);
  const damm = new anchor.Program(dammIdl, provider);
  const payer = provider.wallet.payer;
  const c = provider.connection;

  const mint = Keypair.generate();
  const nft = Keypair.generate();
  const holder = Keypair.generate();
  const trader = Keypair.generate();
  const stranger = Keypair.generate();
  const [curve] = PublicKey.findProgramAddressSync([Buffer.from("curve"), mint.publicKey.toBuffer()], program.programId);
  const [grad] = PublicKey.findProgramAddressSync([Buffer.from("grad"), mint.publicKey.toBuffer()], program.programId);
  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId);
  const vault = spl.getAssociatedTokenAddressSync(mint.publicKey, curve, true, T22);
  const gradToken = spl.getAssociatedTokenAddressSync(mint.publicKey, grad, true, T22);
  const gradWsol = spl.getAssociatedTokenAddressSync(WSOL, grad, true, CLASSIC);
  const [eventAuthority] = PublicKey.findProgramAddressSync([Buffer.from("__event_authority")], DAMM);
  const [position] = PublicKey.findProgramAddressSync([Buffer.from("position"), nft.publicKey.toBuffer()], DAMM);
  const [nftAccount] = PublicKey.findProgramAddressSync([Buffer.from("position_nft_account"), nft.publicKey.toBuffer()], DAMM);
  const ka = mint.publicKey.toBuffer();
  const kb = WSOL.toBuffer();
  const [pool] = PublicKey.findProgramAddressSync(
    [Buffer.from("cpool"), Buffer.compare(ka, kb) > 0 ? ka : kb, Buffer.compare(ka, kb) > 0 ? kb : ka],
    DAMM
  );
  const [vaultA] = PublicKey.findProgramAddressSync([Buffer.from("token_vault"), mint.publicKey.toBuffer(), pool.toBuffer()], DAMM);
  const [vaultB] = PublicKey.findProgramAddressSync([Buffer.from("token_vault"), WSOL.toBuffer(), pool.toBuffer()], DAMM);

  // the test chain can answer reads one slot behind: wait until a condition shows up instead of assuming it already has
  const waitUntil = async (check: () => Promise<boolean>, what: string) => {
    for (let i = 0; i < 40; i++) {
      if (await check()) return;
      await new Promise((r) => setTimeout(r, 250));
    }
    assert.fail("timed out waiting for " + what);
  };

  const expectError = async (p: Promise<any>, re: RegExp) => {
    try {
      await p;
    } catch (e: any) {
      const msg = String(e) + JSON.stringify(e?.logs ?? "");
      assert.match(msg, re, "wrong error: " + msg.slice(0, 400));
      return;
    }
    assert.fail("expected an error matching " + re);
  };

  const prepareIx = () =>
    program.methods.graduatePrepare().accountsPartial({ caller: payer.publicKey, mint: mint.publicKey, vault, grad, gradToken, gradWsol });
  const createPool = (sp: bigint, L: bigint, signers: any[] = [nft]) =>
    program.methods
      .graduateCreatePool(new BN(sp.toString()), new BN(L.toString()))
      .accountsPartial({
        caller: payer.publicKey,
        mint: mint.publicKey,
        grad,
        gradToken,
        gradWsol,
        positionNftMint: nft.publicKey,
        positionNftAccount: nftAccount,
        pool,
        position,
        tokenAVault: vaultA,
        tokenBVault: vaultB,
        eventAuthority,
      })
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 600000 })])
      .signers(signers);
  const lockIx = () =>
    program.methods.graduateLock().accountsPartial({ caller: payer.publicKey, mint: mint.publicKey, grad, pool, position, positionNftAccount: nftAccount, eventAuthority });
  const claimIx = (treasury: any) =>
    program.methods
      .claimPoolFees()
      .accountsPartial({
        caller: payer.publicKey,
        mint: mint.publicKey,
        grad,
        gradToken,
        gradWsol,
        pool,
        position,
        positionNftAccount: nftAccount,
        tokenAVault: vaultA,
        tokenBVault: vaultB,
        treasury,
        eventAuthority,
      })
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 600000 })]);

  let treasury: any;
  let nums: { sp: bigint; L: bigint };

  before(async function () {
    const info = await c.getAccountInfo(DAMM);
    if (!info || !info.executable) {
      console.log("      (skipped: Meteora's program is not on this chain; see the note at the top of tests/graduation.cts)");
      this.skip();
    }
    // setup shared with the other tests: create the config if this chain has none
    if (!(await (program.account as any).config.fetchNullable(configPda))) {
      const [programData] = PublicKey.findProgramAddressSync([program.programId.toBuffer()], BPF_UPGRADEABLE);
      await program.methods
        .initConfig(Keypair.generate().publicKey, 100)
        .accountsPartial({ authority: payer.publicKey, programData })
        .rpc();
    }
    treasury = (await (program.account as any).config.fetch(configPda)).treasury;
    await provider.sendAndConfirm(
      new Transaction().add(
        SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: treasury, lamports: LAMPORTS_PER_SOL / 100 }),
        SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: holder.publicKey, lamports: 3 * LAMPORTS_PER_SOL }),
        SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: trader.publicKey, lamports: 8 * LAMPORTS_PER_SOL }),
        SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: stranger.publicKey, lamports: LAMPORTS_PER_SOL })
      )
    );
  });

  // steps 1, 2 and 3 as instructions of one transaction (step 1 is refused on its own: see tests/graduation_attacks.cts)
  const graduateTx = async (instructions: any[], signers: any[] = [nft]) => {
    const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }), ...instructions);
    return provider.sendAndConfirm(tx, signers);
  };
  const poolIx = (sp: bigint, L: bigint) =>
    program.methods
      .graduateCreatePool(new BN(sp.toString()), new BN(L.toString()))
      .accountsPartial({ caller: payer.publicKey, mint: mint.publicKey, grad, gradToken, gradWsol, positionNftMint: nft.publicKey, positionNftAccount: nftAccount, pool, position, tokenAVault: vaultA, tokenBVault: vaultB, eventAuthority })
      .instruction();

  it("a token that is not full cannot graduate", async () => {
    await program.methods
      .createCurve("Grad", "GRAD", "", 100, 3000, new BN(3600), 5000, new BN(3600), 5000, 0)
      .accountsPartial({ creator: payer.publicKey, mint: mint.publicKey, vault })
      .signers([mint])
      .rpc();
    // a holder with a small position, so rewards exist later
    await program.methods.buy(new BN(1 * LAMPORTS_PER_SOL), new BN(0)).accountsPartial({ buyer: holder.publicKey, mint: mint.publicKey }).signers([holder]).rpc();
    await expectError(graduateTx([await prepareIx().instruction(), await poolIx(1n << 64n, 1000n)]), /NotComplete|not full/i);
  });

  it("graduation step 1 cannot run on its own, and a bad step 2 undoes it", async () => {
    // a big buy clamps to the last tokens on the curve and fills it
    await program.methods.buy(new BN(150 * LAMPORTS_PER_SOL), new BN(0)).accountsPartial({ buyer: payer.publicKey, mint: mint.publicKey }).rpc();
    const full: any = await (program.account as any).curve.fetch(curve);
    assert.isTrue(full.complete);
    nums = poolNumbers((await spl.getAccount(c, vault, "confirmed", T22)).amount, big(full.realSol) - 50_000_000n);

    // step 1 alone is refused: nobody can leave the token half graduated
    await expectError(prepareIx().rpc(), /NeedsPoolStep|same transaction/i);
    // a pool opened at a wrong price, or with too little liquidity, fails and takes step 1 down with it
    await expectError(graduateTx([await prepareIx().instruction(), await poolIx(nums.sp * 2n, nums.L)]), /BadPrice|does not match/i); // double the price
    await expectError(graduateTx([await prepareIx().instruction(), await poolIx(nums.sp / 2n, nums.L)]), /BadPrice|does not match/i); // half the price
    await expectError(graduateTx([await prepareIx().instruction(), await poolIx(nums.sp, nums.L / 2n)]), /PoolNotFilled|did not take all/i); // would leave half the funds behind
    const still: any = await (program.account as any).curve.fetch(curve);
    assert.equal(still.graduatedStage, 0, "nothing was changed by the failed attempts");
    assert.isTrue((await spl.getAccount(c, vault, "confirmed", T22)).amount > 0n, "the tokens are still in the curve's vault");
    const m0 = await spl.getMint(c, mint.publicKey, "confirmed", T22);
    assert.isTrue(!!spl.getTransferHook(m0) && !spl.getTransferHook(m0)!.programId.equals(PublicKey.default), "the hook is still on");
  });

  it("graduation: hook off, funds set aside, pool created and its liquidity locked, in one transaction", async () => {
    const before: any = await (program.account as any).curve.fetch(curve);
    const realSol = big(before.realSol);
    const sig = await graduateTx([await prepareIx().instruction(), await poolIx(nums.sp, nums.L), await lockIx().instruction()]);
    const info: any = await c.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    console.log("      whole graduation: compute units", info.meta.computeUnitsConsumed);

    const after: any = await (program.account as any).curve.fetch(curve);
    assert.equal(after.graduatedStage, 3);
    assert.equal(after.pool.toBase58(), pool.toBase58());
    assert.equal(big(after.lpSol), realSol - 50_000_000n, "all SOL raised minus the 0.05 SOL setup cost");
    assert.equal(big(after.realSol), 0n);
    assert.isTrue((await spl.getAccount(c, gradToken, "confirmed", T22)).amount <= big(after.lpTokens) / 1000n, "the pool took the tokens");
    assert.equal((await spl.getAccount(c, vault, "confirmed", T22)).amount, 0n, "the curve's account is empty");
    const pos: any = await (damm.account as any).position.fetch(position);
    assert.equal(big(pos.permanentLockedLiquidity), nums.L, "all of the liquidity is locked");
    assert.equal(big(pos.unlockedLiquidity), 0n, "none of it can be withdrawn");

    // the hook is gone for good: no hook program and no authority left to set one
    const m = await spl.getMint(c, mint.publicKey, "confirmed", T22);
    const hook = spl.getTransferHook(m);
    assert.isTrue(!hook || (hook.programId.equals(PublicKey.default) && hook.authority.equals(PublicKey.default)), "hook must be revoked");
    assert.isNull(m.mintAuthority);

    // so holders can now move their tokens freely, which was impossible before
    const holderAta = spl.getAssociatedTokenAddressSync(mint.publicKey, holder.publicKey, false, T22);
    const friend = Keypair.generate();
    const friendAta = spl.getAssociatedTokenAddressSync(mint.publicKey, friend.publicKey, false, T22);
    const bal = (await spl.getAccount(c, holderAta, "confirmed", T22)).amount;
    await provider.sendAndConfirm(
      new Transaction().add(
        spl.createAssociatedTokenAccountIdempotentInstruction(holder.publicKey, friendAta, friend.publicKey, mint.publicKey, T22),
        spl.createTransferCheckedInstruction(holderAta, mint.publicKey, friendAta, holder.publicKey, bal / 10n, 6, [], T22)
      ),
      [holder]
    );
    assert.equal((await spl.getAccount(c, friendAta, "confirmed", T22)).amount, bal / 10n);

    // trading on the old curve is over, and graduation cannot be run twice
    await expectError(
      program.methods.sell(new BN(1_000_000_000), new BN(0)).accountsPartial({ seller: holder.publicKey, mint: mint.publicKey }).signers([holder]).rpc(),
      /AlreadyGraduating|graduating/i
    );
    await expectError(graduateTx([await prepareIx().instruction(), await poolIx(nums.sp, nums.L)]), /WrongStage|not at the right step/i);
    await expectError(lockIx().rpc(), /WrongStage|not at the right step/i);
  });

  it("anyone can trade on the pool, and its fees go to the treasury and nowhere else", async () => {
    // a trader buys the token with SOL on Meteora's pool
    const tIn = await spl.createAssociatedTokenAccountIdempotent(c, payer, WSOL, trader.publicKey, { commitment: "confirmed" }, CLASSIC);
    const tOut = await spl.createAssociatedTokenAccountIdempotent(c, payer, mint.publicKey, trader.publicKey, { commitment: "confirmed" }, T22);
    await sendAndConfirmTransaction(
      c,
      new Transaction().add(SystemProgram.transfer({ fromPubkey: trader.publicKey, toPubkey: tIn, lamports: 3 * LAMPORTS_PER_SOL }), spl.createSyncNativeInstruction(tIn, CLASSIC)),
      [trader]
    );
    await waitUntil(async () => (await spl.getAccount(c, tIn, "confirmed", CLASSIC)).amount >= BigInt(3 * LAMPORTS_PER_SOL), "the trader's wrapped SOL");
    await damm.methods
      .swap2({ amount0: new BN(LAMPORTS_PER_SOL), amount1: new BN(0), swapMode: 0 })
      .accountsPartial({
        pool, inputTokenAccount: tIn, outputTokenAccount: tOut, tokenAVault: vaultA, tokenBVault: vaultB,
        tokenAMint: mint.publicKey, tokenBMint: WSOL, payer: trader.publicKey, tokenAProgram: T22, tokenBProgram: CLASSIC, referralTokenAccount: null,
      })
      .signers([trader])
      .rpc();
    assert.isTrue((await spl.getAccount(c, tOut, "confirmed", T22)).amount > 0n, "the trader received tokens");

    // fees can only be sent to the treasury address in the config
    await expectError(claimIx(stranger.publicKey).rpc(), /ConstraintAddress|address/i);
    const before = BigInt(await c.getBalance(treasury, "confirmed"));
    await claimIx(treasury).rpc();
    const gained = BigInt(await c.getBalance(treasury, "confirmed")) - before;
    console.log("      fees paid to the treasury (lamports):", gained.toString());
    assert.isTrue(gained > 100_000_000n, "a 1 SOL trade at the starting fee should pay well over 0.1 SOL of fees");
    assert.isNull(await c.getAccountInfo(gradWsol), "the wrapped SOL account is closed after paying out");

    // a second trade and a second payout work too (the account is created again)
    await damm.methods
      .swap2({ amount0: new BN(LAMPORTS_PER_SOL / 2), amount1: new BN(0), swapMode: 0 })
      .accountsPartial({
        pool, inputTokenAccount: tIn, outputTokenAccount: tOut, tokenAVault: vaultA, tokenBVault: vaultB,
        tokenAMint: mint.publicKey, tokenBMint: WSOL, payer: trader.publicKey, tokenAProgram: T22, tokenBProgram: CLASSIC, referralTokenAccount: null,
      })
      .signers([trader])
      .rpc();
    const before2 = BigInt(await c.getBalance(treasury, "confirmed"));
    await claimIx(treasury).rpc();
    assert.isTrue(BigInt(await c.getBalance(treasury, "confirmed")) > before2, "second payout arrived");

    // and the trader sells some of the tokens back into the pool (token A to SOL)
    await damm.methods
      .swap2({ amount0: new BN(1_000_000_000), amount1: new BN(0), swapMode: 0 })
      .accountsPartial({
        pool, inputTokenAccount: tOut, outputTokenAccount: tIn, tokenAVault: vaultA, tokenBVault: vaultB,
        tokenAMint: mint.publicKey, tokenBMint: WSOL, payer: trader.publicKey, tokenAProgram: T22, tokenBProgram: CLASSIC, referralTokenAccount: null,
      })
      .signers([trader])
      .rpc();
  });

  it("holders can still claim the rewards they earned on the curve after graduation", async () => {
    const before = BigInt(await c.getBalance(holder.publicKey, "confirmed"));
    try {
      await program.methods.claimRewards().accountsPartial({ claimer: holder.publicKey, mint: mint.publicKey }).signers([holder]).rpc();
      assert.isTrue(BigInt(await c.getBalance(holder.publicKey, "confirmed")) >= before - 10_000n);
    } catch (e: any) {
      // no rewards were ever generated for this holder in this scenario (nobody sold on the curve): that is fine, it just must not be blocked by graduation
      assert.match(String(e) + JSON.stringify(e?.logs ?? ""), /NothingToClaim|No fees to claim/i);
    }
  });

  it("the indexer records the graduation and the pool fee payouts", async () => {
    const store = memoryStore();
    await indexOnce({ connection: c, program, store });
    const m = mint.publicKey.toBase58();
    const grads = store.rows.graduations.filter((g: any) => g.mint === m);
    assert.equal(grads.length, 1, "one graduation row");
    assert.equal(grads[0].pool, pool.toBase58());
    const cv: any = await (program.account as any).curve.fetch(curve);
    assert.equal(BigInt(grads[0].lp_sol), big(cv.lpSol));
    assert.equal(BigInt(grads[0].lp_tokens), big(cv.lpTokens));
    const fees = store.rows.poolFees.filter((f: any) => f.mint === m);
    assert.equal(fees.length, 2, "two pool fee payouts");
    assert.isTrue(fees.every((f: any) => f.amount > 0));

    // the two swaps the trader made on Meteora's pool are in there too, oldest first, with sensible numbers
    const swaps = store.rows.poolTrades.filter((t: any) => t.mint === m);
    assert.equal(swaps.length, 3, "three pool swaps: two buys and a sell");
    assert.isTrue(swaps.every((t: any) => t.pool === pool.toBase58() && t.trader === trader.publicKey.toBase58()));
    assert.isTrue(swaps[0].is_buy && swaps[1].is_buy && !swaps[2].is_buy);
    assert.equal(swaps[2].tokens, 1_000_000_000, "the sell moved exactly the tokens sold");
    assert.isAbove(swaps[2].sol, 0);
    assert.isBelow(swaps[2].cap_sol, swaps[1].cap_sol, "selling pushes the market cap down");
    assert.equal(swaps[0].sol, LAMPORTS_PER_SOL);
    assert.equal(swaps[1].sol, LAMPORTS_PER_SOL / 2);
    assert.isTrue(swaps[0].tokens > 0 && swaps[1].tokens > 0);
    assert.isAbove(swaps[1].cap_sol, swaps[0].cap_sol, "buying again pushes the market cap up");
    // reading the same chain again finds nothing new
    const again = await indexOnce({ connection: c, program, store });
    assert.equal(again.poolTrades, 0);
  });
});
