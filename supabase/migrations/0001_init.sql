-- HODL indexer schema. Applied to the Supabase project 'hodl'. For a fresh project, run it once in the SQL editor.
-- Reads are public (anon key, read-only). Writes happen only from the server with the service role key,
-- which bypasses row level security, so no insert or update policies are defined on purpose.

create table if not exists curves (
  mint            text primary key,
  creator         text   not null,
  name            text   not null,
  symbol          text   not null,
  uri             text   not null default '',
  fee_bps         int    not null,
  holder_fee_bps  int    not null,
  max_tax_bps     int    not null,
  decay_secs      bigint not null,
  holder_sell_bps int    not null,
  window_secs     bigint not null,
  reward_bps      int    not null,
  created_at      timestamptz not null,
  create_sig      text   not null
);

create table if not exists trades (
  sig             text   not null,
  idx             int    not null,      -- position of the event inside the transaction
  mint            text   not null,
  trader          text   not null,
  is_buy          boolean not null,
  sol             bigint not null,      -- lamports paid (buy) or received (sell)
  tokens          bigint not null,      -- raw token units (6 decimals)
  tax             bigint not null default 0,
  rewards         bigint not null default 0,         -- part of the tax paid to holders
  fee_to_holders  bigint not null default 0,         -- part of the trade fee paid to holders
  virtual_sol     bigint not null,
  virtual_tokens  bigint not null,
  ts              timestamptz not null,
  slot            bigint not null,
  primary key (sig, idx)
);
create index if not exists trades_mint_ts on trades (mint, ts desc);
create index if not exists trades_trader_ts on trades (trader, ts desc);

create table if not exists claims (
  sig      text   not null,
  idx      int    not null,
  mint     text   not null,
  claimer  text   not null,
  amount   bigint not null,
  ts       timestamptz not null,
  slot     bigint not null,
  primary key (sig, idx)
);
create index if not exists claims_claimer_ts on claims (claimer, ts desc);

-- where the indexer stopped, so each run only reads new transactions
create table if not exists indexer_state (
  id         text primary key,
  last_sig   text,
  last_slot  bigint,
  updated_at timestamptz not null default now()
);

-- per-token numbers for the site
create or replace view curve_stats with (security_invoker = true) as
select
  c.mint,
  coalesce(count(t.sig), 0)                              as trade_count,
  coalesce(sum(t.sol), 0)::bigint                        as volume_lamports,
  coalesce(sum(t.rewards + t.fee_to_holders), 0)::bigint as paid_to_holders_lamports,
  coalesce(sum(t.tax), 0)::bigint                        as tax_lamports,
  (select virtual_sol    from trades l where l.mint = c.mint order by l.slot desc, l.idx desc limit 1) as last_virtual_sol,
  (select virtual_tokens from trades l where l.mint = c.mint order by l.slot desc, l.idx desc limit 1) as last_virtual_tokens
from curves c
left join trades t on t.mint = c.mint
group by c.mint;

-- one row of platform totals
create or replace view platform_stats with (security_invoker = true) as
select
  (select count(*) from curves)                                              as token_count,
  coalesce((select sum(sol) from trades), 0)::bigint                         as volume_lamports,
  coalesce((select sum(rewards + fee_to_holders) from trades), 0)::bigint    as paid_to_holders_lamports,
  coalesce((select sum(tax) from trades), 0)::bigint                         as tax_lamports,
  (select count(distinct trader) from trades)                                as trader_count;

alter table curves        enable row level security;
alter table trades        enable row level security;
alter table claims        enable row level security;
alter table indexer_state enable row level security;

create policy "public read curves" on curves for select using (true);
create policy "public read trades" on trades for select using (true);
create policy "public read claims" on claims for select using (true);
-- indexer_state has no policies: only the server (service role) can touch it

grant select on curve_stats, platform_stats to anon;
