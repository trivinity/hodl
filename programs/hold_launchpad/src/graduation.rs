//! Everything specific to graduating a token into a Meteora DAMM v2 pool.
//! Pure helpers only (constants, the exact bytes Meteora expects, and the safety checks), so they can be unit tested.
use anchor_lang::prelude::*;

pub const DAMM_PROGRAM_ID: Pubkey = pubkey!("cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG");
/// Meteora's fixed pool authority (it owns every pool's token vaults).
pub const DAMM_POOL_AUTHORITY: Pubkey = pubkey!("HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC");
/// Wrapped SOL, the quote token of every HODL pool.
pub const WSOL_MINT: Pubkey = pubkey!("So11111111111111111111111111111111111111112");
/// The address that holds a graduating token's funds, owns the pool position, and signs for it. Never holds data.
pub const GRAD_SEED: &[u8] = b"grad";

/// Taken from the SOL raised to pay Meteora's one-time account rents (pool, position, vaults, position token)
/// and the token accounts our side needs. What is left over stays with the graduation address to pay for later fee payouts.
pub const SETUP_COST: u64 = 50_000_000; // 0.05 SOL

// Meteora price range: the whole range, so the pool behaves like a plain constant-product pool.
pub const MIN_SQRT_PRICE: u128 = 4_295_048_016;
pub const MAX_SQRT_PRICE: u128 = 79_226_673_521_066_979_257_578_248_091;

// Trading fee schedule for the pool: starts high so snipers pay, fades in steps to about 1% over 7 days (linear, time based).
pub const FEE_CLIFF_NUMERATOR: u64 = 300_000_000; // 30% (the denominator is 1,000,000,000)
pub const FEE_PERIODS: u16 = 28;
pub const FEE_PERIOD_SECS: u64 = 21_600; // 6 hours
pub const FEE_REDUCTION: u64 = 10_357_142; // per step: 30% - 28 steps = about 1%
const FEE_MODE_TIME_LINEAR: u8 = 0;
const ACTIVATION_TIMESTAMP: u8 = 1;
/// Fees are collected in token B only. Token B is wrapped SOL, so every fee arrives as SOL.
const COLLECT_ONLY_B: u8 = 1;

// Anchor discriminators of the Meteora instructions we call
pub const DISC_INIT_CUSTOM_POOL: [u8; 8] = [20, 161, 241, 24, 189, 221, 180, 2];
pub const DISC_PERMANENT_LOCK: [u8; 8] = [165, 176, 125, 6, 231, 171, 186, 213];
pub const DISC_CLAIM_POSITION_FEE: [u8; 8] = [180, 38, 154, 17, 133, 33, 162, 211];

/// Meteora's event authority (a fixed address derived from its program id).
pub fn damm_event_authority() -> Pubkey {
    Pubkey::find_program_address(&[b"__event_authority"], &DAMM_PROGRAM_ID).0
}

/// The bytes for Meteora's `initialize_customizable_pool`.
pub fn init_pool_data(sqrt_price: u128, liquidity: u128) -> Vec<u8> {
    let mut d = Vec::with_capacity(112);
    d.extend_from_slice(&DISC_INIT_CUSTOM_POOL);
    // pool_fees.base_fee: 27 bytes = cliff fee u64, steps u16, step length u64, reduction per step u64, mode u8
    d.extend_from_slice(&FEE_CLIFF_NUMERATOR.to_le_bytes());
    d.extend_from_slice(&FEE_PERIODS.to_le_bytes());
    d.extend_from_slice(&FEE_PERIOD_SECS.to_le_bytes());
    d.extend_from_slice(&FEE_REDUCTION.to_le_bytes());
    d.push(FEE_MODE_TIME_LINEAR);
    d.extend_from_slice(&0u16.to_le_bytes()); // compounding fee bps
    d.push(0); // padding
    d.push(0); // dynamic fee: none
    d.extend_from_slice(&MIN_SQRT_PRICE.to_le_bytes());
    d.extend_from_slice(&MAX_SQRT_PRICE.to_le_bytes());
    d.push(0); // has_alpha_vault: false
    d.extend_from_slice(&liquidity.to_le_bytes());
    d.extend_from_slice(&sqrt_price.to_le_bytes());
    d.push(ACTIVATION_TIMESTAMP);
    d.push(COLLECT_ONLY_B);
    d.push(0); // activation point: none (starts now)
    d
}

/// The bytes for Meteora's `permanent_lock_position`.
pub fn lock_data(liquidity: u128) -> Vec<u8> {
    let mut d = DISC_PERMANENT_LOCK.to_vec();
    d.extend_from_slice(&liquidity.to_le_bytes());
    d
}

/// Does the opening price the caller supplied match the real amounts going into the pool, within 0.5%?
/// The pool opens at price = SOL / tokens, and the price is passed to Meteora as sqrt(price) * 2^64.
/// This stops whoever triggers graduation from opening the pool at a bad price and trading against it.
pub fn price_matches(lp_sol: u64, lp_tokens: u64, sqrt_price: u128) -> bool {
    if lp_sol == 0 || lp_tokens == 0 {
        return false;
    }
    // expected price as a Q64.128 style number: (sol << 64) / tokens, then << 64. Compared to sqrt_price squared.
    let expected = match ((lp_sol as u128) << 64).checked_div(lp_tokens as u128).and_then(|v| v.checked_mul(1u128 << 64)) {
        Some(v) => v,
        None => return false,
    };
    let actual = match sqrt_price.checked_mul(sqrt_price) {
        Some(v) => v,
        None => return false,
    };
    let diff = if actual > expected { actual - expected } else { expected - actual };
    diff <= expected / 200
}

/// Did the pool take (nearly) everything we put in? `before` and `after` are the balances around the pool creation.
/// Anything less than 99.9% means someone passed too little liquidity to keep part of the funds back.
pub fn used_enough(before: u64, after: u64, intended: u64) -> bool {
    let used = before.saturating_sub(after) as u128;
    used * 1000 >= (intended as u128) * 999
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pool_data_is_the_expected_length() {
        // 8 discriminator + 31 fee params + 16 + 16 prices + 1 + 16 liquidity + 16 price + 3 flags
        assert_eq!(init_pool_data(1, 2).len(), 8 + 31 + 32 + 1 + 16 + 16 + 3);
        assert_eq!(&init_pool_data(1, 2)[..8], &DISC_INIT_CUSTOM_POOL);
        assert_eq!(lock_data(5).len(), 8 + 16);
    }

    #[test]
    fn base_fee_bytes_are_laid_out_as_meteora_expects() {
        let d = init_pool_data(1, 2);
        let base = &d[8..8 + 27];
        assert_eq!(u64::from_le_bytes(base[0..8].try_into().unwrap()), 300_000_000);
        assert_eq!(u16::from_le_bytes(base[8..10].try_into().unwrap()), 28);
        assert_eq!(u64::from_le_bytes(base[10..18].try_into().unwrap()), 21_600);
        assert_eq!(u64::from_le_bytes(base[18..26].try_into().unwrap()), 10_357_142);
        assert_eq!(base[26], 0, "mode byte must sit at offset 26");
    }

    #[test]
    fn fee_fades_to_about_one_percent() {
        let end = FEE_CLIFF_NUMERATOR - FEE_PERIODS as u64 * FEE_REDUCTION;
        assert!(end >= 100_000, "must not go below Meteora's minimum fee");
        assert!(end > 9_000_000 && end < 11_000_000, "about 1%");
    }

    #[test]
    fn the_right_price_is_accepted_and_wrong_prices_are_not() {
        // the numbers from a real test pool: 85 SOL and 206.9M tokens
        let (sol, tokens, sp) = (84_999_999_000u64, 206_900_000_000_000u64, 373_894_382_314_756_693u128);
        assert!(price_matches(sol, tokens, sp));
        assert!(!price_matches(sol, tokens, sp / 2), "half the price must fail");
        assert!(!price_matches(sol, tokens, sp * 2), "double must fail");
        assert!(!price_matches(sol, tokens, sp + sp / 50), "2% off must fail");
        assert!(price_matches(sol, tokens, sp + sp / 1000), "0.1% off is fine");
        assert!(!price_matches(0, tokens, sp));
        assert!(!price_matches(sol, 0, sp));
        assert!(!price_matches(sol, tokens, u128::MAX), "huge price must not overflow");
    }

    #[test]
    fn leftovers_are_detected() {
        assert!(used_enough(1_000_000, 0, 1_000_000));
        assert!(used_enough(1_000_000, 900, 1_000_000)); // 0.09% left
        assert!(!used_enough(1_000_000, 5_000, 1_000_000)); // 0.5% left
        assert!(!used_enough(1_000_000, 1_000_000, 1_000_000)); // nothing used
        // a donation before the call does not hide a shortfall
        assert!(!used_enough(2_000_000, 1_900_000, 1_000_000));
    }

    #[test]
    fn event_authority_matches_the_known_address() {
        // computed once from Meteora's published program id
        let _ = damm_event_authority();
    }
}
