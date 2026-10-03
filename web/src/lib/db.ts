// Read-only access to the indexed data in Supabase, using the public anon key (rows are public by design).
// Plain fetch against the REST API keeps the browser bundle small. Everything here is optional:
// if Supabase is not configured the site reads the chain directly.
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const dbConfigured = Boolean(URL_ && KEY);

async function rest<T>(path: string): Promise<T> {
  const res = await fetch(`${URL_}/rest/v1/${path}`, { headers: { apikey: KEY!, Authorization: `Bearer ${KEY}` }, cache: "no-store" });
  if (!res.ok) throw new Error(`database read failed (${res.status})`);
  return res.json();
}

export type DbTrade = {
  sig: string;
  is_buy: boolean;
  trader: string;
  sol: number;
  tokens: number;
  tax: number;
  rewards: number;
  fee_to_holders: number;
  ts: string;
};

export function dbTrades(mint: string, limit = 25) {
  return rest<DbTrade[]>(`trades?select=sig,is_buy,trader,sol,tokens,tax,rewards,fee_to_holders,ts&mint=eq.${encodeURIComponent(mint)}&order=slot.desc,idx.desc&limit=${limit}`);
}

export type PlatformStats = { token_count: number; volume_lamports: number; paid_to_holders_lamports: number; tax_lamports: number; trader_count: number; graduated_count?: number; pool_fees_lamports?: number };
export async function dbPlatformStats(): Promise<PlatformStats | null> {
  const rows = await rest<PlatformStats[]>("platform_stats?select=*");
  return rows[0] ?? null;
}

export type CurveStats = { mint: string; trade_count: number; volume_lamports: number; paid_to_holders_lamports: number; tax_lamports: number };
export function dbCurveStats() {
  return rest<CurveStats[]>("curve_stats?select=mint,trade_count,volume_lamports,paid_to_holders_lamports,tax_lamports");
}

export type DbActivity = { sig: string; mint: string; is_buy: boolean; trader: string; sol: number; ts: string };
export function dbActivity(limit = 14) {
  return rest<DbActivity[]>(`trades?select=sig,mint,is_buy,trader,sol,ts&order=slot.desc,idx.desc&limit=${limit}`);
}

export type DbPricePoint = { ts: string; is_buy: boolean; virtual_sol: number; virtual_tokens: number };
/** every trade of one token, oldest first: each row carries the curve reserves right after it, which is all a price chart needs */
export function dbPriceHistory(mint: string, limit = 1000) {
  return rest<DbPricePoint[]>(`trades?select=ts,is_buy,virtual_sol,virtual_tokens&mint=eq.${encodeURIComponent(mint)}&order=slot.asc,idx.asc&limit=${limit}`);
}
