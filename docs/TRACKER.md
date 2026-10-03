# HODL tracker

Plain list of what is done, what is open, and what is risky. Update it as we go.
Status: `[x]` done, `[ ]` open. Severity: HIGH / MED / LOW.

## Done
- [x] Bonding curve program: create, buy, sell, claim_fees (Anchor 1.x)
- [x] Decaying sell tax, per-wallet sell limits, hold clock that ignores transferred-in tokens
- [x] Holder rewards: share of sell tax paid to holders, claim_rewards
- [x] Trade fee options: creator only, holders only, or both
- [x] Reward payouts go to other holders only (fixed a stranded-rewards bug)
- [x] Claims capped at what the pool holds (rounding dust can't block the last claimer)
- [x] Selling stays open after the curve fills (otherwise SOL is locked forever)
- [x] Caps on tax fade (365d) and sell window (30d) so a token can't be a honeypot by settings
- [x] Minimum sell speed: every wallet must be able to sell at least 20% of its balance per day
- [x] Rewards count only tokens still in the wallet
- [x] Website: browse, launch, trade, tax meter, sell room, rewards box, fee breakdown
- [x] Site reads chain time instead of the browser clock
- [x] Calm minimal restyle (Inter + Geist Mono, dark mode)
- [x] Security headers, https-only token images
- [x] Wallet splitting is not a loophole: limit is a % of each wallet's balance, and tokens moved to a fresh wallet pay the full starting tax (both covered by tests)
- [x] Moved tokens stop earning, covered by a test
- [x] On-chain token metadata (Metaplex): name, symbol, image link; immutable; covered by a test
- [x] Deployed to DEVNET (program Eyv8eYAjHonsHQ6awmB4fy1mv2jqXciK8PzooUoV5kmb, max-len 335000, upgrade authority = a devnet-only key kept outside the repo).
      Smoke test passed on devnet: create with metadata, buy, taxed sell, reward claim (cost about 0.11 SOL). Test token A81cK8f3VzVsWewKZFmDoZaWuaqsm4KEB2bFfcaHKwCq
- [x] CurveCreated event so an indexer can see new tokens
- [x] Indexer built and tested against the local chain (web/src/lib/indexer.ts, tests/indexer.cts): tokens, trades, claims, no repeated work.
      Supabase schema in supabase/migrations/0001_init.sql, server route /api/index (needs CRON_SECRET), site reads trades from Supabase when configured.
- [x] Platform fee (1%) on every trade, locked in per token at launch; changeable (max 2%) for NEW tokens only; accrues per token; anyone can send it to the treasury
- [x] Pause switch (admin only): blocks new buys and new tokens, never sells or reward claims
- [x] Two-step admin handover (propose, then accept) and a command line admin tool: scripts/admin.cjs
- [x] Site shows the platform fee line, a paused banner, disabled Buy while paused, and a notice on the Launch page
- [x] Indexer and database record the platform fee (migration 0002 applied to the hodl project)
- [x] Program size trimmed to 351,944 bytes (size-optimized build, manual upgrade-authority check)
- [x] Admin page at /admin (not in the menu): pause button, platform fee for new tokens, treasury, two-step admin handover. Anyone can read it; only the admin wallet sees controls.
- [x] Code is on GitHub (private): https://github.com/trivinity/hodl
- [x] Tests: 28 on-chain (yarn test), 19 math (cargo test)

## Open: security and correctness
- [x] CLOSED by the hook (tokens cannot be moved off the curve now): Reward flash-hold: tokens moved out and back by plain transfer still earn while away.
      Low today because the only market is our curve, which re-checks balances on every trade.
      FINDING (checked on the DEX docs): a Token-2022 transfer hook does NOT fix this where it matters.
        Meteora DAMM v2 revokes the hook at graduation. Orca needs a manual Token Badge. Raydium unconfirmed.
      So the hook would only work while a token is still on our own curve, where we already see every trade.
      DECISION NEEDED: after graduation, either (1) the rules end and the token is a plain token on a DEX,
      or (2) tokens never leave our curve, so every rule stays enforceable. Pick before building graduation.
- [x] DONE: transfer hook. Until a token graduates it can only move by buying or selling on the curve: wallet to wallet and to other exchanges is refused (hodl_hook program, Token-2022). Also closes the flash-hold loophole. Name, symbol and image now live inside the mint (replaces Metaplex).
      On devnet: hook program 13PKRkQAtxV92pJpM7fXAhxd5a1QGQPJ22o9FLLo7FNA, main program upgraded. Verified on devnet with test token 32jy7kUUKiRWuk8tLhLHrJQhc5w3B7NFNjfk5sJpKN29. Older devnet tokens (classic type) are hidden by the site.
      Trade-offs: scanners and some wallets may flag hook tokens; holders cannot move tokens to a cold wallet until graduation. At graduation the hook must be switched off (curve is its authority; the instruction to do that is part of the graduation build, NOT built yet).
- [ ] SECURITY AUDIT (2026-10-02) done, see docs/SECURITY_AUDIT.md. Open items: rotate leaked secrets (HIGH), add a report-only content security policy (MEDIUM), token name impersonation warning (LOW), test hook tokens in real wallets and scanners (MEDIUM; Phantom on devnet CONFIRMED by the owner on 2026-10-02: a transfer is refused; other wallets and scanners not tested), install cargo-audit and scan Rust dependencies, back up the devnet deploy key (LOW).
- [ ] LOW  Creator sees every viewer's IP via the token image URL. Fix: image proxy or upload
- [ ] LOW  npm audit: 22 findings inside Solana/Anchor libraries, no safe fix yet. Re-check on upgrades
- [ ] LOW  CURVE_ACCOUNT_SIZE in web/src/lib/program.ts is hardcoded. Update if the Curve struct changes
- [ ] HIGH (before mainnet) Professional audit, legal review, multisig upgrade authority

- [x] (obsolete now that tokens cannot be moved) UX warning about claiming before moving tokens

- [ ] PARKED (decided: not needed initially): put the upgrade authority, admin and treasury under a multisig. Guide ready in docs/MULTISIG.md. Until then ONE wallet controls upgrades and the admin powers. Do before mainnet.
- [x] Devnet UPGRADED to the current program (extended to 355,000 bytes; config set up with a 1% fee and treasury 7EFW2Z5tBJAQ82VYRbUQJUMsURo6pv72nj5hao9vYJro; admin = the devnet-only deploy key FZY4Wv26C5nzsFVL6JWGypP2xB1pesYUBfkZ6eFseiUf).
      Verified on devnet: token locks in the 1% platform fee, platform fees paid to the treasury (exact amount), buys refused while paused, selling works while paused, resume, holder rewards claim. Test token 6Yhz8iDWsM9EtqCjfaJpdLwUywsRTD9iHDn7yQHEJ6xP. Cost 0.19 SOL; deployer has about 2.89 SOL left.

## Open: product
- [x] Richer home page: live numbers strip, how-it-works, live activity strip, token cards with a mini tax-fade drawing and rules (price sparkline NOT built; needs trade history per token)
- [x] "Your earnings" page (/earnings): every token you hold, current sell tax, what it is worth, claimable rewards, Claim and Claim all (3 per transaction). Claim math checked against a real batched claim (within 19 lamports of rounding). Wallet clicking NOT tested by me; needs your check in Phantom.
- [ ] Holder-first discovery: sort by SOL paid to holders, share who kept holding
- [ ] Private Vercel preview on devnet: the connector got 403 creating the project, so follow docs/VERCEL.md by hand (site builds cleanly with the devnet settings; verified)
- [x] GRADUATION built and tested on a local chain with Meteora's real program (copied from devnet): 3 steps, anyone can run them once a token is full.
      Step 1 switches the transfer hook off for good and sets the funds aside (0.05 SOL setup cost comes out of the SOL raised); step 2 creates the Meteora pool at the price the funds imply (fading fee 30% to about 1% over 7 days, fees collected in SOL); step 3 locks the liquidity permanently.
      Safety checks tested: wrong opening price rejected, too little liquidity rejected (cannot keep funds back), steps cannot be repeated or skipped, curve trading stops, holders can transfer freely afterwards, pool fees can only go to the treasury.
      Decisions made by the owner: pool fees go to the treasury; setup cost taken from the SOL raised.
      STILL TO DO: website (graduate button, graduated state, link to trade on the pool), indexer events, devnet upgrade (program is now 463 KB: costs about 2.4 SOL of temporary buffer plus about 0.5 SOL to extend, the devnet deploy key has about 1.8 SOL), size reduction ideas, real-wallet test of the 3 steps.
      Notes: needs a test chain with Meteora's program (see tests/graduation.cts); `anchor build -p hold_launchpad` builds the main program (a plain `anchor build` also builds the hook but prints a harmless 'IDL doesn't exist' for it).
- [ ] Price chart

- [x] Supabase project "hodl" created (free tier, us-east-1, ref puamkthzhgibhzfjrktl) and the schema applied. Security advisor: clean (one INFO about indexer_state having no policies, which is intended).
      Verified with the public key: reads work, inserts refused, deletes change nothing, indexer_state hidden. Public URL + anon key are in web/.env.local.
- [x] Indexer verified end to end against the real Supabase project: /api/index refuses missing/wrong secret (401), saves tokens and trades with the service key, second run finds nothing new, cursor saved.
- [ ] ROTATE SECRETS: the CRON_SECRET and service role key were accidentally printed in the chat transcript on 2026-10-02. Make a new CRON_SECRET, create a new Supabase secret key (and disable the old service_role key), update web/.env.local, restart the site.
- [ ] Old paused Supabase project "supabase-charcoal-house" left untouched (not ours to change).
- [ ] Disk is at 98% full: the local test ledger at ~/tl/test-ledger is 3 GB; delete it when the validator is stopped.
- [ ] Indexer caveats: first run reads at most 5000 transactions back (reports gap:true if more). Vercel Hobby cron runs once a day only; for every-minute runs use Vercel Pro or a free GitHub Actions schedule.
- [ ] Devnet program has 3.7 KB of headroom (max-len 335000, program 331256). The CurveCreated event is NOT deployed to devnet yet; it needs an upgrade (about 0.001 SOL in fees, refundable buffer rent).

- Local demo data: `node scripts/seed-local.cjs` fills a local chain with example tokens and trading (refuses non-local networks).

## Notes
- Run the admin tool against devnet: `RPC_URL=https://api.devnet.solana.com WALLET=<devnet deploy key file> node scripts/admin.cjs show`.
- Devnet: set `NEXT_PUBLIC_RPC_URL=https://api.devnet.solana.com` and `NEXT_PUBLIC_CLUSTER_LABEL=devnet` (the public RPC is rate limited; use a free provider key for sharing).
- Devnet SOL is scarce: the public faucet is rate limited. Do not run the full test suite on devnet (it needs about 20 SOL).
- Local run: validator needs the Metaplex program copied from devnet: `solana-test-validator --reset --url devnet --clone-upgradeable-program metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s` (run it in a terminal tab), then `cd web && npm run dev`.
- Never commit: `*-keypair.json`, `.env.local`, licensed fonts.
- Tests: `ANCHOR_PROVIDER_URL=http://localhost:8899 ANCHOR_WALLET=~/.config/solana/id.json yarn test` and `cargo test`.
