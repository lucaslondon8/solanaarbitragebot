import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { getWhirlpoolsClient } from '@orca-so/whirlpools';
import { WhirlpoolsClient, WhirlpoolsContext, WhirlpoolContext, PDAUtil, Whirlpool } from '@orca-so/whirlpools';
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { TokenPrice, TradeResult } from '../types';
import { Logger } from '../utils/logger';
import { configManager } from '../utils/config';

const logger = Logger.getInstance();

export class RealOrcaIntegration {
  private client: WhirlpoolsClient | null = null;
  private ctx: WhirlpoolsContext | null = null;
  private whirlpools: Map<string, Whirlpool> = new Map();
  private priceCache: Map<string, TokenPrice> = new Map();

  constructor(
    private connection: Connection,
    private wallet: Keypair
  ) {}

  async initialize(): Promise<void> {
    try {
      logger.info('🌊 Initializing real Orca integration...');

      // Initialize Whirlpools client and context
      this.ctx = WhirlpoolsContext.withProvider(
        this.connection,
        { publicKey: this.wallet.publicKey, payer: this.wallet },
        'mainnet-beta'
      );

      this.client = new WhirlpoolsClient(this.ctx);

      // Load common whirlpools
      await this.loadCommonWhirlpools();

      logger.info(`✅ Orca integration initialized with ${this.whirlpools.size} whirlpools`);
    } catch (error) {
      logger.error('❌ Failed to initialize Orca integration:', error);
      throw error;
    }
  }

  private async loadCommonWhirlpools(): Promise<void> {
    const commonPairs = [
      { tokenA: 'SOL', tokenB: 'USDC', tickSpacing: 64 },
      { tokenA: 'SOL', tokenB: 'USDT', tickSpacing: 64 },
      { tokenA: 'USDC', tokenB: 'USDT', tickSpacing: 8 },
      { tokenA: 'SOL', tokenB: 'RAY', tickSpacing: 64 },
      { tokenA: 'SOL', tokenB: 'ORCA', tickSpacing: 64 }
    ];

    for (const pair of commonPairs) {
      try {
        const whirlpoolAddress = await this.findWhirlpoolAddress(
          pair.tokenA,
          pair.tokenB,
          pair.tickSpacing
        );

        if (whirlpoolAddress) {
          const whirlpool = await this.client!.getPool(whirlpoolAddress);
          if (whirlpool) {
            const pairKey = `${pair.tokenA}/${pair.tokenB}`;
            this.whirlpools.set(pairKey, whirlpool);
            logger.debug(`Loaded Orca whirlpool: ${pairKey}`);
          }
        }
      } catch (error) {
        logger.warn(`Failed to load ${pair.tokenA}/${pair.tokenB} whirlpool:`, error);
      }
    }
  }

  private async findWhirlpoolAddress(
    tokenA: string,
    tokenB: string,
    tickSpacing: number
  ): Promise<PublicKey | null> {
    try {
      const tokenMintA = this.getTokenMint(tokenA);
      const tokenMintB = this.getTokenMint(tokenB);

      if (!tokenMintA || !tokenMintB) {
        logger.warn(`Cannot find mints for ${tokenA}/${tokenB}`);
        return null;
      }

      // Find whirlpool PDA
      const whirlpoolPda = PDAUtil.getWhirlpool(
        this.ctx!.program.programId,
        new PublicKey('2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ'), // Whirlpools config
        tokenMintA,
        tokenMintB,
        tickSpacing
      );

      // Check if whirlpool exists
      const accountInfo = await this.connection.getAccountInfo(whirlpoolPda.publicKey);
      return accountInfo ? whirlpoolPda.publicKey : null;
    } catch (error) {
      logger.warn(`Error finding whirlpool for ${tokenA}/${tokenB}:`, error);
      return null;
    }
  }

  private getTokenMint(symbol: string): PublicKey | null {
    const TOKEN_MINTS: { [key: string]: string } = {
      'SOL': 'So11111111111111111111111111111111111111112',
      'USDC': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      'USDT': 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
      'RAY': '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
      'ORCA': 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE'
    };

    const mint = TOKEN_MINTS[symbol];
    return mint ? new PublicKey(mint) : null;
  }

  async getPrices(): Promise<TokenPrice[]> {
    if (!this.client) {
      logger.warn('Orca client not initialized');
      return [];
    }

    const prices: TokenPrice[] = [];
    const now = Date.now();

    for (const [pairKey, whirlpool] of this.whirlpools.entries()) {
      try {
        // Get whirlpool data
        const whirlpoolData = whirlpool.getData();
        const tokenAInfo = whirlpool.getTokenAInfo();
        const tokenBInfo = whirlpool.getTokenBInfo();

        // Calculate price from sqrt price
        const sqrtPrice = whirlpoolData.sqrtPrice;
        const price = this.sqrtPriceToPrice(sqrtPrice, tokenAInfo.decimals, tokenBInfo.decimals);

        // Calculate liquidity
        const liquidity = whirlpoolData.liquidity.toNumber();

        // Add price for token A in terms of token B
        const tokenAPrice: TokenPrice = {
          symbol: this.getSymbolFromMint(tokenAInfo.mint.toString()) || 'UNKNOWN',
          mint: tokenAInfo.mint.toString(),
          price: price,
          source: 'Orca',
          timestamp: now,
          liquidity: liquidity
        };

        // Add price for token B in terms of token A (inverse)
        const tokenBPrice: TokenPrice = {
          symbol: this.getSymbolFromMint(tokenBInfo.mint.toString()) || 'UNKNOWN',
          mint: tokenBInfo.mint.toString(),
          price: 1 / price,
          source: 'Orca',
          timestamp: now,
          liquidity: liquidity
        };

        prices.push(tokenAPrice, tokenBPrice);

        // Cache prices
        this.priceCache.set(`${tokenAPrice.symbol}-Orca`, tokenAPrice);
        this.priceCache.set(`${tokenBPrice.symbol}-Orca`, tokenBPrice);

      } catch (error) {
        logger.warn(`Failed to get price for ${pairKey}:`, error);
      }
    }

    logger.debug(`Retrieved ${prices.length} prices from Orca`);
    return prices;
  }

  private sqrtPriceToPrice(sqrtPrice: any, decimalsA: number, decimalsB: number): number {
    // Convert BN to number safely
    const sqrtPriceNumber = sqrtPrice.toNumber ? sqrtPrice.toNumber() : Number(sqrtPrice);
    
    // Calculate price from sqrt price
    const price = Math.pow(sqrtPriceNumber / (2 ** 64), 2);
    
    // Adjust for decimal differences
    return price * Math.pow(10, decimalsB - decimalsA);
  }

  private getSymbolFromMint(mint: string): string | null {
    const MINT_TO_SYMBOL: { [key: string]: string } = {
      'So11111111111111111111111111111111111111112': 'SOL',
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 'USDC',
      'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 'USDT',
      '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R': 'RAY',
      'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE': 'ORCA'
    };

    return MINT_TO_SYMBOL[mint] || null;
  }

  async executeSwap(
    inputMint: string,
    outputMint: string,
    amount: number,
    slippage: number = 0.01
  ): Promise<TradeResult> {
    if (!this.client) {
      return { success: false, error: 'Orca client not initialized' };
    }

    try {
      logger.debug(`Executing Orca swap: ${amount} ${inputMint} -> ${outputMint}`);

      // Find appropriate whirlpool
      const whirlpool = this.findWhirlpoolForSwap(inputMint, outputMint);
      if (!whirlpool) {
        return { success: false, error: 'No suitable whirlpool found' };
      }

      // Get quote
      const inputToken = this.getTokenMint(this.getSymbolFromMint(inputMint) || '');
      const outputToken = this.getTokenMint(this.getSymbolFromMint(outputMint) || '');

      if (!inputToken || !outputToken) {
        return { success: false, error: 'Token mints not found' };
      }

      // Calculate amount in token units
      const tokenInfo = whirlpool.getTokenAInfo().mint.equals(inputToken) ? 
        whirlpool.getTokenAInfo() : whirlpool.getTokenBInfo();
      const amountIn = Math.floor(amount * Math.pow(10, tokenInfo.decimals));

      // Get swap quote
      const aToB = whirlpool.getTokenAInfo().mint.equals(inputToken);
      const quote = await this.client.getSwapQuote(
        whirlpool.getAddress(),
        aToB,
        amountIn,
        slippage * 10000 // Convert to basis points
      );

      if (!quote) {
        return { success: false, error: 'Could not get swap quote' };
      }

      // Execute swap
      const swapTx = await this.client.swap(
        whirlpool.getAddress(),
        aToB,
        amountIn,
        quote.estimatedAmountOut,
        this.wallet.publicKey
      );

      // Sign and send transaction
      swapTx.sign([this.wallet]);
      const signature = await this.connection.sendTransaction(swapTx);

      // Wait for confirmation
      await this.connection.confirmTransaction(signature, 'confirmed');

      return {
        success: true,
        signature,
        gasCost: 0.003 // Estimated gas cost in SOL
      };

    } catch (error) {
      logger.error('Orca swap failed:', error);
      return { success: false, error: String(error) };
    }
  }

  private findWhirlpoolForSwap(inputMint: string, outputMint: string): Whirlpool | null {
    const inputSymbol = this.getSymbolFromMint(inputMint);
    const outputSymbol = this.getSymbolFromMint(outputMint);

    if (!inputSymbol || !outputSymbol) return null;

    // Try direct pair
    let pairKey = `${inputSymbol}/${outputSymbol}`;
    if (this.whirlpools.has(pairKey)) {
      return this.whirlpools.get(pairKey)!;
    }

    // Try reverse pair
    pairKey = `${outputSymbol}/${inputSymbol}`;
    if (this.whirlpools.has(pairKey)) {
      return this.whirlpools.get(pairKey)!;
    }

    return null;
  }

  async getPoolLiquidity(tokenA: string, tokenB: string): Promise<number> {
    const whirlpool = this.findWhirlpoolForSwap(
      this.getTokenMint(tokenA)?.toString() || '',
      this.getTokenMint(tokenB)?.toString() || ''
    );

    if (!whirlpool) return 0;

    try {
      const data = whirlpool.getData();
      return data.liquidity.toNumber();
    } catch (error) {
      logger.warn(`Failed to get liquidity for ${tokenA}/${tokenB}:`, error);
      return 0;
    }
  }

  getCachedPrice(symbol: string): TokenPrice | null {
    return this.priceCache.get(`${symbol}-Orca`) || null;
  }

  getAvailablePairs(): string[] {
    return Array.from(this.whirlpools.keys());
  }

  async refreshPools(): Promise<void> {
    logger.info('Refreshing Orca whirlpools...');
    await this.loadCommonWhirlpools();
  }

  getHealthStatus(): { healthy: boolean; pools: number; lastUpdate: number } {
    return {
      healthy: this.client !== null && this.whirlpools.size > 0,
      pools: this.whirlpools.size,
      lastUpdate: Math.max(...Array.from(this.priceCache.values()).map(p => p.timestamp))
    };
  }
}
