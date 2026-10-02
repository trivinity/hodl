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
- [x] Tests: 24 on-chain (yarn test), 19 math (cargo test)

## Open: security and correctness
- [ ] LOW  Reward flash-hold: tokens moved out and back by plain transfer still earn while away.
      Low today because the only market is our curve, which re-checks balances on every trade.
      FINDING (checked on the DEX docs): a Token-2022 transfer hook does NOT fix this where it matters.
        Meteora DAMM v2 revokes the hook at graduation. Orca needs a manual Token Badge. Raydium unconfirmed.
      So the hook would only work while a token is still on our own curve, where we already see every trade.
      DECISION NEEDED: after graduation, either (1) the rules end and the token is a plain token on a DEX,
      or (2) tokens never leave our curve, so every rule stays enforceable. Pick before building graduation.
- [ ] LOW  Creator sees every viewer's IP via the token image URL. Fix: image proxy or upload
- [ ] LOW  npm audit: 22 findings inside Solana/Anchor libraries, no safe fix yet. Re-check on upgrades
- [ ] LOW  CURVE_ACCOUNT_SIZE in web/src/lib/program.ts is hardcoded. Update if the Curve struct changes
- [ ] HIGH (before mainnet) Professional audit, legal review, multisig upgrade authority

- [ ] UX  A wallet that moves all its tokens away forfeits rewards it had not claimed yet. Site must warn: claim before moving tokens

- [ ] PARKED (decided: not needed initially): put the upgrade authority, admin and treasury under a multisig. Guide ready in docs/MULTISIG.md. Until then ONE wallet controls upgrades and the admin powers. Do before mainnet.
- [ ] Devnet still runs the OLD program (no Config, no platform fee, no pause, no CurveCreated event). To update: extend the program by about 17 KB (about 0.12 devnet SOL), upgrade, then run: node scripts/admin.cjs init <treasury> 100 --yes with RPC_URL set to devnet.

## Open: product
- [ ] Richer home page: totals strip, token cards with sparkline, activity ticker
- [ ] "My earnings" page: everything you can claim across tokens
- [ ] Holder-first discovery: sort by SOL paid to holders, share who kept holding
- [ ] Private Vercel preview (password protected), pointed at devnet
- [ ] DEX graduation. DIRECTION ADOPTED: tokens graduate into a Meteora DAMM v2 pool; the personal hold-time tax and
      sell limits apply on our curve only. What carries over: a decaying fee for everyone (fee scheduler, 99% max so our 30% start fits),
      fees paid to holders via a permanently locked LP position owned by our program, anti-snipe from the high starting fee.
      Checked in Meteora docs: fee scheduler limits (fine), permanent lock still earns claimable fees (fine).
      Still to prove on devnet: a program-owned account holding the position NFT can claim the fees (docs say claims can be delegated).
      Still to design: how to split the fees among holders without our curve seeing balances
      (options: pay by balance at claim time, which brings back flash-hold; or periodic snapshots, which is heavier).
      Also needed: the UI must label each token's phase (on our curve vs graduated) so nobody assumes the rules still apply.
- [ ] Price chart

- [x] Supabase project "hodl" created (free tier, us-east-1, ref puamkthzhgibhzfjrktl) and the schema applied. Security advisor: clean (one INFO about indexer_state having no policies, which is intended).
      Verified with the public key: reads work, inserts refused, deletes change nothing, indexer_state hidden. Public URL + anon key are in web/.env.local.
- [x] Indexer verified end to end against the real Supabase project: /api/index refuses missing/wrong secret (401), saves tokens and trades with the service key, second run finds nothing new, cursor saved.
- [ ] ROTATE SECRETS: the CRON_SECRET and service role key were accidentally printed in the chat transcript on 2026-10-02. Make a new CRON_SECRET, create a new Supabase secret key (and disable the old service_role key), update web/.env.local, restart the site.
- [ ] Old paused Supabase project "supabase-charcoal-house" left untouched (not ours to change).
- [ ] Disk is at 98% full: the local test ledger at ~/tl/test-ledger is 3 GB; delete it when the validator is stopped.
- [ ] Indexer caveats: first run reads at most 5000 transactions back (reports gap:true if more). Vercel Hobby cron runs once a day only; for every-minute runs use Vercel Pro or a free GitHub Actions schedule.
- [ ] Devnet program has 3.7 KB of headroom (max-len 335000, program 331256). The CurveCreated event is NOT deployed to devnet yet; it needs an upgrade (about 0.001 SOL in fees, refundable buffer rent).

## Notes
- Devnet: set `NEXT_PUBLIC_RPC_URL=https://api.devnet.solana.com` and `NEXT_PUBLIC_CLUSTER_LABEL=devnet` (the public RPC is rate limited; use a free provider key for sharing).
- Devnet SOL is scarce: the public faucet is rate limited. Do not run the full test suite on devnet (it needs about 20 SOL).
- Local run: validator needs the Metaplex program copied from devnet: `solana-test-validator --reset --url devnet --clone-upgradeable-program metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s` (run it in a terminal tab), then `cd web && npm run dev`.
- Never commit: `*-keypair.json`, `.env.local`, licensed fonts.
- Tests: `ANCHOR_PROVIDER_URL=http://localhost:8899 ANCHOR_WALLET=~/.config/solana/id.json yarn test` and `cargo test`.
