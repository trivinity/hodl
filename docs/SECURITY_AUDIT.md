# HODL self-audit (2026-10-02)

This is a **self-review by the developer's AI assistant**, not a professional audit. It does not replace one.
Everything below was read or tested on 2026-10-02 against commit `e86c5a8` plus the small changes listed at the end.

## What was covered
- Main program `hold_launchpad` (every instruction, every account list, the SOL accounting)
- Hook program `hodl_hook`
- Website, admin page, and the `/api/index` route
- Supabase database (access rules, advisor)
- Vercel project settings and live security headers
- Dependencies (npm), secrets in git history, the repository itself
- Compute usage and worst-case token details

## What was NOT covered (be honest about this)
- No professional audit, no fuzzing, no formal verification
- `cargo audit` was not available, so Rust dependencies were not scanned for known advisories
- No test of how Phantom, other wallets, explorers or token scanners treat hook tokens
- No load or abuse testing, no penetration test of Vercel or Supabase
- Graduation (added later the same day) was NOT part of this review; it is tested but not yet re-audited

## Findings

| # | Severity | Area | Finding | Status |
|---|---|---|---|---|
| 1 | HIGH | Secrets | The indexer secret (`CRON_SECRET`) and the Supabase service key were printed in the assistant chat. Anyone who can read that chat can use them. | **OPEN: rotate both** (new CRON_SECRET, new Supabase secret key, disable the old one) |
| 2 | HIGH before mainnet | Control | One key controls upgrades of both programs and one key is the admin. An upgrade can change any rule or take funds. | OPEN. Multisig guide ready in `docs/MULTISIG.md` (parked by choice) |
| 3 | HIGH before mainnet | Process | Unaudited, brand-new custody code, including a new hook program. | OPEN. Needs a professional audit and a legal review |
| 4 | MEDIUM | Product | Graduation was not built at the time of this review. | BUILT later the same week; reviewed in the second pass below |
| 5 | MEDIUM | Trust | Hook tokens may be flagged as risky by scanners and some wallets. Holders cannot move tokens to a cold wallet before graduation. | OPEN: untested with real wallets. Shown plainly on each token page |
| 6 | MEDIUM | Website | The content security policy only blocks framing. There is no script policy, so a future cross-site-scripting bug would be worse. | OPEN: add a report-only policy first |
| 7 | LOW | Availability | Creating a token could be blocked by someone who pre-funds the new mint or hook list address in the same moment (needs to see the transaction first). The creator just retries with a fresh key. | ACCEPTED, theoretical |
| 8 | LOW | Phishing | Nothing stops a token being named like a well-known one (for example "USDC"). | OPEN: consider reserved names or a warning |
| 9 | LOW | Product | Creators can still pick harsh but bounded rules (up to 50% tax, 20% per day minimum sell, 365 day fade). All rules are shown on the token page. | ACCEPTED |
| 10 | LOW | Dependencies | 22 npm advisories (6 high), all inherited from the Solana and Anchor libraries or from Next.js build tooling. No safe fix exists without breaking downgrades. | MONITOR on upgrades |
| 11 | LOW | Ops | The devnet deploy key is stored as a plain file in a temporary folder (devnet only). Losing it means the devnet programs cannot be upgraded. | OPEN: back up, and use a hardware wallet or multisig for mainnet |
| 12 | LOW | Ops | A treasury address with a zero balance cannot receive a platform-fee payout smaller than the rent minimum (about 0.00089 SOL). | ACCEPTED: use a funded wallet (your Phantom wallet is) |
| 13 | INFO | Product | Tokens worth less than a lamport cannot be sold (the sale rounds to zero). | ACCEPTED |
| 14 | INFO | Website | Prices shown come from the RPC node the site uses. A malicious node could show wrong numbers, but on-chain limits (slippage, program checks) still apply. | ACCEPTED |

## Verified OK
- **SOL accounting:** the amount that leaves the curve account always equals what the reserves, fees, platform fees and reward pool shrink by (re-derived by hand for buys, sells, claims). A test checks the curve account always holds at least what it owes.
- **Account checks:** every instruction pins or derives its accounts (curve, config, position, vault, token accounts, hook accounts, treasury). The token program and the hook program are fixed addresses.
- **Admin:** only the stored admin can pause, change the fee for new tokens, change the treasury, or hand over admin (two steps). The first-time setup can only be done by the program's upgrade authority. Fee changes never touch existing tokens. Platform fee is capped at 2%, creator plus holder fee at 5%.
- **Pause:** blocks new buys and new tokens only. Selling and reward claims always work.
- **Hook:** refuses wallet to wallet transfers, transfers to any outside account, transfers by an approved delegate, and (because token accounts are locked to their owner) cannot be skipped by handing a token account to someone else. All four are covered by tests. Anyone can still send tokens *into* the curve's account, which only donates them.
- **Tokens:** no one can mint more, no freeze authority, name/symbol/image stored in the token and not changeable by any instruction.
- **Rewards:** paid only to other holders, never back to the person trading; claims cannot exceed the pool; rounding dust cannot block the last claimer.
- **Math:** overflow is checked everywhere; 19 unit tests plus the on-chain tests.
- **Compute:** create about 93k, buy about 93k, sell about 61k of the 200k limit. Maximum-length name, symbol and image link work.
- **Database:** public key can read but not write (tested); the internal state table is hidden; the Supabase advisor shows only the intended note.
- **Website:** no use of raw HTML injection; token images must be https and send no referrer; security headers are live on Vercel (no framing, no sniffing, strict transport); the indexer route refuses callers without the secret and compares it in constant time; the preview is behind Vercel login.
- **Repository:** private; no secrets or key files anywhere in git history.

## Changes made during the audit
- `/api/index` compares its secret in constant time.
- Added two hook tests: an approved delegate cannot move tokens off the curve, and a holder cannot reassign their token account.
- (Earlier the same day) caps on tax fade and sell window, a 20% per day minimum sell speed, the reward-to-others-only fix, claim cap at pool size.

## Before real money (minimum)
1. Rotate the secrets from finding 1.
2. Professional audit of both programs.
3. Legal review (a launchpad with sell taxes and fee sharing may be regulated in some places).
4. Put upgrade authority, admin and treasury under a multisig.
5. Build and review graduation.
6. Test hook tokens in real wallets and with scanners.


---

# Second pass: graduation and everything added since (2026-10-03)

Same limits as above: a self-review by the developer's AI assistant, not a professional audit. This time each suspicion was tried
as a real attack or loss scenario on a local chain running Meteora's real program, and every fix has a test
(`tests/graduation_attacks.cts`, `tests/graduation.cts`, and the unit tests in `graduation.rs`).

| # | Severity | Finding | Status |
|---|---|---|---|
| A | **HIGH** | **Anyone could trap a token's raised SOL.** Graduation was three separate steps. Meteora's pool address depends only on the two token addresses, so after step 1 switched the hook off, anyone holding a few tokens could open their own Meteora pool for the token. Step 2 then failed forever, curve selling was already closed, and the SOL (about 85 SOL on a full curve) sat in the graduation account. Reproduced: 84.96 SOL stuck. (Before step 1 this is impossible: Meteora refuses the token while its hook is on, error `InvalidTokenBadge`.) | **FIXED.** The program now refuses step 1 unless step 2 is a later instruction of the same transaction (it reads the transaction's instruction list). If step 2 fails, step 1 is undone, so a token can never be left half graduated. The whole graduation (hook off, pool, lock) now runs as one transaction and one wallet approval (about 276k compute units). |
| B | MEDIUM | **Earned holder rewards could be lost after graduation.** Rewards were paid on the smaller of a wallet's recorded tokens and its current balance. Before graduation tokens could not leave a wallet, so that was safe. After graduation they can, so a holder who sold or moved their tokens before claiming got nothing (reproduced: `NothingToClaim` for a holder who had earned rewards), and the SOL stayed stranded in the reward pool. | **FIXED.** Once graduation has started nothing new can be earned, so the program pays on the recorded tokens in full. The Earnings page uses the same rule and re-creates a closed token account before claiming. |
| C | LOW | Tokens sent by hand into the curve's vault (the hook allows that) were added to the pool and changed its opening price. | **FIXED.** Only the tokens the curve itself owns go into the pool; a gift stays behind. |
| D | LOW | The opening price could be set up to 0.5% away from the fair price by whoever triggers graduation (a small, bounded MEV leak). | **FIXED.** Now 0.1%. |
| E | LOW | The emergency pause did not stop graduation, so SOL could still move to Meteora during an incident. | **FIXED.** Graduation is refused while paused. |
| F | INFO | Rewards after graduation are paid on recorded tokens even if some were burned before graduation. Burning is a pure loss for the holder, so it is no way to gain. | ACCEPTED |
| G | INFO / trust | The locked liquidity lives in Meteora's program, which Meteora can upgrade. HODL cannot protect against a change or fault there. | ACCEPTED, but say so plainly to users |
| H | INFO | The pool-swap reader decides who traded from token balance changes. A router can make that a router address. Display only. | ACCEPTED |

## Checked and found fine in this pass
- All graduation accounts are pinned or derived (Meteora program, pool authority, event authority, wrapped SOL, the recorded pool and position). Nothing in HODL can remove pool liquidity once locked; the only thing that leaves the pool account is trading fees, and they can only go to the treasury address in the config (a claim naming any other address is refused, tested).
- Checks after pool creation (the pool must use at least 99.9% of the tokens and SOL) still hold; wrong price and too little liquidity are refused and, now, undone together with step 1.
- After setup the graduation address keeps about 0.035 SOL on devnet, about 17 times what later fee payouts need.
- Meteora's swap events cannot be forged: they are written by a call only Meteora can sign.
- The new website pieces (price route, search, watchlist, holders list, charts) show data and cannot move funds; the price route only forwards a number from CoinGecko or Jupiter, cached on the server.

## Still not covered
No professional audit, fuzzing or formal verification. Mainnet's Meteora settings were not checked (this was all local chain and devnet). Graduated tokens in real wallets and scanners are untested. `cargo audit` was not run. A full-size devnet graduation (about 85 SOL) was not run.
