import { TradeResult, ArbitrageOpportunity } from '../types';
import { Logger } from '../utils/logger';
import fs from 'fs';
import path from 'path';

const logger = Logger.getInstance();

interface TradingMetrics {
  totalTrades: number;
  successfulTrades: number;
  totalProfit: number;
  totalLoss: number;
  netProfit: number;
  winRate: number;
  avgProfitPerTrade: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  sharpeRatio: number;
  maxDrawdown: number;
  avgExecutionTime: number;
  avgGasCost: number;
  bestTrade: number;
  worstTrade: number;
}

interface ExchangeMetrics {
  [exchange: string]: {
    trades: number;
    profit: number;
    successRate: number;
    avgExecutionTime: number;
  };
}

interface TokenMetrics {
  [token: string]: {
    trades: number;
    profit: number;
    successRate: number;
    avgProfitPercent: number;
  };
}

interface HourlyMetrics {
  hour: number;
  opportunities: number;
  trades: number;
  profit: number;
  successRate: number;
}

export class AnalyticsDashboard {
  private trades: TradeResult[] = [];
  private opportunities: ArbitrageOpportunity[] = [];
  private hourlyData: HourlyMetrics[] = Array(24).fill(null).map((_, i) => ({
    hour: i,
    opportunities: 0,
    trades: 0,
    profit: 0,
    successRate: 0
  }));

  recordOpportunity(opportunity: ArbitrageOpportunity) {
    this.opportunities.unshift(opportunity);
    
    // Keep only last 1000 opportunities
    if (this.opportunities.length > 1000) {
      this.opportunities.pop();
    }

    // Update hourly data
    const hour = new Date().getHours();
    this.hourlyData[hour].opportunities++;
  }

  recordTrade(result: TradeResult, opportunity: ArbitrageOpportunity) {
    this.trades.unshift(result);
    
    // Keep only last 1000 trades
    if (this.trades.length > 1000) {
      this.trades.pop();
    }

    // Update hourly data
    const hour = new Date().getHours();
    this.hourlyData[hour].trades++;
    
    if (result.success && result.profitRealized) {
      this.hourlyData[hour].profit += result.profitRealized;
    }

    // Recalculate hourly success rate
    const hourlyTrades = this.trades.filter(trade => {
      const tradeHour = new Date().getHours(); // Simplified - should use actual trade time
      return tradeHour === hour;
    });
    
    const hourlySuccesses = hourlyTrades.filter(trade => trade.success).length;
    this.hourlyData[hour].successRate = hourlyTrades.length > 0 ? 
      hourlySuccesses / hourlyTrades.length : 0;
  }

  getTradingMetrics(): TradingMetrics {
    if (this.trades.length === 0) {
      return {
        totalTrades: 0,
        successfulTrades: 0,
        totalProfit: 0,
        totalLoss: 0,
        netProfit: 0,
        winRate: 0,
        avgProfitPerTrade: 0,
        avgWin: 0,
        avgLoss: 0,
        profitFactor: 0,
        sharpeRatio: 0,
        maxDrawdown: 0,
        avgExecutionTime: 0,
        avgGasCost: 0,
        bestTrade: 0,
        worstTrade: 0
      };
    }

    const successfulTrades = this.trades.filter(trade => trade.success);
    const profits = this.trades.map(trade => trade.profitRealized || 0);
    const wins = profits.filter(p => p > 0);
    const losses = profits.filter(p => p <= 0);
    
    const totalProfit = wins.reduce((sum, profit) => sum + profit, 0);
    const totalLoss = Math.abs(losses.reduce((sum, loss) => sum + loss, 0));
    const netProfit = totalProfit - totalLoss;
    
    const avgProfit = profits.reduce((sum, profit) => sum + profit, 0) / profits.length;
    const avgWin = wins.length > 0 ? totalProfit / wins.length : 0;
    const avgLoss = losses.length > 0 ? totalLoss / losses.length : 0;
    
    // Calculate Sharpe ratio
    const profitStdDev = this.calculateStandardDeviation(profits);
    const sharpeRatio = profitStdDev === 0 ? 0 : avgProfit / profitStdDev;
    
    // Calculate max drawdown
    const maxDrawdown = this.calculateMaxDrawdown(profits);
    
    // Calculate average execution time and gas cost
    const validExecutionTimes = this.trades.filter(trade => trade.executionTime).map(trade => trade.executionTime!);
    const avgExecutionTime = validExecutionTimes.length > 0 ? 
      validExecutionTimes.reduce((sum, time) => sum + time, 0) / validExecutionTimes.length : 0;
    
    const validGasCosts = this.trades.filter(trade => trade.gasCost).map(trade => trade.gasCost!);
    const avgGasCost = validGasCosts.length > 0 ?
      validGasCosts.reduce((sum, cost) => sum + cost, 0) / validGasCosts.length : 0;

    return {
      totalTrades: this.trades.length,
      successfulTrades: successfulTrades.length,
      totalProfit,
      totalLoss,
      netProfit,
      winRate: successfulTrades.length / this.trades.length,
      avgProfitPerTrade: avgProfit,
      avgWin,
      avgLoss,
      profitFactor: avgLoss === 0 ? 0 : avgWin / avgLoss,
      sharpeRatio,
      maxDrawdown,
      avgExecutionTime,
      avgGasCost,
      bestTrade: Math.max(...profits),
      worstTrade: Math.min(...profits)
    };
  }

  getExchangeMetrics(): ExchangeMetrics {
    const exchangeData: ExchangeMetrics = {};
    
    // Group trades by exchange (simplified - you'd need to track exchange info)
    const exchanges = ['Jupiter', 'Orca', 'Raydium'];
    
    for (const exchange of exchanges) {
      const exchangeTrades = this.trades.filter((_, index) => {
        // Simplified logic - in reality, you'd track which exchange was used
        return index % exchanges.length === exchanges.indexOf(exchange);
      });
      
      const successfulTrades = exchangeTrades.filter(trade => trade.success);
      const totalProfit = exchangeTrades.reduce((sum, trade) => sum + (trade.profitRealized || 0), 0);
      const executionTimes = exchangeTrades.filter(trade => trade.executionTime).map(trade => trade.executionTime!);
      
      exchangeData[exchange] = {
        trades: exchangeTrades.length,
        profit: totalProfit,
        successRate: exchangeTrades.length > 0 ? successfulTrades.length / exchangeTrades.length : 0,
        avgExecutionTime: executionTimes.length > 0 ? 
          executionTimes.reduce((sum, time) => sum + time, 0) / executionTimes.length : 0
      };
    }
    
    return exchangeData;
  }

  getTokenMetrics(): TokenMetrics {
    const tokenData: TokenMetrics = {};
    
    // Group opportunities and trades by token
    const tokens = ['SOL', 'USDC', 'USDT', 'RAY', 'ORCA'];
    
    for (const token of tokens) {
      const tokenOpportunities = this.opportunities.filter(opp => opp.tokenA === token);
      const tokenTrades = this.trades.slice(0, tokenOpportunities.length); // Simplified mapping
      
      const successfulTrades = tokenTrades.filter(trade => trade.success);
      const totalProfit = tokenTrades.reduce((sum, trade) => sum + (trade.profitRealized || 0), 0);
      const avgProfitPercent = tokenOpportunities.length > 0 ?
        tokenOpportunities.reduce((sum, opp) => sum + opp.profitPercent, 0) / tokenOpportunities.length : 0;
      
      tokenData[token] = {
        trades: tokenTrades.length,
        profit: totalProfit,
        successRate: tokenTrades.length > 0 ? successfulTrades.length / tokenTrades.length : 0,
        avgProfitPercent: avgProfitPercent * 100 // Convert to percentage
      };
    }
    
    return tokenData;
  }

  getHourlyMetrics(): HourlyMetrics[] {
    return [...this.hourlyData];
  }

  private calculateStandardDeviation(values: number[]): number {
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    return Math.sqrt(variance);
  }

  private calculateMaxDrawdown(profits: number[]): number {
    if (profits.length === 0) return 0;
    
    let maxDrawdown = 0;
    let peak = profits[0];
    let cumulative = 0;
    
    for (const profit of profits) {
      cumulative += profit;
      
      if (cumulative > peak) {
        peak = cumulative;
      }
      
      const drawdown = peak - cumulative;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }
    
    return maxDrawdown;
  }

  generateReport(): string {
    const metrics = this.getTradingMetrics();
    const exchangeMetrics = this.getExchangeMetrics();
    const tokenMetrics = this.getTokenMetrics();
    
    const report = `
=== ARBITRAGE BOT PERFORMANCE REPORT ===
Generated: ${new Date().toISOString()}

OVERALL METRICS:
- Total Trades: ${metrics.totalTrades}
- Success Rate: ${(metrics.winRate * 100).toFixed(2)}%
- Net Profit: ${metrics.netProfit.toFixed(6)} SOL
- Profit Factor: ${metrics.profitFactor.toFixed(2)}
- Sharpe Ratio: ${metrics.sharpeRatio.toFixed(2)}
- Max Drawdown: ${metrics.maxDrawdown.toFixed(6)} SOL
- Avg Execution Time: ${metrics.avgExecutionTime.toFixed(0)}ms
- Avg Gas Cost: ${metrics.avgGasCost.toFixed(6)} SOL

EXCHANGE PERFORMANCE:
${Object.entries(exchangeMetrics).map(([exchange, data]) => `
- ${exchange}:
  * Trades: ${data.trades}
  * Profit: ${data.profit.toFixed(6)} SOL
  * Success Rate: ${(data.successRate * 100).toFixed(2)}%
  * Avg Execution: ${data.avgExecutionTime.toFixed(0)}ms`).join('')}

TOKEN PERFORMANCE:
${Object.entries(tokenMetrics).map(([token, data]) => `
- ${token}:
  * Trades: ${data.trades}
  * Profit: ${data.profit.toFixed(6)} SOL
  * Success Rate: ${(data.successRate * 100).toFixed(2)}%
  * Avg Profit %: ${data.avgProfitPercent.toFixed(3)}%`).join('')}

HOURLY ACTIVITY (Top 5):
${this.getTopHourlyMetrics().map(metric => `
- Hour ${metric.hour}:00: ${metric.opportunities} opportunities, ${metric.trades} trades, ${metric.profit.toFixed(6)} SOL profit`).join('')}
`;

    return report;
  }

  private getTopHourlyMetrics(): HourlyMetrics[] {
    return [...this.hourlyData]
      .sort((a, b) => b.profit - a.profit)
      .slice(0, 5);
  }

  saveReport(filename?: string) {
    const report = this.generateReport();
    const reportPath = filename || path.join('logs', `report_${Date.now()}.txt`);
    
    // Ensure logs directory exists
    const dir = path.dirname(reportPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(reportPath, report);
    logger.info(`Performance report saved to: ${reportPath}`);
    
    return reportPath;
  }

  exportData(format: 'json' | 'csv' = 'json'): string {
    const data = {
      metrics: this.getTradingMetrics(),
      exchanges: this.getExchangeMetrics(),
      tokens: this.getTokenMetrics(),
      hourly: this.getHourlyMetrics(),
      trades: this.trades.slice(0, 100), // Last 100 trades
      opportunities: this.opportunities.slice(0, 100) // Last 100 opportunities
    };
    
    if (format === 'json') {
      const filename = path.join('logs', `data_export_${Date.now()}.json`);
      fs.writeFileSync(filename, JSON.stringify(data, null, 2));
      return filename;
    } else {
      // CSV export (simplified)
      const csvData = this.trades.map(trade => ({
        timestamp: new Date().toISOString(), // Should use actual trade timestamp
        success: trade.success,
        profit: trade.profitRealized || 0,
        executionTime: trade.executionTime || 0,
        gasCost: trade.gasCost || 0
      }));
      
      const csvContent = [
        'timestamp,success,profit,executionTime,gasCost',
        ...csvData.map(row => Object.values(row).join(','))
      ].join('\n');
      
      const filename = path.join('logs', `data_export_${Date.now()}.csv`);
      fs.writeFileSync(filename, csvContent);
      return filename;
    }
  }

  // Real-time statistics for live monitoring
  getLiveStats() {
    const last24h = this.trades.filter(trade => {
      // Simplified - should use actual timestamps
      return true; // Include all trades for now
    });
    
    const last1h = last24h.slice(0, Math.floor(last24h.length / 24));
    
    return {
      last1h: {
        trades: last1h.length,
        profit: last1h.reduce((sum, trade) => sum + (trade.profitRealized || 0), 0),
        successRate: last1h.filter(trade => trade.success).length / Math.max(last1h.length, 1)
      },
      last24h: {
        trades: last24h.length,
        profit: last24h.reduce((sum, trade) => sum + (trade.profitRealized || 0), 0),
        successRate: last24h.filter(trade => trade.success).length / Math.max(last24h.length, 1)
      },
      currentHour: this.hourlyData[new Date().getHours()],
      totalOpportunities: this.opportunities.length,
      totalTrades: this.trades.length
    };
  }
}
