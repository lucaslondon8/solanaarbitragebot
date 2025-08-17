import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
const envPath = path.resolve(__dirname, '../../../.env');
dotenv.config({ path: envPath });

export interface BotConfig {
  // Solana Configuration
  rpc: {
    primary: string;
    backup: string;
  };
  wallet: {
    privateKey: string;
  };
  
  // Trading Configuration
  trading: {
    minProfitThreshold: number;
    maxTradeSizeSol: number;
    slippageTolerance: number;
    checkInterval: number;
    supportedTokens: string[];
    dexPriority: string[];
  };
  
  // Risk Management
  risk: {
    maxDailyTrades: number;
    maxDailyLoss: number;
    maxSingleTradeSize: number;
    emergencyStopLoss: number;
  };
  
  // API Configuration
  apis: {
    jupiter?: string;
    orca?: string;
    telegram?: {
      botToken: string;
      chatId: string;
    };
  };
  
  // Logging
  logging: {
    level: string;
    filePath?: string;
  };
}

class ConfigManager {
  private static instance: ConfigManager;
  private config: BotConfig;

  private constructor() {
    this.config = this.loadConfig();
    this.validateConfig();
  }

  static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  private loadConfig(): BotConfig {
    return {
      rpc: {
        primary: process.env.PRIMARY_RPC_ENDPOINT || 'https://api.devnet.solana.com',
        backup: process.env.BACKUP_RPC_ENDPOINT || 'https://api.devnet.solana.com'
      },
      wallet: {
        privateKey: process.env.PRIVATE_KEY || ''
      },
      trading: {
        minProfitThreshold: parseFloat(process.env.MIN_PROFIT_THRESHOLD || '0.01'),
        maxTradeSizeSol: parseFloat(process.env.MAX_TRADE_SIZE_SOL || '0.1'),
        slippageTolerance: parseFloat(process.env.SLIPPAGE_TOLERANCE || '0.005'),
        checkInterval: parseInt(process.env.CHECK_INTERVAL || '2000'),
        supportedTokens: (process.env.SUPPORTED_TOKENS || 'SOL,USDC,USDT,RAY,ORCA').split(','),
        dexPriority: (process.env.DEX_PRIORITY || 'Jupiter,Orca,Raydium').split(',')
      },
      risk: {
        maxDailyTrades: parseInt(process.env.MAX_DAILY_TRADES || '50'),
        maxDailyLoss: parseFloat(process.env.MAX_DAILY_LOSS || '0.1'),
        maxSingleTradeSize: parseFloat(process.env.MAX_SINGLE_TRADE_SIZE || '0.1'),
        emergencyStopLoss: parseFloat(process.env.EMERGENCY_STOP_LOSS || '0.2')
      },
      apis: {
        jupiter: process.env.JUPITER_API_KEY,
        orca: process.env.ORCA_API_KEY,
        telegram: (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) ? {
          botToken: process.env.TELEGRAM_BOT_TOKEN,
          chatId: process.env.TELEGRAM_CHAT_ID
        } : undefined
      },
      logging: {
        level: process.env.LOG_LEVEL || 'info',
        filePath: process.env.LOG_FILE_PATH
      }
    };
  }

  private validateConfig(): void {
    const errors: string[] = [];

    // Validate required fields
    if (!this.config.rpc.primary) {
      errors.push('PRIMARY_RPC_ENDPOINT is required');
    }
    
    if (!this.config.wallet.privateKey) {
      errors.push('PRIVATE_KEY is required');
    }

    // Validate numeric ranges
    if (this.config.trading.minProfitThreshold <= 0 || this.config.trading.minProfitThreshold > 1) {
      errors.push('MIN_PROFIT_THRESHOLD must be between 0 and 1');
    }

    if (this.config.trading.slippageTolerance <= 0 || this.config.trading.slippageTolerance > 0.1) {
      errors.push('SLIPPAGE_TOLERANCE must be between 0 and 0.1');
    }

    if (this.config.risk.maxDailyLoss <= 0 || this.config.risk.maxDailyLoss > 1) {
      errors.push('MAX_DAILY_LOSS must be between 0 and 1');
    }

    if (errors.length > 0) {
      throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
    }
  }

  getConfig(): BotConfig {
    return { ...this.config }; // Return a copy to prevent external modifications
  }

  updateConfig(updates: Partial<BotConfig>): void {
    this.config = { ...this.config, ...updates };
    this.validateConfig();
  }

  // Helper methods for commonly used config values
  getRpcEndpoint(): string {
    return this.config.rpc.primary;
  }

  getWalletPrivateKey(): string {
    return this.config.wallet.privateKey;
  }

  getMinProfitThreshold(): number {
    return this.config.trading.minProfitThreshold;
  }

  getMaxTradeSize(): number {
    return this.config.trading.maxTradeSizeSol;
  }

  getSupportedTokens(): string[] {
    return [...this.config.trading.supportedTokens];
  }

  isDevelopment(): boolean {
    return this.config.rpc.primary.includes('devnet') || this.config.rpc.primary.includes('localhost');
  }

  isProduction(): boolean {
    return !this.isDevelopment();
  }
}

export const configManager = ConfigManager.getInstance();
export default configManager;
