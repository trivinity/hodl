//! Pure curve + rate-limit math. No Anchor deps so it can be unit tested with plain rustc.

pub const BPS_DENOM: u128 = 10_000;

pub const TOTAL_SUPPLY: u64 = 1_000_000_000_000_000; // 1B tokens, 6 decimals
pub const INIT_VIRTUAL_SOL: u64 = 30_000_000_000; // 30 SOL
pub const INIT_VIRTUAL_TOKENS: u64 = 1_073_000_000_000_000;
pub const INIT_REAL_TOKENS: u64 = 793_100_000_000_000; // sold along the curve

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub struct BuyQuote {
    pub tokens_out: u64,
    /// total lamports the buyer pays (net + fee)
    pub sol_cost: u64,
    pub fee: u64,
    /// lamports that enter the curve reserves
    pub net: u64,
}

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub struct SellQuote {
    /// lamports leaving the curve reserves (before fee)
    pub gross: u64,
    pub fee: u64,
    /// lamports the seller receives
    pub net: u64,
}

fn mul_div_floor(a: u128, b: u128, d: u128) -> Option<u128> {
    a.checked_mul(b)?.checked_div(d)
}

fn mul_div_ceil(a: u128, b: u128, d: u128) -> Option<u128> {
    let p = a.checked_mul(b)?;
    p.checked_add(d.checked_sub(1)?)?.checked_div(d)
}

/// Quote a buy of up to `sol_in` lamports. Clamps to `real_tokens` left on the curve
/// (final buy refunds nothing, it just costs less).
pub fn buy_quote(
    vs: u64,
    vt: u64,
    real_tokens: u64,
    sol_in: u64,
    fee_bps: u16,
) -> Option<BuyQuote> {
    if sol_in == 0 || real_tokens == 0 || fee_bps as u128 >= BPS_DENOM {
        return None;
    }
    let (vs, vt) = (vs as u128, vt as u128);
    let k = vs.checked_mul(vt)?;
    let fee_bps = fee_bps as u128;

    let fee = mul_div_ceil(sol_in as u128, fee_bps, BPS_DENOM)?;
    let net = (sol_in as u128).checked_sub(fee)?;
    let new_vs = vs.checked_add(net)?;
    let new_vt = mul_div_ceil(k, 1, new_vs)?; // ceil keeps k from shrinking
    let mut tokens_out = vt.checked_sub(new_vt)?;

    let (mut net, mut fee, mut cost) = (net, fee, sol_in as u128);
    if tokens_out > real_tokens as u128 {
        // last buy on the curve: take exactly what is left, charge exactly what that costs
        tokens_out = real_tokens as u128;
        let vt_after = vt.checked_sub(tokens_out)?;
        let vs_after = mul_div_ceil(k, 1, vt_after)?;
        net = vs_after.checked_sub(vs)?;
        // gross up for fee: cost = ceil(net * D / (D - fee_bps))
        cost = mul_div_ceil(net, BPS_DENOM, BPS_DENOM - fee_bps)?;
        fee = cost.checked_sub(net)?;
    }
    if tokens_out == 0 {
        return None;
    }
    Some(BuyQuote {
        tokens_out: u64::try_from(tokens_out).ok()?,
        sol_cost: u64::try_from(cost).ok()?,
        fee: u64::try_from(fee).ok()?,
        net: u64::try_from(net).ok()?,
    })
}

pub fn sell_quote(vs: u64, vt: u64, tokens_in: u64, fee_bps: u16) -> Option<SellQuote> {
    if tokens_in == 0 || fee_bps as u128 >= BPS_DENOM {
        return None;
    }
    let (vs, vt) = (vs as u128, vt as u128);
    let k = vs.checked_mul(vt)?;
    let new_vt = vt.checked_add(tokens_in as u128)?;
    let new_vs = mul_div_ceil(k, 1, new_vt)?; // ceil = seller gets slightly less
    let gross = vs.checked_sub(new_vs)?;
    if gross == 0 {
        return None;
    }
    let fee = mul_div_floor(gross, fee_bps as u128, BPS_DENOM)?;
    let net = gross.checked_sub(fee)?;
    Some(SellQuote {
        gross: u64::try_from(gross).ok()?,
        fee: u64::try_from(fee).ok()?,
        net: u64::try_from(net).ok()?,
    })
}

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub struct Window {
    pub start: i64,
    /// real SOL reserves snapshot when the window opened
    pub base_reserves: u64,
    /// gross lamports sold out during this window
    pub sold: u64,
}

/// Pool-level sell limit: in any window of `window_secs`, total gross SOL leaving the curve
/// cannot exceed `max_bps` of the reserves at the window's start. Splitting across wallets
/// does nothing because the counter lives on the curve, not the wallet.
/// Returns the updated window, or None if this sell would exceed the cap.
pub fn apply_sell_limit(
    w: Window,
    now: i64,
    window_secs: i64,
    real_sol_now: u64,
    max_bps: u16,
    gross_out: u64,
) -> Option<Window> {
    let mut w = w;
    if now < w.start {
        return None; // clock went backwards, refuse
    }
    // start == 0 means no window has been opened yet (fresh curve)
    if w.start == 0 || now - w.start >= window_secs {
        w = Window { start: now, base_reserves: real_sol_now, sold: 0 };
    }
    let cap = mul_div_floor(w.base_reserves as u128, max_bps as u128, BPS_DENOM)?;
    let new_sold = (w.sold as u128).checked_add(gross_out as u128)?;
    if new_sold > cap {
        return None;
    }
    w.sold = u64::try_from(new_sold).ok()?;
    Some(w)
}


/// Sell tax that fades with hold time: `max_bps` at 0 seconds held, 0 once `decay_secs` have passed.
pub fn decay_tax_bps(held_secs: i64, decay_secs: i64, max_bps: u16) -> u16 {
    if decay_secs <= 0 || held_secs <= 0 {
        return max_bps;
    }
    if held_secs >= decay_secs {
        return 0;
    }
    let left = (decay_secs - held_secs) as u128;
    ((max_bps as u128 * left) / decay_secs as u128) as u16
}

/// Balance-weighted average timestamp. With nothing held yet the new tokens start the clock at `now`.
pub fn weighted_avg_ts(old_bal: u64, old_ts: i64, add: u64, now: i64) -> Option<i64> {
    let total = (old_bal as i128).checked_add(add as i128)?;
    if total == 0 || old_bal == 0 {
        return Some(now);
    }
    let sum = (old_bal as i128)
        .checked_mul(old_ts as i128)?
        .checked_add((add as i128).checked_mul(now as i128)?)?;
    i64::try_from(sum.checked_div(total)?).ok()
}

pub fn tax_amount(gross: u64, tax_bps: u16) -> Option<u64> {
    u64::try_from(mul_div_floor(gross as u128, tax_bps as u128, BPS_DENOM)?).ok()
}

/// Holder part of a trade fee when the fee is split between creator and holders.
pub fn holder_fee_part(fee: u64, creator_bps: u16, holder_bps: u16) -> Option<u64> {
    let total = creator_bps as u128 + holder_bps as u128;
    if total == 0 {
        return Some(0);
    }
    u64::try_from(mul_div_floor(fee as u128, holder_bps as u128, total)?).ok()
}

/// Platform part of a trade fee: fee * platform_bps / total_bps.
pub fn platform_fee_part(fee: u64, total_bps: u16, platform_bps: u16) -> Option<u64> {
    if total_bps == 0 {
        return Some(0);
    }
    u64::try_from(mul_div_floor(fee as u128, platform_bps as u128, total_bps as u128)?).ok()
}

/// Fixed-point scale for the per-token reward accumulator.
pub const ACC_SCALE: u128 = 1_000_000_000_000;
/// Below this much tracked supply (1 token) rewards are not distributed, so the accumulator can never blow up.
pub const MIN_REWARD_TRACKED: u64 = 1_000_000;

/// Share of a sell tax earmarked for holders.
pub fn reward_share(tax: u64, reward_bps: u16) -> Option<u64> {
    u64::try_from(mul_div_floor(tax as u128, reward_bps as u128, BPS_DENOM)?).ok()
}

/// Spread `amount` lamports over `total_tracked` tokens.
/// Returns (accumulator increase, lamports actually distributed). Rounding dust is not distributed.
pub fn acc_increase(amount: u64, total_tracked: u64) -> Option<(u128, u64)> {
    if amount == 0 || total_tracked < MIN_REWARD_TRACKED {
        return Some((0, 0));
    }
    let inc = (amount as u128).checked_mul(ACC_SCALE)? / total_tracked as u128;
    let distributed = inc.checked_mul(total_tracked as u128)? / ACC_SCALE;
    Some((inc, u64::try_from(distributed).ok()?))
}

/// What a position has earned since `debt` was set: tracked * acc / scale - debt.
pub fn reward_owed(tracked: u64, acc: u128, debt: u128) -> Option<u64> {
    let total = (tracked as u128).checked_mul(acc)? / ACC_SCALE;
    u64::try_from(total.saturating_sub(debt)).ok()
}

/// New debt after a position's tracked balance changes.
pub fn reward_debt(tracked: u64, acc: u128) -> Option<u128> {
    (tracked as u128).checked_mul(acc)?.checked_div(ACC_SCALE)
}

#[cfg(test)]
mod tests {
    use super::*;

    const FEE: u16 = 100; // 1%

    #[test]
    fn buy_gives_tokens_and_k_never_shrinks() {
        let q = buy_quote(INIT_VIRTUAL_SOL, INIT_VIRTUAL_TOKENS, INIT_REAL_TOKENS, 1_000_000_000, FEE).unwrap();
        assert!(q.tokens_out > 0);
        assert_eq!(q.net + q.fee, q.sol_cost);
        let vs = INIT_VIRTUAL_SOL as u128 + q.net as u128;
        let vt = INIT_VIRTUAL_TOKENS as u128 - q.tokens_out as u128;
        assert!(vs * vt >= INIT_VIRTUAL_SOL as u128 * INIT_VIRTUAL_TOKENS as u128);
    }

    #[test]
    fn round_trip_never_profits() {
        let sol_in = 5_000_000_000u64;
        let b = buy_quote(INIT_VIRTUAL_SOL, INIT_VIRTUAL_TOKENS, INIT_REAL_TOKENS, sol_in, FEE).unwrap();
        let vs = INIT_VIRTUAL_SOL + b.net;
        let vt = INIT_VIRTUAL_TOKENS - b.tokens_out;
        let s = sell_quote(vs, vt, b.tokens_out, FEE).unwrap();
        assert!(s.net < sol_in);
    }

    #[test]
    fn last_buy_clamps_to_remaining_tokens() {
        let q = buy_quote(INIT_VIRTUAL_SOL, INIT_VIRTUAL_TOKENS, 1_000_000, 1_000_000_000_000, FEE).unwrap();
        assert_eq!(q.tokens_out, 1_000_000);
        assert!(q.sol_cost < 1_000_000_000_000);
        assert_eq!(q.net + q.fee, q.sol_cost);
    }

    #[test]
    fn zero_and_bad_inputs_rejected() {
        assert!(buy_quote(INIT_VIRTUAL_SOL, INIT_VIRTUAL_TOKENS, INIT_REAL_TOKENS, 0, FEE).is_none());
        assert!(buy_quote(INIT_VIRTUAL_SOL, INIT_VIRTUAL_TOKENS, 0, 1_000, FEE).is_none());
        assert!(buy_quote(INIT_VIRTUAL_SOL, INIT_VIRTUAL_TOKENS, INIT_REAL_TOKENS, 1_000, 10_000).is_none());
        assert!(sell_quote(INIT_VIRTUAL_SOL, INIT_VIRTUAL_TOKENS, 0, FEE).is_none());
    }

    #[test]
    fn dust_sell_rejected() {
        assert!(sell_quote(INIT_VIRTUAL_SOL, INIT_VIRTUAL_TOKENS, 1, FEE).is_none());
    }

    #[test]
    fn huge_inputs_do_not_panic() {
        let _ = buy_quote(u64::MAX, u64::MAX, u64::MAX, u64::MAX, FEE);
        let _ = sell_quote(u64::MAX, u64::MAX, u64::MAX, FEE);
    }

    #[test]
    fn limit_blocks_split_sells_within_window() {
        let w0 = Window { start: 0, base_reserves: 0, sold: 0 };
        // window opens at t=100 with 100 SOL reserves, cap 5% = 5 SOL
        let w1 = apply_sell_limit(w0, 100, 3600, 100_000_000_000, 500, 2_000_000_000).unwrap();
        let w2 = apply_sell_limit(w1, 200, 3600, 98_000_000_000, 500, 2_000_000_000).unwrap();
        // third 2 SOL sell (different "wallet", same pool) breaks the 5 SOL cap
        assert!(apply_sell_limit(w2, 300, 3600, 96_000_000_000, 500, 2_000_000_000).is_none());
        // 1 SOL still fits exactly under cap
        assert!(apply_sell_limit(w2, 300, 3600, 96_000_000_000, 500, 1_000_000_000).is_some());
    }

    #[test]
    fn limit_resets_after_window() {
        let w = Window { start: 100, base_reserves: 100_000_000_000, sold: 5_000_000_000 };
        let w2 = apply_sell_limit(w, 100 + 3600, 3600, 90_000_000_000, 500, 4_000_000_000).unwrap();
        assert_eq!(w2.start, 3700);
        assert_eq!(w2.base_reserves, 90_000_000_000);
        assert_eq!(w2.sold, 4_000_000_000);
    }

    #[test]
    fn limit_rejects_backwards_clock() {
        let w = Window { start: 500, base_reserves: 1_000, sold: 0 };
        assert!(apply_sell_limit(w, 400, 3600, 1_000, 500, 1).is_none());
    }

    #[test]
    fn tax_decays_linearly_to_zero() {
        assert_eq!(decay_tax_bps(0, 1000, 3000), 3000);
        assert_eq!(decay_tax_bps(500, 1000, 3000), 1500);
        assert_eq!(decay_tax_bps(1000, 1000, 3000), 0);
        assert_eq!(decay_tax_bps(5000, 1000, 3000), 0);
        assert_eq!(decay_tax_bps(-5, 1000, 3000), 3000);
    }

    #[test]
    fn avg_ts_weights_by_balance() {
        // nothing held: clock starts now
        assert_eq!(weighted_avg_ts(0, 0, 100, 1000), Some(1000));
        // equal sizes: midpoint
        assert_eq!(weighted_avg_ts(100, 0, 100, 1000), Some(500));
        // tiny top-up barely moves the clock
        let t = weighted_avg_ts(1_000_000, 0, 1, 1000).unwrap();
        assert!(t < 5);
    }

    #[test]
    fn tax_amount_floors() {
        assert_eq!(tax_amount(1000, 3000), Some(300));
        assert_eq!(tax_amount(1, 3000), Some(0));
    }

    #[test]
    fn reward_share_splits_tax() {
        assert_eq!(reward_share(1000, 5000), Some(500));
        assert_eq!(reward_share(1000, 0), Some(0));
        assert_eq!(reward_share(1000, 10_000), Some(1000));
    }

    #[test]
    fn rewards_go_pro_rata_and_never_overpay() {
        let total = 3_000_000_000u64; // 3000 tokens tracked
        let (inc, dist) = acc_increase(1_000_000_007, total).unwrap();
        assert!(dist <= 1_000_000_007);
        // holder with 1/3 of tracked supply
        let a = reward_owed(1_000_000_000, inc, 0).unwrap();
        let b = reward_owed(2_000_000_000, inc, 0).unwrap();
        assert!(a + b <= dist);
        assert!(dist - (a + b) <= 2);
        assert!(b >= 2 * a - 1);
    }

    #[test]
    fn tiny_tracked_supply_skips_rewards() {
        assert_eq!(acc_increase(1_000_000, MIN_REWARD_TRACKED - 1), Some((0, 0)));
        assert_eq!(acc_increase(0, 5_000_000_000), Some((0, 0)));
    }

    #[test]
    fn debt_blocks_old_rewards_for_new_tokens() {
        let (inc, _) = acc_increase(1_000_000_000, 1_000_000_000).unwrap();
        // joins after the payout: debt cancels it
        let debt = reward_debt(1_000_000_000, inc).unwrap();
        assert_eq!(reward_owed(1_000_000_000, inc, debt), Some(0));
        // a later payout is shared
        let (inc2, _) = acc_increase(1_000_000_000, 2_000_000_000).unwrap();
        let acc = inc + inc2;
        assert!(reward_owed(1_000_000_000, acc, debt).unwrap() > 0);
    }

    #[test]
    fn reward_math_does_not_panic_on_huge_inputs() {
        let _ = acc_increase(u64::MAX, MIN_REWARD_TRACKED);
        let _ = reward_owed(u64::MAX, u128::MAX, 0);
        let _ = reward_debt(u64::MAX, u128::MAX);
    }

    #[test]
    fn fee_splits_between_creator_and_holders() {
        assert_eq!(holder_fee_part(200, 100, 100), Some(100));
        assert_eq!(holder_fee_part(200, 100, 0), Some(0));
        assert_eq!(holder_fee_part(200, 0, 100), Some(200));
        assert_eq!(holder_fee_part(200, 0, 0), Some(0));
        assert_eq!(holder_fee_part(3, 100, 100), Some(1));
    }

    #[test]
    fn platform_part_is_a_share_of_the_fee() {
        assert_eq!(platform_fee_part(300, 300, 100), Some(100));
        assert_eq!(platform_fee_part(300, 300, 0), Some(0));
        assert_eq!(platform_fee_part(300, 0, 0), Some(0));
        assert_eq!(platform_fee_part(1, 300, 100), Some(0));
        // the three parts always add back up to the fee
        let fee = 1_234_567u64;
        let plat = platform_fee_part(fee, 300, 100).unwrap();
        let rest = fee - plat;
        let holders = holder_fee_part(rest, 100, 100).unwrap();
        assert_eq!(plat + (rest - holders) + holders, fee);
    }
}
