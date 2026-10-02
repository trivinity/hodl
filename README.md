# HODL

Token launchpad on Solana where the sell tax melts to zero the longer you hold.

- `programs/hold_launchpad`: Anchor program (bonding curve, decaying sell tax, per-wallet sell limit)
- `tests/hodl.cts`: on-chain tests
- `web/`: Next.js site

## Rules the program enforces
- Sell tax starts at `max_tax` and fades linearly to 0 over `decay_secs` of holding. Tokens that were not bought through the curve count as brand new.
- The tax stays in the pool, so it lifts the price for everyone still holding.
- One wallet can sell `holder_sell_bps` of its own balance per window.
- Mint authority is revoked at creation.

## Local run
1. Terminal 1: `solana-test-validator --reset`
2. Terminal 2, project root:
   ```
   anchor keys sync && anchor build
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
