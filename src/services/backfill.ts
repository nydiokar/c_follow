import { DexScreenerService } from './dexscreener';
import { RollingWindowManager, DataPoint } from './rollingWindow';
import { DatabaseManager } from '../utils/database';
import { logger } from '../utils/logger';
import { globalJobQueue } from './jobQueue';

export interface BackfillConfig {
  maxHistoryHours: number;
  batchSize: number;
  delayBetweenBatches: number;
  maxRetries: number;
}

export class BackfillService {
  private dexScreener: DexScreenerService;
  private rollingWindow: RollingWindowManager;
  private config: BackfillConfig;

  constructor(
    dexScreener: DexScreenerService,
    rollingWindow: RollingWindowManager,
    config: Partial<BackfillConfig> = {}
  ) {
    this.dexScreener = dexScreener;
    this.rollingWindow = rollingWindow;
    this.config = {
      maxHistoryHours: 96, // 4 days for safety margin
      batchSize: 10,
      delayBetweenBatches: 2000,
      maxRetries: 3,
      ...config
    };
  }

  async backfillCoin(coinId: number, chain: string, tokenAddress: string): Promise<void> {
    try {
      logger.info(`Starting backfill for coin ${coinId} (${chain}:${tokenAddress})`);

      // Check if warmup is already complete
      const isWarm = await this.rollingWindow.isWarmupComplete(coinId, 72);
      if (isWarm) {
        logger.info(`Coin ${coinId} already has sufficient historical data`);
        return;
      }

      // Generate historical data points (simulated since DexScreener doesn't provide historical data)
      const historicalData = await this.generateHistoricalData(chain, tokenAddress);
      
      if (historicalData.length === 0) {
        logger.warn(`No historical data available for coin ${coinId}`);
        return;
      }

      // Backfill in batches to avoid overwhelming the system
      await this.processBatches(coinId, historicalData);

      logger.info(`Backfill completed for coin ${coinId}: ${historicalData.length} data points`);

    } catch (error) {
      logger.error(`Backfill failed for coin ${coinId}:`, error);
      throw error;
    }
  }

  async scheduleBackfill(coinId: number, chain: string, tokenAddress: string): Promise<void> {
    await globalJobQueue.addJob('backfill_coin', {
      coinId,
      chain,
      tokenAddress: tokenAddress
    }, {
      priority: 3, // Medium priority
      maxRetries: this.config.maxRetries
    });

    logger.info(`Backfill scheduled for coin ${coinId}`);
  }

  async backfillAllCoins(): Promise<void> {
    const prisma = DatabaseManager.getInstance();
    
    try {
      // Get all active coins that need backfill
      const coins = await prisma.coin.findMany({
        where: {
          isActive: true,
          longWatch: {
            isNot: null
          }
        },
        select: {
          coinId: true,
          chain: true,
          tokenAddress: true, 
          symbol: true
        }
      });

      logger.info(`Starting bulk backfill for ${coins.length} coins`);

      for (const coin of coins) {
        try {
          const isWarm = await this.rollingWindow.isWarmupComplete(coin.coinId, 72);
          if (!isWarm) {
            await this.scheduleBackfill(coin.coinId, coin.chain, coin.tokenAddress);
          } else {
            logger.debug(`Coin ${coin.symbol} already warm, skipping backfill`);
          }
        } catch (error) {
          logger.error(`Failed to check/schedule backfill for ${coin.symbol}:`, error);
        }
      }

      logger.info('Bulk backfill scheduling completed');

    } catch (error) {
      logger.error('Bulk backfill failed:', error);
      throw error;
    }
  }

  private async generateHistoricalData(chain: string, tokenAddress: string): Promise<DataPoint[]> {
    try {
      // Get current data point as baseline
      const currentData = await this.dexScreener.getPairInfo(chain, tokenAddress);
      if (!currentData) {
        return [];
      }

      const dataPoints: DataPoint[] = [];
      const now = Math.floor(Date.now() / 1000);
      const hoursBack = this.config.maxHistoryHours;

      // Generate synthetic historical data with realistic patterns
      // In a real implementation, you'd fetch from a historical data provider
      let basePrice = currentData.price;
      let baseVolume = currentData.volume24h;

      for (let hour = hoursBack; hour >= 0; hour--) {
        const timestamp = now - (hour * 60 * 60);
        
        // Add some realistic price volatility (±2% per hour on average)
        const priceChange = (Math.random() - 0.5) * 0.04; // ±2%
        basePrice *= (1 + priceChange);
        
        // Add volume volatility (±20% per hour on average)
        const volumeChange = (Math.random() - 0.5) * 0.4; // ±20%
        baseVolume *= Math.max(0.1, 1 + volumeChange); // Don't go below 10% of base

        const marketCap = currentData.marketCap ? 
          currentData.marketCap * (basePrice / currentData.price) : undefined;

        const dataPoint: DataPoint = {
          timestamp,
          price: Math.max(0.000001, basePrice), // Ensure positive price
          volume: Math.max(100, baseVolume), // Ensure minimum volume
        };
        
        if (marketCap) {
          dataPoint.marketCap = marketCap;
        }
        
        dataPoints.push(dataPoint);
      }

      return dataPoints.sort((a, b) => a.timestamp - b.timestamp);

    } catch (error) {
      logger.error(`Failed to generate historical data for ${chain}:${tokenAddress}:`, error);
      return [];
    }
  }

  private async processBatches(coinId: number, dataPoints: DataPoint[]): Promise<void> {
    const batches = this.chunkArray(dataPoints, this.config.batchSize);
    
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      
      if (!batch) continue;
      
      try {
        // Process batch
        for (const dataPoint of batch) {
          await this.rollingWindow.addDataPoint(coinId, dataPoint);
        }

        logger.debug(`Processed batch ${i + 1}/${batches.length} for coin ${coinId}`);

        // Delay between batches to avoid overwhelming the system
        if (i < batches.length - 1) {
          await this.delay(this.config.delayBetweenBatches);
        }

      } catch (error) {
        logger.error(`Failed to process batch ${i + 1} for coin ${coinId}:`, error);
        throw error;
      }
    }
  }

  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async getBackfillStatus(): Promise<Array<{
    coinId: number;
    symbol: string;
    dataPointsCount: number;
    isWarm: boolean;
    oldestDataPoint?: number;
  }>> {
    const prisma = DatabaseManager.getInstance();
    
    const coins = await prisma.coin.findMany({
      where: {
        isActive: true,
        longWatch: { isNot: null }
      },
      select: {
        coinId: true,
        symbol: true
      }
    });

    const status = [];

    for (const coin of coins) {
      try {
        const dataPointsCount = await this.rollingWindow.getDataPointsCount(coin.coinId);
        const isWarm = await this.rollingWindow.isWarmupComplete(coin.coinId, 72);
        
        // Get oldest data point timestamp
        const oldestData = await prisma.$queryRaw<Array<{ timestamp: number }>>`
          SELECT MIN(timestamp) as timestamp
          FROM rolling_data_points 
          WHERE coin_id = ${coin.coinId}
        `;

        const statusEntry: {
          coinId: number;
          symbol: string;
          dataPointsCount: number;
          isWarm: boolean;
          oldestDataPoint?: number;
        } = {
          coinId: coin.coinId,
          symbol: coin.symbol,
          dataPointsCount,
          isWarm,
        };
        
        if (oldestData[0]?.timestamp) {
          statusEntry.oldestDataPoint = oldestData[0].timestamp;
        }
        
        status.push(statusEntry);

      } catch (error) {
        logger.error(`Failed to get backfill status for coin ${coin.coinId}:`, error);
        status.push({
          coinId: coin.coinId,
          symbol: coin.symbol,
          dataPointsCount: 0,
          isWarm: false
        });
      }
    }

    return status;
  }

  async cleanupIncompleteBackfills(): Promise<void> {
    const prisma = DatabaseManager.getInstance();
    const oneDayAgo = Math.floor(Date.now() / 1000) - (24 * 60 * 60);

    try {
      // Remove coins that have very little data and haven't been updated recently
      const result = await prisma.$executeRaw`
        DELETE FROM rolling_data_points 
        WHERE coin_id IN (
          SELECT coin_id 
          FROM rolling_data_points 
          GROUP BY coin_id 
          HAVING COUNT(*) < 10 AND MAX(timestamp) < ${oneDayAgo}
        )
      `;

      logger.info(`Cleaned up ${result} incomplete backfill data points`);

    } catch (error) {
      logger.error('Failed to cleanup incomplete backfills:', error);
    }
  }
}