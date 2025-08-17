import { Connection, PublicKey, Keypair, Transaction } from '@solana/web3.js';
import { 
  Liquidity, 
  LiquidityPoolKeys, 
  TokenAmount, 
  Token, 
  Percent,
  TxVersion,
  MARKET_STATE_LAYOUT_V3,
  Market
} from '@raydium-io/raydium-sdk';
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { TokenPrice, TradeResult } from '../types';
import { Logger } from '../utils/logger';
import axios from 'axios';

const logger = Logger.getInstance();

interface RaydiumPoolInfo {
  id: string;
  baseMint: string;
  quoteMint: string;
  lpMint: string;
  baseDecimals: number;
  quoteDecimals: number;
  lpDecimals: number;
  version: number;
  programId: string;
  authority: string;
  openOrders: string;
  targetOrders: string;
  baseVault: string;
  quoteVault: string;
  withdrawQueue: string;
  lpVault: string;
  marketVersion: number;
  marketProgramId: string;
  marketId: string;
  marketAuthority: string;
  marketBaseVault: string;
  marketQuoteVault: string;
  marketBids: string;
  marketAsks: string;
  marketEventQueue: string;
  lookupTableAccount?: string;
}

export class RealRaydiumIntegration {
  private pools: Map<string, LiquidityPoolKeys> = new Map();
  private poolsInfo: Map<string, RaydiumPoolInfo> = new Map();
  private priceCache: Map<string, TokenPrice> = new Map();
  private readonly RAYDIUM_API_URL = 'https://api.raydium.io/v2';

  constructor(
    private connection: Connection,
    private wallet: Keypair
  ) {}

  async initialize(): Promise<void> {
    try {
      logger.info('⚡ Initializing real Raydium integration...');

      // Load pool information from Raydium API
      await this.loadPoolsFromAPI();

      // Convert to LiquidityPoolKeys format
      await this.processPoolKeys();

      logger.info(`✅ Raydium integration initialized with ${this.pools.size} pools`);
    } catch (error) {
      logger.error('❌ Failed to initialize Raydium integration:', error);
      throw error;
    }
  }

  private async loadPoolsFromAPI(): Promise<void> {
    try {
      const response = await axios.get(`${this.RAYDIUM_API_URL}/sdk/liquidity/mainnet.json`, {
        timeout: 10000
      });

      const data = response.data;
      
      // Process official pools
      if (data.official && Array.isArray(data.official)) {
        for (const pool of data.official) {
          if (this.isValidPool(pool)) {
            this.poolsInfo.set(pool.id, pool);
          }
        }
      }

      // Process unOfficial pools (be more selective)
      if (data.unOfficial && Array.isArray(data.unOfficial)) {
        for (const pool of data.unOfficial) {
          if (this.isValidPool(pool) && this.isHighQualityPool(pool)) {
            this.poolsInfo.set(pool.id, pool);
          }
        }
      }

      logger.debug(`Loaded ${this.poolsInfo.size} pools from Raydium API`);
    } catch (error) {
      logger.error('Failed to load pools from Raydium API:', error);
      // Fallback to hardcoded pools
      this.loadFallbackPools();
    }
  }

  private isValidPool(pool: any): boolean {
    return (
      pool.id &&
      pool.baseMint &&
      pool.quoteMint &&
      pool.lpMint &&
      pool.version &&
      pool.programId &&
      pool.authority &&
      pool.baseVault &&
      pool.quoteVault &&
      pool.marketId
    );
  }

  private isHighQualityPool(pool: any): boolean {
    // Only include high-quality unofficial pools
    const supportedTokens = ['SOL', 'USDC', 'USDT', 'RAY', 'ORCA'];
    const baseSymbol = this.getSymbolFromMint(pool.baseMint);
    const quoteSymbol = this.getSymbolFromMint(pool.quoteMint);
    
    return (
      supportedTokens.includes(baseSymbol || '') ||
      supportedTokens.includes(quoteSymbol || '')
    );
  }

  private loadFallbackPools(): void {
    // Hardcoded pool information for critical pairs
    const fallbackPools = [
      {
        id: '58oQChx4yWmvKdwLLZzBi4ChoCc2fqbAaGMA3LdN2gq7',
        baseMint: 'So11111111111111111111111111111111111111112', // SOL
        quoteMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
        lpMint: '8HoQnePLqPj4M7PUDzfw8e3Ymdwgc7NLGnaMUapubyvu',
        baseDecimals: 9,
        quoteDecimals: 6,
        version: 4,
        programId: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8'
      }
    ];

    fallbackPools.forEach(pool => {
      this.poolsInfo.set(pool.id, pool as any);
    });

    logger.warn('Using fallback pools due to API failure');
  }

  private async processPoolKeys(): Promise<void> {
    for (const [poolId, poolInfo] of this.poolsInfo.entries()) {
      try {
        const poolKeys = await this.convertToPoolKeys(poolInfo);
        if (poolKeys) {
          this.pools.set(poolId, poolKeys);
          
          // Create pair identifier
          const baseSymbol = this.getSymbolFromMint(poolInfo.baseMint);
          const quoteSymbol = this.getSymbolFromMint(poolInfo.quoteMint);
          if (baseSymbol && quoteSymbol) {
            const pairKey = `${baseSymbol}/${quoteSymbol}`;
            this.pools.set(pairKey, poolKeys);
          }
        }
      } catch (error) {
        logger.warn(`Failed to process pool ${poolId}:`, error);
      }
    }
  }

  private async convertToPoolKeys(poolInfo: RaydiumPoolInfo): Promise<LiquidityPoolKeys | null> {
    try {
      const poolKeys: LiquidityPoolKeys = {
        id: new PublicKey(poolInfo.id),
        baseMint: new PublicKey(poolInfo.baseMint),
        quoteMint: new PublicKey(poolInfo.quoteMint),
        lpMint: new PublicKey(poolInfo.lpMint),
        baseDecimals: poolInfo.baseDecimals,
        quoteDecimals: poolInfo.quoteDecimals,
        lpDecimals: poolInfo.lpDecimals,
        version: poolInfo.version,
        programId: new PublicKey(poolInfo.programId),
        authority: new PublicKey(poolInfo.authority),
        openOrders: new PublicKey(poolInfo.openOrders),
        targetOrders: new PublicKey(poolInfo.targetOrders),
        baseVault: new PublicKey(poolInfo.baseVault),
        quoteVault: new PublicKey(poolInfo.quoteVault),
        withdrawQueue: new PublicKey(poolInfo.withdrawQueue),
        lpVault: new PublicKey(poolInfo.lpVault),
        marketVersion: poolInfo.marketVersion,
        marketProgramId: new PublicKey(poolInfo.marketProgramId),
        marketId: new PublicKey(poolInfo.marketId),
        marketAuthority: new PublicKey(poolInfo.marketAuthority),
        marketBaseVault: new PublicKey(poolInfo.marketBaseVault),
        marketQuoteVault: new PublicKey(poolInfo.marketQuoteVault),
        marketBids: new PublicKey(poolInfo.marketBids),
        marketAsks: new PublicKey(poolInfo.marketAsks),
        marketEventQueue: new PublicKey(poolInfo.marketEventQueue),
        lookupTableAccount: poolInfo.lookupTableAccount ? new PublicKey(poolInfo.lookupTableAccount) : PublicKey.default
      };

      return poolKeys;
    } catch (error) {
      logger.warn(`Error converting pool keys for ${poolInfo.id}:`, error);
      return null;
    }
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

  async getPrices(): Promise<TokenPrice[]> {
    const prices: TokenPrice[] = [];
    const now = Date.now();

    for (const [pairKey, poolKeys] of this.pools.entries()) {
      if (!pairKey.includes('/')) continue; // Skip non-pair keys

      try {
        // Fetch pool info
        const poolInfo = await Liquidity.fetchInfo({
          connection: this.connection,
          poolKeys
        });

        if (!poolInfo) continue;

        const baseSymbol = this.getSymbolFromMint(poolKeys.baseMint.toString());
        const quoteSymbol = this.getSymbolFromMint(poolKeys.quoteMint.toString());

        if (!baseSymbol || !quoteSymbol) continue;

        // Calculate price from reserves
        const baseReserve = poolInfo.baseReserve.toNumber() / Math.pow(10, poolKeys.baseDecimals);
        const quoteReserve = poolInfo.quoteReserve.toNumber() / Math.pow(10, poolKeys.quoteDecimals);
        
        if (baseReserve === 0 || quoteReserve === 0) continue;

        const basePrice = quoteReserve / baseReserve; // Price of base in quote
        const quotePrice = baseReserve / quoteReserve; // Price of quote in base

        // Calculate liquidity (simplified TVL in USD terms)
        const liquidity = baseReserve + quoteReserve;

        // Create price objects
        const basePriceObj: TokenPrice = {
          symbol: baseSymbol,
          mint: poolKeys.baseMint.toString(),
          price: basePrice,
          source: 'Raydium',
          timestamp: now,
          liquidity: liquidity
        };

        const quotePriceObj: TokenPrice = {
          symbol: quoteSymbol,
          mint: poolKeys.quoteMint.toString(),
          price: quotePrice,
          source: 'Raydium',
          timestamp: now,
          liquidity: liquidity
        };

        prices.push(basePriceObj, quotePriceObj);

        // Cache prices
        this.priceCache.set(`${baseSymbol}-Raydium`, basePriceObj);
        this.priceCache.set(`${quoteSymbol}-Raydium`, quotePriceObj);

      } catch (error) {
        logger.warn(`Failed to get Raydium price for ${pairKey}:`, error);
      }
    }

    logger.debug(`Retrieved ${prices.length} prices from Raydium`);
    return prices;
  }

  async executeSwap(
    inputMint: string,
    outputMint: string,
    amount: number,
    slippage: number = 0.01
  ): Promise<TradeResult> {
    try {
      logger.debug(`Executing Raydium swap: ${amount} ${inputMint} -> ${outputMint}`);

      // Find pool for the swap pair
      const poolKeys = this.findPoolForSwap(inputMint, outputMint);
      if (!poolKeys) {
        return { success: false, error: 'No suitable pool found' };
      }

      // Get pool info
      const poolInfo = await Liquidity.fetchInfo({
        connection: this.connection,
        poolKeys
      });

      if (!poolInfo) {
        return { success: false, error: 'Failed to fetch pool info' };
      }

      // Determine input/output tokens
      const inputToken = new Token(TOKEN_PROGRAM_ID, new PublicKey(inputMint), poolKeys.baseDecimals);
      const outputToken = new Token(TOKEN_PROGRAM_ID, new PublicKey(outputMint), poolKeys.quoteDecimals);

      // Calculate amounts
      const inputTokenAmount = new TokenAmount(inputToken, Math.floor(amount * Math.pow(10, inputToken.decimals)));

      // Get quote
      const { amountOut, minAmountOut } = Liquidity.computeAmountOut({
        poolKeys,
        poolInfo,
        amountIn: inputTokenAmount,
        currencyOut: outputToken,
        slippage: new Percent(Math.floor(slippage * 10000), 10000)
      });

      // Get user token accounts
      const inputTokenAccount = await getAssociatedTokenAddress(new PublicKey(inputMint), this.wallet.publicKey);
      const outputTokenAccount = await getAssociatedTokenAddress(new PublicKey(outputMint), this.wallet.publicKey);

      // Create swap instruction
      const { innerTransactions } = await Liquidity.makeSwapInstructionSimple({
        connection: this.connection,
        poolKeys,
        userKeys: {
          tokenAccountIn: inputTokenAccount,
          tokenAccountOut: outputTokenAccount,
          owner: this.wallet.publicKey,
        },
        amountIn: inputTokenAmount,
        amountOut: minAmountOut,
        fixedSide: 'in'
      });

      // Sign and send transaction
      const tx = new Transaction();
      for (const innerTx of innerTransactions) {
        tx.add(...innerTx.instructions);
      }

      tx.sign(this.wallet);
      const signature = await this.connection.sendTransaction(tx, [this.wallet]);

      // Wait for confirmation
      await this.connection.confirmTransaction(signature, 'confirmed');

      return {
        success: true,
        signature,
        gasCost: 0.004 // Estimated gas cost in SOL
      };

    } catch (error) {
      logger.error('Raydium swap failed:', error);
      return { success: false, error: String(error) };
    }
  }

  private findPoolForSwap(inputMint: string, outputMint: string): LiquidityPoolKeys | null {
    const inputSymbol = this.getSymbolFromMint(inputMint);
    const outputSymbol = this.getSymbolFromMint(outputMint);

    if (!inputSymbol || !outputSymbol) return null;

    // Try direct pair
    let pairKey = `${inputSymbol}/${outputSymbol}`;
    if (this.pools.has(pairKey)) {
      return this.pools.get(pairKey)!;
    }

    // Try reverse pair
    pairKey = `${outputSymbol}/${inputSymbol}`;
    if (this.pools.has(pairKey)) {
      return this.pools.get(pairKey)!;
    }

    return null;
  }

  async getPoolLiquidity(tokenA: string, tokenB: string): Promise<number> {
    const poolKeys = this.findPoolForSwap(
      this.getTokenMint(tokenA)?.toString() || '',
      this.getTokenMint(tokenB)?.toString() || ''
    );

    if (!poolKeys) return 0;

    try {
      const poolInfo = await Liquidity.fetchInfo({
        connection: this.connection,
        poolKeys
      });

      if (!poolInfo) return 0;

      const baseReserve = poolInfo.baseReserve.toNumber() / Math.pow(10, poolKeys.baseDecimals);
      const quoteReserve = poolInfo.quoteReserve.toNumber() / Math.pow(10, poolKeys.quoteDecimals);

      return baseReserve + quoteReserve; // Simplified TVL
    } catch (error) {
      logger.warn(`Failed to get liquidity for ${tokenA}/${tokenB}:`, error);
      return 0;
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

  getCachedPrice(symbol: string): TokenPrice | null {
    return this.priceCache.get(`${symbol}-Raydium`) || null;
  }

  getAvailablePairs(): string[] {
    return Array.from(this.pools.keys()).filter(key => key.includes('/'));
  }

  async refreshPools(): Promise<void> {
    logger.info('Refreshing Raydium pools...');
    await this.loadPoolsFromAPI();
    await this.processPoolKeys();
  }

  getHealthStatus(): { healthy: boolean; pools: number; lastUpdate: number } {
    return {
      healthy: this.pools.size > 0,
      pools: this.pools.size,
      lastUpdate: Math.max(...Array.from(this.priceCache.values()).map(p => p.timestamp))
    };
  }

  // Advanced features for better arbitrage detection
  async getDetailedPoolInfo(poolId: string): Promise<any> {
    const poolKeys = this.pools.get(poolId);
    if (!poolKeys) return null;

    try {
      const poolInfo = await Liquidity.fetchInfo({
        connection: this.connection,
        poolKeys
      });

      return {
        baseReserve: poolInfo.baseReserve.toNumber(),
        quoteReserve: poolInfo.quoteReserve.toNumber(),
        lpSupply: poolInfo.lpSupply.toNumber(),
        price: poolInfo.baseReserve.toNumber() / poolInfo.quoteReserve.toNumber()
      };
    } catch (error) {
      logger.warn(`Failed to get detailed pool info for ${poolId}:`, error);
      return null;
    }
  }

  async getSwapQuote(
    inputMint: string,
    outputMint: string,
    amount: number
  ): Promise<{ outputAmount: number; priceImpact: number } | null> {
    const poolKeys = this.findPoolForSwap(inputMint, outputMint);
    if (!poolKeys) return null;

    try {
      const poolInfo = await Liquidity.fetchInfo({
        connection: this.connection,
        poolKeys
      });

      if (!poolInfo) return null;

      const inputToken = new Token(TOKEN_PROGRAM_ID, new PublicKey(inputMint), poolKeys.baseDecimals);
      const outputToken = new Token(TOKEN_PROGRAM_ID, new PublicKey(outputMint), poolKeys.quoteDecimals);
      const inputTokenAmount = new TokenAmount(inputToken, Math.floor(amount * Math.pow(10, inputToken.decimals)));

      const { amountOut, priceImpact } = Liquidity.computeAmountOut({
        poolKeys,
        poolInfo,
        amountIn: inputTokenAmount,
        currencyOut: outputToken,
        slippage: new Percent(0, 10000) // 0% slippage for quote
      });

      return {
        outputAmount: amountOut.toNumber() / Math.pow(10, outputToken.decimals),
        priceImpact: priceImpact.toNumber()
      };
    } catch (error) {
      logger.warn(`Failed to get swap quote for ${inputMint}/${outputMint}:`, error);
      return null;
    }
  }
}
