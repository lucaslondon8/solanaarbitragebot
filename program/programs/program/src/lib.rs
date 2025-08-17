use anchor_lang::prelude::*;

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod arbitrage_bot {
    use super::*;

    pub fn execute_arbitrage(
        _ctx: Context<ExecuteArbitrage>, // Changed to _ctx
        _route: Vec<SwapHop>,             // Changed to _route
        in_amount: u64,
        _min_out_amount: u64,            // Changed to _min_out_amount
    ) -> Result<()> {
        msg!("Starting arbitrage execution...");
        msg!("Initial amount: {}", in_amount);

        // The 'trade_wallet' and 'current_amount' variables are unused for now,
        // so we prefix them with '_' to silence compiler warnings.
        let _trade_wallet = &_ctx.accounts.trade_wallet;
        let _current_amount = in_amount;

        for (index, hop) in _route.iter().enumerate() {
            msg!("Executing hop {}: Swapping on {:?}", index + 1, hop.venue);

            match hop.venue {
                SwapVenue::Orca => {
                    msg!("(Placeholder) Swapped on Orca.");
                }
                SwapVenue::Raydium => {
                    msg!("(Placeholder) Swapped on Raydium.");
                }
                SwapVenue::Phoenix => {
                    msg!("(Placeholder) Swapped on Phoenix.");
                }
            }
        }

        msg!("Arbitrage execution finished successfully.");
        Ok(())
    }
}

#[derive(Accounts)]
pub struct ExecuteArbitrage<'info> {
    pub authority: Signer<'info>,

    /// CHECK: This is a temporary trading account that can hold different token types.
    /// The off-chain client is responsible for ensuring it is a valid token account.
    #[account(mut)]
    pub trade_wallet: AccountInfo<'info>,
}

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

#[error_code]
pub enum ArbitrageError {
    #[msg("The final profit was less than the minimum required.")]
    InsufficientProfit,
}
