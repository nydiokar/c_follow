import { DatabaseManager } from '../utils/database';
import { logger } from '../utils/logger';

export interface DataPoint {
  timestamp: number;
  price: number;
  volume: number;
  marketCap?: number;
}

export interface RollingStats {
  h12High?: number;
  h24High?: number;
  h72High?: number;
  h12Low?: number;
  h24Low?: number;
  h72Low?: number;
  v12Sum?: number;
  v24Sum?: number;
}

export class RollingWindowManager {
  private readonly CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour
  private cleanupTimer: NodeJS.Timeout | undefined = undefined;

  constructor() {
    this.startCleanupTimer();
  }

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupOldData().catch(error => {
        logger.error('Failed to cleanup old rolling window data:', error);
      });
    }, this.CLEANUP_INTERVAL);
  }

  async addDataPoint(coinId: number, dataPoint: DataPoint): Promise<void> {
    const prisma = DatabaseManager.getInstance();
    
    try {
      // Store the data point for rolling calculations
      await prisma.$executeRaw`
        INSERT INTO rolling_data_points (coin_id, timestamp, price, volume, market_cap)
        VALUES (${coinId}, ${dataPoint.timestamp}, ${dataPoint.price}, ${dataPoint.volume}, ${dataPoint.marketCap})
      `;

      // Update rolling stats
      const stats = await this.calculateRollingStats(coinId, dataPoint.timestamp);
      await this.updateLongState(coinId, dataPoint, stats);

    } catch (error) {
      logger.error(`Failed to add data point for coin ${coinId}:`, error);
      throw error;
    }
  }

  private async calculateRollingStats(coinId: number, currentTime: number): Promise<RollingStats> {
    const prisma = DatabaseManager.getInstance();
    const h12Ago = currentTime - (12 * 60 * 60);
    const h24Ago = currentTime - (24 * 60 * 60);
    const h72Ago = currentTime - (72 * 60 * 60);

    try {
      // Get price stats for different time windows
      const [h12Stats, h24Stats, h72Stats] = await Promise.all([
        prisma.$queryRaw<Array<{ high: number; low: number }>>`
          SELECT MAX(price) as high, MIN(price) as low
          FROM rolling_data_points 
          WHERE coin_id = ${coinId} AND timestamp >= ${h12Ago}
        `,
        prisma.$queryRaw<Array<{ high: number; low: number }>>`
          SELECT MAX(price) as high, MIN(price) as low
          FROM rolling_data_points 
          WHERE coin_id = ${coinId} AND timestamp >= ${h24Ago}
        `,
        prisma.$queryRaw<Array<{ high: number; low: number }>>`
          SELECT MAX(price) as high, MIN(price) as low
          FROM rolling_data_points 
          WHERE coin_id = ${coinId} AND timestamp >= ${h72Ago}
        `
      ]);

      // Get volume stats
      const [v12Sum, v24Sum] = await Promise.all([
        prisma.$queryRaw<Array<{ total: number }>>`
          SELECT SUM(volume) as total
          FROM rolling_data_points 
          WHERE coin_id = ${coinId} AND timestamp >= ${h12Ago}
        `,
        prisma.$queryRaw<Array<{ total: number }>>`
          SELECT SUM(volume) as total
          FROM rolling_data_points 
          WHERE coin_id = ${coinId} AND timestamp >= ${h24Ago}
        `
      ]);

      const stats: RollingStats = {};
      
      if (h12Stats[0]?.high) stats.h12High = h12Stats[0].high;
      if (h12Stats[0]?.low) stats.h12Low = h12Stats[0].low;
      if (h24Stats[0]?.high) stats.h24High = h24Stats[0].high;
      if (h24Stats[0]?.low) stats.h24Low = h24Stats[0].low;
      if (h72Stats[0]?.high) stats.h72High = h72Stats[0].high;
      if (h72Stats[0]?.low) stats.h72Low = h72Stats[0].low;
      if (v12Sum[0]?.total) stats.v12Sum = v12Sum[0].total;
      if (v24Sum[0]?.total) stats.v24Sum = v24Sum[0].total;
      
      return stats;
    } catch (error) {
      logger.error(`Failed to calculate rolling stats for coin ${coinId}:`, error);
      throw error;
    }
  }

  private async updateLongState(coinId: number, dataPoint: DataPoint, stats: RollingStats): Promise<void> {
    const prisma = DatabaseManager.getInstance();
    
    try {
      await prisma.longState.upsert({
        where: { coinId },
        update: {
          lastPrice: dataPoint.price,
          lastMcap: dataPoint.marketCap ?? null,
          h12High: stats.h12High ?? null,
          h24High: stats.h24High ?? null,
          h72High: stats.h72High ?? null,
          h12Low: stats.h12Low ?? null,
          h24Low: stats.h24Low ?? null,
          h72Low: stats.h72Low ?? null,
          v12Sum: stats.v12Sum ?? null,
          v24Sum: stats.v24Sum ?? null,
          lastUpdatedUtc: dataPoint.timestamp
        },
        create: {
          coinId,
          lastPrice: dataPoint.price,
          lastMcap: dataPoint.marketCap ?? null,
          h12High: stats.h12High ?? null,
          h24High: stats.h24High ?? null,
          h72High: stats.h72High ?? null,
          h12Low: stats.h12Low ?? null,
          h24Low: stats.h24Low ?? null,
          h72Low: stats.h72Low ?? null,
          v12Sum: stats.v12Sum ?? null,
          v24Sum: stats.v24Sum ?? null,
          lastUpdatedUtc: dataPoint.timestamp
        }
      });
    } catch (error) {
      logger.error(`Failed to update long state for coin ${coinId}:`, error);
      throw error;
    }
  }

  async backfillData(coinId: number, historicalData: DataPoint[]): Promise<void> {
    logger.info(`Starting backfill for coin ${coinId} with ${historicalData.length} data points`);
    
    const sortedData = historicalData.sort((a, b) => a.timestamp - b.timestamp);
    
    for (const dataPoint of sortedData) {
      await this.addDataPoint(coinId, dataPoint);
    }
    
    logger.info(`Completed backfill for coin ${coinId}`);
  }

  private async cleanupOldData(): Promise<void> {
    const prisma = DatabaseManager.getInstance();
    const cutoffTime = Math.floor(Date.now() / 1000) - (73 * 60 * 60); // Keep 73 hours for safety
    
    try {
      const result = await prisma.$executeRaw`
        DELETE FROM rolling_data_points 
        WHERE timestamp < ${cutoffTime}
      `;
      
      logger.debug(`Cleaned up ${result} old rolling window data points`);
    } catch (error) {
      logger.error('Failed to cleanup old rolling window data:', error);
    }
  }

  async getDataPointsCount(coinId: number): Promise<number> {
    const prisma = DatabaseManager.getInstance();
    
    const result = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*) as count
      FROM rolling_data_points 
      WHERE coin_id = ${coinId}
    `;
    
    return result[0]?.count || 0;
  }

  async isWarmupComplete(coinId: number, requiredHours: number = 72): Promise<boolean> {
    const prisma = DatabaseManager.getInstance();
    const requiredTime = Math.floor(Date.now() / 1000) - (requiredHours * 60 * 60);
    
    const result = await prisma.$queryRaw<Array<{ earliest: number }>>`
      SELECT MIN(timestamp) as earliest
      FROM rolling_data_points 
      WHERE coin_id = ${coinId}
    `;
    
    const earliestTimestamp = result[0]?.earliest;
    return earliestTimestamp ? earliestTimestamp <= requiredTime : false;
  }

  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }
}