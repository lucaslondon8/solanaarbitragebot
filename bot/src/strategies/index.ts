import { TokenPrice, ArbitrageOpportunity } from '../types';
import { Logger } from '../utils/logger';

const logger = Logger.getInstance();

export interface Strategy {
  name: string;
  findOpportunities(prices: Map<string, TokenPrice[]>): ArbitrageOpportunity[];
  getDescription(): string;
  getMinProfitThreshold(): number;
}

// Simple 2-DEX arbitrage
export class SimpleArbitrageStrategy implements Strategy {
  name = 'Simple Arbitrage';

  constructor(private minProfitThreshold: number = 0.01) {}

  findOpportunities(prices: Map<string, TokenPrice[]>): ArbitrageOpportunity[] {
    const opportunities: ArbitrageOpportunity[] = [];
    
    for (const [token, tokenPrices] of prices.entries()) {
      if (tokenPrices.length < 2) continue;
      
      // Find best buy and sell prices
      const sortedPrices = [...tokenPrices].sort((a, b) => a.price - b.price);
      const cheapest = sortedPrices[0];
      const mostExpensive = sortedPrices[sortedPrices.length - 1];
      
      const profitPercent = (mostExpensive.price - cheapest.price) / cheapest.price;
      
      if (profitPercent >= this.minProfitThreshold) {
        opportunities.push({
          tokenA: token,
          tokenB: 'SOL',
          buyExchange: cheapest.source,
          sellExchange: mostExpensive.source,
          buyPrice: cheapest.price,
          sellPrice: mostExpensive.price,
          profitPercent,
          estimatedProfit: 0, // Will be calculated later based on trade size
          tradeSize: 0, // Will be calculated later
          confidence: this.calculateConfidence(cheapest, mostExpensive, profitPercent)
        });
      }
    }
    
    return opportunities.sort((a, b) => b.profitPercent - a.profitPercent);
  }

  private calculateConfidence(buyPrice: TokenPrice, sellPrice: TokenPrice, profitPercent: number): number {
    let confidence = 0.5;
    
    // Higher confidence for larger profits
    confidence += Math.min(profitPercent * 5, 0.3);
    
    // Higher confidence for more liquid markets
    const avgLiquidity = ((buyPrice.liquidity || 0) + (sellPrice.liquidity || 0)) / 2;
    confidence += Math.min(avgLiquidity / 500000, 0.2);
    
    // Lower confidence for stale prices
    const maxAge = Math.max(Date.now() - buyPrice.timestamp, Date.now() - sellPrice.timestamp);
    confidence -= Math.min(maxAge / 10000, 0.3);
    
    return Math.max(0.1, Math.min(1, confidence));
  }

  getDescription(): string {
    return 'Simple price difference arbitrage between two exchanges';
  }

  getMinProfitThreshold(): number {
    return this.minProfitThreshold;
  }
}

// Triangular arbitrage (A->B->C->A)
export class TriangularArbitrageStrategy implements Strategy {
  name = 'Triangular Arbitrage';

  constructor(private minProfitThreshold: number = 0.005) {}

  findOpportunities(prices: Map<string, TokenPrice[]>): ArbitrageOpportunity[] {
    const opportunities: ArbitrageOpportunity[] = [];
    
    // Common triangular pairs on Solana
    const triangularPairs = [
      ['SOL', 'USDC', 'USDT'],
      ['SOL', 'RAY', 'USDC'],
      ['SOL', 'ORCA', 'USDC'],
      ['USDC', 'USDT', 'RAY']
    ];

    for (const [tokenA, tokenB, tokenC] of triangularPairs) {
      const pricesA = prices.get(tokenA) || [];
      const pricesB = prices.get(tokenB) || [];
      const pricesC = prices.get(tokenC) || [];

      if (pricesA.length === 0 || pricesB.length === 0 || pricesC.length === 0) continue;

      // Calculate triangular arbitrage for each exchange combination
      for (const exchangeA of this.getUniqueExchanges(pricesA)) {
        for (const exchangeB of this.getUniqueExchanges(pricesB)) {
          for (const exchangeC of this.getUniqueExchanges(pricesC)) {
            const opportunity = this.calculateTriangularOpportunity(
              tokenA, tokenB, tokenC,
              pricesA.find(p => p.source === exchangeA),
              pricesB.find(p => p.source === exchangeB),
              pricesC.find(p => p.source === exchangeC)
            );

            if (opportunity && opportunity.profitPercent >= this.minProfitThreshold) {
              opportunities.push(opportunity);
            }
          }
        }
      }
    }

    return opportunities.sort((a, b) => b.profitPercent - a.profitPercent);
  }

  private calculateTriangularOpportunity(
    tokenA: string, tokenB: string, tokenC: string,
    priceA?: TokenPrice, priceB?: TokenPrice, priceC?: TokenPrice
  ): ArbitrageOpportunity | null {
    if (!priceA || !priceB || !priceC) return null;

    // Calculate the triangular exchange rate
    // A -> B -> C -> A
    const exchangeRate = (1 / priceA.price) * (1 / priceB.price) * priceC.price;
    const profitPercent = exchangeRate - 1;

    if (profitPercent <= 0) return null;

    return {
      tokenA,
      tokenB,
      buyExchange: priceA.source,
      sellExchange: priceC.source,
      buyPrice: priceA.price,
      sellPrice: priceC.price,
      profitPercent,
      estimatedProfit: 0,
      tradeSize: 0,
      confidence: this.calculateTriangularConfidence([priceA, priceB, priceC], profitPercent)
    };
  }

  private calculateTriangularConfidence(prices: TokenPrice[], profitPercent: number): number {
    let confidence = 0.3; // Lower base confidence for more complex strategy
    
    // Higher confidence for larger profits
    confidence += Math.min(profitPercent * 10, 0.4);
    
    // Average liquidity across all legs
    const avgLiquidity = prices.reduce((sum, p) => sum + (p.liquidity || 0), 0) / prices.length;
    confidence += Math.min(avgLiquidity / 1000000, 0.2);
    
    // Penalty for price staleness
    const maxAge = Math.max(...prices.map(p => Date.now() - p.timestamp));
    confidence -= Math.min(maxAge / 5000, 0.2); // More strict for triangular
    
    return Math.max(0.1, Math.min(1, confidence));
  }

  private getUniqueExchanges(prices: TokenPrice[]): string[] {
    return [...new Set(prices.map(p => p.source))];
  }

  getDescription(): string {
    return 'Triangular arbitrage across three currency pairs (A->B->C->A)';
  }

  getMinProfitThreshold(): number {
    return this.minProfitThreshold;
  }
}

// Statistical arbitrage based on price deviations
export class StatisticalArbitrageStrategy implements Strategy {
  name = 'Statistical Arbitrage';
  private priceHistory: Map<string, number[]> = new Map();

  constructor(
    private minProfitThreshold: number = 0.008,
    private lookbackPeriod: number = 50,
    private stdDevThreshold: number = 2
  ) {}

  findOpportunities(prices: Map<string, TokenPrice[]>): ArbitrageOpportunity[] {
    const opportunities: ArbitrageOpportunity[] = [];
    
    // Update price history
    this.updatePriceHistory(prices);

    for (const [token, tokenPrices] of prices.entries()) {
      if (tokenPrices.length < 2) continue;

      const historicalPrices = this.priceHistory.get(token) || [];
      if (historicalPrices.length < this.lookbackPeriod) continue;

      // Calculate statistical metrics
      const mean = this.calculateMean(historicalPrices);
      const stdDev = this.calculateStdDev(historicalPrices, mean);

      // Find prices that deviate significantly from historical average
      for (const price of tokenPrices) {
        const zScore = Math.abs(price.price - mean) / stdDev;
        
        if (zScore >= this.stdDevThreshold) {
          // Find counter-party (price closer to mean)
          const normalPrice = tokenPrices.find(p => 
            p.source !== price.source && 
            Math.abs(p.price - mean) / stdDev < 1
          );

          if (normalPrice) {
            const profitPercent = Math.abs(price.price - normalPrice.price) / Math.min(price.price, normalPrice.price);
            
            if (profitPercent >= this.minProfitThreshold) {
              const [buyPrice, sellPrice] = price.price < normalPrice.price ? 
                [price, normalPrice] : [normalPrice, price];

              opportunities.push({
                tokenA: token,
                tokenB: 'SOL',
                buyExchange: buyPrice.source,
                sellExchange: sellPrice.source,
                buyPrice: buyPrice.price,
                sellPrice: sellPrice.price,
                profitPercent,
                estimatedProfit: 0,
                tradeSize: 0,
                confidence: this.calculateStatisticalConfidence(zScore, profitPercent, stdDev)
              });
            }
          }
        }
      }
    }

    return opportunities.sort((a, b) => b.confidence - a.confidence);
  }

  private updatePriceHistory(prices: Map<string, TokenPrice[]>) {
    for (const [token, tokenPrices] of prices.entries()) {
      if (tokenPrices.length === 0) continue;

      // Use average price across exchanges for historical data
      const avgPrice = tokenPrices.reduce((sum, p) => sum + p.price, 0) / tokenPrices.length;
      
      const history = this.priceHistory.get(token) || [];
      history.unshift(avgPrice);
      
      // Keep only recent history
      if (history.length > this.lookbackPeriod) {
        history.pop();
      }
      
      this.priceHistory.set(token, history);
    }
  }

  private calculateMean(values: number[]): number {
    return values.reduce((sum, val) => sum + val, 0) / values.length;
  }

  private calculateStdDev(values: number[], mean: number): number {
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    return Math.sqrt(variance);
  }

  private calculateStatisticalConfidence(zScore: number, profitPercent: number, stdDev: number): number {
    let confidence = 0.4;
    
    // Higher confidence for larger z-scores (more statistical significance)
    confidence += Math.min(zScore / 5, 0.3);
    
    // Higher confidence for larger profits
    confidence += Math.min(profitPercent * 3, 0.2);
    
    // Higher confidence for more volatile markets (higher std dev)
    confidence += Math.min(stdDev / 10, 0.1);
    
    return Math.max(0.1, Math.min(1, confidence));
  }

  getDescription(): string {
    return 'Statistical arbitrage based on price deviations from historical mean';
  }

  getMinProfitThreshold(): number {
    return this.minProfitThreshold;
  }
}

// MEV (Maximal Extractable Value) strategy
export class MEVStrategy implements Strategy {
  name = 'MEV Strategy';

  constructor(private minProfitThreshold: number = 0.015) {}

  findOpportunities(prices: Map<string, TokenPrice[]>): ArbitrageOpportunity[] {
    const opportunities: ArbitrageOpportunity[] = [];
    
    // Look for opportunities that can be front-run or back-run
    for (const [token, tokenPrices] of prices.entries()) {
      if (tokenPrices.length < 2) continue;

      // Identify potential large orders that might move the price
      const priceSpread = this.calculatePriceSpread(tokenPrices);
      const avgVolume = this.calculateAverageVolume(tokenPrices);

      if (priceSpread > 0.005 && avgVolume > 100000) { // 0.5% spread, $100k volume
        const sortedPrices = [...tokenPrices].sort((a, b) => a.price - b.price);
        const cheapest = sortedPrices[0];
        const mostExpensive = sortedPrices[sortedPrices.length - 1];
        
        const profitPercent = (mostExpensive.price - cheapest.price) / cheapest.price;
        
        if (profitPercent >= this.minProfitThreshold) {
          opportunities.push({
            tokenA: token,
            tokenB: 'SOL',
            buyExchange: cheapest.source,
            sellExchange: mostExpensive.source,
            buyPrice: cheapest.price,
            sellPrice: mostExpensive.price,
            profitPercent,
            estimatedProfit: 0,
            tradeSize: 0,
            confidence: this.calculateMEVConfidence(priceSpread, avgVolume, profitPercent)
          });
        }
      }
    }

    return opportunities.sort((a, b) => b.profitPercent - a.profitPercent);
  }

  private calculatePriceSpread(prices: TokenPrice[]): number {
    if (prices.length < 2) return 0;
    
    const sortedPrices = [...prices].sort((a, b) => a.price - b.price);
    const lowest = sortedPrices[0].price;
    const highest = sortedPrices[sortedPrices.length - 1].price;
    
    return (highest - lowest) / lowest;
  }

  private calculateAverageVolume(prices: TokenPrice[]): number {
    const validVolumes = prices.filter(p => p.volume24h).map(p => p.volume24h!);
    if (validVolumes.length === 0) return 0;
    
    return validVolumes.reduce((sum, vol) => sum + vol, 0) / validVolumes.length;
  }

  private calculateMEVConfidence(priceSpread: number, avgVolume: number, profitPercent: number): number {
    let confidence = 0.3; // Lower base confidence due to MEV competition
    
    // Higher confidence for larger spreads
    confidence += Math.min(priceSpread * 20, 0.3);
    
    // Higher confidence for higher volume markets
    confidence += Math.min(avgVolume / 1000000, 0.2);
    
    // Higher confidence for larger profits
    confidence += Math.min(profitPercent * 5, 0.2);
    
    return Math.max(0.1, Math.min(1, confidence));
  }

  getDescription(): string {
    return 'MEV-focused strategy targeting high-volume, high-spread opportunities';
  }

  getMinProfitThreshold(): number {
    return this.minProfitThreshold;
  }
}

// Strategy manager to coordinate multiple strategies
export class StrategyManager {
  private strategies: Strategy[] = [];
  private strategyWeights: Map<string, number> = new Map();

  constructor() {
    // Initialize default strategies
    this.addStrategy(new SimpleArbitrageStrategy(0.01), 0.4);
    this.addStrategy(new TriangularArbitrageStrategy(0.008), 0.3);
    this.addStrategy(new StatisticalArbitrageStrategy(0.008), 0.2);
    this.addStrategy(new MEVStrategy(0.015), 0.1);
  }

  addStrategy(strategy: Strategy, weight: number) {
    this.strategies.push(strategy);
    this.strategyWeights.set(strategy.name, weight);
    
    logger.info(`Added strategy: ${strategy.name} (weight: ${weight})`);
    logger.debug(`Strategy description: ${strategy.getDescription()}`);
  }

  findOpportunities(prices: Map<string, TokenPrice[]>): ArbitrageOpportunity[] {
    const allOpportunities: ArbitrageOpportunity[] = [];
    
    for (const strategy of this.strategies) {
      try {
        const opportunities = strategy.findOpportunities(prices);
        const weight = this.strategyWeights.get(strategy.name) || 1;
        
        // Apply strategy weight to confidence scores
        const weightedOpportunities = opportunities.map(opp => ({
          ...opp,
          confidence: opp.confidence * weight,
          strategy: strategy.name
        }));
        
        allOpportunities.push(...weightedOpportunities);
        
        logger.debug(`${strategy.name} found ${opportunities.length} opportunities`);
        
      } catch (error) {
        logger.error(`Strategy ${strategy.name} failed:`, error);
      }
    }

    // Remove duplicates and sort by weighted confidence
    const uniqueOpportunities = this.removeDuplicates(allOpportunities);
    return uniqueOpportunities.sort((a, b) => b.confidence - a.confidence);
  }

  private removeDuplicates(opportunities: ArbitrageOpportunity[]): ArbitrageOpportunity[] {
    const seen = new Set<string>();
    const unique: ArbitrageOpportunity[] = [];

    for (const opp of opportunities) {
      const key = `${opp.tokenA}-${opp.buyExchange}-${opp.sellExchange}`;
      
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(opp);
      }
    }

    return unique;
  }

  getStrategies(): Strategy[] {
    return [...this.strategies];
  }

  updateStrategyWeight(strategyName: string, weight: number) {
    this.strategyWeights.set(strategyName, weight);
    logger.info(`Updated strategy weight: ${strategyName} = ${weight}`);
  }

  getStrategyStats(): { [key: string]: { weight: number; description: string } } {
    const stats: { [key: string]: { weight: number; description: string } } = {};
    
    for (const strategy of this.strategies) {
      stats[strategy.name] = {
        weight: this.strategyWeights.get(strategy.name) || 0,
        description: strategy.getDescription()
      };
    }
    
    return stats;
  }
}

// Add strategy interface to types
declare global {
  interface ArbitrageOpportunity {
    strategy?: string;
  }
}
