import dotenv from 'dotenv';
import express from 'express';
import { DatabaseManager } from './utils/database';
import { DatabaseService } from './services/database';
import { DexScreenerService } from './services/dexscreener';
import { LongListService } from './services/longlist';
import { HotListService } from './services/hotlist';
import { TelegramService } from './services/telegram';
import { SchedulerService } from './services/scheduler';
import { RateLimitService } from './services/rateLimiter';
import { DataValidator } from './utils/validation';
import { RollingWindowManager } from './services/rollingWindow';
import { BackfillService } from './services/backfill';
import { globalHealthCheck } from './services/health';
import { globalJobQueue } from './services/jobQueue';
import { globalAlertBus } from './events/alertBus';
import { globalErrorHandler, withErrorHandling, createErrorContext } from './utils/errorHandler';
import { logger } from './utils/logger';

dotenv.config();

interface AppConfig {
  telegramBotToken: string;
  telegramChatId: string;
  telegramGroupChatId: string | undefined;
  databaseUrl: string;
  timezone: string;
  rateLimitMs: number;
  nodeEnv: string;
}

class FollowCoinBot {
  private db!: DatabaseService;
  private dexScreener!: DexScreenerService;
  private longList!: LongListService;
  private hotList!: HotListService;
  private telegram!: TelegramService;
  private scheduler!: SchedulerService;
  private rateLimiter!: RateLimitService;
  private validator!: DataValidator;
  private rollingWindow!: RollingWindowManager;
  private backfill!: BackfillService;
  private config: AppConfig;
  private isShuttingDown = false;

  constructor() {
    try {
      this.config = this.loadConfig();
      this.setupProcessHandlers();
    } catch (error) {
      logger.error('Error in constructor:', error);
      throw error;
    }
  }

  private loadConfig(): AppConfig {
    const requiredEnvVars = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'DATABASE_URL'];
    const missing = requiredEnvVars.filter(key => !process.env[key]);

    if (missing.length > 0) {
      const error = `Missing required environment variables: ${missing.join(', ')}`;
      logger.error('Config error:', error);
      throw new Error(error);
    }

    const config = {
      telegramBotToken: process.env.TELEGRAM_BOT_TOKEN!,
      telegramChatId: process.env.TELEGRAM_CHAT_ID!,
      telegramGroupChatId: process.env.TELEGRAM_GROUP_CHAT_ID || undefined,
      databaseUrl: process.env.DATABASE_URL!,
      timezone: process.env.TIMEZONE || 'UTC',
      rateLimitMs: parseInt(process.env.DEXSCREENER_RATE_LIMIT_MS || '200'),
      nodeEnv: process.env.NODE_ENV || 'development'
    };
    
    return config;
  }

  private setupProcessHandlers(): void {
    process.on('uncaughtException', async (error) => {
      await globalErrorHandler.handleError(error, createErrorContext('uncaught_exception'));
      logger.error('Uncaught exception:', error);
      await this.gracefulShutdown(1);
    });

    process.on('unhandledRejection', async (reason, promise) => {
      const error = reason instanceof Error ? reason : new Error(String(reason));
      await globalErrorHandler.handleError(error, createErrorContext('unhandled_rejection'));
      logger.error('Unhandled rejection at:', promise, 'reason:', reason);
    });

    process.on('SIGTERM', () => {
      logger.info('SIGTERM received, initiating graceful shutdown');
      this.gracefulShutdown(0);
    });

    process.on('SIGINT', () => {
      logger.info('SIGINT received, initiating graceful shutdown');
      this.gracefulShutdown(0);
    });
  }

  async start(): Promise<void> {
    try {
      logger.info('Starting Follow Coin Bot...', {
        nodeEnv: this.config.nodeEnv,
        timezone: this.config.timezone
      });

      await this.initializeServices();
      await this.startServices();

      logger.info('Follow Coin Bot started successfully');
      
      // Log chat configuration
      logger.info('Chat Configuration:', {
        adminChatId: this.config.telegramChatId,
        groupChatId: this.config.telegramGroupChatId || 'Not configured',
        healthAlerts: 'Admin chat only',
        tradingAlerts: this.config.telegramGroupChatId ? 'Group chat' : 'Admin chat'
      });

      // Send startup message to group if configured
      if (this.config.telegramGroupChatId) {
        await this.telegram.sendMessage(
          this.config.telegramGroupChatId,
          '🚀 **Follow Coin Bot is now online!**\n\n' +
          '✅ Health monitoring active\n' +
          '✅ Trading alerts enabled\n' +
          '✅ Commands ready\n\n' +
          'Use /help to see available commands'
        );
      }


    } catch (error) {
      await globalErrorHandler.handleError(
        error as Error, 
        createErrorContext('bot_startup')
      );
      throw error;
    }
  }

  private async initializeServices(): Promise<void> {
    logger.info('Initializing services...');

    // Initialize database first
    await DatabaseManager.initialize();
    
    this.db = new DatabaseService();
    await this.db.initialize();

    this.dexScreener = new DexScreenerService(this.config.rateLimitMs);
    this.rollingWindow = new RollingWindowManager();
    this.backfill = new BackfillService(this.dexScreener, this.rollingWindow);

    // Register job handlers
    globalJobQueue.addHandler({
      type: 'backfill_coin',
      handler: async (job) => {
        const { coinId, chain, tokenAddress } = job.data as any;
        await this.backfill.backfillCoin(coinId, chain, tokenAddress);
      }
    });

    this.longList = new LongListService(this.db, this.dexScreener, this.rollingWindow);
    this.hotList = new HotListService(this.db, this.dexScreener);

    this.telegram = new TelegramService(
      this.config.telegramBotToken,
      this.config.telegramChatId,
      this.config.telegramGroupChatId,
      this.db,
      this.longList,
      this.hotList,
      this.dexScreener
    );
    try {
      await this.telegram.start();
    } catch (error) {
      logger.error('Failed to start Telegram bot:', error);
      throw error;
    }

    // Subscribe to alert events - use existing TelegramService methods
    globalAlertBus.subscribe({
      id: 'telegram_sender',
      handler: async (event) => {
        if (event.type === 'long_trigger') {
          await this.telegram.sendTriggerAlert(event.data);
        } else if (event.type === 'hot_alert') {
          await this.telegram.sendHotAlert(event.data);
        }
      }
    });

    this.scheduler = new SchedulerService(
      this.db,
      this.longList,
      this.hotList,
      this.telegram,
      this.config.timezone
    );

    this.rateLimiter = new RateLimitService();
    this.validator = new DataValidator();

    logger.info('Services initialized successfully');
  }

  private async startServices(): Promise<void> {
    try {
      // Start background services
      globalJobQueue.start();
      
      await withErrorHandling(
        () => this.scheduler.start(),
        createErrorContext('scheduler_start')
      );

      // Start health checks
      try {
        await globalHealthCheck.performHealthCheck();
      } catch (error) {
        logger.warn('Internal health check failed, but continuing:', error);
      }

      // Start health check server AFTER all services are ready
      try {
        this.startHealthCheck();
      } catch (error) {
        logger.error('Failed to start health check HTTP server:', error);
      }

      // Trigger initial backfill for existing coins
      await globalJobQueue.addJob('initial_backfill', {}, { priority: 1 });
      globalJobQueue.addHandler({
        type: 'initial_backfill',
        handler: async () => {
          await this.backfill.backfillAllCoins();
        }
      });
    } catch (error) {
      logger.error('Error starting services:', error);
      throw error;
    }
  }

  private startHealthCheck(): void {
    const app = express();
    const port = parseInt(process.env.HEALTH_CHECK_PORT || '3002');
    
    // Health check endpoint - lightweight, no database queries
    app.get('/health', (req: express.Request, res: express.Response) => {
      try {
        const stats = {
          status: 'healthy',
          uptime: process.uptime(),
          timestamp: new Date().toISOString(),
          version: process.env.npm_package_version || '1.0.0',
          environment: this.config.nodeEnv,
          pid: process.pid,
          memory: {
            used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
            total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
            external: Math.round(process.memoryUsage().external / 1024 / 1024)
          },
          // Simple process health indicators
          process: {
            alive: true,
            scheduler: this.scheduler.isSchedulerRunning()
          }
        };
        
        res.json(stats);
      } catch (error) {
        res.status(500).json({
          status: 'unhealthy',
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString()
        });
      }
    });

    // Status endpoint for monitoring
    app.get('/status', (_req: express.Request, res: express.Response) => {
      res.json({
        status: 'running',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        pid: process.pid
      });
    });

    // Start the server
    app.listen(port, () => {
      logger.info(`Health check server started on port ${port}`);
      logger.info(`Health endpoint: http://localhost:${port}/health`);
      logger.info(`Status endpoint: http://localhost:${port}/status`);
    });

    // Self-monitoring: Check health every 5 minutes and alert if down
    setInterval(async () => {
      try {
        const response = await fetch(`http://localhost:${port}/health`);
        if (!response.ok) {
          await this.sendHealthAlert('Bot health check failed', 'error');
        }
      } catch (error) {
        await this.sendHealthAlert('Bot health check server unreachable', 'critical');
      }
    }, 300000); // Every 5 minutes
  }

  private async sendHealthAlert(message: string, level: 'warning' | 'error' | 'critical'): Promise<void> {
    try {
      const alertMessage = `🚨 **Bot Health Alert**\n\n` +
        `**Level**: ${level.toUpperCase()}\n` +
        `**Message**: ${message}\n` +
        `**Time**: ${new Date().toISOString()}\n` +
        `**Uptime**: ${Math.floor(process.uptime() / 60)} minutes\n` +
        `**PID**: ${process.pid}`;

      await this.telegram.sendMessage(this.config.telegramChatId, alertMessage);
      logger.warn(`Health alert sent to admin chat: ${message}`);
    } catch (error) {
      logger.error('Failed to send health alert:', error);
    }
  }

  async gracefulShutdown(exitCode: number): Promise<void> {
    if (this.isShuttingDown) {
      logger.warn('Shutdown already in progress, forcing exit');
      process.exit(exitCode);
    }

    this.isShuttingDown = true;
    logger.info('Initiating graceful shutdown...');

    const shutdownTimeout = setTimeout(() => {
      logger.error('Shutdown timeout exceeded, forcing exit');
      process.exit(1);
    }, 30000); // 30 second timeout

    try {
      if (this.scheduler) {
        this.scheduler.stop();
        logger.info('Scheduler stopped');
      }

      if (this.rollingWindow) {
        this.rollingWindow.stop();
        logger.info('Rolling window manager stopped');
      }

      globalJobQueue.stop();
      globalHealthCheck.stop();
      logger.info('Background services stopped');

      if (this.telegram) {
        await this.telegram.stop();
        logger.info('Telegram service stopped');
      }

      if (this.db) {
        await this.db.disconnect();
        logger.info('Database service stopped');
      }
    } catch (error) {
      logger.error('Error during service shutdown:', error);
    } finally {
      await DatabaseManager.disconnect();
      logger.info('Database disconnected');

      clearTimeout(shutdownTimeout);
      logger.info('Graceful shutdown completed');
      process.exit(exitCode);
    }
  }
}

async function main(): Promise<void> {
  try {
    const bot = new FollowCoinBot();
    await bot.start();
    
    // Keep the process alive - the bot needs to stay running
    
    // Set up graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('Received SIGINT, shutting down gracefully...');
      await bot.gracefulShutdown(0);
    });
    
    process.on('SIGTERM', async () => {
      logger.info('Received SIGTERM, shutting down gracefully...');
      await bot.gracefulShutdown(0);
    });
    
    // Keep the process alive indefinitely
    await new Promise(() => {
      // This promise never resolves, keeping the process running
    });
    
  } catch (error) {
    logger.error('Failed to start bot:', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : 'No stack trace',
      errorObject: error
    });
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((error) => {
    logger.error('Failed to start bot:', error);
    process.exit(1);
  });
}

export { FollowCoinBot };
export default main;