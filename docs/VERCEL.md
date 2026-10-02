# Deploying the site to Vercel (private preview on devnet)

The Claude Vercel connector could not create the project (403: no permission to create projects),
so do this once by hand in the Vercel dashboard. The site builds cleanly with these settings (checked).

## Steps
1. vercel.com/new, then import the GitHub repo **trivinity/hodl**. If it does not appear, give the Vercel GitHub app access to that private repo (GitHub settings, Applications).
2. **Root Directory:** `web`. Framework: Next.js (detected automatically). Leave build and install commands alone.
3. **Environment variables** (all three are public values, safe to enter as plain):
   - `NEXT_PUBLIC_RPC_URL` = `https://api.devnet.solana.com`
   - `NEXT_PUBLIC_PROGRAM_ID` = `Eyv8eYAjHonsHQ6awmB4fy1mv2jqXciK8PzooUoV5kmb`
   - `NEXT_PUBLIC_CLUSTER_LABEL` = `devnet`
4. Do NOT add the Supabase variables for the devnet preview. The database currently holds test data from the local chain, and without them the site reads the chain directly.
5. Deploy.
6. **Keep it private:** Project, Settings, Deployment Protection. Turn on Vercel Authentication for **all deployments** (so the production address needs a Vercel login too). Check by opening the link in a private window: it must ask you to log in.

## Notes
- The public devnet RPC is rate limited. Fine for a demo; for sharing widely use a free RPC provider key in `NEXT_PUBLIC_RPC_URL`.
- On devnet the admin is the devnet-only deploy key, so /admin shows the settings read-only until admin is handed to your wallet.
- Wallet users need Phantom set to **Devnet** and some devnet SOL.
- Never put the Supabase service key or CRON_SECRET in Vercel until you actually turn the indexer on (and then as "sensitive" variables, never `NEXT_PUBLIC_`).
