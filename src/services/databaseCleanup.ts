import { DatabaseManager } from '../utils/database';
import { logger } from '../utils/logger';

export interface CleanupStats {
  recordsAnalyzed: number;
  recordsDeleted: number;
  sizeBefore: number;
  sizeAfter: number;
  spaceSavedMB: number;
  duration: number;
  deletedByStatus?: Record<string, number>;
}

export class DatabaseCleanupService {
  private isRunning = false;
  private cleanupTimer: NodeJS.Timeout | null = null;

  async analyzeCleanupImpact(daysToKeep: number = 3): Promise<{
    totalRecords: number;
    recordsToDelete: number;
    recordsToKeep: number;
    percentageToDelete: number;
    oldestRecord: string;
    newestRecord: string;
  }> {
    const prisma = DatabaseManager.getInstance() as any;
    
    const cutoffTimestamp = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);
    
    try {
      const [total, toDelete, dateRange] = await Promise.all([
        prisma.mintEvent.count(),
        prisma.mintEvent.count({
          where: {
            timestamp: {
              lt: BigInt(cutoffTimestamp)
            }
          }
        }),
        prisma.mintEvent.aggregate({
          _min: { timestamp: true },
          _max: { timestamp: true }
        })
      ]);

      const recordsToKeep = total - toDelete;
      const percentageToDelete = Math.round((toDelete / total) * 100);

      return {
        totalRecords: total,
        recordsToDelete: toDelete,
        recordsToKeep,
        percentageToDelete,
        oldestRecord: dateRange._min.timestamp ? 
          new Date(Number(dateRange._min.timestamp)).toISOString() : 'N/A',
        newestRecord: dateRange._max.timestamp ? 
          new Date(Number(dateRange._max.timestamp)).toISOString() : 'N/A'
      };
    } catch (error) {
      logger.error('Failed to analyze cleanup impact:', error);
      throw error;
    }
  }

  async performCleanup(
    daysToKeep: number = 3,
    dryRun: boolean = true,
    aggressive: boolean = false,
    deadTokenDays: number = 1
  ): Promise<CleanupStats> {
    // If aggressive mode, use the aggressive cleanup strategy
    if (aggressive) {
      return this.performAggressiveCleanup(daysToKeep, dryRun, deadTokenDays);
    }

    if (this.isRunning) {
      throw new Error('Cleanup already in progress');
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      const prisma = DatabaseManager.getInstance() as any;
      const cutoffTimestamp = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);

      logger.info(`Starting database cleanup - ${dryRun ? 'DRY RUN' : 'LIVE'}`, {
        daysToKeep,
        cutoffDate: new Date(cutoffTimestamp).toISOString()
      });

      // Get initial stats
      const initialCount = await prisma.mintEvent.count();
      const sizeBefore = await this.getDatabaseSize();

      // Count records to delete
      const recordsToDelete = await prisma.mintEvent.count({
        where: {
          timestamp: {
            lt: BigInt(cutoffTimestamp)
          }
        }
      });

      if (dryRun) {
        logger.info('DRY RUN - No records will be deleted', {
          totalRecords: initialCount,
          recordsToDelete,
          estimatedSpaceSavedMB: Math.round((recordsToDelete / initialCount) * sizeBefore)
        });

        return {
          recordsAnalyzed: initialCount,
          recordsDeleted: 0,
          sizeBefore,
          sizeAfter: sizeBefore,
          spaceSavedMB: 0,
          duration: Date.now() - startTime
        };
      }

      // Perform actual deletion in small batches to minimize lock time
      let totalDeleted = 0;
      const batchSize = 10000; // Larger batches for faster cleanup

      // Get batch of IDs to delete (more efficient than timestamp filtering)
      const idsToDelete = await prisma.mintEvent.findMany({
        where: {
          timestamp: {
            lt: BigInt(cutoffTimestamp)
          }
        },
        select: { id: true },
        take: recordsToDelete
      });

      logger.info(`Cleanup will process ${idsToDelete.length} records in batches of ${batchSize}`);

      // Delete in small ID-based batches
      for (let i = 0; i < idsToDelete.length; i += batchSize) {
        const batchIds = idsToDelete.slice(i, i + batchSize).map((item: { id: number }) => item.id);

        const batchResult = await prisma.mintEvent.deleteMany({
          where: {
            id: {
              in: batchIds
            }
          }
        });

        totalDeleted += batchResult.count;
        logger.info(`Deleted batch ${Math.ceil((i + 1) / batchSize)}: ${batchResult.count} records (total: ${totalDeleted})`);

        // Shorter delay between batches - 100ms is enough
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Use incremental vacuum instead of full VACUUM to avoid memory spike
      // Full VACUUM loads entire DB into memory, incremental is safer
      logger.info('Running incremental VACUUM to reclaim space...');
      await prisma.$executeRaw`PRAGMA incremental_vacuum(1000)`;  // Free 1000 pages at a time

      const sizeAfter = await this.getDatabaseSize();
      const spaceSavedMB = sizeBefore - sizeAfter;
      const duration = Date.now() - startTime;

      const stats: CleanupStats = {
        recordsAnalyzed: initialCount,
        recordsDeleted: totalDeleted,
        sizeBefore,
        sizeAfter,
        spaceSavedMB,
        duration
      };

      logger.info('Database cleanup completed', stats);

      return stats;

    } catch (error) {
      logger.error('Database cleanup failed:', error);
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Aggressive cleanup strategy targeting ONLY dead tokens
   * - Deletes "dead" tokens older than deadTokenDays (default 1 day)
   * - Keeps "clean" tokens for cleanTokenDays (default 2-3 days)
   * - Keeps "scam", "no_data" for cleanTokenDays (not much data, keep for analysis)
   * - Keeps null/unprocessed tokens indefinitely (waiting to be processed)
   */
  async performAggressiveCleanup(cleanTokenDays: number = 2, dryRun: boolean = true, deadTokenDays: number = 1): Promise<CleanupStats> {
    if (this.isRunning) {
      throw new Error('Cleanup already in progress');
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      const prisma = DatabaseManager.getInstance() as any;

      // Different retention periods for different statuses
      const cleanCutoff = Date.now() - (cleanTokenDays * 24 * 60 * 60 * 1000); // Keep clean/scam/no_data tokens
      const deadCutoff = Date.now() - (deadTokenDays * 24 * 60 * 60 * 1000); // Keep dead tokens configurable

      logger.info(`Starting AGGRESSIVE database cleanup - ${dryRun ? 'DRY RUN' : 'LIVE'}`, {
        cleanTokenDays,
        deadRetentionDays: deadTokenDays,
        cleanCutoffDate: new Date(cleanCutoff).toISOString(),
        deadCutoffDate: new Date(deadCutoff).toISOString()
      });

      // Get initial stats
      const initialCount = await prisma.mintEvent.count();
      const sizeBefore = await this.getDatabaseSize();

      // Build deletion criteria for each status
      // ONLY delete: dead (aggressive) and old clean/scam/no_data
      // NEVER delete: null/unprocessed (they need to be processed)
      const deletionCriteria = [
        { status: 'dead', cutoff: deadCutoff },       // Dead tokens - keep only 1 day
        { status: 'clean', cutoff: cleanCutoff },     // Clean tokens - keep 2-3 days
        { status: 'scam', cutoff: cleanCutoff },      // Scam tokens - keep 2-3 days for analysis
        { status: 'no_data', cutoff: cleanCutoff }    // No data tokens - keep 2-3 days
        // null/unprocessed - NEVER delete (waiting to be processed)
      ];

      // Count records to delete by status
      const deletionStats: Record<string, number> = {};
      for (const criteria of deletionCriteria) {
        const count = await prisma.mintEvent.count({
          where: {
            scamStatus: criteria.status,
            timestamp: {
              lt: BigInt(criteria.cutoff)
            }
          }
        });
        deletionStats[criteria.status || 'unknown'] = count;
      }

      const totalToDelete = Object.values(deletionStats).reduce((sum, count) => sum + count, 0);

      if (dryRun) {
        logger.info('DRY RUN - No records will be deleted', {
          totalRecords: initialCount,
          totalToDelete,
          byStatus: deletionStats,
          estimatedSpaceSavedMB: Math.round((totalToDelete / initialCount) * sizeBefore)
        });

        return {
          recordsAnalyzed: initialCount,
          recordsDeleted: 0,
          sizeBefore,
          sizeAfter: sizeBefore,
          spaceSavedMB: 0,
          duration: Date.now() - startTime,
          deletedByStatus: deletionStats
        };
      }

      // Perform actual deletion for each status category
      let totalDeleted = 0;
      const batchSize = 10000;
      const deletedByStatus: Record<string, number> = {};

      for (const criteria of deletionCriteria) {
        const statusName = criteria.status || 'unknown';

        if (deletionStats[statusName] === 0) {
          logger.info(`Skipping ${statusName} - no records to delete`);
          continue;
        }

        logger.info(`Processing ${statusName} tokens (${deletionStats[statusName]} records)...`);

        // Get IDs to delete for this status
        const idsToDelete = await prisma.mintEvent.findMany({
          where: {
            scamStatus: criteria.status,
            timestamp: {
              lt: BigInt(criteria.cutoff)
            }
          },
          select: { id: true }
        });

        // Delete in batches
        let statusDeleted = 0;
        for (let i = 0; i < idsToDelete.length; i += batchSize) {
          const batchIds = idsToDelete.slice(i, i + batchSize).map((item: { id: number }) => item.id);

          const batchResult = await prisma.mintEvent.deleteMany({
            where: {
              id: {
                in: batchIds
              }
            }
          });

          statusDeleted += batchResult.count;
          totalDeleted += batchResult.count;

          if ((i + batchSize) % 50000 === 0) {
            logger.info(`  ${statusName}: ${statusDeleted}/${idsToDelete.length} deleted`);
          }

          await new Promise(resolve => setTimeout(resolve, 50));
        }

        deletedByStatus[statusName] = statusDeleted;
        logger.info(`✓ ${statusName}: deleted ${statusDeleted} records`);
      }

      // Use incremental vacuum instead of full VACUUM to avoid memory spike
      // Full VACUUM loads entire DB into memory, incremental is safer
      logger.info('Running incremental VACUUM to reclaim space...');
      await prisma.$executeRaw`PRAGMA incremental_vacuum(1000)`;  // Free 1000 pages at a time

      const sizeAfter = await this.getDatabaseSize();
      const spaceSavedMB = sizeBefore - sizeAfter;
      const duration = Date.now() - startTime;

      const stats: CleanupStats = {
        recordsAnalyzed: initialCount,
        recordsDeleted: totalDeleted,
        sizeBefore,
        sizeAfter,
        spaceSavedMB,
        duration,
        deletedByStatus
      };

      logger.info('Aggressive cleanup completed', stats);

      return stats;

    } catch (error) {
      logger.error('Aggressive cleanup failed:', error);
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Start automatic daily cleanup at 7:41 AM (after backups complete)
   */
  startScheduledCleanup(cleanTokenDays: number = 2): void {
    if (this.cleanupTimer) {
      logger.warn('Scheduled cleanup already running');
      return;
    }

    // Run cleanup daily at 7:41 AM (after 2 AM backup completes)
    const scheduleCleanup = () => {
      const now = new Date();
      const nextRun = new Date(now);
      nextRun.setHours(7, 41, 0, 0);

      // If 7:41 AM already passed today, schedule for tomorrow
      if (nextRun <= now) {
        nextRun.setDate(nextRun.getDate() + 1);
      }

      const msUntilNextRun = nextRun.getTime() - now.getTime();

      logger.info('Scheduled database cleanup', {
        nextRun: nextRun.toISOString(),
        hoursUntilRun: Math.round(msUntilNextRun / 1000 / 60 / 60)
      });

      this.cleanupTimer = setTimeout(async () => {
        try {
          logger.info('Running scheduled aggressive cleanup...');
          const stats = await this.performAggressiveCleanup(cleanTokenDays, false);
          logger.info('Scheduled cleanup completed', stats);
        } catch (error) {
          logger.error('Scheduled cleanup failed:', error);
        }

        // Schedule next run
        this.cleanupTimer = null;
        scheduleCleanup();
      }, msUntilNextRun);
    };

    scheduleCleanup();
    logger.info('Database cleanup scheduler started');
  }

  /**
   * Stop scheduled cleanup
   */
  stopScheduledCleanup(): void {
    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer);
      this.cleanupTimer = null;
      logger.info('Database cleanup scheduler stopped');
    }
  }

  private async getDatabaseSize(): Promise<number> {
    try {
      const prisma = DatabaseManager.getInstance() as any;
      const result = await prisma.$queryRaw`
        SELECT round(page_count * page_size / 1024.0 / 1024.0, 1) as size_mb 
        FROM pragma_page_count(), pragma_page_size()
      ` as any[];
      
      return result[0]?.size_mb || 0;
    } catch (error) {
      logger.error('Failed to get database size:', error);
      return 0;
    }
  }

  async getCleanupRecommendations(): Promise<{
    currentSize: number;
    recordCount: number;
    avgRecordSize: number;
    recommendedAction: string;
    riskLevel: 'low' | 'medium' | 'high';
  }> {
    const prisma = DatabaseManager.getInstance() as any;
    
    const recordCount = await prisma.mintEvent.count();
    const currentSize = await this.getDatabaseSize();
    const avgRecordSize = recordCount > 0 ? (currentSize * 1024 * 1024) / recordCount : 0;
    
    let recommendedAction = '';
    let riskLevel: 'low' | 'medium' | 'high' = 'low';
    
    if (currentSize > 5000) { // 5GB
      recommendedAction = 'URGENT: Immediate cleanup required - database too large';
      riskLevel = 'high';
    } else if (currentSize > 2000) { // 2GB
      recommendedAction = 'Cleanup recommended - database growing large';
      riskLevel = 'medium';
    } else if (recordCount > 100000) {
      recommendedAction = 'Consider periodic cleanup to maintain performance';
      riskLevel = 'low';
    } else {
      recommendedAction = 'No cleanup needed at this time';
      riskLevel = 'low';
    }

    return {
      currentSize,
      recordCount,
      avgRecordSize: Math.round(avgRecordSize),
      recommendedAction,
      riskLevel
    };
  }

  isCleanupRunning(): boolean {
    return this.isRunning;
  }
}

export const globalDatabaseCleanup = new DatabaseCleanupService();