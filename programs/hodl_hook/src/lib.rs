use anchor_lang::prelude::*;
use anchor_lang::solana_program::{program::invoke_signed, system_instruction};

declare_id!("13PKRkQAtxV92pJpM7fXAhxd5a1QGQPJ22o9FLLo7FNA");

/// The HODL curve program. A transfer is only allowed if one side of it is this token's curve vault.
pub const HODL_PROGRAM: Pubkey = pubkey!("Eyv8eYAjHonsHQ6awmB4fy1mv2jqXciK8PzooUoV5kmb");
pub const CURVE_SEED: &[u8] = b"curve";
pub const META_LIST_SEED: &[u8] = b"extra-account-metas";

/// First 8 bytes of sha256("spl-transfer-hook-interface:execute"): how the token program calls a hook.
pub const EXECUTE_DISCRIMINATOR: [u8; 8] = [105, 37, 101, 197, 75, 251, 102, 26];

#[program]
pub mod hodl_hook {
    use super::*;

    /// Creates the (empty) list of extra accounts the token program looks for before every transfer.
    /// We need none, but the list account must exist or the token program refuses to transfer.
    /// Anyone can call this once per mint; the curve program calls it when it creates a token.
    pub fn initialize_extra_account_meta_list(ctx: Context<InitMetaList>) -> Result<()> {
        // layout: 8 byte type (the execute discriminator) + 4 byte length + list (4 byte count = 0)
        let mut data = Vec::with_capacity(16);
        data.extend_from_slice(&EXECUTE_DISCRIMINATOR);
        data.extend_from_slice(&4u32.to_le_bytes());
        data.extend_from_slice(&0u32.to_le_bytes());

        let mint_key = ctx.accounts.mint.key();
        let bump = ctx.bumps.meta_list;
        let seeds: &[&[u8]] = &[META_LIST_SEED, mint_key.as_ref(), &[bump]];
        let lamports = Rent::get()?.minimum_balance(data.len());
        invoke_signed(
            &system_instruction::create_account(&ctx.accounts.payer.key(), &ctx.accounts.meta_list.key(), lamports, data.len() as u64, &crate::ID),
            &[
                ctx.accounts.payer.to_account_info(),
                ctx.accounts.meta_list.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            &[seeds],
        )?;
        ctx.accounts.meta_list.try_borrow_mut_data()?.copy_from_slice(&data);
        Ok(())
    }

    /// Called by the token program on every transfer of a HODL token (not by people).
    /// accounts: source token account, mint, destination token account, owner, the extra-accounts list.
    pub fn fallback<'info>(program_id: &Pubkey, accounts: &'info [AccountInfo<'info>], data: &[u8]) -> Result<()> {
        require!(data.len() >= 16 && data[0..8] == EXECUTE_DISCRIMINATOR, HookError::UnknownInstruction);
        require!(accounts.len() >= 5, HookError::MissingAccounts);
        let (source, mint, destination, meta_list) = (&accounts[0], &accounts[1], &accounts[2], &accounts[4]);

        // the list account must be the real one for this mint
        let (expected_list, _) = Pubkey::find_program_address(&[META_LIST_SEED, mint.key.as_ref()], program_id);
        require_keys_eq!(*meta_list.key, expected_list, HookError::MissingAccounts);

        // token account layout: bytes 0..32 mint, 32..64 owner. Same for both token programs.
        let owner_of = |a: &AccountInfo| -> Result<Pubkey> {
            let d = a.try_borrow_data()?;
            require!(d.len() >= 64, HookError::MissingAccounts);
            Ok(Pubkey::new_from_array(d[32..64].try_into().unwrap()))
        };
        let (curve, _) = Pubkey::find_program_address(&[CURVE_SEED, mint.key.as_ref()], &HODL_PROGRAM);
        require!(owner_of(source)? == curve || owner_of(destination)? == curve, HookError::OnlyViaCurve);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitMetaList<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: created here at its fixed address
    #[account(mut, seeds = [META_LIST_SEED, mint.key().as_ref()], bump)]
    pub meta_list: UncheckedAccount<'info>,

    /// CHECK: only its address is used
    pub mint: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[error_code]
pub enum HookError {
    #[msg("This token can only be bought or sold on the HODL curve until it graduates. Wallet to wallet transfers are blocked.")]
    OnlyViaCurve,
    #[msg("Unknown instruction")]
    UnknownInstruction,
    #[msg("Missing or wrong accounts")]
    MissingAccounts,
}
