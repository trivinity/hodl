-- Platform fee: the indexer now records what HODL earns per trade and each token's locked-in platform fee.
alter table curves add column if not exists platform_fee_bps int not null default 0;
alter table trades add column if not exists fee_to_platform bigint not null default 0;

drop view if exists curve_stats;
create view curve_stats with (security_invoker = true) as
select
  c.mint,
  coalesce(count(t.sig), 0)                              as trade_count,
  coalesce(sum(t.sol), 0)::bigint                        as volume_lamports,
  coalesce(sum(t.rewards + t.fee_to_holders), 0)::bigint as paid_to_holders_lamports,
  coalesce(sum(t.tax), 0)::bigint                        as tax_lamports,
  coalesce(sum(t.fee_to_platform), 0)::bigint            as platform_fees_lamports,
  (select virtual_sol    from trades l where l.mint = c.mint order by l.slot desc, l.idx desc limit 1) as last_virtual_sol,
  (select virtual_tokens from trades l where l.mint = c.mint order by l.slot desc, l.idx desc limit 1) as last_virtual_tokens
from curves c
left join trades t on t.mint = c.mint
group by c.mint;

drop view if exists platform_stats;
create view platform_stats with (security_invoker = true) as
select
  (select count(*) from curves)                                              as token_count,
  coalesce((select sum(sol) from trades), 0)::bigint                         as volume_lamports,
  coalesce((select sum(rewards + fee_to_holders) from trades), 0)::bigint    as paid_to_holders_lamports,
  coalesce((select sum(tax) from trades), 0)::bigint                         as tax_lamports,
  coalesce((select sum(fee_to_platform) from trades), 0)::bigint            as platform_fees_lamports,
  (select count(distinct trader) from trades)                                as trader_count;

grant select on curve_stats, platform_stats to anon;
