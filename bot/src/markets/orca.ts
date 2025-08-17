import { Connection, PublicKey } from '@solana/web3.js';
import { getOrca, OrcaFarmConfig, OrcaPoolConfig } from '@orca-so/sdk';
import { Decimal } from 'decimal.js';
import { TokenPrice } from '../types';
import { Logger } from '../utils/logger';

const logger = Logger.getInstance();

export class OrcaIntegration {
  private orca: any;
  private poolConfigs: Map<string, OrcaPoolConfig> = new Map();

  constructor(private connection: Connection) {}

  async initialize() {
    try {
      this.orca = getOrca(this.connection);
      
      // Initialize common pools
      const commonPools = [
        'SOL/USDC',
        'SOL/USDT', 
        'ORCA/SOL',
        'RAY/SOL'
      ];

      for (const poolName of commonPools) {
        try {
          const pool = this.orca.getPool(OrcaPoolConfig[poolName]);
          this.poolConfigs.set(poolName, pool.getPoolConfig());
          logger.debug(`Initialized Orca pool: ${poolName}`);
        } catch (error) {
          logger.warn(`Failed to initialize Orca pool ${poolName}:`, error);
        }
      }

      logger.info(`✅ Orca integration initialized with ${this.poolConfigs.size} pools`);
    } catch (error) {
      logger.error('❌ Failed to initialize Orca integration:', error);
      throw error;
    }
  }

  async getPrices(): Promise<TokenPrice[]> {
    const prices: TokenPrice[] = [];

    for (const [poolName, poolConfig] of this.poolConfigs.entries()) {
      try {
        const pool = this.orca.getPool(poolConfig);
        
        // Get pool quote for both directions
        const [tokenA, tokenB] = poolName.split('/');
        
        // Quote A->B
        const quoteAB = await pool.getQuote(pool.getTokenA(), new Decimal(1));
        const priceAB = quoteAB.getMinOutputAmount().toNumber();
        
        // Quote B->A  
        const quoteBA = await pool.getQuote(pool.getTokenB(), new Decimal(1));
        const priceBA = 1 / quoteBA.getMinOutputAmount().toNumber();

        prices.push({
          symbol: tokenA,
          mint: pool.getTokenA().mint.toString(),
          price: priceBA, // Price of tokenA in terms of tokenB
          source: 'Orca',
          timestamp: Date.now(),
          liquidity: await this.getPoolLiquidity(pool)
        });

        // Only add tokenB price if it's not SOL (to avoid duplicate SOL prices)
        if (tokenB !== 'SOL') {
          prices.push({
            symbol: tokenB,
            mint: pool.getTokenB().mint.toString(), 
            price: priceAB, // Price of tokenB in terms of tokenA
            source: 'Orca',
            timestamp: Date.now(),
            liquidity: await this.getPoolLiquidity(pool)
          });
        }

      } catch (error) {
        logger.warn(`Failed to get Orca price for ${poolName}:`, error);
      }
    }

    return prices;
  }

  async executeSwap(
    inputMint: string,
    outputMint: string,
    amount: number,
    slippage: number = 0.01
  ): Promise<{ success: boolean; signature?: string; error?: string }> {
    try {
      // Find appropriate pool
      const pool = this.findPoolForSwap(inputMint, outputMint);
      if (!pool) {
        return { success: false, error: 'No suitable pool found' };
      }

      // Get quote
      const inputToken = inputMint === pool.getTokenA().mint.toString() ? 
        pool.getTokenA() : pool.getTokenB();
      
      const quote = await pool.getQuote(inputToken, new Decimal(amount));
      const minOutputAmount = quote.getMinOutputAmount().mul(1 - slippage);

      // Execute swap
      const swapPayload = await pool.swap(
        inputToken,
        new Decimal(amount),
        minOutputAmount
      );

      const transaction = await swapPayload.transaction();
      const signature = await this.connection.sendTransaction(transaction);

      return { success: true, signature };

    } catch (error) {
      logger.error('Orca swap failed:', error);
      return { success: false, error: String(error) };
    }
  }

  private findPoolForSwap(inputMint: string, outputMint: string): any {
    // Logic to find the best pool for the swap pair
    for (const [poolName, poolConfig] of this.poolConfigs.entries()) {
      const pool = this.orca.getPool(poolConfig);
      const tokenAMint = pool.getTokenA().mint.toString();
      const tokenBMint = pool.getTokenB().mint.toString();

      if ((inputMint === tokenAMint && outputMint === tokenBMint) ||
          (inputMint === tokenBMint && outputMint === tokenAMint)) {
        return pool;
      }
    }
    return null;
  }

  private async getPoolLiquidity(pool: any): Promise<number> {
    try {
      // Get pool account data and calculate TVL
      const poolAccount = await pool.getPoolAccount();
      // Simplified liquidity calculation - implement proper TVL calculation
      return poolAccount.tokenAAmount + poolAccount.tokenBAmount;
    } catch (error) {
      logger.warn('Failed to get pool liquidity:', error);
      return 0;
    }
  }
}
