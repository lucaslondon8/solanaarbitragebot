// Enhanced types for the Solana arbitrage bot

import { PublicKey } from '@solana/web3.js';

export interface TokenPrice {
  symbol: string;
  mint: string;
  price: number;
  source: string;
  timestamp: number;
  liquidity?: number;
  volume24h?: number;
}

export interface ArbitrageOpportunity {
  tokenA: string;
  tokenB: string;
  buyExchange: string;
  sellExchange: string;
  buyPrice: number;
  sellPrice: number;
  profitPercent: number;
  estimatedProfit: number;
  tradeSize: number;
  confidence: number;
  strategy?: string;
  liquidityScore?: number;
  priceImpact?: number;
  gasEstimate?: number;
  executionTime?: number;
}

export interface TradeResult {
  success: boolean;
  signature?: string;
  error?: string;
  profitRealized?: number;
  gasCost?: number;
  executionTime?: number;
  slippage?: number;
  priceImpact?: number;
}

export interface Market {
  address: string;
  mintA: PublicKey;
  mintB: PublicKey;
  priceBPerA: number;
  priceAPerB: number;
  liquidity?: number;
  volume24h?: number;
  source: string;
  fees?: number;
}

export interface PoolInfo {
  id: string;
  tokenA: TokenInfo;
  tokenB: TokenInfo;
  liquidity: number;
  volume24h: number;
  fees: number;
  apr: number;
  tvl: number;
}

export interface TokenInfo {
  symbol: string;
  mint: string;
  decimals: number;
  name?: string;
  logoUri?: string;
  coingeckoId?: string;
}

export interface SwapQuote {
  inputAmount: number;
  outputAmount: number;
  priceImpact: number;
  fee: number;
  route: string[];
  slippage: number;
}

export interface LiquidityPosition {
  id: string;
  tokenA: TokenInfo;
  tokenB: TokenInfo;
  liquidity: number;
  value: number;
  fees24h: number;
  apr: number;
}

export interface RiskMetrics {
  sharpeRatio: number;
  maxDrawdown: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  volatility: number;
  var95: number; // Value at Risk 95%
  expectedShortfall: number;
}

export interface PerformanceMetrics {
  totalTrades: number;
  successfulTrades: number;
  totalProfit: number;
  totalLoss: number;
  netProfit: number;
  avgProfitPerTrade: number;
  avgExecutionTime: number;
  avgGasCost: number;
  bestTrade: number;
  worstTrade: number;
  tradingVolume: number;
  roi: number; // Return on Investment
}

export interface ExchangeMetrics {
  [exchange: string]: {
    trades: number;
    volume: number;
    profit: number;
    successRate: number;
    avgExecutionTime: number;
    avgSlippage: number;
    reliability: number;
  };
}

export interface StrategyMetrics {
  [strategy: string]: {
    trades: number;
    profit: number;
    successRate: number;
    avgProfitPercent: number;
    sharpeRatio: number;
    maxDrawdown: number;
    weight: number;
  };
}

export interface BotConfiguration {
  trading: {
    minProfitThreshold: number;
    maxTradeSizeSol: number;
    slippageTolerance: number;
    checkInterval: number;
    supportedTokens: string[];
    dexPriority: string[];
    enabledStrategies: string[];
  };
  risk: {
    maxDailyTrades: number;
    maxDailyLoss: number;
    maxSingleTradeSize: number;
    emergencyStopLoss: number;
    maxCorrelatedExposure: number;
    maxPortfolioRisk: number;
    riskAdjustment: boolean;
  };
  execution: {
    parallelTrades: boolean;
    smartRouting: boolean;
    priorityFees: boolean;
    computeUnitLimit: number;
    computeUnitPrice: number;
  };
  monitoring: {
    enableTelegram: boolean;
    enableWebhooks: boolean;
    reportInterval: number;
    saveReports: boolean;
    detailedLogging: boolean;
  };
}

export interface WebSocketMessage {
  type: 'price_update' | 'trade_update' | 'pool_update' | 'system_status';
  data: any;
  timestamp: number;
  source: string;
}

export interface PriceAlert {
  id: string;
  tokenA: string;
  tokenB: string;
  type: 'price_above' | 'price_below' | 'spread_above' | 'volume_above';
  threshold: number;
  active: boolean;
  triggered: boolean;
  createdAt: number;
}

export interface BacktestResult {
  strategy: string;
  timeframe: {
    start: Date;
    end: Date;
  };
  metrics: PerformanceMetrics;
  trades: TradeResult[];
  equity: number[];
  timestamps: number[];
  maxDrawdownPeriod: {
    start: Date;
    end: Date;
    drawdown: number;
  };
}

export interface MarketCondition {
  volatility: 'low' | 'medium' | 'high';
  trend: 'bullish' | 'bearish' | 'sideways';
  liquidity: 'low' | 'medium' | 'high';
  volume: 'low' | 'medium' | 'high';
  spread: 'tight' | 'normal' | 'wide';
}

export interface AdvancedOrder {
  id: string;
  type: 'market' | 'limit' | 'stop_loss' | 'take_profit';
  tokenA: string;
  tokenB: string;
  amount: number;
  price?: number;
  stopPrice?: number;
  status: 'pending' | 'filled' | 'cancelled' | 'expired';
  createdAt: number;
  filledAt?: number;
}

export interface LiquidityPool {
  address: string;
  tokenA: TokenInfo;
  tokenB: TokenInfo;
  reserveA: number;
  reserveB: number;
  totalSupply: number;
  fee: number;
  volume24h: number;
  apr: number;
  tvl: number;
  exchange: string;
}

export interface ArbPathData {
  path: string[];
  exchanges: string[];
  expectedReturn: number;
  gasEstimate: number;
  executionTime: number;
  complexity: number;
  reliability: number;
}

export interface SystemHealth {
  rpcLatency: number;
  websocketConnections: number;
  exchangeConnections: {
    [exchange: string]: {
      connected: boolean;
      lastPing: number;
      errorCount: number;
    };
  };
  memoryUsage: number;
  cpuUsage: number;
  errorRate: number;
  uptime: number;
}

export interface TradingSignal {
  id: string;
  type: 'arbitrage' | 'momentum' | 'mean_reversion' | 'breakout';
  strength: number; // 0-100
  confidence: number; // 0-1
  timeframe: string;
  entry: number;
  target: number;
  stopLoss: number;
  risk: number;
  metadata: any;
}

// Event types for the event system
export interface BotEvent {
  type: 'trade_executed' | 'opportunity_found' | 'error_occurred' | 'status_changed';
  timestamp: number;
  data: any;
}

export interface TradeExecutedEvent extends BotEvent {
  type: 'trade_executed';
  data: {
    opportunity: ArbitrageOpportunity;
    result: TradeResult;
    executionDetails: {
      route: string[];
      actualSlippage: number;
      gasCost: number;
      executionTime: number;
    };
  };
}

export interface OpportunityFoundEvent extends BotEvent {
  type: 'opportunity_found';
  data: {
    opportunity: ArbitrageOpportunity;
    marketConditions: MarketCondition;
    riskAssessment: {
      score: number;
      factors: string[];
    };
  };
}

export interface ErrorOccurredEvent extends BotEvent {
  type: 'error_occurred';
  data: {
    error: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    component: string;
    context: any;
  };
}

export interface StatusChangedEvent extends BotEvent {
  type: 'status_changed';
  data: {
    oldStatus: string;
    newStatus: string;
    reason: string;
  };
}

// Utility types
export type Exchange = 'Jupiter' | 'Orca' | 'Raydium' | 'Serum' | 'Meteora' | 'Phoenix';
export type TokenSymbol = 'SOL' | 'USDC' | 'USDT' | 'RAY' | 'ORCA' | 'SRM' | 'MNGO';
export type TimeFrame = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';
export type OrderSide = 'buy' | 'sell';
export type OrderStatus = 'pending' | 'filled' | 'cancelled' | 'expired' | 'failed';

// Type guards
export function isTokenPrice(obj: any): obj is TokenPrice {
  return obj && typeof obj === 'object' && 
         typeof obj.symbol === 'string' && 
         typeof obj.price === 'number' &&
         typeof obj.source === 'string' &&
         typeof obj.timestamp === 'number';
}

export function isArbitrageOpportunity(obj: any): obj is ArbitrageOpportunity {
  return obj && typeof obj === 'object' &&
         typeof obj.tokenA === 'string' &&
         typeof obj.tokenB === 'string' &&
         typeof obj.profitPercent === 'number' &&
         typeof obj.confidence === 'number';
}

export function isTradeResult(obj: any): obj is TradeResult {
  return obj && typeof obj === 'object' &&
         typeof obj.success === 'boolean';
}
