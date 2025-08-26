import { PrismaClient } from '@prisma/client';
import { DexScreenerService } from './dexscreener';
import { PairInfo } from '../types/dexscreener';
import { DatabaseManager } from '../utils/database';
import { logger } from '../utils/logger';
import { TokenClassifier } from '../utils/tokenClassifier';

export class TokenProcessorService {
  private dexScreener: DexScreenerService;
  private prisma: PrismaClient;
  private startTime: number = 0;

  constructor(dexScreener: DexScreenerService) {
    this.dexScreener = dexScreener;
    this.prisma = DatabaseManager.getInstance();
  }

  async runIncrementalProcessing(): Promise<void> {
    const cutoffHours = 3;
    this.startTime = Date.now();
    const initialMemory = process.memoryUsage();
    
    logger.info(`TokenProcessor: Starting incremental processing (cutoff: ${cutoffHours}h)`);
    logger.info(`TokenProcessor: Initial memory - RSS: ${Math.round(initialMemory.rss/1024/1024)}MB, Heap: ${Math.round(initialMemory.heapUsed/1024/1024)}MB`);
    
    // Get ALL unprocessed tokens from last 3 hours (no artificial limit)
    const unprocessedTokens = await this.getUnprocessedTokens(cutoffHours);
    
    if (unprocessedTokens.length === 0) {
      logger.info('TokenProcessor: No unprocessed tokens found');
      return;
    }
    
    logger.info(`TokenProcessor: Found ${unprocessedTokens.length} unprocessed tokens from last ${cutoffHours}h`);
    
    // Log distribution by age
    const now = Date.now();
    const age1h = unprocessedTokens.filter(t => Number(t.timestamp) > now - 60*60*1000).length;
    const age3h = unprocessedTokens.filter(t => Number(t.timestamp) > now - 3*60*60*1000).length;
    logger.info(`TokenProcessor: Age distribution - Last 1h: ${age1h}, Last 3h: ${age3h}`);
    
    const memoryAfterQuery = process.memoryUsage();
    logger.info(`TokenProcessor: Memory after DB query - RSS: ${Math.round(memoryAfterQuery.rss/1024/1024)}MB, Heap: ${Math.round(memoryAfterQuery.heapUsed/1024/1024)}MB`);
    
    try {
      // Use existing batchGetTokens - it already handles DexScreener + Jupiter fallback
      const requests = unprocessedTokens.map(t => ({ 
        chainId: 'solana', 
        tokenAddress: t.mint 
      }));
      
      // This will automatically:
      // - Batch DexScreener calls (50 tokens per request, 300 req/min limit)  
      // - Fallback to Jupiter for failed tokens (50 tokens per request, 600 req/min limit)
      const results = await this.dexScreener.batchGetTokens(requests);
      
      // Analyze and mark each token
      await this.analyzeAndMarkTokens(unprocessedTokens, results);
      
      logger.info('TokenProcessor: Incremental processing completed successfully');
    } catch (error) {
      logger.error('TokenProcessor: Failed to process tokens', error);
      throw error;
    }
  }
  
  private async getUnprocessedTokens(hours: number) {
    const cutoff = BigInt(Date.now() - hours * 60 * 60 * 1000);
    
    // Get ALL unprocessed tokens (no LIMIT)
    return await this.prisma.mintEvent.findMany({
      where: {
        isFirst: true,
        timestamp: { gte: cutoff },
        processedAt: null,
        processAttempts: { lt: 3 }
      },
      orderBy: { timestamp: 'desc' },
      select: { mint: true, timestamp: true }
    });
  }
  
  private async analyzeAndMarkTokens(tokens: any[], apiResults: Map<string, PairInfo | null>) {
    // Use shared classification logic
    const classified = TokenClassifier.batchClassify(apiResults);
    
    // Batch database updates
    await this.batchUpdateDatabase(classified.scam, classified.clean, classified.failed, classified.dead, classified.no_data);
    
    const processingTime = Math.round((Date.now() - this.startTime) / 1000);
    const finalMemory = process.memoryUsage();
    
    logger.info(`TokenProcessor: Processing complete in ${processingTime}s - ${classified.clean.length} clean, ${classified.scam.length} scam, ${classified.dead.length} dead, ${classified.no_data.length} no-data, ${classified.failed.length} failed`);
    logger.info(`TokenProcessor: Final memory - RSS: ${Math.round(finalMemory.rss/1024/1024)}MB, Heap: ${Math.round(finalMemory.heapUsed/1024/1024)}MB`);
  }
  
  private async batchUpdateDatabase(scamTokens: string[], cleanTokens: string[], failedTokens: string[], deadTokens: string[], noDataTokens: string[]) {
    const now = BigInt(Date.now());
    
    // Use efficient batch operations
    const operations = [];
    
    if (scamTokens.length > 0) {
      operations.push(
        this.prisma.mintEvent.updateMany({
          where: { mint: { in: scamTokens } },
          data: { 
            processedAt: now, 
            scamStatus: 'scam',
            processAttempts: { increment: 1 }
          }
        })
      );
    }
    
    if (cleanTokens.length > 0) {
      operations.push(
        this.prisma.mintEvent.updateMany({
          where: { mint: { in: cleanTokens } },
          data: { 
            processedAt: now, 
            scamStatus: 'clean',
            processAttempts: { increment: 1 }
          }
        })
      );
    }
    
    if (deadTokens.length > 0) {
      operations.push(
        this.prisma.mintEvent.updateMany({
          where: { mint: { in: deadTokens } },
          data: { 
            processedAt: now, 
            scamStatus: 'dead',
            processAttempts: { increment: 1 }
          }
        })
      );
    }
    
    if (noDataTokens.length > 0) {
      operations.push(
        this.prisma.mintEvent.updateMany({
          where: { mint: { in: noDataTokens } },
          data: { 
            processedAt: now, 
            scamStatus: 'no_data',
            processAttempts: { increment: 1 }
          }
        })
      );
    }
    
    if (failedTokens.length > 0) {
      operations.push(
        this.prisma.mintEvent.updateMany({
          where: { mint: { in: failedTokens } },
          data: { 
            processAttempts: { increment: 1 }
          }
        })
      );
    }
    
    // Execute all operations in a transaction
    if (operations.length > 0) {
      await this.prisma.$transaction(operations);
      logger.info(`TokenProcessor: Database updated - marked ${scamTokens.length} scam, ${cleanTokens.length} clean, ${deadTokens.length} dead, ${noDataTokens.length} no-data, ${failedTokens.length} failed`);
    }
  }
  
  // Static helper method for use in other services - delegates to TokenClassifier
  static isObviousScam(tokenData: PairInfo): boolean {
    const result = TokenClassifier.classifyToken(tokenData);
    return result.classification === 'scam';
  }

  // Helper method to mark newly detected scams (for use in mint report)
  static async markTokensAsScam(mints: string[]): Promise<void> {
    if (mints.length === 0) return;
    
    try {
      const prisma = DatabaseManager.getInstance();
      await prisma.mintEvent.updateMany({
        where: { mint: { in: mints } },
        data: { 
          processedAt: BigInt(Date.now()),
          scamStatus: 'scam',
          processAttempts: 1
        }
      });
      logger.info(`TokenProcessor: Marked ${mints.length} tokens as scam`);
    } catch (error) {
      logger.error('TokenProcessor: Failed to mark tokens as scam', error);
    }
  }

  // Helper method to mark tokens with no data (skip future processing)
  static async markTokensAsNoData(mints: string[]): Promise<void> {
    if (mints.length === 0) return;
    
    try {
      const prisma = DatabaseManager.getInstance();
      await prisma.mintEvent.updateMany({
        where: { mint: { in: mints } },
        data: { 
          processedAt: BigInt(Date.now()),
          scamStatus: 'no_data',
          processAttempts: 1
        }
      });
      logger.info(`TokenProcessor: Marked ${mints.length} tokens as no-data`);
    } catch (error) {
      logger.error('TokenProcessor: Failed to mark tokens as no-data', error);
    }
  }

  // Helper method to mark dead tokens (no liquidity/mcap)
  static async markTokensAsDead(mints: string[]): Promise<void> {
    if (mints.length === 0) return;
    
    try {
      const prisma = DatabaseManager.getInstance();
      await prisma.mintEvent.updateMany({
        where: { mint: { in: mints } },
        data: { 
          processedAt: BigInt(Date.now()),
          scamStatus: 'dead',
          processAttempts: 1
        }
      });
      logger.info(`TokenProcessor: Marked ${mints.length} tokens as dead`);
    } catch (error) {
      logger.error('TokenProcessor: Failed to mark tokens as dead', error);
    }
  }

  // Helper method to mark legitimate tokens as clean
  static async markTokensAsClean(mints: string[]): Promise<void> {
    if (mints.length === 0) return;
    
    try {
      const prisma = DatabaseManager.getInstance();
      await prisma.mintEvent.updateMany({
        where: { mint: { in: mints } },
        data: { 
          processedAt: BigInt(Date.now()),
          scamStatus: 'clean',
          processAttempts: 1
        }
      });
      logger.info(`TokenProcessor: Marked ${mints.length} tokens as clean`);
    } catch (error) {
      logger.error('TokenProcessor: Failed to mark tokens as clean', error);
    }
  }
}