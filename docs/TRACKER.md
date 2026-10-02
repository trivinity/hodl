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
- [x] Tests: 16 on-chain (yarn test), 18 math (cargo test)

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

## Open: product
- [ ] Richer home page: totals strip, token cards with sparkline, activity ticker
- [ ] "My earnings" page: everything you can claim across tokens
- [ ] Holder-first discovery: sort by SOL paid to holders, share who kept holding
- [ ] Devnet deploy + private Vercel preview (password protected)
- [ ] DEX graduation. DIRECTION ADOPTED: tokens graduate into a Meteora DAMM v2 pool; the personal hold-time tax and
      sell limits apply on our curve only. What carries over: a decaying fee for everyone (fee scheduler, 99% max so our 30% start fits),
      fees paid to holders via a permanently locked LP position owned by our program, anti-snipe from the high starting fee.
      Checked in Meteora docs: fee scheduler limits (fine), permanent lock still earns claimable fees (fine).
      Still to prove on devnet: a program-owned account holding the position NFT can claim the fees (docs say claims can be delegated).
      Still to design: how to split the fees among holders without our curve seeing balances
      (options: pay by balance at claim time, which brings back flash-hold; or periodic snapshots, which is heavier).
      Also needed: the UI must label each token's phase (on our curve vs graduated) so nobody assumes the rules still apply.
- [ ] Token metadata and images (on-chain)
- [ ] Price chart

## Notes
- Local run: validator `solana-test-validator` (run it in a terminal tab), then `cd web && npm run dev`.
- Never commit: `*-keypair.json`, `.env.local`, licensed fonts.
- Tests: `ANCHOR_PROVIDER_URL=http://localhost:8899 ANCHOR_WALLET=~/.config/solana/id.json yarn test` and `cargo test`.
