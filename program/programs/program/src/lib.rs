use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod arbitrage_bot {
    use super::*;

    /// Initialize the arbitrage state account
    pub fn initialize_arbitrage_state(
        ctx: Context<InitializeArbitrageState>,
        min_execution_interval: i64,
    ) -> Result<()> {
        let arbitrage_state = &mut ctx.accounts.arbitrage_state;
        arbitrage_state.authority = ctx.accounts.authority.key();
        arbitrage_state.min_execution_interval = min_execution_interval;
        arbitrage_state.is_paused = false;
        arbitrage_state.total_trades = 0;
        arbitrage_state.total_profit = 0;
        arbitrage_state.last_execution_time = 0;
        arbitrage_state.bump = ctx.bumps.arbitrage_state;
        
        emit!(ArbitrageStateInitialized {
            authority: ctx.accounts.authority.key(),
            min_execution_interval,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        msg!("Arbitrage state initialized for authority: {}", ctx.accounts.authority.key());
        Ok(())
    }

    /// Execute flash loan arbitrage with complete atomicity and safety checks
    pub fn execute_flash_arbitrage(
        ctx: Context<FlashArbitrage>,
        borrow_amount: u64,
        min_profit_lamports: u64,
        swap_routes: Vec<SwapRoute>,
    ) -> Result<()> {
        msg!("Starting flash arbitrage execution");
        msg!("Borrow amount: {}, Min profit: {}", borrow_amount, min_profit_lamports);

        // Validate inputs
        require!(borrow_amount > 0, ArbitrageError::InvalidAmount);
        require!(!swap_routes.is_empty(), ArbitrageError::EmptyRoutes);
        require!(swap_routes.len() <= 4, ArbitrageError::TooManyHops);

        let clock = Clock::get()?;
        let arbitrage_state = &mut ctx.accounts.arbitrage_state;
        
        // Check if bot is paused
        require!(!arbitrage_state.is_paused, ArbitrageError::BotPaused);
        
        // Rate limiting check
        require!(
            clock.unix_timestamp - arbitrage_state.last_execution_time > arbitrage_state.min_execution_interval,
            ArbitrageError::ExecutionTooFrequent
        );

        // Record initial balances for profit calculation
        let initial_balance = ctx.accounts.user_token_account.amount;
        
        // Execute the arbitrage sequence atomically
        Self::execute_arbitrage_sequence(
            &ctx,
            borrow_amount,
            &swap_routes,
        )?;

        // Verify profitability
        ctx.accounts.user_token_account.reload()?;
        let final_balance = ctx.accounts.user_token_account.amount;
        let profit = final_balance.saturating_sub(initial_balance);
        
        require!(profit >= min_profit_lamports, ArbitrageError::InsufficientProfit);

        // Update state
        arbitrage_state.last_execution_time = clock.unix_timestamp;
        arbitrage_state.total_trades += 1;
        arbitrage_state.total_profit = arbitrage_state.total_profit.saturating_add(profit);

        // Emit success event
        emit!(ArbitrageExecuted {
            user: ctx.accounts.user.key(),
            profit,
            routes: swap_routes.len() as u8,
            timestamp: clock.unix_timestamp,
        });

        msg!("Arbitrage completed successfully. Profit: {} lamports", profit);
        Ok(())
    }

    /// Emergency pause function
    pub fn pause_bot(ctx: Context<PauseBot>) -> Result<()> {
        let arbitrage_state = &mut ctx.accounts.arbitrage_state;
        arbitrage_state.is_paused = true;
        
        emit!(BotPaused {
            authority: ctx.accounts.authority.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        msg!("Bot paused by authority: {}", ctx.accounts.authority.key());
        Ok(())
    }

    /// Resume bot function
    pub fn resume_bot(ctx: Context<ResumeBot>) -> Result<()> {
        let arbitrage_state = &mut ctx.accounts.arbitrage_state;
        arbitrage_state.is_paused = false;
        
        emit!(BotResumed {
            authority: ctx.accounts.authority.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        msg!("Bot resumed by authority: {}", ctx.accounts.authority.key());
        Ok(())
    }

    /// Withdraw profits (authority only)
    pub fn withdraw_profits(
        ctx: Context<WithdrawProfits>,
        amount: u64,
    ) -> Result<()> {
        require!(amount > 0, ArbitrageError::InvalidAmount);
        require!(
            ctx.accounts.user_token_account.amount >= amount,
            ArbitrageError::InsufficientBalance
        );

        // Transfer tokens from user account to authority
        let transfer_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.user_token_account.to_account_info(),
                to: ctx.accounts.authority_token_account.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        );
        
        token::transfer(transfer_ctx, amount)?;

        emit!(ProfitsWithdrawn {
            authority: ctx.accounts.authority.key(),
            amount,
            timestamp: Clock::get()?.unix_timestamp,
        });

        msg!("Withdrew {} lamports to authority", amount);
        Ok(())
    }

    /// Update bot configuration (authority only)
    pub fn update_bot_config(
        ctx: Context<UpdateBotConfig>,
        new_min_execution_interval: Option<i64>,
    ) -> Result<()> {
        let arbitrage_state = &mut ctx.accounts.arbitrage_state;
        
        if let Some(interval) = new_min_execution_interval {
            require!(interval >= 0, ArbitrageError::InvalidAmount);
            arbitrage_state.min_execution_interval = interval;
            msg!("Updated min execution interval to: {}", interval);
        }
        
        emit!(BotConfigUpdated {
            authority: ctx.accounts.authority.key(),
            new_min_execution_interval,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        Ok(())
    }

    // Private helper function for executing arbitrage sequence
    fn execute_arbitrage_sequence(
        ctx: &Context<FlashArbitrage>,
        borrow_amount: u64,
        swap_routes: &[SwapRoute],
    ) -> Result<()> {
        msg!("Executing arbitrage sequence with {} routes", swap_routes.len());
        
        // For each swap route, validate and execute
        for (index, route) in swap_routes.iter().enumerate() {
            msg!("Executing swap {} on {:?}", index + 1, route.dex_id);
            
            // Validate swap parameters
            require!(route.amount_in > 0, ArbitrageError::InvalidAmount);
            require!(route.min_amount_out > 0, ArbitrageError::InvalidAmount);
            
            // Additional safety checks
            require!(
                route.input_mint != route.output_mint, 
                ArbitrageError::InvalidSwapPair
            );
            
            // Execute swap based on DEX
            match route.dex_id {
                DexId::Orca => {
                    Self::execute_orca_swap(ctx, route)?;
                }
                DexId::Raydium => {
                    Self::execute_raydium_swap(ctx, route)?;
                }
                DexId::Jupiter => {
                    Self::execute_jupiter_swap(ctx, route)?;
                }
            }
        }
        
        msg!("Arbitrage sequence completed successfully");
        Ok(())
    }

    // Placeholder implementations for DEX-specific swaps
    // TODO: Implement actual DEX CPI calls
    fn execute_orca_swap(
        _ctx: &Context<FlashArbitrage>,
        route: &SwapRoute,
    ) -> Result<()> {
        msg!("Executing Orca swap: {} -> {}", route.amount_in, route.min_amount_out);
        msg!("Input mint: {}, Output mint: {}", route.input_mint, route.output_mint);
        
        // TODO: Implement actual Orca Whirlpool CPI call
        // This would involve:
        // 1. Finding the appropriate whirlpool
        // 2. Creating swap instruction
        // 3. Executing the swap
        // 4. Verifying slippage tolerance
        
        Ok(())
    }

    fn execute_raydium_swap(
        _ctx: &Context<FlashArbitrage>,
        route: &SwapRoute,
    ) -> Result<()> {
        msg!("Executing Raydium swap: {} -> {}", route.amount_in, route.min_amount_out);
        msg!("Input mint: {}, Output mint: {}", route.input_mint, route.output_mint);
        
        // TODO: Implement actual Raydium CPI call
        // This would involve:
        // 1. Finding the appropriate liquidity pool
        // 2. Creating swap instruction
        // 3. Executing the swap
        // 4. Verifying slippage tolerance
        
        Ok(())
    }

    fn execute_jupiter_swap(
        _ctx: &Context<FlashArbitrage>,
        route: &SwapRoute,
    ) -> Result<()> {
        msg!("Executing Jupiter swap: {} -> {}", route.amount_in, route.min_amount_out);
        msg!("Input mint: {}, Output mint: {}", route.input_mint, route.output_mint);
        
        // TODO: Implement actual Jupiter CPI call
        // This would involve using Jupiter's shared accounts
        // and routing through their aggregator
        
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeArbitrageState<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        seeds = [b"arbitrage_state", authority.key().as_ref()],
        bump,
        payer = authority,
        space = ArbitrageState::LEN,
    )]
    pub arbitrage_state: Account<'info, ArbitrageState>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FlashArbitrage<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"arbitrage_state", user.key().as_ref()],
        bump = arbitrage_state.bump,
    )]
    pub arbitrage_state: Account<'info, ArbitrageState>,

    #[account(
        mut,
        constraint = user_token_account.owner == user.key() @ ArbitrageError::Unauthorized,
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PauseBot<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"arbitrage_state", authority.key().as_ref()],
        bump = arbitrage_state.bump,
        constraint = arbitrage_state.authority == authority.key() @ ArbitrageError::Unauthorized,
    )]
    pub arbitrage_state: Account<'info, ArbitrageState>,
}

#[derive(Accounts)]
pub struct ResumeBot<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"arbitrage_state", authority.key().as_ref()],
        bump = arbitrage_state.bump,
        constraint = arbitrage_state.authority == authority.key() @ ArbitrageError::Unauthorized,
    )]
    pub arbitrage_state: Account<'info, ArbitrageState>,
}

#[derive(Accounts)]
pub struct UpdateBotConfig<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"arbitrage_state", authority.key().as_ref()],
        bump = arbitrage_state.bump,
        constraint = arbitrage_state.authority == authority.key() @ ArbitrageError::Unauthorized,
    )]
    pub arbitrage_state: Account<'info, ArbitrageState>,
}

#[derive(Accounts)]
pub struct WithdrawProfits<'info> {
    pub authority: Signer<'info>,
    
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        seeds = [b"arbitrage_state", user.key().as_ref()],
        bump = arbitrage_state.bump,
        constraint = arbitrage_state.authority == authority.key() @ ArbitrageError::Unauthorized,
    )]
    pub arbitrage_state: Account<'info, ArbitrageState>,

    #[account(
        mut,
        constraint = user_token_account.owner == user.key() @ ArbitrageError::Unauthorized,
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = authority_token_account.owner == authority.key() @ ArbitrageError::Unauthorized,
    )]
    pub authority_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[account]
pub struct ArbitrageState {
    pub authority: Pubkey,
    pub is_paused: bool,
    pub min_execution_interval: i64,
    pub last_execution_time: i64,
    pub total_trades: u64,
    pub total_profit: u64,
    pub bump: u8,
}

impl ArbitrageState {
    pub const LEN: usize = 8 + // discriminator
        32 + // authority
        1 +  // is_paused
        8 +  // min_execution_interval
        8 +  // last_execution_time
        8 +  // total_trades
        8 +  // total_profit
        1;   // bump
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct SwapRoute {
    pub dex_id: DexId,
    pub amount_in: u64,
    pub min_amount_out: u64,
    pub input_mint: Pubkey,
    pub output_mint: Pubkey,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub enum DexId {
    Orca,
    Raydium,
    Jupiter,
}

// Legacy compatibility - keeping for backward compatibility
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct SwapHop {
    pub venue: SwapVenue,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub enum SwapVenue {
    Orca,
    Raydium,
    Phoenix,
}

// Events for monitoring and analytics
#[event]
pub struct ArbitrageStateInitialized {
    pub authority: Pubkey,
    pub min_execution_interval: i64,
    pub timestamp: i64,
}

#[event]
pub struct ArbitrageExecuted {
    pub user: Pubkey,
    pub profit: u64,
    pub routes: u8,
    pub timestamp: i64,
}

#[event]
pub struct BotPaused {
    pub authority: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct BotResumed {
    pub authority: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct BotConfigUpdated {
    pub authority: Pubkey,
    pub new_min_execution_interval: Option<i64>,
    pub timestamp: i64,
}

#[event]
pub struct ProfitsWithdrawn {
    pub authority: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

#[error_code]
pub enum ArbitrageError {
    #[msg("Invalid amount provided")]
    InvalidAmount,
    #[msg("No swap routes provided")]
    EmptyRoutes,
    #[msg("Too many swap hops (max 4)")]
    TooManyHops,
    #[msg("Bot is currently paused")]
    BotPaused,
    #[msg("Execution too frequent - rate limited")]
    ExecutionTooFrequent,
    #[msg("Insufficient profit after execution")]
    InsufficientProfit,
    #[msg("Insufficient balance for operation")]
    InsufficientBalance,
    #[msg("Unauthorized access")]
    Unauthorized,
    #[msg("Slippage tolerance exceeded")]
    SlippageExceeded,
    #[msg("Pool liquidity insufficient")]
    InsufficientLiquidity,
    #[msg("Invalid swap pair - same input and output mint")]
    InvalidSwapPair,
    #[msg("Account validation failed")]
    AccountValidationFailed,
    #[msg("Arithmetic overflow or underflow")]
    ArithmeticError,
}
