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
import { registerHeliusWebhookRoutes } from './services/heliusWebhook';
import { WebSocketIngestService } from './services/ws';
import { globalMemoryMonitor } from './services/memoryMonitor';
import { globalDatabaseCleanup } from './services/databaseCleanup';
// On-demand report via Telegram command; no scheduler import here

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
  private wsIngest: WebSocketIngestService | null = null;

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
      logger.warn('SIGTERM received - possible process manager restart or system shutdown');
      logger.info('Process info at shutdown:', {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        pid: process.pid,
        ppid: process.ppid
      });
      this.gracefulShutdown(0);
    });

    process.on('SIGINT', () => {
      logger.warn('SIGINT received - manual termination or monitoring system intervention');
      logger.info('Process info at shutdown:', {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        pid: process.pid,
        ppid: process.ppid
      });
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

      // Startup message removed - only send on /start command to avoid spam


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
      this.dexScreener,
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
      
      // Start memory monitoring
      globalMemoryMonitor.start();
      
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

      // Optionally start WebSocket ingest (feature flag)
      if ((process.env.WS_ENABLED || 'false') === 'true') {
        try {
          this.wsIngest = new WebSocketIngestService();
          this.wsIngest.start();
          logger.info('WebSocket ingest enabled');
        } catch (e) {
          logger.error('Failed to start WS ingest', e);
        }
      }

      // Mint 24H report is on-demand via /mints_24h; no scheduler setup

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
        const memStats = globalMemoryMonitor.getStats();
        const stats = {
          status: memStats.analysis.memoryPressure === 'critical' ? 'unhealthy' : 'healthy',
          uptime: process.uptime(),
          timestamp: new Date().toISOString(),
          version: process.env.npm_package_version || '1.0.0',
          environment: this.config.nodeEnv,
          pid: process.pid,
          memory: {
            rss: memStats.current.rss,
            heapUsed: memStats.current.heapUsed,
            heapTotal: memStats.current.heapTotal,
            external: memStats.current.external,
            arrayBuffers: memStats.current.arrayBuffers,
            pressure: memStats.analysis.memoryPressure,
            largestComponent: memStats.analysis.largestComponent,
            externalToHeapRatio: memStats.analysis.externalToHeapRatio
          },
          trends: {
            heapGrowthRateMBPerHour: memStats.trends.heapGrowthRate,
            externalGrowthRateMBPerHour: memStats.trends.externalGrowthRate,
            rssGrowthRateMBPerHour: memStats.trends.rssGrowthRate,
            memoryLeakWarning: memStats.trends.memoryLeakWarning
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

    // Memory analysis endpoint with detailed breakdown
    app.get('/memory', (_req: express.Request, res: express.Response) => {
      try {
        const memStats = globalMemoryMonitor.getStats();
        const breakdown = globalMemoryMonitor.getMemoryBreakdown();
        
        res.json({
          current: memStats.current,
          analysis: memStats.analysis,
          trends: memStats.trends,
          history: memStats.history, // Last 2 hours
          breakdown: breakdown,
          recommendations: breakdown.recommendations
        });
      } catch (error) {
        res.status(500).json({
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString()
        });
      }
    });

    // Force GC and analyze memory impact (debugging endpoint)
    app.post('/memory/gc', (_req: express.Request, res: express.Response) => {
      try {
        const result = globalMemoryMonitor.forceGCAndAnalyze();
        res.json(result);
      } catch (error) {
        res.status(500).json({
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString()
        });
      }
    });

    // Database cleanup analysis endpoint
    app.get('/database/cleanup', async (_req: express.Request, res: express.Response) => {
      try {
        const [analysis, recommendations] = await Promise.all([
          globalDatabaseCleanup.analyzeCleanupImpact(3),
          globalDatabaseCleanup.getCleanupRecommendations()
        ]);
        
        res.json({
          analysis,
          recommendations,
          isCleanupRunning: globalDatabaseCleanup.isCleanupRunning()
        });
      } catch (error) {
        res.status(500).json({
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString()
        });
      }
    });

    // Database cleanup execution endpoint (POST for safety)
    app.post('/database/cleanup', async (req: express.Request, res: express.Response) => {
      try {
        const { daysToKeep = 3, dryRun = true } = req.body || {};
        
        if (!dryRun && req.headers['x-confirm-cleanup'] !== 'true') {
          res.status(400).json({
            error: 'Live cleanup requires X-Confirm-Cleanup: true header'
          });
          return;
        }

        const result = await globalDatabaseCleanup.performCleanup(daysToKeep, dryRun);
        res.json(result);
      } catch (error) {
        res.status(500).json({
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString()
        });
      }
    });

    // Register Helius webhook route
    try {
      registerHeliusWebhookRoutes(app);
      logger.info('Helius webhook route registered at /webhooks/helius');
    } catch (e) {
      logger.error('Failed to register Helius webhook route', e);
    }

    // Start the server
    app.listen(port, () => {
      logger.info(`Health check server started on port ${port}`);
      logger.info(`Health endpoint: http://localhost:${port}/health`);
      logger.info(`Status endpoint: http://localhost:${port}/status`);
    });

    // Self-monitoring: Check health every 5 minutes and alert if down or memory high
    setInterval(async () => {
      try {
        const response = await fetch(`http://localhost:${port}/health`);
        if (!response.ok) {
          await this.sendHealthAlert('Bot health check failed', 'error');
        } else {
          const healthData = await response.json() as any;
          
          // Only alert on truly critical memory (95%+ of limit)
          if (healthData.memory?.pressure === 'critical') {
            await this.sendHealthAlert(
              `Critical memory usage: ${healthData.memory.rss}MB (${healthData.memory.largestComponent} is largest component)`,
              'critical'
            );
          }
          
          // Alert on confirmed memory leaks only (requires 2+ hours of data)
          if (healthData.trends?.memoryLeakWarning && healthData.memory?.rss > 300) {
            await this.sendHealthAlert(
              `Confirmed memory leak: ${healthData.memory.rss}MB, growing at ${healthData.trends.rssGrowthRateMBPerHour}MB/hour`,
              'error'
            );
          }
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
      globalMemoryMonitor.stop();
      logger.info('Background services stopped');

      if (this.telegram) {
        await this.telegram.stop();
        logger.info('Telegram service stopped');
      }

      if (this.db) {
        await this.db.disconnect();
        logger.info('Database service stopped');
      }
      if (this.wsIngest) {
        this.wsIngest.stop();
        logger.info('WS ingest stopped');
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
    // Note: Signal handlers are already set up in the FollowCoinBot constructor
    
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