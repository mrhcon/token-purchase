use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount};
use anchor_spl::associated_token::AssociatedToken;

declare_id!("9HgVgT5AQ9WdCcZPMgzG8j26892YBjvHFEFL33xk4tb7");

#[program]
pub mod token_purchase {
    use super::*;

    pub fn create_purchase_transaction(
        ctx: Context<CreatePurchaseTransaction>,
        sol_amount: u64,
        lock_duration_months: u8,
    ) -> Result<()> {
        // Validate input
        if ![1, 3, 6, 12].contains(&lock_duration_months) {
            return err!(ErrorCode::InvalidLockDuration);
        }
        if sol_amount == 0 {
            return err!(ErrorCode::InvalidAmount);
        }

        // Step 1: Transfer SOL from user to treasury
        let transfer_ix = anchor_lang::system_program::Transfer {
            from: ctx.accounts.user.to_account_info(),
            to: ctx.accounts.treasury.to_account_info(),
        };

        let cpi_ctx = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            transfer_ix,
        );

        anchor_lang::system_program::transfer(cpi_ctx, sol_amount)?;

        // Step 2: Calculate token amount with bonus multiplier
        let base_token_amount = sol_amount * 100 / 1_000_000_000;
        
        let bonus_multiplier = match lock_duration_months {
            1 => 102,
            3 => 106,
            6 => 112,
            12 => 125,
            _ => 100,
        };
        
        let total_token_amount = base_token_amount * bonus_multiplier / 100;

        // Step 3: Transfer tokens from admin to user
        let transfer_cpi_accounts = token::Transfer {
            from: ctx.accounts.admin_token_account.to_account_info(),
            to: ctx.accounts.user_token_account.to_account_info(),
            authority: ctx.accounts.admin.to_account_info(),
        };

        let token_cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            transfer_cpi_accounts,
        );

        token::transfer(token_cpi_ctx, total_token_amount)?;

        // Note: We'll handle governance locking separately
        Ok(())
    }

    pub fn complete_purchase(
        _ctx: Context<CompletePurchase>,
        _sol_amount: u64,
        _lock_duration_months: u8,
        _transaction_signature: String,
    ) -> Result<()> {
        // This is just a record-keeping function
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(sol_amount: u64, lock_duration_months: u8)]
pub struct CreatePurchaseTransaction<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub admin: Signer<'info>,
    /// CHECK: This is the treasury account that receives SOL
    #[account(mut)]
    pub treasury: AccountInfo<'info>,
    pub community_mint: Account<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = community_mint,
        associated_token::authority = admin,
    )]
    pub admin_token_account: Account<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = community_mint,
        associated_token::authority = user,
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    // Governance-related accounts
    /// CHECK: Realm account used by governance program
    pub realm: AccountInfo<'info>,
    /// CHECK: Realm config used by governance program
    pub realm_config: AccountInfo<'info>,
    /// CHECK: Governing token holding used by governance program
    #[account(mut)]
    pub governing_token_holding: AccountInfo<'info>,
    /// CHECK: Governance token account used by governance program
    #[account(mut)]
    pub governance_token_account: AccountInfo<'info>,
    /// CHECK: Token owner record used by governance program
    #[account(mut)]
    pub token_owner_record: AccountInfo<'info>,
    // Programs
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    /// CHECK: Governance program
    pub governance_program: AccountInfo<'info>,
}

#[derive(Accounts)]
#[instruction(sol_amount: u64, lock_duration_months: u8, transaction_signature: String)]
pub struct CompletePurchase<'info> {
    /// CHECK: User account for record-keeping
    pub user: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Invalid lock duration. Must be 1, 3, 6, or 12 months.")]
    InvalidLockDuration,
    #[msg("Invalid amount. Amount must be greater than 0.")]
    InvalidAmount,
    #[msg("Insufficient token balance in treasury.")]
    InsufficientTreasuryBalance,
}
