export function sol(lamports: bigint | number, digits = 3): string {
  const n = typeof lamports === "bigint" ? Number(lamports) / 1e9 : lamports / 1e9;
  return n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function tokens(base: bigint, digits = 2): string {
  const n = Number(base) / 1e6;
  return compact(n, digits);
}

export function compact(n: number, digits = 2): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(digits) + "B";
  if (abs >= 1e6) return (n / 1e6).toFixed(digits) + "M";
  if (abs >= 1e3) return (n / 1e3).toFixed(digits) + "K";
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export function price(p: number): string {
  if (p === 0) return "0";
  if (p >= 0.01) return p.toFixed(4);
  // small numbers: keep 3 significant digits but write them out in full (never 3.10e-8)
  const decimals = Math.min(20, -Math.floor(Math.log10(p)) + 2);
  return p.toFixed(decimals);
}

/** price of 1M tokens in SOL: readable, because a single token costs a tiny fraction of a SOL */
export function perMillion(solPerToken: number): string {
  return price(solPerToken * 1e6);
}

/** market cap style numbers for axes: short but never rounded to nothing */
export function capLabel(v: number): string {
  if (v >= 1000) return compact(v, 1);
  if (v >= 100) return v.toFixed(0);
  if (v >= 1) return v.toFixed(2);
  return v.toFixed(3);
}

export function duration(secs: number): string {
  secs = Math.max(0, Math.round(secs));
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  return `${s}s`;
}

export function short(k: string): string {
  return k.slice(0, 4) + "…" + k.slice(-4);
}

export function ago(ts: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** stable hue per mint for generated avatars */
export function hue(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 360;
  return h;
}
