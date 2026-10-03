-- Swaps on the Meteora pool of a graduated token, so the chart and trade feed keep going after graduation.
create table if not exists pool_trades (
  sig       text   not null,
  idx       int    not null,
  mint      text   not null,
  pool      text   not null,
  trader    text   not null,        -- the transaction's fee payer
  is_buy    boolean not null,
  sol       bigint not null,        -- lamports paid (buy) or received (sell)
  tokens    bigint not null,        -- raw token units
  cap_sol   double precision not null,  -- market cap in SOL right after the swap
  ts        timestamptz not null,
  slot      bigint not null,
  primary key (sig, idx)
);
create index if not exists pool_trades_mint_slot on pool_trades (mint, slot desc, idx desc);

alter table pool_trades enable row level security;
create policy "public read pool trades" on pool_trades for select using (true);
