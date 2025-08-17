import fs from 'fs';
import path from 'path';
import axios from 'axios';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

export class Logger {
  private static instance: Logger;
  private logLevel: LogLevel = LogLevel.INFO;
  private logFile?: string;
  private telegramBot?: {
    token: string;
    chatId: string;
  };

  private constructor() {
    // Set log level from environment
    const envLogLevel = process.env.LOG_LEVEL?.toLowerCase();
    switch (envLogLevel) {
      case 'debug': this.logLevel = LogLevel.DEBUG; break;
      case 'info': this.logLevel = LogLevel.INFO; break;
      case 'warn': this.logLevel = LogLevel.WARN; break;
      case 'error': this.logLevel = LogLevel.ERROR; break;
    }

    // Set log file
    if (process.env.LOG_FILE_PATH) {
      this.logFile = process.env.LOG_FILE_PATH;
      this.ensureLogDirectory();
    }

    // Set Telegram bot for alerts
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
      this.telegramBot = {
        token: process.env.TELEGRAM_BOT_TOKEN,
        chatId: process.env.TELEGRAM_CHAT_ID
      };
    }
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  private ensureLogDirectory() {
    if (this.logFile) {
      const dir = path.dirname(this.logFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  private formatMessage(level: string, message: string, data?: any): string {
    const timestamp = new Date().toISOString();
    const dataStr = data ? ` | ${JSON.stringify(data)}` : '';
    return `[${timestamp}] ${level}: ${message}${dataStr}`;
  }

  private writeToFile(message: string) {
    if (this.logFile) {
      try {
        fs.appendFileSync(this.logFile, message + '\n');
      } catch (error) {
        console.error('Failed to write to log file:', error);
      }
    }
  }

  private async sendTelegramAlert(message: string, level: LogLevel) {
    if (!this.telegramBot || level < LogLevel.WARN) return;

    try {
      const emoji = level === LogLevel.ERROR ? '🚨' : '⚠️';
      const text = `${emoji} Bot Alert: ${message}`;
      
      await axios.post(`https://api.telegram.org/bot${this.telegramBot.token}/sendMessage`, {
        chat_id: this.telegramBot.chatId,
        text,
        parse_mode: 'HTML'
      });
    } catch (error) {
      console.error('Failed to send Telegram alert:', error);
    }
  }

  debug(message: string, data?: any) {
    if (this.logLevel <= LogLevel.DEBUG) {
      const formatted = this.formatMessage('DEBUG', message, data);
      console.log('\x1b[36m%s\x1b[0m', formatted); // Cyan
      this.writeToFile(formatted);
    }
  }

  info(message: string, data?: any) {
    if (this.logLevel <= LogLevel.INFO) {
      const formatted = this.formatMessage('INFO', message, data);
      console.log(formatted);
      this.writeToFile(formatted);
    }
  }

  warn(message: string, data?: any) {
    if (this.logLevel <= LogLevel.WARN) {
      const formatted = this.formatMessage('WARN', message, data);
      console.log('\x1b[33m%s\x1b[0m', formatted); // Yellow
      this.writeToFile(formatted);
      this.sendTelegramAlert(message, LogLevel.WARN);
    }
  }

  error(message: string, data?: any) {
    if (this.logLevel <= LogLevel.ERROR) {
      const formatted = this.formatMessage('ERROR', message, data);
      console.log('\x1b[31m%s\x1b[0m', formatted); // Red
      this.writeToFile(formatted);
      this.sendTelegramAlert(message, LogLevel.ERROR);
    }
  }

  trade(message: string, data?: any) {
    const formatted = this.formatMessage('TRADE', message, data);
    console.log('\x1b[32m%s\x1b[0m', formatted); // Green
    this.writeToFile(formatted);
  }

  profit(amount: number, token = 'SOL') {
    const message = `Profit realized: +${amount.toFixed(6)} ${token}`;
    const formatted = this.formatMessage('PROFIT', message);
    console.log('\x1b[42m%s\x1b[0m', formatted); // Green background
    this.writeToFile(formatted);
    
    if (this.telegramBot) {
      this.sendTelegramAlert(`💰 ${message}`, LogLevel.INFO);
    }
  }

  loss(amount: number, token = 'SOL') {
    const message = `Loss incurred: -${Math.abs(amount).toFixed(6)} ${token}`;
    const formatted = this.formatMessage('LOSS', message);
    console.log('\x1b[41m%s\x1b[0m', formatted); // Red background
    this.writeToFile(formatted);
    
    if (this.telegramBot) {
      this.sendTelegramAlert(`📉 ${message}`, LogLevel.WARN);
    }
  }
}
