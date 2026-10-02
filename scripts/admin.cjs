#!/usr/bin/env node
// HODL admin tool. Reads the global config and, with --yes, changes it.
//
//   node scripts/admin.cjs show
//   node scripts/admin.cjs set-paused true|false  --yes
//   node scripts/admin.cjs set-fee <bps>          --yes   (platform fee for NEW tokens, max 200)
//   node scripts/admin.cjs set-treasury <address> --yes
//   node scripts/admin.cjs propose-admin <address> --yes  (step 1 of handing admin to someone else)
//   node scripts/admin.cjs accept-admin --yes             (step 2: run with the WALLET of the proposed admin)
//   node scripts/admin.cjs init <treasury> <fee-bps> --yes (one time, upgrade authority only)
//
// Environment:  RPC_URL (default http://127.0.0.1:8899)   WALLET (default ~/.config/solana/id.json)
// The wallet file is read locally to sign. It is never printed or sent anywhere.
const anchor = require("@anchor-lang/core");
const { BN } = anchor;
const { Connection, Keypair, PublicKey } = require("@solana/web3.js");
const fs = require("fs");
const os = require("os");
const path = require("path");

const idl = JSON.parse(fs.readFileSync(path.join(__dirname, "../target/idl/hold_launchpad.json"), "utf8"));
const rpc = process.env.RPC_URL || "http://127.0.0.1:8899";
const walletPath = (process.env.WALLET || "~/.config/solana/id.json").replace(/^~/, os.homedir());
const args = process.argv.slice(2);
const yes = args.includes("--yes");
const [cmd, a1, a2] = args.filter((a) => a !== "--yes");

const lamportsToSol = (n) => (Number(n) / 1e9).toFixed(4);

(async () => {
  const connection = new Connection(rpc, "confirmed");
  const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf8"))));
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(kp), { commitment: "confirmed", preflightCommitment: "confirmed" });
  const program = new anchor.Program(idl, provider);
  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId);

  const show = async (label) => {
    const c = await program.account.config.fetchNullable(configPda);
    if (!c) return console.log(`${label}: not set up yet (run: init <treasury> <fee-bps> --yes)`);
    console.log(`${label}:`);
    console.log(`  admin           ${c.admin.toBase58()}`);
    console.log(`  pending admin   ${c.pendingAdmin.equals(PublicKey.default) ? "(none)" : c.pendingAdmin.toBase58()}`);
    console.log(`  treasury        ${c.treasury.toBase58()}`);
    console.log(`  platform fee    ${c.platformFeeBps / 100}% (applies to new tokens only)`);
    console.log(`  paused          ${c.paused ? "YES: no new buys or new tokens (selling and claiming still work)" : "no"}`);
  };

  console.log(`network: ${rpc}\nprogram: ${program.programId.toBase58()}\nsigning as: ${kp.publicKey.toBase58()}\n`);
  if (!cmd || cmd === "show") return show("current config");

  const need = (v, what) => {
    if (v === undefined) throw new Error(`missing ${what}`);
    return v;
  };
  let build;
  if (cmd === "set-paused") {
    const v = need(a1, "true or false");
    if (v !== "true" && v !== "false") throw new Error("use true or false");
    build = () => program.methods.setPaused(v === "true").accountsPartial({ admin: kp.publicKey }).rpc();
  } else if (cmd === "set-fee") {
    const bps = Number(need(a1, "fee in basis points, 100 = 1%"));
    if (!Number.isInteger(bps) || bps < 0 || bps > 200) throw new Error("fee must be a whole number of basis points between 0 and 200");
    build = () => program.methods.setPlatformFee(bps).accountsPartial({ admin: kp.publicKey }).rpc();
  } else if (cmd === "set-treasury") {
    const t = new PublicKey(need(a1, "treasury address"));
    build = () => program.methods.setTreasury(t).accountsPartial({ admin: kp.publicKey }).rpc();
  } else if (cmd === "propose-admin") {
    const n = new PublicKey(need(a1, "new admin address"));
    build = () => program.methods.proposeAdmin(n).accountsPartial({ admin: kp.publicKey }).rpc();
  } else if (cmd === "accept-admin") {
    build = () => program.methods.acceptAdmin().accountsPartial({ newAdmin: kp.publicKey }).rpc();
  } else if (cmd === "init") {
    const t = new PublicKey(need(a1, "treasury address"));
    const bps = Number(need(a2, "fee in basis points"));
    const [programData] = PublicKey.findProgramAddressSync([program.programId.toBuffer()], new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"));
    build = () => program.methods.initConfig(t, bps).accountsPartial({ authority: kp.publicKey, programData }).rpc();
  } else {
    throw new Error(`unknown command "${cmd}"`);
  }

  await show("before");
  if (!yes) return console.log("\nDry run only. Add --yes to send this change.");
  const sig = await build();
  console.log(`\nsent: ${sig}\n`);
  await show("after");
})().catch((e) => {
  console.error("FAILED:", String(e.message || e).slice(0, 300));
  process.exit(1);
});
