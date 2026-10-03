# HODL

Token launchpad on Solana where the sell tax melts to zero the longer you hold.

- `programs/hold_launchpad`: Anchor program (bonding curve, decaying sell tax, per-wallet sell limit, holder rewards, platform fee, graduation to a Meteora pool)
- `programs/hodl_hook`: Token-2022 transfer hook (tokens can only move by trading on the curve until they graduate)
- `tests/`: on-chain tests (`hodl.cts`, `graduation.cts`, `indexer.cts`)
- `web/`: Next.js site
- `scripts/admin.cjs`: admin tool (pause, fee, treasury, admin handover)
- `docs/`: TRACKER.md (status), SECURITY_AUDIT.md, MULTISIG.md, VERCEL.md

## Rules the program enforces
- Sell tax starts at `max_tax` and fades linearly to 0 over `decay_secs` of holding. Tokens that were not bought through the curve count as brand new.
- The tax stays in the pool, so it lifts the price for everyone still holding.
- One wallet can sell `holder_sell_bps` of its own balance per window.
- Mint authority is revoked at creation.
- Until graduation, tokens can only be bought or sold on the curve (transfer hook).
- When the curve fills, anyone can graduate it in 3 steps: the hook is switched off, a Meteora DAMM v2 pool is created with the SOL raised (minus a 0.05 SOL setup cost) and the leftover tokens, and the liquidity is locked for good. Pool trading fees go to the treasury.

## Local run
1. Terminal 1: `solana-test-validator --reset --limit-ledger-size 10000 --url devnet --clone-upgradeable-program cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG` (copies Meteora's program from devnet, needed for the graduation tests)
2. Terminal 2, project root:
   ```
   anchor keys sync && anchor build   # prints a harmless "IDL doesn't exist" for the hook; use -p hold_launchpad to build only the main program
   solana config set --url localhost
   solana airdrop 100
   anchor program deploy target/deploy/hold_launchpad.so --program-name hold_launchpad --provider.cluster localnet
   yarn install
   ANCHOR_PROVIDER_URL=http://localhost:8899 ANCHOR_WALLET=~/.config/solana/id.json yarn test
   ```
3. Site:
   ```
   cd web
   npm install
   npm run sync-idl
   cp .env.local.example .env.local   # then paste the Program Id from the deploy output
   npm run dev
   ```

Unaudited prototype. Do not put real money through it.
