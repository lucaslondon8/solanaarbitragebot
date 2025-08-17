import { Connection, Keypair, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';
import { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction } from '@solana/spl-token';
import axios from 'axios';
import WebSocket from 'ws';
import { Logger } from './utils/logger';
import { configManager, BotConfig } from './utils/config';

// Initialize logger and config
const logger = Logger.getInstance();
const config = configManager.getConfig();

// Initialize connection and wallet
const connection = new Connection(config.rpc.primary, 'confirmed');
const keypair = Keypair.fromSecretKey(new Uint8Array(JSON.parse(config.wallet.privateKey)));

// Types
interface TokenPrice {
  symbol: string;
  mint: string;
  price: number;
  source: string;
  timestamp: number;
  liquidity?: number;
  volume24h?: number;
}

interface ArbitrageOpportunity {
  tokenA: string;
  tokenB: string;
  buyExchange: string;
  sellExchange: string;
  buyPrice: number;
  sellPrice: number;
  profitPercent: number;
  estimatedProfit: number;
  tradeSize: number;
  confidence: number; // 0-1 confidence score
}

interface TradeResult {
  success: boolean;
  signature?: string;
  error?: string;
  profitRealized?: number;
  gasCost?: number;
  executionTime?: number;
}

// Token mint addresses
const TOKEN_MINTS: { [key: string]: string } = {
  'SOL': 'So11111111111111111111111111111111111111112',
  'USDC': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'USDT': 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  'RAY': '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
  'ORCA': 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE',
  'MNGO': 'MangoCzJ36AjZyKwVj3VnYU4GTonjfVEnJmvvWaxLac',
  'SRM': 'SRMuApVNdxXokk5GT7XD5cUUgXMBCoAz2LHeuAoKWRt'
};

// Market Data Manager
class MarketDataManager {
  private priceCache: Map<string, TokenPrice[]> = new Map();
  private wsConnections: WebSocket[] = [];
  private updateInterval?: NodeJS.Timeout;

  async initialize() {
    logger.info('🔄 Initializing market data connections...');
    
    try {
      // Initialize price feeds from multiple sources
      await Promise.all([
        this.initializeJupiterPrices(),
        this.initializeOrcaPrices(),
        this.initializeRaydiumPrices()
      ]);
      
      // Set up periodic price updates
      this.setupPeriodicUpdates();
      
      logger.info('✅ Market data connections established');
    } catch (error) {
      logger.error('❌ Failed to initialize market data', error);
      throw error;
    }
  }

  private async initializeJupiterPrices() {
    try {
      const tokenIds = config.trading.supportedTokens.join(',');
      const response = await axios.get(`https://price.jup.ag/v4/price?ids=${tokenIds}`, {
        timeout: 10000
      });
      
      const prices = response.data.data;
      
      for (const [symbol, data] of Object.entries(prices as any)) {
        if (config.trading.supportedTokens.includes(symbol)) {
          const tokenPrice: TokenPrice = {
            symbol,
            mint: TOKEN_MINTS[symbol] || '',
            price: data.price,
            source: 'Jupiter',
            timestamp: Date.now(),
            liquidity: data.liquidity,
            volume24h: data.volume24h
          };
          
          this.updatePrice(tokenPrice);
        }
      }
      
      logger.debug('Jupiter prices updated', { count: Object.keys(prices).length });
    } catch (error) {
      logger.warn('Failed to fetch Jupiter prices', error);
    }
  }

  private async initializeOrcaPrices() {
    try {
      // Placeholder for Orca API integration
      // In production, integrate with @orca-so/sdk
      const mockPrices = config.trading.supportedTokens.map(symbol => ({
        symbol,
        mint: TOKEN_MINTS[symbol] || '',
        price: Math.random() * 100, // Mock price
        source: 'Orca',
        timestamp: Date.now(),
        liquidity: Math.random() * 1000000
      }));

      mockPrices.forEach(price => this.updatePrice(price));
      logger.debug('Orca prices updated (mock)', { count: mockPrices.length });
    } catch (error) {
      logger.warn('Failed to fetch Orca prices', error);
    }
  }

  private async initializeRaydiumPrices() {
    try {
      // Placeholder for Raydium API integration
      // In production, integrate with @raydium-io/raydium-sdk
      const mockPrices = config.trading.supportedTokens.map(symbol => ({
        symbol,
        mint: TOKEN_MINTS[symbol] || '',
        price: Math.random() * 100, // Mock price
        source: 'Raydium',
        timestamp: Date.now(),
        liquidity: Math.random() * 1000000
      }));

      mockPrices.forEach(price => this.updatePrice(price));
      logger.debug('Raydium prices updated (mock)', { count: mockPrices.length });
    } catch (error) {
      logger.warn('Failed to fetch Raydium prices', error);
    }
  }

  private setupPeriodicUpdates() {
    this.updateInterval = setInterval(async () => {
      await this.initializeJupiterPrices();
      // Add other price updates as needed
    }, config.trading.checkInterval);
  }

  private updatePrice(tokenPrice: TokenPrice) {
    const key = `${tokenPrice.symbol}-${tokenPrice.source}`;
    const existing = this.priceCache.get(key) || [];
    
    // Keep only last 10 price points for each token-exchange pair
    existing.unshift(tokenPrice);
    if (existing.length > 10) existing.pop();
    
    this.priceCache.set(key, existing);
    
    logger.debug(`Price updated: ${tokenPrice.symbol} @ ${tokenPrice.price} on ${tokenPrice.source}`);
  }

  getPrices(symbol: string): TokenPrice[] {
    const prices: TokenPrice[] = [];
    
    for (const [key, priceList] of this.priceCache.entries()) {
      if (key.startsWith(symbol + '-') && priceList.length > 0) {
        prices.push(priceList[0]); // Get latest price
      }
    }
    
    return prices.filter(p => Date.now() - p.timestamp < 30000); // Only prices less than 30s old
  }

  getAllPrices(): Map<string, TokenPrice[]> {
    return new Map(this.priceCache);
  }

  cleanup() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
    this.wsConnections.forEach(ws => ws.close());
    logger.info('Market data connections cleaned up');
  }
}

// Enhanced Arbitrage Detection Engine
class ArbitrageDetector {
  constructor(private marketData: MarketDataManager) {}

  findOpportunities(): ArbitrageOpportunity[] {
    const opportunities: ArbitrageOpportunity[] = [];
    
    for (const token of config.trading.supportedTokens) {
      if (token === 'SOL') continue; // Skip base currency
      
      const prices = this.marketData.getPrices(token);
      
      if (prices.length < 2) {
        logger.debug(`Insufficient price data for ${token}`, { priceCount: prices.length });
        continue;
      }
      
      // Find best arbitrage opportunities between exchanges
      for (let i = 0; i < prices.length; i++) {
        for (let j = i + 1; j < prices.length; j++) {
          const price1 = prices[i];
          const price2 = prices[j];
          
          // Determine buy/sell sides
          const [buyPrice, sellPrice] = price1.price < price2.price ? 
            [price1, price2] : [price2, price1];
          
          const profitPercent = (sellPrice.price - buyPrice.price) / buyPrice.price;
          
          if (profitPercent >= config.trading.minProfitThreshold) {
            const tradeSize = this.calculateOptimalTradeSize(buyPrice, sellPrice);
            const confidence = this.calculateConfidence(buyPrice, sellPrice, profitPercent);
            
            if (tradeSize > 0 && confidence > 0.5) {
              opportunities.push({
                tokenA: token,
                tokenB: 'SOL',
                buyExchange: buyPrice.source,
                sellExchange: sellPrice.source,
                buyPrice: buyPrice.price,
                sellPrice: sellPrice.price,
                profitPercent,
                estimatedProfit: tradeSize * profitPercent,
                tradeSize,
                confidence
              });
            }
          }
        }
      }
    }
    
    // Sort by profit potential and confidence
    return opportunities
      .sort((a, b) => (b.profitPercent * b.confidence) - (a.profitPercent * a.confidence))
      .slice(0, 5); // Return top 5 opportunities
  }

  private calculateOptimalTradeSize(buyPrice: TokenPrice, sellPrice: TokenPrice): number {
    const minLiquidity = Math.min(
      buyPrice.liquidity || 10000,
      sellPrice.liquidity || 10000
    );
    
    // Use 1% of minimum liquidity, capped by max trade size
    const liquidityBasedSize = minLiquidity * 0.01;
    const maxAllowedSize = config.trading.maxTradeSizeSol;
    
    return Math.min(liquidityBasedSize, maxAllowedSize);
  }

  private calculateConfidence(buyPrice: TokenPrice, sellPrice: TokenPrice, profitPercent: number): number {
    let confidence = 0.5; // Base confidence
    
    // Higher confidence for larger profit margins
    confidence += Math.min(profitPercent * 10, 0.3);
    
    // Higher confidence for more liquid markets
    const avgLiquidity = ((buyPrice.liquidity || 0) + (sellPrice.liquidity || 0)) / 2;
    confidence += Math.min(avgLiquidity / 1000000, 0.2);
    
    // Lower confidence for stale prices
    const avgAge = (Date.now() - buyPrice.timestamp + Date.now() - sellPrice.timestamp) / 2;
    confidence -= Math.min(avgAge / 10000, 0.3); // Reduce confidence for old prices
    
    return Math.max(0, Math.min(1, confidence));
  }
}

// Enhanced Trade Executor
class TradeExecutor {
  constructor(private connection: Connection, private wallet: Keypair) {}

  async executeArbitrage(opportunity: ArbitrageOpportunity): Promise<TradeResult> {
    const startTime = Date.now();
    logger.trade(`🚀 Executing arbitrage: ${opportunity.tokenA} | ${opportunity.buyExchange} → ${opportunity.sellExchange} | ${(opportunity.profitPercent * 100).toFixed(2)}% profit`);
    
    try {
      // Step 1: Execute buy order
      logger.debug(`Executing buy on ${opportunity.buyExchange}`);
      const buyResult = await this.executeTrade(
        'buy',
        opportunity.tokenA,
        opportunity.tradeSize,
        opportunity.buyExchange
      );
      
      if (!buyResult.success) {
        logger.error(`Buy failed on ${opportunity.buyExchange}`, { error: buyResult.error });
        return { success: false, error: `Buy failed: ${buyResult.error}` };
      }
      
      // Wait for buy confirmation
      if (buyResult.signature) {
        await this.waitForConfirmation(buyResult.signature);
        logger.debug(`Buy confirmed: ${buyResult.signature}`);
      }
      
      // Step 2: Execute sell order
      logger.debug(`Executing sell on ${opportunity.sellExchange}`);
      const sellResult = await this.executeTrade(
        'sell',
        opportunity.tokenA,
        opportunity.tradeSize,
        opportunity.sellExchange
      );
      
      if (!sellResult.success) {
        logger.error(`Sell failed on ${opportunity.sellExchange}`, { error: sellResult.error });
        // TODO: Implement rollback logic
        return { success: false, error: `Sell failed: ${sellResult.error}` };
      }
      
      if (sellResult.signature) {
        await this.waitForConfirmation(sellResult.signature);
        logger.debug(`Sell confirmed: ${sellResult.signature}`);
      }
      
      const executionTime = Date.now() - startTime;
      const totalGasCost = (buyResult.gasCost || 0) + (sellResult.gasCost || 0);
      const netProfit = opportunity.estimatedProfit - totalGasCost;
      
      logger.profit(netProfit);
      
      return {
        success: true,
        signature: sellResult.signature,
        profitRealized: netProfit,
        gasCost: totalGasCost,
        executionTime
      };
      
    } catch (error) {
      logger.error('❌ Arbitrage execution failed', error);
      return { 
        success: false, 
        error: String(error),
        executionTime: Date.now() - startTime
      };
    }
  }

  private async executeTrade(
    side: 'buy' | 'sell',
    token: string,
    amount: number,
    exchange: string
  ): Promise<TradeResult> {
    
    switch (exchange) {
      case 'Jupiter':
        return await this.executeJupiterTrade(side, token, amount);
      case 'Orca':
        return await this.executeOrcaTrade(side, token, amount);
      case 'Raydium':
        return await this.executeRaydiumTrade(side, token, amount);
      default:
        return { success: false, error: `Unsupported exchange: ${exchange}` };
    }
  }

  private async executeJupiterTrade(side: 'buy' | 'sell', token: string, amount: number): Promise<TradeResult> {
    try {
      const inputMint = side === 'buy' ? TOKEN_MINTS['SOL'] : TOKEN_MINTS[token];
      const outputMint = side === 'buy' ? TOKEN_MINTS[token] : TOKEN_MINTS['SOL'];
      const amountLamports = Math.floor(amount * 1e9);
      
      // Get Jupiter quote
      const quoteResponse = await axios.get(`https://quote-api.jup.ag/v6/quote`, {
        params: {
          inputMint,
          outputMint,
          amount: amountLamports,
          slippageBps: Math.floor(config.trading.slippageTolerance * 10000)
        },
        timeout: 10000
      });
      
      if (!quoteResponse.data) {
        return { success: false, error: 'No Jupiter quote available' };
      }
      
      // Get swap transaction
      const swapResponse = await axios.post('https://quote-api.jup.ag/v6/swap', {
        quoteResponse: quoteResponse.data,
        userPublicKey: this.wallet.publicKey.toString(),
        wrapAndUnwrapSol: true
      }, { timeout: 10000 });
      
      const swapTransactionBuf = Buffer.from(swapResponse.data.swapTransaction, 'base64');
      const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
      
      // Sign and send transaction
      transaction.sign([this.wallet]);
      const signature = await this.connection.sendTransaction(transaction, {
        maxRetries: 3,
        preflightCommitment: 'processed'
      });
      
      return { 
        success: true, 
        signature,
        gasCost: 0.005 // Estimated gas cost in SOL
      };
      
    } catch (error) {
      logger.error(`Jupiter trade failed: ${side} ${token}`, error);
      return { success: false, error: String(error) };
    }
  }

  private async executeOrcaTrade(side: 'buy' | 'sell', token: string, amount: number): Promise<TradeResult> {
    try {
      // Placeholder for Orca integration using @orca-so/sdk
      // In production, implement actual Orca swap logic
      logger.debug(`Executing ${side} on Orca for ${token}: ${amount} SOL`);
      
      // Simulate trade execution time
      await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));
      
      // Simulate success/failure (90% success rate)
      const success = Math.random() > 0.1;
      
      if (success) {
        return { 
          success: true, 
          signature: `orca_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          gasCost: 0.003
        };
      } else {
        return { success: false, error: 'Simulated Orca trade failure' };
      }
      
    } catch (error) {
      logger.error(`Orca trade failed: ${side} ${token}`, error);
      return { success: false, error: String(error) };
    }
  }

  private async executeRaydiumTrade(side: 'buy' | 'sell', token: string, amount: number): Promise<TradeResult> {
    try {
      // Placeholder for Raydium integration using @raydium-io/raydium-sdk
      // In production, implement actual Raydium swap logic
      logger.debug(`Executing ${side} on Raydium for ${token}: ${amount} SOL`);
      
      // Simulate trade execution time
      await new Promise(resolve => setTimeout(resolve, 800 + Math.random() * 1500));
      
      // Simulate success/failure (85% success rate)
      const success = Math.random() > 0.15;
      
      if (success) {
        return { 
          success: true, 
          signature: `raydium_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          gasCost: 0.004
        };
      } else {
        return { success: false, error: 'Simulated Raydium trade failure' };
      }
      
    } catch (error) {
      logger.error(`Raydium trade failed: ${side} ${token}`, error);
      return { success: false, error: String(error) };
    }
  }

  private async waitForConfirmation(signature: string, maxRetries = 30) {
    for (let i = 0; i < maxRetries; i++) {
      try {
        const confirmation = await this.connection.confirmTransaction(signature, 'confirmed');
        if (confirmation.value.err) {
          throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
        }
        return;
      } catch (error) {
        if (i === maxRetries - 1) throw error;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }
}

// Enhanced Risk Management
class RiskManager {
  private dailyTrades = 0;
  private dailyProfit = 0;
  private dailyLoss = 0;
  private lastResetDate = new Date().toDateString();
  private recentTrades: TradeResult[] = [];
  private emergencyStop = false;

  constructor(
    private maxDailyTrades = config.risk.maxDailyTrades,
    private maxDailyLoss = config.risk.maxDailyLoss,
    private maxSingleTradeSize = config.risk.maxSingleTradeSize,
    private emergencyStopLoss = config.risk.emergencyStopLoss
  ) {}

  canExecuteTrade(opportunity: ArbitrageOpportunity): { allowed: boolean; reason?: string } {
    this.resetDailyCountersIfNeeded();

    // Check emergency stop
    if (this.emergencyStop) {
      return { allowed: false, reason: 'Emergency stop activated' };
    }

    // Check daily trade limit
    if (this.dailyTrades >= this.maxDailyTrades) {
      return { allowed: false, reason: 'Daily trade limit reached' };
    }

    // Check daily loss limit
    if (this.dailyLoss >= this.maxDailyLoss) {
      return { allowed: false, reason: 'Daily loss limit reached' };
    }

    // Check single trade size
    if (opportunity.tradeSize > this.maxSingleTradeSize) {
      return { allowed: false, reason: `Trade size (${opportunity.tradeSize}) exceeds limit (${this.maxSingleTradeSize})` };
    }

    // Check minimum profit threshold
    if (opportunity.profitPercent < config.trading.minProfitThreshold) {
      return { allowed: false, reason: 'Profit below threshold' };
    }

    // Check recent performance (avoid trading if recent trades were mostly losses)
    const recentLossRate = this.getRecentLossRate();
    if (recentLossRate > 0.7 && this.recentTrades.length >= 10) {
      return { allowed: false, reason: 'High recent loss rate, pausing trading' };
    }

    // Check confidence threshold
    if (opportunity.confidence < 0.6) {
      return { allowed: false, reason: 'Opportunity confidence too low' };
    }

    return { allowed: true };
  }

  recordTrade(result: TradeResult, opportunity: ArbitrageOpportunity) {
    this.dailyTrades++;
    this.recentTrades.unshift(result);
    
    // Keep only last 20 trades for analysis
    if (this.recentTrades.length > 20) {
      this.recentTrades.pop();
    }
    
    if (result.success && result.profitRealized !== undefined) {
      if (result.profitRealized > 0) {
        this.dailyProfit += result.profitRealized;
        logger.info(`✅ Trade successful: +${result.profitRealized.toFixed(6)} SOL`);
      } else {
        this.dailyLoss += Math.abs(result.profitRealized);
        logger.warn(`❌ Trade resulted in loss: -${Math.abs(result.profitRealized).toFixed(6)} SOL`);
      }
    } else {
      // Estimate loss for failed trades (gas costs)
      const estimatedLoss = result.gasCost || 0.005;
      this.dailyLoss += estimatedLoss;
      logger.warn(`❌ Trade failed: estimated loss ${estimatedLoss.toFixed(6)} SOL`);
    }

    // Check for emergency stop conditions
    this.checkEmergencyStop();
    
    // Log trade details
    logger.trade('Trade recorded', {
      success: result.success,
      profit: result.profitRealized?.toFixed(6),
      gasCost: result.gasCost?.toFixed(6),
      executionTime: result.executionTime,
      token: opportunity.tokenA,
      exchanges: `${opportunity.buyExchange} → ${opportunity.sellExchange}`
    });
  }

  private checkEmergencyStop() {
    const netLoss = this.dailyLoss - this.dailyProfit;
    if (netLoss >= this.emergencyStopLoss) {
      this.emergencyStop = true;
      logger.error(`🚨 EMERGENCY STOP ACTIVATED! Net loss: ${netLoss.toFixed(6)} SOL`);
    }
  }

  private getRecentLossRate(): number {
    if (this.recentTrades.length === 0) return 0;
    
    const losses = this.recentTrades.filter(trade => 
      !trade.success || (trade.profitRealized !== undefined && trade.profitRealized <= 0)
    ).length;
    
    return losses / this.recentTrades.length;
  }

  private resetDailyCountersIfNeeded() {
    const today = new Date().toDateString();
    if (today !== this.lastResetDate) {
      logger.info('📊 Daily counters reset', {
        previousProfit: this.dailyProfit.toFixed(6),
        previousLoss: this.dailyLoss.toFixed(6),
        previousTrades: this.dailyTrades
      });
      
      this.dailyTrades = 0;
      this.dailyProfit = 0;
      this.dailyLoss = 0;
      this.lastResetDate = today;
      this.emergencyStop = false; // Reset emergency stop daily
    }
  }

  getStats() {
    const recentSuccessRate = this.recentTrades.length > 0 ? 
      this.recentTrades.filter(t => t.success).length / this.recentTrades.length : 0;
    
    return {
      dailyTrades: this.dailyTrades,
      dailyProfit: this.dailyProfit,
      dailyLoss: this.dailyLoss,
      netProfit: this.dailyProfit - this.dailyLoss,
      recentSuccessRate: recentSuccessRate * 100,
      emergencyStop: this.emergencyStop,
      tradesRemaining: this.maxDailyTrades - this.dailyTrades
    };
  }

  reset() {
    this.emergencyStop = false;
    logger.warn('Risk manager manually reset');
  }
}

// Performance Monitor
class PerformanceMonitor {
  private startTime = Date.now();
  private totalOpportunities = 0;
  private executedTrades = 0;
  private totalProfit = 0;
  private totalLoss = 0;
  private maxDrawdown = 0;
  private peakProfit = 0;

  recordOpportunity() {
    this.totalOpportunities++;
  }

  recordTrade(result: TradeResult) {
    this.executedTrades++;
    
    if (result.success && result.profitRealized !== undefined) {
      if (result.profitRealized > 0) {
        this.totalProfit += result.profitRealized;
      } else {
        this.totalLoss += Math.abs(result.profitRealized);
      }
    }

    // Update drawdown tracking
    const netProfit = this.totalProfit - this.totalLoss;
    if (netProfit > this.peakProfit) {
      this.peakProfit = netProfit;
    }
    
    const currentDrawdown = this.peakProfit - netProfit;
    if (currentDrawdown > this.maxDrawdown) {
      this.maxDrawdown = currentDrawdown;
    }
  }

  getStats() {
    const runtime = (Date.now() - this.startTime) / 1000 / 60; // minutes
    const executionRate = this.totalOpportunities > 0 ? 
      (this.executedTrades / this.totalOpportunities) * 100 : 0;
    
    return {
      runtime: runtime,
      totalOpportunities: this.totalOpportunities,
      executedTrades: this.executedTrades,
      executionRate: executionRate,
      totalProfit: this.totalProfit,
      totalLoss: this.totalLoss,
      netProfit: this.totalProfit - this.totalLoss,
      maxDrawdown: this.maxDrawdown,
      avgProfitPerTrade: this.executedTrades > 0 ? 
        (this.totalProfit - this.totalLoss) / this.executedTrades : 0
    };
  }
}

// Main Bot Class
class SolanaArbitrageBot {
  private marketData: MarketDataManager;
  private detector: ArbitrageDetector;
  private executor: TradeExecutor;
  private riskManager: RiskManager;
  private performanceMonitor: PerformanceMonitor;
  private isRunning = false;

  constructor() {
    this.marketData = new MarketDataManager();
    this.detector = new ArbitrageDetector(this.marketData);
    this.executor = new TradeExecutor(connection, keypair);
    this.riskManager = new RiskManager();
    this.performanceMonitor = new PerformanceMonitor();
  }

  async start() {
    try {
      logger.info('🤖 Starting Solana Arbitrage Bot...');
      logger.info(`💰 Wallet: ${keypair.publicKey.toString()}`);
      logger.info(`🌐 Network: ${config.isDevelopment() ? 'Devnet' : 'Mainnet'}`);
      
      // Check initial balance
      const balance = await connection.getBalance(keypair.publicKey);
      if (balance < 0.01 * 1e9) { // Less than 0.01 SOL
        throw new Error('Insufficient wallet balance. Need at least 0.01 SOL.');
      }
      
      logger.info(`💎 Initial balance: ${(balance / 1e9).toFixed(6)} SOL`);
      
      // Initialize market data
      await this.marketData.initialize();
      
      this.isRunning = true;
      logger.info('✅ Bot started successfully!');
      
      // Start main loop
      this.mainLoop();
      
      // Start periodic reporting
      this.startPeriodicReporting();
      
    } catch (error) {
      logger.error('💥 Bot failed to start', error);
      throw error;
    }
  }

  private async mainLoop() {
    let consecutiveErrors = 0;
    const maxConsecutiveErrors = 5;
    
    while (this.isRunning) {
      try {
        // Find arbitrage opportunities
        const opportunities = this.detector.findOpportunities();
        
        this.performanceMonitor.recordOpportunity();
        
        if (opportunities.length > 0) {
          logger.info(`🔍 Found ${opportunities.length} opportunities`);
          
          // Process best opportunity
          const bestOpportunity = opportunities[0];
          logger.info(`💡 Best: ${bestOpportunity.tokenA} | ${(bestOpportunity.profitPercent * 100).toFixed(2)}% | ${bestOpportunity.confidence.toFixed(2)} confidence`);
          
          // Check risk management
          const riskCheck = this.riskManager.canExecuteTrade(bestOpportunity);
          
          if (riskCheck.allowed) {
            logger.info('🚀 Executing trade...');
            
            // Execute the trade
            const result = await this.executor.executeArbitrage(bestOpportunity);
            
            // Record results
            this.riskManager.recordTrade(result, bestOpportunity);
            this.performanceMonitor.recordTrade(result);
            
            if (result.success) {
              logger.profit(result.profitRealized || 0);
            } else {
              logger.error(`Trade failed: ${result.error}`);
            }
            
            // Wait a bit longer after trade execution
            await new Promise(resolve => setTimeout(resolve, config.trading.checkInterval * 2));
          } else {
            logger.warn(`⚠️  Trade blocked: ${riskCheck.reason}`);
          }
        } else {
          logger.debug('No profitable opportunities found');
        }
        
        // Reset error counter on successful iteration
        consecutiveErrors = 0;
        
        // Wait before next iteration
        await new Promise(resolve => setTimeout(resolve, config.trading.checkInterval));
        
      } catch (error) {
        consecutiveErrors++;
        logger.error(`💥 Error in main loop (${consecutiveErrors}/${maxConsecutiveErrors})`, error);
        
        if (consecutiveErrors >= maxConsecutiveErrors) {
          logger.error('🛑 Too many consecutive errors, stopping bot');
          break;
        }
        
        // Exponential backoff on errors
        const backoffTime = Math.min(30000, 1000 * Math.pow(2, consecutiveErrors));
        await new Promise(resolve => setTimeout(resolve, backoffTime));
      }
    }
    
    logger.warn('Main loop exited');
  }

  private startPeriodicReporting() {
    setInterval(() => {
      const riskStats = this.riskManager.getStats();
      const perfStats = this.performanceMonitor.getStats();
      
      logger.info('\n📊 === BOT STATISTICS ===');
      logger.info(`⏱️  Runtime: ${perfStats.runtime.toFixed(1)} minutes`);
      logger.info(`🎯 Opportunities: ${perfStats.totalOpportunities} | Executed: ${perfStats.executedTrades} (${perfStats.executionRate.toFixed(1)}%)`);
      logger.info(`💰 P&L: +${perfStats.totalProfit.toFixed(6)} / -${perfStats.totalLoss.toFixed(6)} = ${perfStats.netProfit.toFixed(6)} SOL`);
      logger.info(`📈 Avg/Trade: ${perfStats.avgProfitPerTrade.toFixed(6)} SOL | Max Drawdown: ${perfStats.maxDrawdown.toFixed(6)} SOL`);
      logger.info(`📊 Daily: ${riskStats.dailyTrades} trades | Success Rate: ${riskStats.recentSuccessRate.toFixed(1)}%`);
      logger.info(`⚖️  Risk: ${riskStats.tradesRemaining} trades remaining | Emergency Stop: ${riskStats.emergencyStop ? '🚨 YES' : '✅ No'}`);
      logger.info('========================\n');
    }, 60000); // Report every minute
  }

  async stop() {
    logger.info('🛑 Stopping bot...');
    this.isRunning = false;
    this.marketData.cleanup();
    
    // Final statistics
    const finalStats = this.performanceMonitor.getStats();
    logger.info('📊 Final Statistics:', finalStats);
    
    logger.info('✅ Bot stopped successfully');
  }

  // Manual controls
  resetRiskManager() {
    this.riskManager.reset();
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      riskStats: this.riskManager.getStats(),
      performanceStats: this.performanceMonitor.getStats(),
      config: config
    };
  }
}

// Graceful shutdown handler
process.on('SIGINT', async () => {
  logger.warn('\n🛑 Received SIGINT, shutting down gracefully...');
  if (bot) {
    await bot.stop();
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.warn('\n🛑 Received SIGTERM, shutting down gracefully...');
  if (bot) {
    await bot.stop();
  }
  process.exit(0);
});

// Global error handlers
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

// Main execution
let bot: SolanaArbitrageBot;

async function main() {
  try {
    // Validate environment
    logger.info('🔧 Validating configuration...');
    logger.info(`📡 RPC: ${config.rpc.primary}`);
    logger.info(`💱 Supported tokens: ${config.trading.supportedTokens.join(', ')}`);
    logger.info(`⚙️  Min profit: ${(config.trading.minProfitThreshold * 100).toFixed(2)}%`);
    logger.info(`💰 Max trade size: ${config.trading.maxTradeSizeSol} SOL`);
    
    bot = new SolanaArbitrageBot();
    await bot.start();
    
  } catch (error) {
    logger.error('💥 Bot startup failed:', error);
    process.exit(1);
  }
}

// Start the bot
if (require.main === module) {
  main().catch(error => {
    logger.error('💥 Unhandled startup error:', error);
    process.exit(1);
  });
}

export { SolanaArbitrageBot, MarketDataManager, ArbitrageDetector, TradeExecutor, RiskManager };

console.log('🤖 Solana Arbitrage Bot loaded successfully!');
