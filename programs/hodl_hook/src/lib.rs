//! HODL transfer hook.
//!
//! Token-2022 calls this program before every transfer of a HODL token. The only rule: a transfer is allowed
//! when one side of it is the token's curve account (a buy or a sell on the HODL curve). Everything else, such
//! as wallet to wallet or to another exchange, is refused until the token graduates and the hook is switched off.
//!
//! Written without a framework on purpose: it is tiny, which keeps the on-chain rent cost low.
use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    account_info::AccountInfo, entrypoint, entrypoint::ProgramResult, msg, program::invoke_signed, program_error::ProgramError,
    pubkey::Pubkey, rent::Rent, system_instruction,
};

declare_id!("13PKRkQAtxV92pJpM7fXAhxd5a1QGQPJ22o9FLLo7FNA");

/// The HODL curve program. A transfer is only allowed if one side of it is this token's curve account.
pub const HODL_PROGRAM: Pubkey = pubkey!("Eyv8eYAjHonsHQ6awmB4fy1mv2jqXciK8PzooUoV5kmb");
pub const CURVE_SEED: &[u8] = b"curve";
pub const META_LIST_SEED: &[u8] = b"extra-account-metas";

/// First 8 bytes of sha256("spl-transfer-hook-interface:execute"): how the token program calls a hook.
pub const EXECUTE_DISCRIMINATOR: [u8; 8] = [105, 37, 101, 197, 75, 251, 102, 26];
/// First 8 bytes of sha256("global:initialize_extra_account_meta_list"): the setup instruction the curve program calls.
pub const INIT_DISCRIMINATOR: [u8; 8] = [92, 197, 174, 197, 41, 124, 19, 3];

const ERR_ONLY_VIA_CURVE: u32 = 6000;

entrypoint!(process_instruction);

pub fn process_instruction(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.len() >= 16 && data[..8] == EXECUTE_DISCRIMINATOR {
        return execute(program_id, accounts);
    }
    if data.len() >= 8 && data[..8] == INIT_DISCRIMINATOR {
        return init_meta_list(program_id, accounts);
    }
    Err(ProgramError::InvalidInstructionData)
}

/// accounts: source token account, mint, destination token account, owner, the extra-accounts list.
fn execute(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    if accounts.len() < 5 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }
    let (source, mint, destination, meta_list) = (&accounts[0], &accounts[1], &accounts[2], &accounts[4]);

    // the list account must be the real one for this mint
    let (expected_list, _) = Pubkey::find_program_address(&[META_LIST_SEED, mint.key.as_ref()], program_id);
    if *meta_list.key != expected_list {
        return Err(ProgramError::InvalidSeeds);
    }

    // token account layout: bytes 0..32 mint, 32..64 owner. The same for both token programs.
    let owner_of = |a: &AccountInfo| -> core::result::Result<Pubkey, ProgramError> {
        let d = a.try_borrow_data()?;
        if d.len() < 64 {
            return Err(ProgramError::InvalidAccountData);
        }
        Ok(Pubkey::new_from_array(d[32..64].try_into().unwrap()))
    };
    let (curve, _) = Pubkey::find_program_address(&[CURVE_SEED, mint.key.as_ref()], &HODL_PROGRAM);
    if owner_of(source)? == curve || owner_of(destination)? == curve {
        return Ok(());
    }
    msg!("This token can only be bought or sold on the HODL curve until it graduates. Wallet to wallet transfers are blocked.");
    Err(ProgramError::Custom(ERR_ONLY_VIA_CURVE))
}

/// Creates the (empty) list of extra accounts the token program looks for before every transfer.
/// We need none, but the list account must exist or the token program refuses to transfer.
/// accounts: payer (signer), the list account, the mint, the system program.
fn init_meta_list(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    if accounts.len() < 4 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }
    let (payer, meta_list, mint, system) = (&accounts[0], &accounts[1], &accounts[2], &accounts[3]);
    if !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let (expected_list, bump) = Pubkey::find_program_address(&[META_LIST_SEED, mint.key.as_ref()], program_id);
    if *meta_list.key != expected_list {
        return Err(ProgramError::InvalidSeeds);
    }

    // layout: 8 byte type (the execute discriminator) + 4 byte length + list (4 byte count = 0)
    let mut data = [0u8; 16];
    data[..8].copy_from_slice(&EXECUTE_DISCRIMINATOR);
    data[8..12].copy_from_slice(&4u32.to_le_bytes());

    let lamports = Rent::get()?.minimum_balance(data.len());
    let seeds: &[&[u8]] = &[META_LIST_SEED, mint.key.as_ref(), &[bump]];
    invoke_signed(
        &system_instruction::create_account(payer.key, meta_list.key, lamports, data.len() as u64, program_id),
        &[payer.clone(), meta_list.clone(), system.clone()],
        &[seeds],
    )?;
    meta_list.try_borrow_mut_data()?.copy_from_slice(&data);
    Ok(())
}
