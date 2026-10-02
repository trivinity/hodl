use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer as SolTransfer};
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::spl_token::instruction::AuthorityType;
use anchor_spl::token::{
    self, Mint, MintTo, SetAuthority, Token, TokenAccount, Transfer as SplTransfer,
};

pub mod math;
use math::*;

// placeholder, run `anchor keys sync` after the first build
declare_id!("Eyv8eYAjHonsHQ6awmB4fy1mv2jqXciK8PzooUoV5kmb");

/// Metaplex Token Metadata program: gives the token a name, symbol and image that wallets and DEXs can read.
pub const METADATA_PROGRAM_ID: Pubkey = pubkey!("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
pub const METADATA_SEED: &[u8] = b"metadata";

pub const CURVE_SEED: &[u8] = b"curve";
pub const POSITION_SEED: &[u8] = b"position";
pub const MAX_FEE_BPS: u16 = 500;
pub const MAX_TAX_BPS: u16 = 5_000; // 50% hard ceiling on the early-sell tax
pub const MIN_WINDOW_SECS: i64 = 60;
pub const MIN_DECAY_SECS: i64 = 60;
// upper bounds so a creator cannot launch a token that is effectively impossible to sell
pub const MAX_DECAY_SECS: i64 = 365 * 86_400;
pub const MAX_WINDOW_SECS: i64 = 30 * 86_400;
/// A wallet must be able to sell at least this share of its balance per day (20%), whatever the window length.
pub const MIN_DAILY_SELL_BPS: u128 = 2_000;

#[program]
pub mod hold_launchpad {
    use super::*;

    /// Create a token + curve. The full supply is minted into the curve vault and the
    /// mint authority is revoked in the same instruction.
    ///
    /// - `fee_bps` / `holder_fee_bps`: trade fee on every buy and sell, paid to the creator and to holders. Their sum is the fee charged (max 5%).
    /// - `max_tax_bps` / `decay_secs`: sell tax that starts at max and fades to 0 over `decay_secs` of holding.
    ///   The tax stays in the curve, so it lifts the price for everyone still holding.
    /// - `reward_bps`: share of every sell tax paid out to holders (pro-rata by curve-bought balance). The rest stays in the curve.
    /// - `holder_sell_bps` / `window_secs`: one wallet can sell at most this share of its own balance per window.
    pub fn create_curve(
        ctx: Context<CreateCurve>,
        name: String,
        symbol: String,
        uri: String,
        fee_bps: u16,
        max_tax_bps: u16,
        decay_secs: i64,
        holder_sell_bps: u16,
        window_secs: i64,
        reward_bps: u16,
        holder_fee_bps: u16,
    ) -> Result<()> {
        require!(name.len() >= 1 && name.len() <= 32, LaunchError::BadParams);
        require!(symbol.len() >= 1 && symbol.len() <= 10, LaunchError::BadParams);
        require!(uri.len() <= 128, LaunchError::BadParams);
        require!(fee_bps as u32 + holder_fee_bps as u32 <= MAX_FEE_BPS as u32, LaunchError::BadParams);
        require!(max_tax_bps <= MAX_TAX_BPS, LaunchError::BadParams);
        require!(decay_secs >= MIN_DECAY_SECS && decay_secs <= MAX_DECAY_SECS, LaunchError::BadParams);
        require!(holder_sell_bps >= 100 && holder_sell_bps <= 10_000, LaunchError::BadParams);
        require!(window_secs >= MIN_WINDOW_SECS && window_secs <= MAX_WINDOW_SECS, LaunchError::BadParams);
        // sell speed per day = holder_sell_bps * 1 day / window. Must be at least MIN_DAILY_SELL_BPS.
        require!(
            (holder_sell_bps as u128) * 86_400 >= MIN_DAILY_SELL_BPS * (window_secs as u128),
            LaunchError::BadParams
        );
        require!(reward_bps <= 10_000, LaunchError::BadParams);

        // built before the strings move into the curve account
        let metadata_ix_data = encode_create_metadata_v3(&name, &symbol, &uri);

        let mint_key = ctx.accounts.mint.key();
        let bump = ctx.bumps.curve;

        let curve = &mut ctx.accounts.curve;
        curve.creator = ctx.accounts.creator.key();
        curve.mint = mint_key;
        curve.name = name;
        curve.symbol = symbol;
        curve.uri = uri;
        curve.virtual_sol = INIT_VIRTUAL_SOL;
        curve.virtual_tokens = INIT_VIRTUAL_TOKENS;
        curve.real_sol = 0;
        curve.real_tokens = INIT_REAL_TOKENS;
        curve.accrued_fees = 0;
        curve.fee_bps = fee_bps;
        curve.holder_fee_bps = holder_fee_bps;
        curve.max_tax_bps = max_tax_bps;
        curve.decay_secs = decay_secs;
        curve.holder_sell_bps = holder_sell_bps;
        curve.window_secs = window_secs;
        curve.created_at = Clock::get()?.unix_timestamp;
        curve.complete = false;
        curve.bump = bump;
        curve.reward_bps = reward_bps;
        curve.total_tracked = 0;
        curve.acc_per_token = 0;
        curve.reward_pool = 0;

        let seeds: &[&[u8]] = &[CURVE_SEED, mint_key.as_ref(), &[bump]];
        let signer = &[seeds];

        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.curve.to_account_info(),
                },
                signer,
            ),
            TOTAL_SUPPLY,
        )?;

        // on-chain name / symbol / image. Immutable, so nobody (including us) can change them later.
        // The curve signs as both mint authority (still held at this point) and update authority.
        let curve_key = ctx.accounts.curve.key();
        let ix = anchor_lang::solana_program::instruction::Instruction {
            program_id: METADATA_PROGRAM_ID,
            accounts: vec![
                AccountMeta::new(ctx.accounts.metadata.key(), false),
                AccountMeta::new_readonly(mint_key, false),
                AccountMeta::new_readonly(curve_key, true),
                AccountMeta::new(ctx.accounts.creator.key(), true),
                AccountMeta::new_readonly(curve_key, true),
                AccountMeta::new_readonly(ctx.accounts.system_program.key(), false),
            ],
            data: metadata_ix_data,
        };
        anchor_lang::solana_program::program::invoke_signed(
            &ix,
            &[
                ctx.accounts.metadata.to_account_info(),
                ctx.accounts.mint.to_account_info(),
                ctx.accounts.curve.to_account_info(),
                ctx.accounts.creator.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
                ctx.accounts.metadata_program.to_account_info(),
            ],
            signer,
        )?;

        token::set_authority(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                SetAuthority {
                    current_authority: ctx.accounts.curve.to_account_info(),
                    account_or_mint: ctx.accounts.mint.to_account_info(),
                },
                signer,
            ),
            AuthorityType::MintTokens,
            None,
        )?;

        let c = &ctx.accounts.curve;
        emit!(CurveCreated {
            mint: mint_key,
            creator: c.creator,
            name: c.name.clone(),
            symbol: c.symbol.clone(),
            uri: c.uri.clone(),
            fee_bps: c.fee_bps,
            holder_fee_bps: c.holder_fee_bps,
            max_tax_bps: c.max_tax_bps,
            decay_secs: c.decay_secs,
            holder_sell_bps: c.holder_sell_bps,
            window_secs: c.window_secs,
            reward_bps: c.reward_bps,
            ts: c.created_at,
        });
        Ok(())
    }

    pub fn buy(ctx: Context<Buy>, sol_in: u64, min_tokens_out: u64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let curve = &ctx.accounts.curve;
        require!(!curve.complete, LaunchError::CurveComplete);

        let q = buy_quote(
            curve.virtual_sol,
            curve.virtual_tokens,
            curve.real_tokens,
            sol_in,
            curve.fee_bps + curve.holder_fee_bps,
        )
        .ok_or(LaunchError::MathError)?;
        require!(q.tokens_out >= min_tokens_out, LaunchError::Slippage);
        let holder_fee_target = holder_fee_part(q.fee, curve.fee_bps, curve.holder_fee_bps).ok_or(LaunchError::MathError)?;

        // hold clock: only tokens bought through the curve carry age
        let bal_before = ctx.accounts.buyer_ata.amount;
        let pos = &mut ctx.accounts.position;
        if pos.owner == Pubkey::default() {
            pos.owner = ctx.accounts.buyer.key();
            pos.mint = ctx.accounts.mint.key();
            pos.bump = ctx.bumps.position;
        }
        let tracked = pos.tracked.min(bal_before);
        let old_ts = if pos.avg_ts == 0 { now } else { pos.avg_ts };
        pos.avg_ts = weighted_avg_ts(tracked, old_ts, q.tokens_out, now).ok_or(LaunchError::MathError)?;
        let old_tracked = pos.tracked;
        let new_tracked = tracked.checked_add(q.tokens_out).ok_or(LaunchError::MathError)?;
        // bank what the old balance earned, then restart the reward clock for the new balance
        let acc_before = ctx.accounts.curve.acc_per_token;
        pos.pending_rewards = pos
            .pending_rewards
            .checked_add(reward_owed(tracked, acc_before, pos.reward_debt).ok_or(LaunchError::MathError)?)
            .ok_or(LaunchError::MathError)?;
        // the holder part of the fee goes to the other holders, never back to the buyer
        let others = ctx.accounts.curve.total_tracked.checked_sub(old_tracked).ok_or(LaunchError::MathError)?;
        let (fee_inc, fee_distributed) = acc_increase(holder_fee_target, others).ok_or(LaunchError::MathError)?;
        let acc_after = acc_before.checked_add(fee_inc).ok_or(LaunchError::MathError)?;
        pos.tracked = new_tracked;
        pos.reward_debt = reward_debt(new_tracked, acc_after).ok_or(LaunchError::MathError)?;
        let total_tracked_after = others.checked_add(new_tracked).ok_or(LaunchError::MathError)?;

        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                SolTransfer {
                    from: ctx.accounts.buyer.to_account_info(),
                    to: ctx.accounts.curve.to_account_info(),
                },
            ),
            q.sol_cost,
        )?;

        let mint_key = ctx.accounts.mint.key();
        let bump = ctx.accounts.curve.bump;
        let seeds: &[&[u8]] = &[CURVE_SEED, mint_key.as_ref(), &[bump]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                SplTransfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.buyer_ata.to_account_info(),
                    authority: ctx.accounts.curve.to_account_info(),
                },
                &[seeds],
            ),
            q.tokens_out,
        )?;

        let curve = &mut ctx.accounts.curve;
        curve.virtual_sol = curve.virtual_sol.checked_add(q.net).ok_or(LaunchError::MathError)?;
        curve.virtual_tokens = curve.virtual_tokens.checked_sub(q.tokens_out).ok_or(LaunchError::MathError)?;
        curve.real_sol = curve.real_sol.checked_add(q.net).ok_or(LaunchError::MathError)?;
        curve.real_tokens = curve.real_tokens.checked_sub(q.tokens_out).ok_or(LaunchError::MathError)?;
        // creator gets the creator part of the fee, plus any holder part nobody could be paid
        curve.accrued_fees = curve.accrued_fees.checked_add(q.fee - fee_distributed).ok_or(LaunchError::MathError)?;
        curve.reward_pool = curve.reward_pool.checked_add(fee_distributed).ok_or(LaunchError::MathError)?;
        curve.acc_per_token = acc_after;
        curve.total_tracked = total_tracked_after;
        if curve.real_tokens == 0 {
            curve.complete = true; // graduation (LP migration) is not implemented yet
        }

        emit!(Trade {
            mint: mint_key,
            trader: ctx.accounts.buyer.key(),
            is_buy: true,
            sol: q.sol_cost,
            tokens: q.tokens_out,
            tax: 0,
            rewards: 0,
            fee_to_holders: fee_distributed,
            virtual_sol: curve.virtual_sol,
            virtual_tokens: curve.virtual_tokens,
            ts: now,
        });
        Ok(())
    }

    pub fn sell(ctx: Context<Sell>, tokens_in: u64, min_sol_out: u64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let curve = &ctx.accounts.curve;
        // note: selling stays open after the curve fills. There is no graduation yet, so closing sells would lock everyone's SOL.

        let balance = ctx.accounts.seller_ata.amount;
        require!(tokens_in > 0 && tokens_in <= balance, LaunchError::MathError);

        let q = sell_quote(curve.virtual_sol, curve.virtual_tokens, tokens_in, curve.fee_bps + curve.holder_fee_bps)
            .ok_or(LaunchError::MathError)?;
        require!(q.gross <= curve.real_sol, LaunchError::MathError);

        // per-wallet limit: share of this wallet's own balance per window
        let pos = &mut ctx.accounts.position;
        if pos.owner == Pubkey::default() {
            pos.owner = ctx.accounts.seller.key();
            pos.mint = ctx.accounts.mint.key();
            pos.bump = ctx.bumps.position;
        }
        let w = apply_sell_limit(
            Window { start: pos.window_start, base_reserves: pos.window_base, sold: pos.window_sold },
            now,
            curve.window_secs,
            balance,
            curve.holder_sell_bps,
            tokens_in,
        )
        .ok_or(LaunchError::HolderLimitExceeded)?;
        pos.window_start = w.start;
        pos.window_base = w.base_reserves;
        pos.window_sold = w.sold;

        // sell tax: tokens that did not come through the curve count as brand new
        let tracked = pos.tracked.min(balance);
        let old_ts = if pos.avg_ts == 0 { now } else { pos.avg_ts };
        let eff_ts = weighted_avg_ts(tracked, old_ts, balance - tracked, now).ok_or(LaunchError::MathError)?;
        let tax_bps = decay_tax_bps(now.saturating_sub(eff_ts), curve.decay_secs, curve.max_tax_bps);
        let tax = tax_amount(q.gross, tax_bps).ok_or(LaunchError::MathError)?;
        let seller_gets = q.net.checked_sub(tax).ok_or(LaunchError::MathError)?;
        require!(seller_gets >= min_sol_out, LaunchError::Slippage);
        let old_tracked = pos.tracked;
        let new_tracked = tracked.saturating_sub(tokens_in);

        // bank this wallet's earnings before its balance changes
        let acc_before = curve.acc_per_token;
        pos.pending_rewards = pos
            .pending_rewards
            .checked_add(reward_owed(tracked, acc_before, pos.reward_debt).ok_or(LaunchError::MathError)?)
            .ok_or(LaunchError::MathError)?;
        pos.tracked = new_tracked;

        // part of the tax and of the fee goes to the other holders of curve-bought tokens, never back to the seller
        let others = curve.total_tracked.checked_sub(old_tracked).ok_or(LaunchError::MathError)?;
        let total_tracked_after = others.checked_add(new_tracked).ok_or(LaunchError::MathError)?;
        let reward_target = reward_share(tax, curve.reward_bps).ok_or(LaunchError::MathError)?;
        let holder_fee_target = holder_fee_part(q.fee, curve.fee_bps, curve.holder_fee_bps).ok_or(LaunchError::MathError)?;
        let (acc_inc, distributed) = acc_increase(reward_target, others).ok_or(LaunchError::MathError)?;
        let (fee_inc, fee_distributed) = acc_increase(holder_fee_target, others).ok_or(LaunchError::MathError)?;
        let acc_after = acc_before
            .checked_add(acc_inc)
            .and_then(|a| a.checked_add(fee_inc))
            .ok_or(LaunchError::MathError)?;
        pos.reward_debt = reward_debt(new_tracked, acc_after).ok_or(LaunchError::MathError)?;

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                SplTransfer {
                    from: ctx.accounts.seller_ata.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.seller.to_account_info(),
                },
            ),
            tokens_in,
        )?;

        let curve_info = ctx.accounts.curve.to_account_info();
        let seller_info = ctx.accounts.seller.to_account_info();
        **curve_info.try_borrow_mut_lamports()? = curve_info
            .lamports()
            .checked_sub(seller_gets)
            .ok_or(LaunchError::MathError)?;
        **seller_info.try_borrow_mut_lamports()? = seller_info
            .lamports()
            .checked_add(seller_gets)
            .ok_or(LaunchError::MathError)?;

        // the rest of the tax stays in the curve (reserves shrink by gross - tax), so price rises for remaining holders.
        // the holder share leaves the reserves but stays in the curve account as claimable rewards.
        let stays = tax.checked_sub(distributed).ok_or(LaunchError::MathError)?;
        let leaves = q.gross.checked_sub(stays).ok_or(LaunchError::MathError)?;
        let curve = &mut ctx.accounts.curve;
        curve.total_tracked = total_tracked_after;
        curve.acc_per_token = acc_after;
        curve.reward_pool = curve
            .reward_pool
            .checked_add(distributed)
            .and_then(|p| p.checked_add(fee_distributed))
            .ok_or(LaunchError::MathError)?;
        curve.virtual_sol = curve.virtual_sol.checked_sub(leaves).ok_or(LaunchError::MathError)?;
        curve.virtual_tokens = curve.virtual_tokens.checked_add(tokens_in).ok_or(LaunchError::MathError)?;
        curve.real_sol = curve.real_sol.checked_sub(leaves).ok_or(LaunchError::MathError)?;
        curve.real_tokens = curve.real_tokens.checked_add(tokens_in).ok_or(LaunchError::MathError)?;
        curve.accrued_fees = curve.accrued_fees.checked_add(q.fee - fee_distributed).ok_or(LaunchError::MathError)?;

        emit!(Trade {
            mint: ctx.accounts.mint.key(),
            trader: ctx.accounts.seller.key(),
            is_buy: false,
            sol: seller_gets,
            tokens: tokens_in,
            tax,
            rewards: distributed,
            fee_to_holders: fee_distributed,
            virtual_sol: curve.virtual_sol,
            virtual_tokens: curve.virtual_tokens,
            ts: now,
        });
        Ok(())
    }

    /// Pay out the holder rewards this wallet has earned from other people's sell taxes.
    pub fn claim_rewards(ctx: Context<ClaimRewards>) -> Result<()> {
        let acc = ctx.accounts.curve.acc_per_token;
        let balance = ctx.accounts.claimer_ata.amount;
        let pos = &mut ctx.accounts.position;

        // only tokens still in the wallet earn: moving tokens away does not keep rewards flowing
        let eff = pos.tracked.min(balance);
        let earned = reward_owed(eff, acc, pos.reward_debt).ok_or(LaunchError::MathError)?;
        let pending = pos.pending_rewards.checked_add(earned).ok_or(LaunchError::MathError)?;
        require!(pending > 0, LaunchError::NothingToClaim);

        let dropped = pos.tracked - eff;
        pos.tracked = eff;
        pos.reward_debt = reward_debt(eff, acc).ok_or(LaunchError::MathError)?;
        pos.pending_rewards = 0;

        let curve = &mut ctx.accounts.curve;
        curve.total_tracked = curve.total_tracked.checked_sub(dropped).ok_or(LaunchError::MathError)?;
        // per-holder rounding can leave the pool a few lamports short for the very last claimer; never pay more than it holds
        let pending = pending.min(curve.reward_pool);
        curve.reward_pool = curve.reward_pool.checked_sub(pending).ok_or(LaunchError::MathError)?;

        let curve_info = ctx.accounts.curve.to_account_info();
        let claimer_info = ctx.accounts.claimer.to_account_info();
        **curve_info.try_borrow_mut_lamports()? = curve_info
            .lamports()
            .checked_sub(pending)
            .ok_or(LaunchError::MathError)?;
        **claimer_info.try_borrow_mut_lamports()? = claimer_info
            .lamports()
            .checked_add(pending)
            .ok_or(LaunchError::MathError)?;

        emit!(RewardsClaimed {
            mint: ctx.accounts.mint.key(),
            claimer: ctx.accounts.claimer.key(),
            amount: pending,
        });
        Ok(())
    }

    pub fn claim_fees(ctx: Context<ClaimFees>) -> Result<()> {
        let amount = ctx.accounts.curve.accrued_fees;
        require!(amount > 0, LaunchError::NothingToClaim);

        let curve_info = ctx.accounts.curve.to_account_info();
        let creator_info = ctx.accounts.creator.to_account_info();
        **curve_info.try_borrow_mut_lamports()? = curve_info
            .lamports()
            .checked_sub(amount)
            .ok_or(LaunchError::MathError)?;
        **creator_info.try_borrow_mut_lamports()? = creator_info
            .lamports()
            .checked_add(amount)
            .ok_or(LaunchError::MathError)?;
        ctx.accounts.curve.accrued_fees = 0;
        Ok(())
    }
}

fn push_borsh_string(buf: &mut Vec<u8>, s: &str) {
    buf.extend_from_slice(&(s.len() as u32).to_le_bytes());
    buf.extend_from_slice(s.as_bytes());
}

/// Borsh bytes for Metaplex `CreateMetadataAccountV3`: no creators, no royalties, no collection, immutable.
pub fn encode_create_metadata_v3(name: &str, symbol: &str, uri: &str) -> Vec<u8> {
    let mut d = vec![33u8]; // instruction discriminator
    push_borsh_string(&mut d, name);
    push_borsh_string(&mut d, symbol);
    push_borsh_string(&mut d, uri);
    d.extend_from_slice(&0u16.to_le_bytes()); // seller_fee_basis_points
    d.push(0); // creators: None
    d.push(0); // collection: None
    d.push(0); // uses: None
    d.push(0); // is_mutable: false
    d.push(0); // collection_details: None
    d
}

#[account]
#[derive(InitSpace)]
pub struct Curve {
    pub creator: Pubkey,
    pub mint: Pubkey,
    #[max_len(32)]
    pub name: String,
    #[max_len(10)]
    pub symbol: String,
    #[max_len(128)]
    pub uri: String,
    pub virtual_sol: u64,
    pub virtual_tokens: u64,
    pub real_sol: u64,
    pub real_tokens: u64,
    pub accrued_fees: u64,
    pub fee_bps: u16,
    /// extra trade fee, paid to holders instead of the creator
    pub holder_fee_bps: u16,
    pub max_tax_bps: u16,
    pub decay_secs: i64,
    pub holder_sell_bps: u16,
    pub window_secs: i64,
    pub created_at: i64,
    pub complete: bool,
    pub bump: u8,
    /// share of each sell tax paid to holders
    pub reward_bps: u16,
    /// sum of every position's curve-bought balance
    pub total_tracked: u64,
    /// cumulative lamports of reward per token unit, scaled by ACC_SCALE
    pub acc_per_token: u128,
    /// lamports owed to holders and not yet claimed (held in the curve account, outside the price reserves)
    pub reward_pool: u64,
}

/// Per-wallet, per-token bookkeeping: hold clock + sell window.
#[account]
#[derive(InitSpace)]
pub struct Position {
    pub owner: Pubkey,
    pub mint: Pubkey,
    /// balance-weighted average buy time of tokens bought through the curve (0 = none yet)
    pub avg_ts: i64,
    /// tokens bought through the curve and still held (transfers in don't count)
    pub tracked: u64,
    pub window_start: i64,
    /// wallet balance when the current sell window opened
    pub window_base: u64,
    /// tokens sold in the current window
    pub window_sold: u64,
    pub bump: u8,
    /// tracked * acc_per_token / ACC_SCALE at the last change; earnings are measured from here
    pub reward_debt: u128,
    /// banked rewards not yet claimed
    pub pending_rewards: u64,
}

#[event]
pub struct Trade {
    pub mint: Pubkey,
    pub trader: Pubkey,
    pub is_buy: bool,
    pub sol: u64,
    pub tokens: u64,
    pub tax: u64,
    /// part of the tax paid out to holders
    pub rewards: u64,
    /// part of the trade fee paid out to holders
    pub fee_to_holders: u64,
    pub virtual_sol: u64,
    pub virtual_tokens: u64,
    pub ts: i64,
}

#[derive(Accounts)]
pub struct CreateCurve<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        init,
        payer = creator,
        space = 8 + Curve::INIT_SPACE,
        seeds = [CURVE_SEED, mint.key().as_ref()],
        bump
    )]
    pub curve: Account<'info, Curve>,

    #[account(init, payer = creator, mint::decimals = 6, mint::authority = curve)]
    pub mint: Account<'info, Mint>,

    #[account(
        init,
        payer = creator,
        associated_token::mint = mint,
        associated_token::authority = curve
    )]
    pub vault: Account<'info, TokenAccount>,

    /// CHECK: the Metaplex metadata PDA for this mint, created by the CPI in create_curve
    #[account(
        mut,
        seeds = [METADATA_SEED, METADATA_PROGRAM_ID.as_ref(), mint.key().as_ref()],
        bump,
        seeds::program = METADATA_PROGRAM_ID
    )]
    pub metadata: UncheckedAccount<'info>,

    /// CHECK: pinned to the Metaplex Token Metadata program id
    #[account(address = METADATA_PROGRAM_ID)]
    pub metadata_program: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Buy<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

    #[account(mut, seeds = [CURVE_SEED, mint.key().as_ref()], bump = curve.bump, has_one = mint)]
    pub curve: Account<'info, Curve>,

    pub mint: Account<'info, Mint>,

    #[account(mut, associated_token::mint = mint, associated_token::authority = curve)]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = buyer,
        associated_token::mint = mint,
        associated_token::authority = buyer
    )]
    pub buyer_ata: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = buyer,
        space = 8 + Position::INIT_SPACE,
        seeds = [POSITION_SEED, mint.key().as_ref(), buyer.key().as_ref()],
        bump
    )]
    pub position: Account<'info, Position>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Sell<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,

    #[account(mut, seeds = [CURVE_SEED, mint.key().as_ref()], bump = curve.bump, has_one = mint)]
    pub curve: Account<'info, Curve>,

    pub mint: Account<'info, Mint>,

    #[account(mut, associated_token::mint = mint, associated_token::authority = curve)]
    pub vault: Account<'info, TokenAccount>,

    #[account(mut, associated_token::mint = mint, associated_token::authority = seller)]
    pub seller_ata: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = seller,
        space = 8 + Position::INIT_SPACE,
        seeds = [POSITION_SEED, mint.key().as_ref(), seller.key().as_ref()],
        bump
    )]
    pub position: Account<'info, Position>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[event]
pub struct CurveCreated {
    pub mint: Pubkey,
    pub creator: Pubkey,
    pub name: String,
    pub symbol: String,
    pub uri: String,
    pub fee_bps: u16,
    pub holder_fee_bps: u16,
    pub max_tax_bps: u16,
    pub decay_secs: i64,
    pub holder_sell_bps: u16,
    pub window_secs: i64,
    pub reward_bps: u16,
    pub ts: i64,
}

#[event]
pub struct RewardsClaimed {
    pub mint: Pubkey,
    pub claimer: Pubkey,
    pub amount: u64,
}

#[derive(Accounts)]
pub struct ClaimRewards<'info> {
    #[account(mut)]
    pub claimer: Signer<'info>,

    #[account(mut, seeds = [CURVE_SEED, mint.key().as_ref()], bump = curve.bump, has_one = mint)]
    pub curve: Account<'info, Curve>,

    pub mint: Account<'info, Mint>,

    #[account(associated_token::mint = mint, associated_token::authority = claimer)]
    pub claimer_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [POSITION_SEED, mint.key().as_ref(), claimer.key().as_ref()],
        bump = position.bump
    )]
    pub position: Account<'info, Position>,
}

#[derive(Accounts)]
pub struct ClaimFees<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(mut, has_one = creator)]
    pub curve: Account<'info, Curve>,
}

#[error_code]
pub enum LaunchError {
    #[msg("Bad curve parameters")]
    BadParams,
    #[msg("Math error or amount too small")]
    MathError,
    #[msg("Slippage exceeded")]
    Slippage,
    #[msg("Curve is complete")]
    CurveComplete,
    #[msg("This wallet already sold its share for this window")]
    HolderLimitExceeded,
    #[msg("No fees to claim")]
    NothingToClaim,
}
