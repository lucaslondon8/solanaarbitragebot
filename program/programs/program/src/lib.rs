use anchor_lang::prelude::*;

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod arbitrage_program {
    use super::*;

    pub fn initialize_arbitrage_state(
        ctx: Context<InitializeArbitrageState>,
        min_execution_interval: i64,
    ) -> Result<()> {
        let arbitrage_state = &mut ctx.accounts.arbitrage_state;
        arbitrage_state.authority = ctx.accounts.authority.key();
        arbitrage_state.is_paused = false;
        arbitrage_state.min_execution_interval = min_execution_interval;
        arbitrage_state.last_execution_time = 0;
        arbitrage_state.total_trades = 0;
        arbitrage_state.total_profit = 0;
        arbitrage_state.bump = ctx.bumps.arbitrage_state;

        emit!(ArbitrageStateInitialized {
            authority: arbitrage_state.authority,
            min_execution_interval,
            timestamp: Clock::get()?.unix_timestamp,
        });

        msg!("Arbitrage state initialized for authority: {}", arbitrage_state.authority);
        Ok(())
    }

    pub fn flash_arbitrage(
        ctx: Context<FlashArbitrage>,
        routes: Vec<SwapRoute>,
        expected_profit: u64,
    ) -> Result<()> {
        let arbitrage_state = &mut ctx.accounts.arbitrage_state;
        
        // Safety checks
        require!(!arbitrage_state.is_paused, ArbitrageError::BotPaused);
        require!(!routes.is_empty(), ArbitrageError::EmptyRoutes);
        require!(routes.len() <= 4, ArbitrageError::TooManyHops);
        require!(expected_profit > 0, ArbitrageError::InvalidAmount);

        // Rate limiting check
        let current_time = Clock::get()?.unix_timestamp;
        let time_since_last = current_time - arbitrage_state.last_execution_time;
        require!(
            time_since_last >= arbitrage_state.min_execution_interval,
            ArbitrageError::ExecutionTooFrequent
        );

        msg!("Starting arbitrage sequence with {} routes", routes.len());
        msg!("Expected profit: {} lamports", expected_profit);

        // Execute each swap route in sequence
        for (i, route) in routes.iter().enumerate() {
            msg!("Executing route {}/{}: {:?} swap", i + 1, routes.len(), route.dex_id);
            
            // Execute swap based on DEX type
            match route.dex_id {
                DexId::Orca => {
                    msg!("🌊 Orca swap: {} → {} (amount: {})", 
                         route.input_mint, route.output_mint, route.amount_in);
                    msg!("  Min amount out: {}", route.min_amount_out);
                    msg!("  ✅ Orca swap simulated successfully");
                },
                DexId::Raydium => {
                    msg!("⚡ Raydium swap: {} → {} (amount: {})", 
                         route.input_mint, route.output_mint, route.amount_in);
                    msg!("  Min amount out: {}", route.min_amount_out);
                    msg!("  ✅ Raydium swap simulated successfully");
                },
                DexId::Jupiter => {
                    msg!("🪐 Jupiter swap: {} → {} (amount: {})", 
                         route.input_mint, route.output_mint, route.amount_in);
                    msg!("  Min amount out: {}", route.min_amount_out);
                    msg!("  ✅ Jupiter swap simulated successfully");
                },
            }
        }

        // Update state after successful execution
        arbitrage_state.last_execution_time = current_time;
        arbitrage_state.total_trades += 1;
        arbitrage_state.total_profit += expected_profit;

        emit!(ArbitrageExecuted {
            user: ctx.accounts.user.key(),
            profit: expected_profit,
            routes: routes.len() as u8,
            timestamp: current_time,
        });

        msg!("Arbitrage sequence completed successfully");
        Ok(())
    }

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

    pub fn update_bot_config(
        ctx: Context<UpdateBotConfig>,
        new_min_execution_interval: Option<i64>,
    ) -> Result<()> {
        let arbitrage_state = &mut ctx.accounts.arbitrage_state;

        if let Some(interval) = new_min_execution_interval {
            arbitrage_state.min_execution_interval = interval;
        }

        emit!(BotConfigUpdated {
            authority: ctx.accounts.authority.key(),
            new_min_execution_interval,
            timestamp: Clock::get()?.unix_timestamp,
        });

        msg!("Bot configuration updated by authority: {}", ctx.accounts.authority.key());
        Ok(())
    }

    pub fn withdraw_profits(
        ctx: Context<WithdrawProfits>,
        amount: u64,
    ) -> Result<()> {
        msg!("Withdraw profits called by: {} for amount: {}", ctx.accounts.authority.key(), amount);
        
        emit!(ProfitsWithdrawn {
            authority: ctx.accounts.authority.key(),
            amount,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
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

    #[account(
        seeds = [b"arbitrage_state", authority.key().as_ref()],
        bump = arbitrage_state.bump,
        constraint = arbitrage_state.authority == authority.key() @ ArbitrageError::Unauthorized,
    )]
    pub arbitrage_state: Account<'info, ArbitrageState>,
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
