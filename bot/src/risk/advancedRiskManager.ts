import { ArbitrageOpportunity, TradeResult } from '../types';
import { Logger } from '../utils/logger';

const logger = Logger.getInstance();

interface RiskMetrics {
  sharpeRatio: number;
  maxDrawdown: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  volatility: number;
}

interface PositionLimit {
  token: string;
  maxPosition: number;
  currentPosition: number;
  maxDailyVolume: number;
  currentDailyVolume: number;
}

export class AdvancedRiskManager {
  private tradeHistory: TradeResult[] = [];
  private positionLimits: Map<string, PositionLimit> = new Map();
  private correlationMatrix: Map<string, Map<string, number>> = new Map();
  private volatilityMap: Map<string, number> = new Map();

  constructor(
    private maxPortfolioRisk: number = 0.02, // 2% of portfolio
    private maxCorrelatedExposure: number = 0.05, // 5% correlated exposure
    private maxDrawdownLimit: number = 0.10 // 10% max drawdown
  ) {
    this.initializePositionLimits();
  }

  private initializePositionLimits() {
    const tokens = ['SOL', 'USDC', 'USDT', 'RAY', 'ORCA'];
    
    tokens.forEach(token => {
      this.positionLimits.set(token, {
        token,
        maxPosition: 1000, // Max position size in USD
        currentPosition: 0,
        maxDailyVolume: 10000, // Max daily trading volume
        currentDailyVolume: 0
      });
    });
  }

  async assessRisk(opportunity: ArbitrageOpportunity): Promise<{
    approved: boolean;
    risk: number;
    reasons: string[];
    adjustedSize?: number;
  }> {
    const reasons: string[] = [];
    let risk = 0;
    let approved = true;

    // 1. Portfolio risk assessment
    const portfolioRisk = this.calculatePortfolioRisk(opportunity);
    if (portfolioRisk > this.maxPortfolioRisk) {
      approved = false;
      reasons.push(`Portfolio risk too high: ${(portfolioRisk * 100).toFixed(2)}%`);
    }
    risk += portfolioRisk;

    // 2. Position limits check
    const positionCheck = this.checkPositionLimits(opportunity);
    if (!positionCheck.approved) {
      approved = false;
      reasons.push(...positionCheck.reasons);
    }

    // 3. Correlation risk
    const correlationRisk = await this.calculateCorrelationRisk(opportunity);
    if (correlationRisk > this.maxCorrelatedExposure) {
      approved = false;
      reasons.push(`Correlation risk too high: ${(correlationRisk * 100).toFixed(2)}%`);
    }
    risk += correlationRisk;

    // 4. Market volatility assessment
    const volatilityRisk = this.assessVolatilityRisk(opportunity);
    risk += volatilityRisk;

    // 5. Drawdown protection
    const drawdownCheck = this.checkDrawdownLimit();
    if (!drawdownCheck.approved) {
      approved = false;
      reasons.push(...drawdownCheck.reasons);
    }

    // 6. Dynamic position sizing
    const adjustedSize = approved ? this.calculateOptimalSize(opportunity, risk) : 0;

    return {
      approved,
      risk,
      reasons,
      adjustedSize
    };
  }

  private calculatePortfolioRisk(opportunity: ArbitrageOpportunity): number {
    // Calculate Value at Risk (VaR) for the opportunity
    const volatility = this.volatilityMap.get(opportunity.tokenA) || 0.5;
    const positionSize = opportunity.tradeSize;
    
    // 95% VaR calculation
    const var95 = positionSize * volatility * 1.645; // 1.645 for 95% confidence
    
    return var95 / 10000; // Normalize against $10k portfolio
  }

  private checkPositionLimits(opportunity: ArbitrageOpportunity): {
    approved: boolean;
    reasons: string[];
  } {
    const reasons: string[] = [];
    const limit = this.positionLimits.get(opportunity.tokenA);
    
    if (!limit) {
      return { approved: false, reasons: ['Token not in allowed list'] };
    }

    // Check position size
    const newPosition = limit.currentPosition + opportunity.tradeSize;
    if (newPosition > limit.maxPosition) {
      reasons.push(`Position limit exceeded for ${opportunity.tokenA}`);
    }

    // Check daily volume
    const newDailyVolume = limit.currentDailyVolume + opportunity.tradeSize;
    if (newDailyVolume > limit.maxDailyVolume) {
      reasons.push(`Daily volume limit exceeded for ${opportunity.tokenA}`);
    }

    return {
      approved: reasons.length === 0,
      reasons
    };
  }

  private async calculateCorrelationRisk(opportunity: ArbitrageOpportunity): Promise<number> {
    // Calculate correlation with existing positions
    let correlationRisk = 0;
    
    for (const [token, limit] of this.positionLimits.entries()) {
      if (limit.currentPosition > 0 && token !== opportunity.tokenA) {
        const correlation = this.getCorrelation(opportunity.tokenA, token);
        const exposureRisk = (limit.currentPosition * Math.abs(correlation)) / 10000;
        correlationRisk += exposureRisk;
      }
    }
    
    return correlationRisk;
  }

  private getCorrelation(tokenA: string, tokenB: string): number {
    // Get correlation coefficient between two tokens
    const correlations = this.correlationMatrix.get(tokenA);
    return correlations?.get(tokenB) || 0;
  }

  private assessVolatilityRisk(opportunity: ArbitrageOpportunity): number {
    const volatility = this.volatilityMap.get(opportunity.tokenA) || 0.5;
    
    // Higher volatility = higher risk
    // Scale: 0.1 (10% volatility) = 0.01 risk, 1.0 (100% volatility) = 0.1 risk
    return Math.min(volatility / 10, 0.1);
  }

  private checkDrawdownLimit(): { approved: boolean; reasons: string[] } {
    const currentDrawdown = this.calculateCurrentDrawdown();
    
    if (currentDrawdown > this.maxDrawdownLimit) {
      return {
        approved: false,
        reasons: [`Current drawdown (${(currentDrawdown * 100).toFixed(2)}%) exceeds limit`]
      };
    }
    
    return { approved: true, reasons: [] };
  }

  private calculateCurrentDrawdown(): number {
    if (this.tradeHistory.length < 10) return 0;
    
    const returns = this.tradeHistory.slice(-50).map(trade => trade.profitRealized || 0);
    const cumulativeReturns = this.calculateCumulativeReturns(returns);
    
    let maxDrawdown = 0;
    let peak = cumulativeReturns[0];
    
    for (const value of cumulativeReturns) {
      if (value > peak) {
        peak = value;
      }
      
      const drawdown = (peak - value) / peak;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }
    
    return maxDrawdown;
  }

  private calculateCumulativeReturns(returns: number[]): number[] {
    const cumulative: number[] = [];
    let sum = 0;
    
    for (const ret of returns) {
      sum += ret;
      cumulative.push(sum);
    }
    
    return cumulative;
  }

  private calculateOptimalSize(opportunity: ArbitrageOpportunity, risk: number): number {
    // Kelly Criterion for optimal position sizing
    const winRate = this.calculateWinRate();
    const avgWin = this.calculateAverageWin();
    const avgLoss = this.calculateAverageLoss();
    
    if (avgLoss === 0) return opportunity.tradeSize; // No loss history
    
    const winLossRatio = avgWin / Math.abs(avgLoss);
    const kellyPercent = (winRate * winLossRatio - (1 - winRate)) / winLossRatio;
    
    // Cap Kelly percentage and adjust for risk
    const maxKelly = 0.25; // Never risk more than 25% of capital
    const adjustedKelly = Math.min(Math.max(kellyPercent, 0), maxKelly);
    
    // Risk adjustment factor
    const riskAdjustment = Math.max(0.1, 1 - risk * 5);
    
    // Calculate optimal size
    const optimalSize = opportunity.tradeSize * adjustedKelly * riskAdjustment;
    
    return Math.max(0.001, optimalSize); // Minimum 0.001 SOL
  }

  private calculateWinRate(): number {
    const recentTrades = this.tradeHistory.slice(-100);
    if (recentTrades.length === 0) return 0.5; // Default 50%
    
    const wins = recentTrades.filter(trade => 
      trade.success && (trade.profitRealized || 0) > 0
    ).length;
    
    return wins / recentTrades.length;
  }

  private calculateAverageWin(): number {
    const recentTrades = this.tradeHistory.slice(-100);
    const wins = recentTrades.filter(trade => 
      trade.success && (trade.profitRealized || 0) > 0
    );
    
    if (wins.length === 0) return 0.01; // Default small win
    
    const totalWins = wins.reduce((sum, trade) => sum + (trade.profitRealized || 0), 0);
    return totalWins / wins.length;
  }

  private calculateAverageLoss(): number {
    const recentTrades = this.tradeHistory.slice(-100);
    const losses = recentTrades.filter(trade => 
      !trade.success || (trade.profitRealized || 0) <= 0
    );
    
    if (losses.length === 0) return -0.005; // Default small loss
    
    const totalLosses = losses.reduce((sum, trade) => sum + (trade.profitRealized || 0), 0);
    return totalLosses / losses.length;
  }

  updateVolatility(token: string, returns: number[]) {
    if (returns.length < 20) return; // Need minimum data
    
    const mean = returns.reduce((sum, ret) => sum + ret, 0) / returns.length;
    const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - mean, 2), 0) / returns.length;
    const volatility = Math.sqrt(variance);
    
    this.volatilityMap.set(token, volatility);
    logger.debug(`Updated volatility for ${token}: ${(volatility * 100).toFixed(2)}%`);
  }

  updateCorrelations(tokenPairs: Map<string, number[]>) {
    // Update correlation matrix based on price movements
    for (const [tokenA, returnsA] of tokenPairs.entries()) {
      if (!this.correlationMatrix.has(tokenA)) {
        this.correlationMatrix.set(tokenA, new Map());
      }
      
      for (const [tokenB, returnsB] of tokenPairs.entries()) {
        if (tokenA !== tokenB) {
          const correlation = this.calculateCorrelationCoefficient(returnsA, returnsB);
          this.correlationMatrix.get(tokenA)!.set(tokenB, correlation);
        }
      }
    }
  }

  private calculateCorrelationCoefficient(x: number[], y: number[]): number {
    const n = Math.min(x.length, y.length);
    if (n < 10) return 0; // Need minimum data points
    
    const xSlice = x.slice(0, n);
    const ySlice = y.slice(0, n);
    
    const meanX = xSlice.reduce((sum, val) => sum + val, 0) / n;
    const meanY = ySlice.reduce((sum, val) => sum + val, 0) / n;
    
    let numerator = 0;
    let sumXSquared = 0;
    let sumYSquared = 0;
    
    for (let i = 0; i < n; i++) {
      const xDiff = xSlice[i] - meanX;
      const yDiff = ySlice[i] - meanY;
      
      numerator += xDiff * yDiff;
      sumXSquared += xDiff * xDiff;
      sumYSquared += yDiff * yDiff;
    }
    
    const denominator = Math.sqrt(sumXSquared * sumYSquared);
    return denominator === 0 ? 0 : numerator / denominator;
  }

  recordTrade(result: TradeResult, opportunity: ArbitrageOpportunity) {
    // Record trade in history
    this.tradeHistory.unshift(result);
    
    // Keep only last 1000 trades
    if (this.tradeHistory.length > 1000) {
      this.tradeHistory.pop();
    }
    
    // Update position tracking
    const limit = this.positionLimits.get(opportunity.tokenA);
    if (limit) {
      if (result.success) {
        limit.currentPosition += opportunity.tradeSize;
        limit.currentDailyVolume += opportunity.tradeSize;
      }
      this.positionLimits.set(opportunity.tokenA, limit);
    }
    
    logger.debug(`Recorded trade for ${opportunity.tokenA}`, {
      success: result.success,
      profit: result.profitRealized,
      newPosition: limit?.currentPosition
    });
  }

  getRiskMetrics(): RiskMetrics {
    const recentTrades = this.tradeHistory.slice(-100);
    
    if (recentTrades.length < 10) {
      return {
        sharpeRatio: 0,
        maxDrawdown: 0,
        winRate: 0,
        avgWin: 0,
        avgLoss: 0,
        profitFactor: 0,
        volatility: 0
      };
    }
    
    const returns = recentTrades.map(trade => trade.profitRealized || 0);
    const wins = returns.filter(ret => ret > 0);
    const losses = returns.filter(ret => ret <= 0);
    
    const avgReturn = returns.reduce((sum, ret) => sum + ret, 0) / returns.length;
    const returnStdDev = Math.sqrt(
      returns.reduce((sum, ret) => sum + Math.pow(ret - avgReturn, 2), 0) / returns.length
    );
    
    const avgWin = wins.length > 0 ? wins.reduce((sum, win) => sum + win, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? losses.reduce((sum, loss) => sum + loss, 0) / losses.length : 0;
    
    return {
      sharpeRatio: returnStdDev === 0 ? 0 : avgReturn / returnStdDev,
      maxDrawdown: this.calculateCurrentDrawdown(),
      winRate: wins.length / returns.length,
      avgWin,
      avgLoss,
      profitFactor: avgLoss === 0 ? 0 : Math.abs(avgWin / avgLoss),
      volatility: returnStdDev
    };
  }

  // Daily reset function
  resetDailyLimits() {
    for (const [token, limit] of this.positionLimits.entries()) {
      limit.currentDailyVolume = 0;
      limit.currentPosition = 0; // Reset positions daily for arbitrage
      this.positionLimits.set(token, limit);
    }
    
    logger.info('Daily position limits reset');
  }

  // Emergency stop functionality
  shouldTriggerEmergencyStop(): boolean {
    const metrics = this.getRiskMetrics();
    
    // Trigger emergency stop if:
    // 1. Drawdown exceeds limit
    // 2. Sharpe ratio becomes very negative
    // 3. Win rate drops below 30%
    
    return (
      metrics.maxDrawdown > this.maxDrawdownLimit ||
      metrics.sharpeRatio < -2 ||
      (metrics.winRate < 0.3 && this.tradeHistory.length > 50)
    );
  }

  getPositionSummary(): { [token: string]: PositionLimit } {
    const summary: { [token: string]: PositionLimit } = {};
    
    for (const [token, limit] of this.positionLimits.entries()) {
      summary[token] = { ...limit };
    }
    
    return summary;
  }
}
