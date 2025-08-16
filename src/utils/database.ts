import { PrismaClient } from '@prisma/client';
import { logger } from './logger';

export class DatabaseManager {
  private static instance: PrismaClient | null = null;
  private static isInitialized = false;

  static getInstance(): PrismaClient {
    if (!this.instance) {
      this.instance = new PrismaClient({
        log: [
          { emit: 'event', level: 'query' },
          { emit: 'event', level: 'error' },
          { emit: 'event', level: 'info' },
          { emit: 'event', level: 'warn' }
        ],
        datasources: {
          db: {
            url: process.env.DATABASE_URL || 'file:./dev.db'
          }
        }
      });

      // Note: Prisma event handlers commented out due to type issues
      // this.instance.$on('error', (e) => {
      //   logger.error('Prisma error:', e);
      // });

      // if (process.env.NODE_ENV === 'development') {
      //   this.instance.$on('query', (e) => {
      //     logger.debug(`Query: ${e.query} Params: ${e.params} Duration: ${e.duration}ms`);
      //   });
      // }
    }

    return this.instance;
  }

  static async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      const prisma = this.getInstance();
      await prisma.$connect();
      
      // Enable WAL mode for better concurrency
      // Note: journal_mode PRAGMA returns results, so we need to handle it differently
      try {
        await prisma.$executeRaw`PRAGMA journal_mode=WAL`;
        logger.info('WAL mode enabled');
      } catch (error) {
        logger.warn('Could not enable WAL mode, continuing with default:', error);
      }
      
      await prisma.$executeRaw`PRAGMA synchronous=NORMAL`;
      await prisma.$executeRaw`PRAGMA temp_store=MEMORY`;
      await prisma.$executeRaw`PRAGMA cache_size=10000`;

      await this.ensureDefaultConfig();
      
      this.isInitialized = true;
      logger.info('Database initialized successfully with optimized settings');
    } catch (error) {
      logger.error('Failed to initialize database:', error);
      throw error;
    }
  }

  private static async ensureDefaultConfig(): Promise<void> {
    const prisma = this.getInstance();
    
    const existingConfig = await prisma.scheduleCfg.findUnique({
      where: { cfgId: 1 }
    });

    if (!existingConfig) {
      await prisma.scheduleCfg.create({
        data: {
          cfgId: 1,
          anchorTimesLocal: '08:00,20:00',
          anchorPeriodHours: 12,
          longCheckpointHours: 6,
          hotIntervalMinutes: 5,
          cooldownHours: 2.0,
          hysteresisPct: 30.0
        }
      });
      logger.info('Created default schedule configuration');
    }
  }

  static async disconnect(): Promise<void> {
    if (this.instance) {
      await this.instance.$disconnect();
      this.instance = null;
      this.isInitialized = false;
      logger.info('Database disconnected');
    }
  }

  static async healthCheck(): Promise<{ healthy: boolean; latency: number; error?: string }> {
    try {
      const start = Date.now();
      await this.getInstance().$queryRaw`SELECT 1`;
      const latency = Date.now() - start;
      
      return { healthy: true, latency };
    } catch (error) {
      return { 
        healthy: false, 
        latency: -1, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }
}