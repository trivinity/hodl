const anchor: any = require("@anchor-lang/core");
const { BN } = anchor;
const { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } = require("@solana/web3.js");
const { assert } = require("chai");
const { getAccount, getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } = require("@solana/spl-token");
const fs = require("fs");
const path = require("path");
const { indexOnce, memoryStore } = require("../web/src/lib/indexer.ts");

const idl = JSON.parse(fs.readFileSync(path.join(process.cwd(), "target/idl/hold_launchpad.json"), "utf8"));

// runs the real indexer against the local validator with an in-memory store
describe("indexer", () => {
  const envProvider = anchor.AnchorProvider.env();
  const provider = new anchor.AnchorProvider(envProvider.connection, envProvider.wallet, { commitment: "confirmed", preflightCommitment: "confirmed" });
  const program = new anchor.Program(idl, provider);
  const creator = provider.wallet.payer;
  const bot = Keypair.generate();
  const mint = Keypair.generate();

  it("records a token, its trades and a claim, and never repeats work", async () => {
    await provider.sendAndConfirm(
      new Transaction().add(SystemProgram.transfer({ fromPubkey: creator.publicKey, toPubkey: bot.publicKey, lamports: 3 * LAMPORTS_PER_SOL }))
    );
    await program.methods
      .createCurve("Indexed", "IDX", "", 100, 3000, new BN(3600), 5000, new BN(3600), 5000, 100)
      .accountsPartial({
        creator: creator.publicKey,
        mint: mint.publicKey,
        vault: getAssociatedTokenAddressSync(
          mint.publicKey,
          PublicKey.findProgramAddressSync([Buffer.from("curve"), mint.publicKey.toBuffer()], program.programId)[0],
          true,
          TOKEN_2022_PROGRAM_ID
        ),
      })
      .signers([mint])
      .rpc();
    await program.methods.buy(new BN(1 * LAMPORTS_PER_SOL), new BN(0)).accountsPartial({ buyer: creator.publicKey, mint: mint.publicKey }).rpc();
    await program.methods.buy(new BN(1 * LAMPORTS_PER_SOL), new BN(0)).accountsPartial({ buyer: bot.publicKey, mint: mint.publicKey }).signers([bot]).rpc();
    const bal = BigInt(
      (await getAccount(provider.connection, getAssociatedTokenAddressSync(mint.publicKey, bot.publicKey, false, TOKEN_2022_PROGRAM_ID), "confirmed", TOKEN_2022_PROGRAM_ID)).amount
    );
    await program.methods
      .sell(new BN(((bal * 40n) / 100n).toString()), new BN(0))
      .accountsPartial({ seller: bot.publicKey, mint: mint.publicKey })
      .signers([bot])
      .rpc();
    await program.methods.claimRewards().accountsPartial({ claimer: creator.publicKey, mint: mint.publicKey }).rpc();

    const store = memoryStore();
    const first = await indexOnce({ connection: provider.connection, program, store });
    assert.isFalse(first.gap);
    assert.isAbove(first.transactions, 0);

    const m = mint.publicKey.toBase58();
    const curves = store.rows.curves.filter((c: any) => c.mint === m);
    const trades = store.rows.trades.filter((t: any) => t.mint === m);
    const claims = store.rows.claims.filter((c: any) => c.mint === m);

    assert.equal(curves.length, 1, "one CurveCreated row");
    assert.equal(curves[0].symbol, "IDX");
    assert.equal(curves[0].holder_fee_bps, 100);
    assert.equal(curves[0].platform_fee_bps, 100, "the token records the platform fee it launched with");
    assert.equal(curves[0].creator, creator.publicKey.toBase58());

    assert.equal(trades.length, 3, "two buys and one sell");
    assert.equal(trades.filter((t: any) => t.is_buy).length, 2);
    const sell = trades.find((t: any) => !t.is_buy);
    assert.isAbove(sell.tax, 0);
    assert.isAbove(sell.rewards, 0);
    assert.isAbove(trades.find((t: any) => t.is_buy).fee_to_holders, -1);
    assert.equal(sell.trader, bot.publicKey.toBase58());
    assert.isAbove(sell.fee_to_platform, 0, "every trade pays the platform fee");
    assert.isTrue(trades.every((t: any) => t.fee_to_platform > 0));
    // the first buy has no other holder to pay, so its holder fee goes to the creator; the second buy pays the first buyer
    assert.isAbove(trades.filter((t: any) => t.is_buy).reduce((a: number, t: any) => a + t.fee_to_holders, 0), 0);

    assert.equal(claims.length, 1);
    assert.equal(claims[0].claimer, creator.publicKey.toBase58());
    // the claim paid out the rewards the sell and the second buy created
    const paidIn = sell.rewards + trades.reduce((a: number, t: any) => a + t.fee_to_holders, 0);
    assert.isAtMost(claims[0].amount, paidIn);
    assert.isAbove(claims[0].amount, 0);

    // a second run starts from the saved cursor and finds nothing new
    const second = await indexOnce({ connection: provider.connection, program, store });
    assert.equal(second.transactions, 0, "second run must not repeat work");
    assert.equal(store.rows.trades.length, first.trades, "no duplicate rows");
  });
});
