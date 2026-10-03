const anchor: any = require("@anchor-lang/core");
const { BN } = anchor;
const { ComputeBudgetProgram, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } = require("@solana/web3.js");
const spl = require("@solana/spl-token");
const { assert } = require("chai");
const fs = require("fs");
const path = require("path");
const { graduationAddresses, poolNumbers } = require("../web/src/lib/graduation.ts");
const { rewardOwed } = require("../web/src/lib/curve.ts");

// Attacks and loss scenarios around graduation. Needs Meteora's program on the test chain (see tests/graduation.cts).
const idl = JSON.parse(fs.readFileSync(path.join(process.cwd(), "target/idl/hold_launchpad.json"), "utf8"));
const T22 = spl.TOKEN_2022_PROGRAM_ID;
const CLASSIC = spl.TOKEN_PROGRAM_ID;
const WSOL = spl.NATIVE_MINT;
const DAMM = new PublicKey("cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG");
const POOL_AUTH = new PublicKey("HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC");
const BPF_UPGRADEABLE = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const big = (x: any) => BigInt(x.toString());
const u64 = (n: any) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const u16 = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u128 = (n: any) => { const b = Buffer.alloc(16); b.writeBigUInt64LE(BigInt(n) & ((1n << 64n) - 1n)); b.writeBigUInt64LE(BigInt(n) >> 64n, 8); return b; };
// Meteora's initialize_customizable_pool, the way an outsider would call it
const initData = (sp: bigint, L: bigint) =>
  Buffer.concat([Buffer.from([20, 161, 241, 24, 189, 221, 180, 2]), u64(300000000), u16(28), u64(21600), u64(10357142), Buffer.from([0]), u16(0), Buffer.from([0, 0]), u128(4295048016n), u128(79226673521066979257578248091n), Buffer.from([0]), u128(L), u128(sp), Buffer.from([1, 1, 0])]);

describe("graduation: attacks and losses", function () {
  const envProvider = anchor.AnchorProvider.env();
  const provider = new anchor.AnchorProvider(envProvider.connection, envProvider.wallet, { commitment: "confirmed", preflightCommitment: "confirmed" });
  const program = new anchor.Program(idl, provider);
  const payer = provider.wallet.payer;
  const c = provider.connection;
  const pda = (seeds: any[], pid: any) => PublicKey.findProgramAddressSync(seeds, pid)[0];
  const evAuth = pda([Buffer.from("__event_authority")], DAMM);
  const fund = (to: any, sol: number) => SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: to, lamports: Math.round(sol * LAMPORTS_PER_SOL) });

  async function newToken(symbol: string) {
    const mint = Keypair.generate();
    const a = graduationAddresses(program.programId, mint.publicKey, PublicKey.default);
    await program.methods.createCurve(symbol, symbol, "", 100, 3000, new BN(3600), 5000, new BN(3600), 5000, 0).accountsPartial({ creator: payer.publicKey, mint: mint.publicKey, vault: a.vault }).signers([mint]).rpc();
    return { mint, a };
  }
  const wallet = async (sol: number) => {
    const k = Keypair.generate();
    await provider.sendAndConfirm(new Transaction().add(fund(k.publicKey, sol)));
    return k;
  };
  const buy = (t: any, who: any, sol: number) => program.methods.buy(new BN(Math.round(sol * LAMPORTS_PER_SOL)), new BN(0)).accountsPartial({ buyer: who.publicKey, mint: t.mint.publicKey }).signers([who]).rpc();
  const poolAddrs = (t: any, nft: any) => ({
    pool: t.a.pool,
    nftAccount: pda([Buffer.from("position_nft_account"), nft.publicKey.toBuffer()], DAMM),
    position: pda([Buffer.from("position"), nft.publicKey.toBuffer()], DAMM),
    vaultA: pda([Buffer.from("token_vault"), t.mint.publicKey.toBuffer(), t.a.pool.toBuffer()], DAMM),
    vaultB: pda([Buffer.from("token_vault"), WSOL.toBuffer(), t.a.pool.toBuffer()], DAMM),
  });
  const prepareIx = (t: any) => program.methods.graduatePrepare().accountsPartial({ caller: payer.publicKey, mint: t.mint.publicKey, vault: t.a.vault, grad: t.a.grad, gradToken: t.a.gradToken, gradWsol: t.a.gradWsol }).instruction();
  // the honest second step; the numbers are worked out from what the token really has set aside
  async function createPoolIx(t: any, nft: any, lpTokens: bigint, lpSol: bigint) {
    const x = poolAddrs(t, nft);
    const { sqrtPrice, liquidity } = poolNumbers(lpTokens, lpSol);
    return program.methods
      .graduateCreatePool(new BN(sqrtPrice.toString()), new BN(liquidity.toString()))
      .accountsPartial({ caller: payer.publicKey, mint: t.mint.publicKey, grad: t.a.grad, gradToken: t.a.gradToken, gradWsol: t.a.gradWsol, positionNftMint: nft.publicKey, positionNftAccount: x.nftAccount, pool: x.pool, position: x.position, tokenAVault: x.vaultA, tokenBVault: x.vaultB, eventAuthority: evAuth })
      .instruction();
  }
  const lockIx = (t: any, nft: any) => {
    const x = poolAddrs(t, nft);
    return program.methods.graduateLock().accountsPartial({ caller: payer.publicKey, mint: t.mint.publicKey, grad: t.a.grad, pool: x.pool, position: x.position, positionNftAccount: x.nftAccount, eventAuthority: evAuth }).instruction();
  };
  const send = (ixs: any[], signers: any[]) => provider.sendAndConfirm(new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }), ...ixs), signers);
  // the amounts an honest graduation will set aside, known before step 1 (all leftover tokens; the SOL raised minus the setup cost)
  async function plan(t: any) {
    await new Promise((r) => setTimeout(r, 700)); // reads can lag one moment behind a transaction that just confirmed
    const cv: any = await (program.account as any).curve.fetch(t.a.curve);
    return { lpTokens: (await spl.getAccount(c, t.a.vault, "confirmed", T22)).amount, lpSol: big(cv.realSol) - 50_000_000n };
  }
  async function graduateHonestly(t: any) {
    const nft = Keypair.generate();
    // (the website works the same amounts out: the SOL raised minus the setup cost, and only the tokens the curve itself owns)
    const { lpTokens, lpSol } = t.__plan ?? (await plan(t));
    await send([await prepareIx(t), await createPoolIx(t, nft, lpTokens, lpSol), await lockIx(t, nft)], [nft]);
  }
  const expectError = async (p: Promise<any>, re: RegExp) => {
    try {
      await p;
    } catch (e: any) {
      const msg = String(e) + JSON.stringify(e?.logs ?? "") + String(e?.transactionLogs ?? "");
      assert.match(msg, re, "wrong error: " + msg.slice(0, 500));
      return;
    }
    assert.fail("expected an error matching " + re);
  };

  before(async function () {
    const info = await c.getAccountInfo(DAMM);
    if (!info || !info.executable) this.skip();
    const [configPda] = [pda([Buffer.from("config")], program.programId)];
    if (!(await (program.account as any).config.fetchNullable(configPda))) {
      const programData = pda([program.programId.toBuffer()], BPF_UPGRADEABLE);
      await program.methods.initConfig(Keypair.generate().publicKey, 100).accountsPartial({ authority: payer.publicKey, programData }).rpc();
    }
  });

  it("step 1 cannot be run on its own, so nobody can leave a token half graduated", async () => {
    const t = await newToken("ONE");
    await buy(t, await wallet(160), 150);
    await expectError(send([await prepareIx(t)], []), /NeedsPoolStep|together/i);
    const cv: any = await (program.account as any).curve.fetch(t.a.curve);
    assert.equal(cv.graduatedStage, 0, "nothing changed");
  });

  it("a rival pool made after step 1 cannot trap the funds: the whole transaction is undone", async () => {
    const t = await newToken("TWO");
    const att = await wallet(3);
    await buy(t, att, 1);
    await buy(t, await wallet(160), 150);
    const attA = spl.getAssociatedTokenAddressSync(t.mint.publicKey, att.publicKey, false, T22);
    const attB = await spl.createAssociatedTokenAccountIdempotent(c, payer, WSOL, att.publicKey, { commitment: "confirmed" }, CLASSIC);
    await sendAndConfirmTransaction(c, new Transaction().add(SystemProgram.transfer({ fromPubkey: att.publicKey, toPubkey: attB, lamports: LAMPORTS_PER_SOL }), spl.createSyncNativeInstruction(attB, CLASSIC)), [att]);
    const tokBal = (await spl.getAccount(c, attA, "confirmed", T22)).amount;
    const rivalNft = Keypair.generate();
    const x = poolAddrs(t, rivalNft);
    const { sqrtPrice, liquidity } = poolNumbers(tokBal / 2n, 500_000_000n);
    const m = (pubkey: any, isWritable = false, isSigner = false) => ({ pubkey, isWritable, isSigner });
    const rivalPool = new TransactionInstruction({
      programId: DAMM,
      keys: [m(att.publicKey), m(rivalNft.publicKey, true, true), m(x.nftAccount, true), m(att.publicKey, true, true), m(POOL_AUTH), m(x.pool, true), m(x.position, true), m(t.mint.publicKey), m(WSOL), m(x.vaultA, true), m(x.vaultB, true), m(attA, true), m(attB, true), m(T22), m(CLASSIC), m(T22), m(SystemProgram.programId), m(evAuth), m(DAMM)],
      data: initData(sqrtPrice, liquidity),
    });
    // 1) while the token's hook is on, Meteora refuses to make any pool for it (this is what keeps the window shut before step 1)
    await expectError(send([rivalPool], [att, rivalNft]), /InvalidTokenBadge|0x1784/i);
    // 2) step 1, the rival's pool, then our step 2 in one transaction: the rival wins the pool address, so our step 2 fails and everything is undone
    const nft = Keypair.generate();
    const { lpTokens, lpSol } = await plan(t);
    await expectError(send([await prepareIx(t), rivalPool, await createPoolIx(t, nft, lpTokens, lpSol)], [att, rivalNft, nft]), /./);
    const cv: any = await (program.account as any).curve.fetch(t.a.curve);
    assert.equal(cv.graduatedStage, 0, "still at the start, hook still on, curve still sells");
    assert.isNull(await c.getAccountInfo(t.a.pool), "no rival pool exists");
    await program.methods.sell(new BN(1_000_000_000), new BN(0)).accountsPartial({ seller: att.publicKey, mint: t.mint.publicKey }).signers([att]).rpc();
  });

  it("an honest graduation (steps 1, 2 and 3 in one transaction) works", async () => {
    const t = await newToken("THREE");
    await buy(t, await wallet(160), 150);
    await graduateHonestly(t);
    const cv: any = await (program.account as any).curve.fetch(t.a.curve);
    assert.equal(cv.graduatedStage, 3);
    assert.isTrue(big(cv.lpSol) > 80n * BigInt(LAMPORTS_PER_SOL));
  });

  it("tokens that stay in the vault by gift do not change the pool's opening price", async () => {
    const t = await newToken("GIFT");
    const donor = await wallet(170);
    await buy(t, donor, 5);
    await buy(t, donor, 150);
    const before = await plan(t);
    // the donor sends part of their tokens straight into the curve's vault (the hook allows tokens INTO the curve)
    const donorAta = spl.getAssociatedTokenAddressSync(t.mint.publicKey, donor.publicKey, false, T22);
    const gift = (await spl.getAccount(c, donorAta, "confirmed", T22)).amount / 2n;
    const giftIx = await spl.createTransferCheckedWithTransferHookInstruction(c, donorAta, t.mint.publicKey, t.a.vault, donor.publicKey, gift, 6, [], "confirmed", T22);
    const giftSig = await sendAndConfirmTransaction(c, new Transaction().add(giftIx), [donor]);
    await c.confirmTransaction(giftSig, "finalized");
    const afterGift = await plan(t);
    assert.equal(afterGift.lpTokens - before.lpTokens, gift, "the vault really got the gift");
    await graduateHonestly({ ...t, __plan: { lpTokens: before.lpTokens, lpSol: before.lpSol } });
    const cv: any = await (program.account as any).curve.fetch(t.a.curve);
    assert.equal(big(cv.lpTokens), 206_900_000_000_000n, "only the tokens the curve itself owns went into the pool");
    assert.equal((await spl.getAccount(c, t.a.vault, "confirmed", T22)).amount, gift, "the gift stays behind");
  });

  it("holders keep the rewards they earned even if they move their tokens out after graduation", async () => {
    const t = await newToken("LOSS");
    const holder = await wallet(3);
    const seller = await wallet(5);
    const other = await wallet(1);
    await buy(t, holder, 1);
    await buy(t, seller, 2);
    // the seller sells part right away and pays tax; half of it goes to the other holders
    const sAta = spl.getAssociatedTokenAddressSync(t.mint.publicKey, seller.publicKey, false, T22);
    const sBal = (await spl.getAccount(c, sAta, "confirmed", T22)).amount;
    await program.methods.sell(new BN((sBal * 4n / 10n).toString()), new BN(0)).accountsPartial({ seller: seller.publicKey, mint: t.mint.publicKey }).signers([seller]).rpc();
    await buy(t, await wallet(160), 150);
    await graduateHonestly(t);

    const cv: any = await (program.account as any).curve.fetch(t.a.curve);
    const posAddr = pda([Buffer.from("position"), t.mint.publicKey.toBuffer(), holder.publicKey.toBuffer()], program.programId);
    const pos: any = await (program.account as any).position.fetch(posAddr);
    const owed = rewardOwed(big(pos.tracked), big(cv.accPerToken), big(pos.rewardDebt), big(pos.pendingRewards));
    assert.isTrue(owed > 0n, "the holder earned something");

    // tokens are free to move now: send everything away, then claim
    const hAta = spl.getAssociatedTokenAddressSync(t.mint.publicKey, holder.publicKey, false, T22);
    const hBal = (await spl.getAccount(c, hAta, "confirmed", T22)).amount;
    const oAta = await spl.createAssociatedTokenAccountIdempotent(c, payer, t.mint.publicKey, other.publicKey, { commitment: "confirmed" }, T22);
    await sendAndConfirmTransaction(c, new Transaction().add(spl.createTransferCheckedInstruction(hAta, t.mint.publicKey, oAta, holder.publicKey, hBal, 6, [], T22)), [holder]);

    const before = BigInt(await c.getBalance(holder.publicKey, "confirmed"));
    await program.methods.claimRewards().accountsPartial({ claimer: holder.publicKey, mint: t.mint.publicKey }).signers([holder]).rpc();
    const gained = BigInt(await c.getBalance(holder.publicKey, "confirmed")) - before;
    assert.isTrue(gained + 10_000n >= owed, `claimed ${gained} but earned ${owed}`);
  });

  it("an emergency pause also stops graduation", async function () {
    const configPda = pda([Buffer.from("config")], program.programId);
    const cfg: any = await (program.account as any).config.fetch(configPda);
    if (!cfg.admin.equals(payer.publicKey)) this.skip(); // this chain's admin is another wallet
    const t = await newToken("PAUSE");
    await buy(t, await wallet(160), 150);
    const nft = Keypair.generate();
    const { lpTokens, lpSol } = await plan(t);
    await program.methods.setPaused(true).accountsPartial({ admin: payer.publicKey }).rpc();
    try {
      await expectError(send([await prepareIx(t), await createPoolIx(t, nft, lpTokens, lpSol), await lockIx(t, nft)], [nft]), /Paused|paused/i);
    } finally {
      await program.methods.setPaused(false).accountsPartial({ admin: payer.publicKey }).rpc();
    }
    await graduateHonestly(t); // and it works again once resumed
    const cv: any = await (program.account as any).curve.fetch(t.a.curve);
    assert.equal(cv.graduatedStage, 3);
  });
});
