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
- [x] Rewards count only tokens still in the wallet
- [x] Website: browse, launch, trade, tax meter, sell room, rewards box, fee breakdown
- [x] Site reads chain time instead of the browser clock
- [x] Calm minimal restyle (Inter + Geist Mono, dark mode)
- [x] Security headers, https-only token images
- [x] Tests: 14 on-chain (yarn test), 18 math (cargo test)

## Open: security and correctness
- [ ] MED  Many wallets beat the per-wallet sell limit (a whale can split up). Decide: accept, or add a cost
- [ ] MED  Timed token moves can still game rewards (flash-hold). Real fix: Token-2022 transfer hook
- [ ] MED  Minimum sell share is 1% per window, which is honeypot-like. Proposal: raise to 5%
- [ ] MED  No test for the "moved tokens stop earning" rule
- [ ] LOW  Creator sees every viewer's IP via the token image URL. Fix: image proxy or upload
- [ ] LOW  npm audit: 22 findings inside Solana/Anchor libraries, no safe fix yet. Re-check on upgrades
- [ ] LOW  CURVE_ACCOUNT_SIZE in web/src/lib/program.ts is hardcoded. Update if the Curve struct changes
- [ ] HIGH (before mainnet) Professional audit, legal review, multisig upgrade authority

## Open: product
- [ ] Richer home page: totals strip, token cards with sparkline, activity ticker
- [ ] "My earnings" page: everything you can claim across tokens
- [ ] Holder-first discovery: sort by SOL paid to holders, share who kept holding
- [ ] Devnet deploy + private Vercel preview (password protected)
- [ ] DEX graduation (and Token-2022 + transfer hook at the same time)
- [ ] Token metadata and images (on-chain)
- [ ] Price chart

## Notes
- Local run: validator `solana-test-validator` (run it in a terminal tab), then `cd web && npm run dev`.
- Never commit: `*-keypair.json`, `.env.local`, licensed fonts.
- Tests: `ANCHOR_PROVIDER_URL=http://localhost:8899 ANCHOR_WALLET=~/.config/solana/id.json yarn test` and `cargo test`.
