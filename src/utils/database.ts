import { PrismaClient } from '@prisma/client';
import { logger } from './logger';

// Configuration constants - keep in sync with scheduler!
const HOT_LIST_CHECK_INTERVAL_MINUTES = 1; // Change this to whatever you want!

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

  static async initialize(retries = 3, delay = 2000): Promise<void> {
    if (this.isInitialized) return;

    for (let i = 0; i < retries; i++) {
      try {
        const prisma = this.getInstance();
        await prisma.$connect();
        
        // Enable WAL mode for better concurrency
        // Note: journal_mode PRAGMA returns results, so we need to handle it differently
        try {
          await prisma.$queryRaw`PRAGMA journal_mode=WAL`;
          logger.info('WAL mode enabled');
        } catch (error) {
          logger.warn('Could not enable WAL mode, continuing with default:', error);
        }
        
        await prisma.$queryRaw`PRAGMA synchronous=NORMAL`;
        await prisma.$queryRaw`PRAGMA temp_store=MEMORY`;
        await prisma.$queryRaw`PRAGMA cache_size=10000`;
        await prisma.$queryRaw`PRAGMA mmap_size=268435456`; // 256MB mmap limit
        await prisma.$queryRaw`PRAGMA soft_heap_limit=104857600`; // 100MB heap limit

        await this.ensureDefaultConfig();
        
        this.isInitialized = true;
        logger.info('Database initialized successfully with optimized settings');
        return; // Success, exit the loop
      } catch (error) {
        logger.error(`Failed to initialize database on attempt ${i + 1}/${retries}:`, error);
        if (i < retries - 1) {
          logger.info(`Retrying in ${delay / 1000} seconds...`);
          await new Promise(res => setTimeout(res, delay));
        } else {
          logger.error('All database initialization attempts failed.');
          throw error;
        }
      }
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
          hotIntervalMinutes: 1,
          cooldownHours: 2.0,
          globalRetraceOn: true,
          globalStallOn: true,
          globalBreakoutOn: true,
          globalMcapOn: false
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

  // MEMORY LEAK FIX: Force database connection cleanup
  static async forceCleanup(): Promise<void> {
    if (this.instance) {
      try {
        // Force SQLite to checkpoint WAL and free memory
        await this.instance.$queryRaw`PRAGMA wal_checkpoint(TRUNCATE)`;
        await this.instance.$queryRaw`PRAGMA shrink_memory`;
        logger.info('Database memory cleanup completed');
      } catch (error) {
        logger.warn('Database cleanup failed:', error);
      }
    }
  }
}