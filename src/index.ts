import dotenv from 'dotenv';
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
import { MigrationService } from './services/migration';
import { globalHealthCheck } from './services/health';
import { globalJobQueue } from './services/jobQueue';
import { globalAlertBus } from './events/alertBus';
import { globalErrorHandler, withErrorHandling, createErrorContext } from './utils/errorHandler';
import { logger } from './utils/logger';

dotenv.config();

interface AppConfig {
  telegramBotToken: string;
  telegramChatId: string;
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
  private migration!: MigrationService;
  private config: AppConfig;
  private isShuttingDown = false;

  constructor() {
    console.log('=== CONSTRUCTOR START ===');
    try {
      this.config = this.loadConfig();
      console.log('Config loaded successfully:', {
        telegramBotToken: this.config.telegramBotToken ? 'SET' : 'NOT SET',
        telegramChatId: this.config.telegramChatId ? 'SET' : 'NOT SET',
        databaseUrl: this.config.databaseUrl ? 'SET' : 'NOT SET',
        timezone: this.config.timezone,
        rateLimitMs: this.config.rateLimitMs,
        nodeEnv: this.config.nodeEnv
      });
      this.setupProcessHandlers();
      console.log('=== CONSTRUCTOR COMPLETE ===');
    } catch (error) {
      console.error('=== CONSTRUCTOR ERROR ===');
      console.error('Error in constructor:', error);
      throw error;
    }
  }

  private loadConfig(): AppConfig {
    const requiredEnvVars = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'DATABASE_URL'];
    const missing = requiredEnvVars.filter(key => !process.env[key]);

    console.log('Required env vars:', requiredEnvVars);
    console.log('Missing env vars:', missing);
    console.log('process.env.TELEGRAM_BOT_TOKEN:', process.env.TELEGRAM_BOT_TOKEN ? 'SET' : 'NOT SET');
    console.log('process.env.TELEGRAM_CHAT_ID:', process.env.TELEGRAM_CHAT_ID ? 'SET' : 'NOT SET');
    console.log('process.env.DATABASE_URL:', process.env.DATABASE_URL ? 'SET' : 'NOT SET');

    if (missing.length > 0) {
      const error = `Missing required environment variables: ${missing.join(', ')}`;
      console.error('Config error:', error);
      throw new Error(error);
    }

    const config = {
      telegramBotToken: process.env.TELEGRAM_BOT_TOKEN!,
      telegramChatId: process.env.TELEGRAM_CHAT_ID!,
      databaseUrl: process.env.DATABASE_URL!,
      timezone: process.env.TIMEZONE || 'UTC',
      rateLimitMs: parseInt(process.env.DEXSCREENER_RATE_LIMIT_MS || '200'),
      nodeEnv: process.env.NODE_ENV || 'development'
    };
    
    console.log('Config loaded successfully');
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

      if (this.config.nodeEnv === 'development') {
        this.startHealthCheck();
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
    
    // Run migrations
    this.migration = new MigrationService();
    await this.migration.runMigrations();

    this.db = new DatabaseService();
    await this.db.initialize();

    this.dexScreener = new DexScreenerService(this.config.rateLimitMs);
    this.rollingWindow = new RollingWindowManager();
    this.backfill = new BackfillService(this.dexScreener, this.rollingWindow);

    // Register job handlers
    globalJobQueue.addHandler({
      type: 'backfill_coin',
      handler: async (job) => {
        const { coinId, chain, pairAddress } = job.data as any;
        await this.backfill.backfillCoin(coinId, chain, pairAddress);
      }
    });

    this.longList = new LongListService(this.db, this.dexScreener, this.rollingWindow);
    this.hotList = new HotListService(this.db, this.dexScreener);

    this.telegram = new TelegramService(
      this.config.telegramBotToken,
      this.config.telegramChatId,
      this.db,
      this.longList,
      this.hotList,
      this.dexScreener
    );
    console.log('Telegram service created, starting bot...');
    try {
      await this.telegram.start();
      console.log('Telegram bot started and connected!');
    } catch (error) {
      console.error('Failed to start Telegram bot:', error);
      throw error;
    }

    // Subscribe to alert events
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
    console.log('=== STARTING SERVICES ===');
    try {
      // Start background services
      console.log('Starting job queue...');
      globalJobQueue.start();
      console.log('Job queue started');
      
      console.log('Starting scheduler...');
      await withErrorHandling(
        () => this.scheduler.start(),
        createErrorContext('scheduler_start')
      );
      console.log('Scheduler started');

      // Start health checks
      console.log('Starting health checks...');
      await globalHealthCheck.performHealthCheck();
      console.log('Health checks started');

      // Trigger initial backfill for existing coins
      console.log('Setting up initial backfill...');
      await globalJobQueue.addJob('initial_backfill', {}, { priority: 1 });
      globalJobQueue.addHandler({
        type: 'initial_backfill',
        handler: async () => {
          await this.backfill.backfillAllCoins();
        }
      });
      console.log('Initial backfill setup complete');

      console.log('=== ALL SERVICES STARTED ===');
    } catch (error) {
      console.error('Error starting services:', error);
      throw error;
    }
  }

  private startHealthCheck(): void {
    setInterval(async () => {
      const stats = {
        rateLimitStats: this.rateLimiter.getRateLimitStats(),
        errorStats: globalErrorHandler.getErrorStats(),
        schedulerRunning: this.scheduler.isSchedulerRunning(),
        jobQueueStats: globalJobQueue.getStats(),
        alertBusStats: globalAlertBus.getStats(),
        healthStatus: await globalHealthCheck.getHealthStatus(),
        timestamp: new Date().toISOString()
      };

      logger.debug('Health check:', stats);
    }, 60000); // Every minute in development
  }

  async gracefulShutdown(exitCode: number): Promise<void> {
    if (this.isShuttingDown) {
      logger.warn('Shutdown already in progress, forcing exit');
      process.exit(exitCode);
    }

    this.isShuttingDown = true;
    logger.info('Initiating graceful shutdown...');

    try {
      const shutdownTimeout = setTimeout(() => {
        logger.error('Shutdown timeout exceeded, forcing exit');
        process.exit(1);
      }, 30000); // 30 second timeout

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

      await DatabaseManager.disconnect();
      logger.info('Database disconnected');

      clearTimeout(shutdownTimeout);
      logger.info('Graceful shutdown completed');
      process.exit(exitCode);

    } catch (error) {
      logger.error('Error during shutdown:', error);
      process.exit(1);
    }
  }
}

async function main(): Promise<void> {
  console.log('=== STARTING MAIN FUNCTION ===');
  try {
    console.log('Creating FollowCoinBot instance...');
    const bot = new FollowCoinBot();
    console.log('Starting bot...');
    await bot.start();
    console.log('Bot started successfully!');
    
    // Keep the process alive - the bot needs to stay running
    console.log('Bot is now running. Press Ctrl+C to stop.');
    
    // Set up graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\nReceived SIGINT, shutting down gracefully...');
      await bot.gracefulShutdown(0);
    });
    
    process.on('SIGTERM', async () => {
      console.log('\nReceived SIGTERM, shutting down gracefully...');
      await bot.gracefulShutdown(0);
    });
    
    // Keep the process alive indefinitely
    await new Promise(() => {
      // This promise never resolves, keeping the process running
    });
    
  } catch (error) {
    console.error('=== MAIN FUNCTION ERROR ===');
    console.error('Error type:', typeof error);
    console.error('Error message:', error instanceof Error ? error.message : String(error));
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    console.error('Full error object:', error);
    logger.error('Failed to start bot:', error);
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