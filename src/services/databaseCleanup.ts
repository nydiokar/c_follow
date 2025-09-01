import { DatabaseManager } from '../utils/database';
import { logger } from '../utils/logger';

export interface CleanupStats {
  recordsAnalyzed: number;
  recordsDeleted: number;
  sizeBefore: number;
  sizeAfter: number;
  spaceSavedMB: number;
  duration: number;
}

export class DatabaseCleanupService {
  private isRunning = false;

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

  async performCleanup(daysToKeep: number = 3, dryRun: boolean = true): Promise<CleanupStats> {
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
      const batchSize = 1000; // Smaller batches for concurrent safety
      
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
        
        // Longer delay between batches for webhook safety
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // Vacuum to reclaim space
      logger.info('Running VACUUM to reclaim space...');
      await prisma.$executeRaw`VACUUM`;
      
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