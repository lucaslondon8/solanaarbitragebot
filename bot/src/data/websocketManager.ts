import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { TokenPrice } from '../types';
import { Logger } from '../utils/logger';

const logger = Logger.getInstance();

export class WebSocketManager extends EventEmitter {
  private connections: Map<string, WebSocket> = new Map();
  private reconnectIntervals: Map<string, NodeJS.Timeout> = new Map();
  private heartbeatIntervals: Map<string, NodeJS.Timeout> = new Map();

  async initialize() {
    logger.info('🔄 Initializing WebSocket connections...');
    
    // Initialize all data feeds
    await Promise.allSettled([
      this.initializeBirdeyeWS(),
      this.initializeSerum(),
      this.initializePyth(),
      this.initializeCustomFeeds()
    ]);

    logger.info('✅ WebSocket connections initialized');
  }

  private async initializeBirdeyeWS() {
    try {
      const ws = new WebSocket('wss://public-api.birdeye.so/socket');
      this.connections.set('birdeye', ws);

      ws.on('open', () => {
        logger.info('✅ Birdeye WebSocket connected');
        
        // Subscribe to token price updates
        const subscribeMessage = {
          type: 'SUBSCRIBE_PRICE',
          data: {
            chainId: 'solana',
            addresses: [
              'So11111111111111111111111111111111111111112', // SOL
              'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
              'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
              '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', // RAY
              'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE'  // ORCA
            ]
          }
        };
        
        ws.send(JSON.stringify(subscribeMessage));
      });

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleBirdeyeMessage(message);
        } catch (error) {
          logger.warn('Failed to parse Birdeye message:', error);
        }
      });

      ws.on('close', () => {
        logger.warn('❌ Birdeye WebSocket disconnected');
        this.scheduleReconnect('birdeye', () => this.initializeBirdeyeWS());
      });

      ws.on('error', (error) => {
        logger.error('Birdeye WebSocket error:', error);
      });

      this.setupHeartbeat('birdeye', ws);

    } catch (error) {
      logger.error('Failed to initialize Birdeye WebSocket:', error);
    }
  }

  private handleBirdeyeMessage(message: any) {
    if (message.type === 'PRICE_DATA') {
      const tokenPrice: TokenPrice = {
        symbol: this.getTokenSymbol(message.data.address),
        mint: message.data.address,
        price: message.data.price,
        source: 'Birdeye',
        timestamp: Date.now(),
        liquidity: message.data.liquidity,
        volume24h: message.data.volume24h
      };
      
      this.emit('priceUpdate', tokenPrice);
    }
  }

  private async initializeSerum() {
    try {
      // Serum DEX WebSocket connection
      const ws = new WebSocket('wss://serum-ws.projectserum.com');
      this.connections.set('serum', ws);

      ws.on('open', () => {
        logger.info('✅ Serum WebSocket connected');
        
        // Subscribe to market data
        const subscribeMessage = {
          op: 'subscribe',
          channel: 'level2',
          markets: [
            'A8YFbxQYFVqKZaoYJLLUVcQiWP7G2MeEgW5wsAQgMvFw', // SOL/USDC
            '9wFFyRfZBsuAha4YcuxcXLKwMxJR43S7fPfQLusDBzvT', // SOL/USDT
            // Add more Serum market addresses
          ]
        };
        
        ws.send(JSON.stringify(subscribeMessage));
      });

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleSerumMessage(message);
        } catch (error) {
          logger.warn('Failed to parse Serum message:', error);
        }
      });

      ws.on('close', () => {
        logger.warn('❌ Serum WebSocket disconnected');
        this.scheduleReconnect('serum', () => this.initializeSerum());
      });

      this.setupHeartbeat('serum', ws);

    } catch (error) {
      logger.error('Failed to initialize Serum WebSocket:', error);
    }
  }

  private handleSerumMessage(message: any) {
    if (message.type === 'l2update') {
      // Process Serum order book updates
      const midPrice = this.calculateMidPrice(message.bids, message.asks);
      if (midPrice) {
        const tokenPrice: TokenPrice = {
          symbol: this.getTokenSymbolFromMarket(message.market),
          mint: message.market,
          price: midPrice,
          source: 'Serum',
          timestamp: Date.now()
        };
        
        this.emit('priceUpdate', tokenPrice);
      }
    }
  }

  private async initializePyth() {
    try {
      // Pyth Network price feeds
      const ws = new WebSocket('wss://api.pythnet.io/ws');
      this.connections.set('pyth', ws);

      ws.on('open', () => {
        logger.info('✅ Pyth WebSocket connected');
        
        // Subscribe to price feeds
        const subscribeMessage = {
          method: 'subscribe',
          params: [
            'H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG', // SOL/USD
            'Gnt27xtC473ZT2Mw5u8wZ68Z3gULkSTb5DuxJy7eJotD', // USDC/USD
            // Add more Pyth price feed IDs
          ]
        };
        
        ws.send(JSON.stringify(subscribeMessage));
      });

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handlePythMessage(message);
        } catch (error) {
          logger.warn('Failed to parse Pyth message:', error);
        }
      });

      ws.on('close', () => {
        logger.warn('❌ Pyth WebSocket disconnected');
        this.scheduleReconnect('pyth', () => this.initializePyth());
      });

      this.setupHeartbeat('pyth', ws);

    } catch (error) {
      logger.error('Failed to initialize Pyth WebSocket:', error);
    }
  }

  private handlePythMessage(message: any) {
    if (message.type === 'price_update') {
      const tokenPrice: TokenPrice = {
        symbol: this.getTokenSymbolFromPythFeed(message.price_feed),
        mint: message.price_feed,
        price: message.price,
        source: 'Pyth',
        timestamp: Date.now()
      };
      
      this.emit('priceUpdate', tokenPrice);
    }
  }

  private async initializeCustomFeeds() {
    // Add custom WebSocket feeds for other DEXes
    // Example: Meteora, Phoenix, etc.
    logger.debug('Custom feeds initialized (placeholder)');
  }

  private setupHeartbeat(name: string, ws: WebSocket) {
    const interval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      } else {
        clearInterval(interval);
        this.heartbeatIntervals.delete(name);
      }
    }, 30000); // Ping every 30 seconds

    this.heartbeatIntervals.set(name, interval);
  }

  private scheduleReconnect(name: string, reconnectFn: () => void) {
    // Clear existing reconnect timer
    const existingTimer = this.reconnectIntervals.get(name);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Schedule reconnect with exponential backoff
    const reconnectDelay = Math.min(30000, 1000 * Math.pow(2, this.getReconnectAttempts(name)));
    
    const timer = setTimeout(() => {
      logger.info(`🔄 Attempting to reconnect ${name}...`);
      reconnectFn();
    }, reconnectDelay);

    this.reconnectIntervals.set(name, timer);
  }

  private getReconnectAttempts(name: string): number {
    // Track reconnect attempts per connection
    // Implementation depends on your needs
    return 1; // Simplified
  }

  // Helper methods
  private getTokenSymbol(address: string): string {
    const tokenMap: { [key: string]: string } = {
      'So11111111111111111111111111111111111111112': 'SOL',
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 'USDC',
      'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 'USDT',
      '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R': 'RAY',
      'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE': 'ORCA'
    };
    
    return tokenMap[address] || 'UNKNOWN';
  }

  private getTokenSymbolFromMarket(market: string): string {
    // Map Serum market addresses to token symbols
    const marketMap: { [key: string]: string } = {
      'A8YFbxQYFVqKZaoYJLLUVcQiWP7G2MeEgW5wsAQgMvFw': 'SOL',
      '9wFFyRfZBsuAha4YcuxcXLKwMxJR43S7fPfQLusDBzvT': 'SOL'
    };
    
    return marketMap[market] || 'UNKNOWN';
  }

  private getTokenSymbolFromPythFeed(feed: string): string {
    // Map Pyth feed IDs to token symbols
    const feedMap: { [key: string]: string } = {
      'H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG': 'SOL',
      'Gnt27xtC473ZT2Mw5u8wZ68Z3gULkSTb5DuxJy7eJotD': 'USDC'
    };
    
    return feedMap[feed] || 'UNKNOWN';
  }

  private calculateMidPrice(bids: any[], asks: any[]): number | null {
    if (!bids.length || !asks.length) return null;
    
    const bestBid = Math.max(...bids.map(bid => bid[0]));
    const bestAsk = Math.min(...asks.map(ask => ask[0]));
    
    return (bestBid + bestAsk) / 2;
  }

  cleanup() {
    // Close all connections
    for (const [name, ws] of this.connections.entries()) {
      ws.close();
      logger.info(`Closed WebSocket connection: ${name}`);
    }

    // Clear all intervals
    for (const interval of this.reconnectIntervals.values()) {
      clearTimeout(interval);
    }
    
    for (const interval of this.heartbeatIntervals.values()) {
      clearInterval(interval);
    }

    this.connections.clear();
    this.reconnectIntervals.clear();
    this.heartbeatIntervals.clear();
  }
}
