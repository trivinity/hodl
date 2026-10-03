-- Graduation: the indexer now records when a token moved to its Meteora pool and the pool fees paid to the treasury.
create table if not exists graduations (
  mint       text primary key,
  pool       text   not null,
  lp_sol     bigint not null,     -- lamports that went into the pool
  lp_tokens  bigint not null,     -- raw token units that went into the pool
  sig        text   not null,
  ts         timestamptz not null,
  slot       bigint not null
);

create table if not exists pool_fee_claims (
  sig     text   not null,
  idx     int    not null,
  mint    text   not null,
  amount  bigint not null,        -- lamports sent to the treasury
  ts      timestamptz not null,
  slot    bigint not null,
  primary key (sig, idx)
);
create index if not exists pool_fee_claims_mint on pool_fee_claims (mint);

alter table graduations     enable row level security;
alter table pool_fee_claims enable row level security;
create policy "public read graduations" on graduations for select using (true);
create policy "public read pool fee claims" on pool_fee_claims for select using (true);

drop view if exists platform_stats;
create view platform_stats with (security_invoker = true) as
select
  (select count(*) from curves)                                              as token_count,
  coalesce((select sum(sol) from trades), 0)::bigint                         as volume_lamports,
  coalesce((select sum(rewards + fee_to_holders) from trades), 0)::bigint    as paid_to_holders_lamports,
  coalesce((select sum(tax) from trades), 0)::bigint                         as tax_lamports,
  coalesce((select sum(fee_to_platform) from trades), 0)::bigint             as platform_fees_lamports,
  (select count(distinct trader) from trades)                                as trader_count,
  (select count(*) from graduations)                                         as graduated_count,
  coalesce((select sum(amount) from pool_fee_claims), 0)::bigint             as pool_fees_lamports;

grant select on platform_stats to anon;
