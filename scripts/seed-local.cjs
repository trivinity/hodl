#!/usr/bin/env node
// Fills a LOCAL test chain with a few example tokens and some trading, so the website has something to show.
// Refuses to run against anything that is not localhost. Uses the test wallet in ~/.config/solana/id.json.
const anchor = require("@anchor-lang/core");
const { BN } = anchor;
const { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } = require("@solana/web3.js");
const { getAssociatedTokenAddressSync, getAccount, TOKEN_2022_PROGRAM_ID: T22 } = require("@solana/spl-token");
const fs = require("fs");
const os = require("os");
const path = require("path");

const rpc = process.env.RPC_URL || "http://127.0.0.1:8899";
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(rpc)) {
  console.error("Refusing to run: this script only seeds a local chain (RPC_URL must be localhost).");
  process.exit(1);
}
const idl = JSON.parse(fs.readFileSync(path.join(__dirname, "../target/idl/hold_launchpad.json"), "utf8"));
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path.join(os.homedir(), ".config/solana/id.json"), "utf8"))));

const TOKENS = [
  // name, symbol, creatorFee, maxTax, decayHours, sellPct, windowHours, reward, holderFee
  ["Diamond Hands", "DIAM", 100, 3000, 168, 50, 24, 5000, 100],
  ["Slow Burn", "BURN", 100, 4000, 240, 35, 24, 7500, 0],
  ["Easy Mode", "EASY", 100, 1500, 24, 75, 24, 2500, 100],
];

(async () => {
  const c = new Connection(rpc, "confirmed");
  const mk = (kp) => new anchor.Program(idl, new anchor.AnchorProvider(c, new anchor.Wallet(kp), { commitment: "confirmed", preflightCommitment: "confirmed" }));
  const bots = [Keypair.generate(), Keypair.generate()];
  const fund = new Transaction();
  bots.forEach((b) => fund.add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: b.publicKey, lamports: 6e9 })));
  await sendAndConfirmTransaction(c, fund, [payer]);
  const pa = mk(payer);
  const [p1, p2] = bots.map(mk);

  // optional: pick which tokens to create, for example `node scripts/seed-local.cjs 1,2`
  const only = (process.argv[2] || "").split(",").filter(Boolean).map(Number);
  for (const [i, [name, sym, fee, tax, decayH, sellPct, winH, reward, hfee]] of TOKENS.entries()) {
    if (only.length && !only.includes(i)) continue;
    const mint = Keypair.generate();
    const [curve] = PublicKey.findProgramAddressSync([Buffer.from("curve"), mint.publicKey.toBuffer()], pa.programId);
    const vault = getAssociatedTokenAddressSync(mint.publicKey, curve, true, T22);
    await pa.methods
      .createCurve(name, sym, "", fee, tax, new BN(decayH * 3600), sellPct * 100, new BN(winH * 3600), reward, hfee)
      .accountsPartial({ creator: payer.publicKey, mint: mint.publicKey, vault })
      .signers([mint])
      .rpc();
    await pa.methods.buy(new BN(1.5e9), new BN(0)).accountsPartial({ buyer: payer.publicKey, mint: mint.publicKey }).rpc();
    await p1.methods.buy(new BN(1e9), new BN(0)).accountsPartial({ buyer: bots[0].publicKey, mint: mint.publicKey }).signers([bots[0]]).rpc();
    await p2.methods.buy(new BN(0.6e9), new BN(0)).accountsPartial({ buyer: bots[1].publicKey, mint: mint.publicKey }).signers([bots[1]]).rpc();
    // an early seller pays the tax, so holders have rewards waiting
    const ata = getAssociatedTokenAddressSync(mint.publicKey, bots[1].publicKey, false, T22);
    const bal = BigInt((await getAccount(c, ata, "confirmed", T22)).amount);
    await p2.methods.sell(new BN(((bal * BigInt(sellPct - 5)) / 100n).toString()), new BN(0)).accountsPartial({ seller: bots[1].publicKey, mint: mint.publicKey }).signers([bots[1]]).rpc();
    console.log(`created ${sym}: ${mint.publicKey.toBase58()}`);
  }
  console.log("done. Reload the site.");
})().catch((e) => {
  console.error("FAILED:", String(e.message || e).slice(0, 300));
  process.exit(1);
});
