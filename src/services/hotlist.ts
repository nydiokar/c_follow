import { DatabaseService } from './database';
import { DexScreenerService } from './dexscreener';
import { HotListEntry, HotTrigger, HotAlert, HotListEvaluator } from '../types/hotlist';
import { PairInfo } from '../types/dexscreener';
import { logger } from '../utils/logger';
import { DatabaseManager } from '../utils/database';
import { globalAlertBus } from '../events/alertBus';

class HotListTriggerEvaluator implements HotListEvaluator {
  private readonly failsafeThreshold = 60.0;

  evaluateEntry(entry: HotListEntry, currentPrice: number, currentMcap?: number): HotAlert[] {
    const alerts: HotAlert[] = [];
    const now = Math.floor(Date.now() / 1000);

    for (const trigger of entry.activeTriggers) {
      if (trigger.fired) continue;

      const priceChangeFromAnchor = ((currentPrice - trigger.anchorPrice) / trigger.anchorPrice) * 100;

      if (!entry.failsafeFired && this.shouldTriggerFailsafe(trigger, currentPrice, currentMcap)) {
        alerts.push({
          hotId: entry.hotId,
          symbol: entry.symbol,
          alertType: 'failsafe',
          message: `${entry.symbol} FAILSAFE: -${this.failsafeThreshold}% drawdown from anchor`,
          currentPrice,
          currentMcap: currentMcap || 0,
          deltaFromAnchor: priceChangeFromAnchor,
          timestamp: now,
        });
      }

      if (trigger.kind === 'pct') {
        if (this.shouldTriggerPct(trigger.value, priceChangeFromAnchor)) {
          alerts.push({
            hotId: entry.hotId,
            symbol: entry.symbol,
            alertType: 'pct',
            message: `${entry.symbol} hit ${trigger.value > 0 ? '+' : ''}${trigger.value}% target`,
            currentPrice,
            currentMcap: currentMcap || 0,
            deltaFromAnchor: priceChangeFromAnchor,
            targetValue: trigger.value,
            timestamp: now,
          });
        }
      } else if (trigger.kind === 'mcap' && currentMcap) {
        if (currentMcap >= trigger.value) {
          alerts.push({
            hotId: entry.hotId,
            symbol: entry.symbol,
            alertType: 'mcap',
            message: `${entry.symbol} reached ${this.formatMarketCap(trigger.value)} market cap`,
            currentPrice,
            currentMcap,
            deltaFromAnchor: priceChangeFromAnchor,
            targetValue: trigger.value,
            timestamp: now,
          });
        }
      }
    }

    return alerts;
  }

  shouldRemoveEntry(entry: HotListEntry): boolean {
    const hasActiveTriggers = entry.activeTriggers.some(t => !t.fired);
    return !hasActiveTriggers;
  }

  private shouldTriggerFailsafe(trigger: HotTrigger, currentPrice: number, currentMcap?: number): boolean {
    const priceDrawdown = ((trigger.anchorPrice - currentPrice) / trigger.anchorPrice) * 100;
    if (priceDrawdown >= this.failsafeThreshold) {
      return true;
    }

    if (trigger.anchorMcap && currentMcap) {
      const mcapDrawdown = ((trigger.anchorMcap - currentMcap) / trigger.anchorMcap) * 100;
      if (mcapDrawdown >= this.failsafeThreshold) {
        return true;
      }
    }
    return false;
  }

  private shouldTriggerPct(targetPct: number, currentPct: number): boolean {
    return targetPct > 0 ? currentPct >= targetPct : currentPct <= targetPct;
  }

  private formatMarketCap(value: number): string {
    if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
    if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
    return `$${value.toFixed(0)}`;
  }
}

export class HotListService {
  private db: DatabaseService;
  private dexScreener: DexScreenerService;
  private evaluator: HotListEvaluator;
  
  // Health monitoring for 2-minute checks
  private static lastCheckTime: number = 0;
  private static checksInLastHour: number = 0;
  private static failsInLastHour: number = 0;
  private static lastHourlyReport: number = 0;
  private prisma = DatabaseManager.getInstance();

  constructor(db: DatabaseService, dexScreener: DexScreenerService) {
    this.db = db;
    this.dexScreener = dexScreener;
    this.evaluator = new HotListTriggerEvaluator();
  }

  async addEntry(
    contractAddress: string,
    tokenData: PairInfo,
    options: {
      pctTargets?: number[];
      mcapTargets?: number[];
    } = {}
  ): Promise<boolean> {
    try {
      
      const now = Math.floor(Date.now() / 1000);

      const result = await this.prisma.$transaction(async (tx: any) => {

        // Upsert Coin
        const coin = await tx.coin.upsert({
          where: {
            chain_tokenAddress: {
              chain: tokenData.chainId,
              tokenAddress: tokenData.tokenAddress
            }
          },
          update: {
            symbol: tokenData.symbol,
            name: tokenData.name,
            isActive: true
          },
          create: {
            chain: tokenData.chainId,
            tokenAddress: tokenData.tokenAddress,
            symbol: tokenData.symbol,
            name: tokenData.name,
            isActive: true
          }
        });

        const hotEntry = await tx.hotEntry.upsert({
          where: { contractAddress: contractAddress },
          update: {
            symbol: tokenData.symbol,
            name: tokenData.name,
            imageUrl: tokenData.info?.imageUrl,
            websitesJson: tokenData.info?.websites ? JSON.stringify(tokenData.info.websites) : null,
            socialsJson: tokenData.info?.socials ? JSON.stringify(tokenData.info.socials) : null,
            coinId: coin.coinId,
            isActive: true
          },
          create: {
            contractAddress: contractAddress,
            chainId: tokenData.chainId,
            symbol: tokenData.symbol,
            name: tokenData.name,
            imageUrl: tokenData.info?.imageUrl,
            websitesJson: tokenData.info?.websites ? JSON.stringify(tokenData.info.websites) : null,
            socialsJson: tokenData.info?.socials ? JSON.stringify(tokenData.info.socials) : null,
            addedAtUtc: now,
            coinId: coin.coinId
          },
        });

        if (options.pctTargets && options.pctTargets.length > 0) {
          for (const target of options.pctTargets) {
            await tx.hotTriggerState.upsert({
              where: {
                hotId_trigKind_trigValue: {
                  hotId: hotEntry.hotId,
                  trigKind: 'pct',
                  trigValue: target,
                }
              },
              update: { fired: false },
              create: {
                hotId: hotEntry.hotId,
                trigKind: 'pct',
                trigValue: target,
                fired: false,
                anchorPrice: tokenData.price,
                anchorMcap: tokenData.marketCap,
              },
            });
          }
          
        }

        if (options.mcapTargets) {
          for (const target of options.mcapTargets) {
            await tx.hotTriggerState.upsert({
              where: {
                hotId_trigKind_trigValue: {
                  hotId: hotEntry.hotId,
                  trigKind: 'mcap',
                  trigValue: target,
                }
              },
              update: { fired: false },
              create: {
                hotId: hotEntry.hotId,
                trigKind: 'mcap',
                trigValue: target,
                fired: false,
                anchorPrice: tokenData.price,
                anchorMcap: tokenData.marketCap,
              },
            });
          }
          
        }
        
        return hotEntry.hotId;
      });

      // Record initial "entry added" alert
      const initialAlert: HotAlert = {
        hotId: result,
        symbol: tokenData.symbol,
        alertType: 'entry_added',
        message: `${tokenData.symbol} added to hot list with triggers`,
        currentPrice: tokenData.price,
        currentMcap: tokenData.marketCap || 0,
        deltaFromAnchor: 0,
        timestamp: now,
      };
      await this.recordAlert(initialAlert, tokenData);

      globalAlertBus.emitHotAlert(initialAlert);

      logger.info(`Added ${tokenData.symbol} (${contractAddress}) to hot list with ID ${result}`, {
        ...options,
      });

      return true;
    } catch (error) {
      console.error('Error in addEntry method:', error);
      logger.error(`Failed to add coin ${contractAddress} to hot list:`, error);
      throw error;
    }
  }

  async removeEntry(contractAddress: string): Promise<boolean> {
    try {
      const result = await this.prisma.hotEntry.updateMany({
        where: { contractAddress },
        data: { isActive: false },
      });

      if (result.count > 0) {
        logger.info(`Deactivated ${contractAddress} from hot list`);
        return true;
      }
      return false;
    } catch (error) {
      logger.error(`Failed to remove coin ${contractAddress} from hot list:`, error);
      throw error;
    }
  }

  async checkAlerts(): Promise<HotAlert[]> {
    const now = Date.now();
    HotListService.lastCheckTime = now;
    HotListService.checksInLastHour++;
    
    try {
      const entries = await this.getActiveEntries();
      
      if (entries.length === 0) return [];

      const pairRequests = entries.map(entry => ({
        chainId: entry.chainId,
        tokenAddress: entry.contractAddress,
      }));

      const pairDataMap = await this.dexScreener.batchGetTokens(pairRequests);
      
      const alerts: HotAlert[] = [];

      for (const entry of entries) {
        const key = `${entry.chainId}:${entry.contractAddress}`;
        const pair = pairDataMap.get(key);
        
        
        if (!pair) {
          continue;
        }

        if (!this.dexScreener.validatePairData(pair)) {
          continue;
        }

        const entryAlerts = this.evaluator.evaluateEntry(entry, pair.price, pair.marketCap || undefined);
        
        for (const alert of entryAlerts) {
          await this.recordAlert(alert, pair);

          if (alert.alertType === 'failsafe') {
            await this.markFailsafeFired(entry.hotId);
          } else {
            await this.markTriggerFired(entry.hotId, alert.alertType, alert.targetValue!);
          }

          // Emit alert through the global alert bus
          await globalAlertBus.emitHotAlert(alert);
        }

        alerts.push(...entryAlerts);

        // Re-fetch triggers after updates; deactivate entry when no active triggers remain
        const refreshed = await this.getEntryById(entry.hotId);
        if (this.evaluator.shouldRemoveEntry(refreshed)) {
          await this.deactivateEntry(entry.hotId);
          logger.info(`Deactivated hot list entry for ${entry.symbol} (all triggers fired)`);
        }
      }

      if (alerts.length > 0) {
        logger.info(`Checked ${entries.length} hot list entries, found ${alerts.length} alerts`);
      } else {
        logger.debug(`Checked ${entries.length} hot list entries, found ${alerts.length} alerts`);
      }
      
      // Report hourly summary
      this.maybeLogHourlySummary();
      
      return alerts;
    } catch (error) {
      HotListService.failsInLastHour++;
      logger.error('Failed to check hot list alerts:', error);
      throw error;
    }
  }

  private maybeLogHourlySummary(): void {
    const now = Date.now();
    const hoursSinceLastReport = (now - HotListService.lastHourlyReport) / (1000 * 60 * 60);
    
    if (hoursSinceLastReport >= 1.0) {
      const expectedChecks = Math.floor(60 / 2); // Every 2 minutes = 30 checks per hour
      const actualChecks = HotListService.checksInLastHour;
      const fails = HotListService.failsInLastHour;
      const successRate = actualChecks > 0 ? ((actualChecks - fails) / actualChecks * 100).toFixed(1) : '0.0';
      
      logger.info(`Hot list health: ${actualChecks}/${expectedChecks} checks completed (${successRate}% success) in last hour`);
      
      // Reset counters
      HotListService.checksInLastHour = 0;
      HotListService.failsInLastHour = 0;
      HotListService.lastHourlyReport = now;
    }
  }

  static getHealthStatus(): { lastCheck: number; checksInLastHour: number; failsInLastHour: number } {
    return {
      lastCheck: HotListService.lastCheckTime,
      checksInLastHour: HotListService.checksInLastHour,
      failsInLastHour: HotListService.failsInLastHour
    };
  }

  async listEntries(): Promise<HotListEntry[]> {
    return this.getActiveEntries();
  }

  async getAlertHistory(limit: number = 50): Promise<Array<{
    symbol: string;
    kind: string;
    message: string;
    timestamp: number;
  }>> {
    try {
      const alerts = await this.prisma.alertHistory.findMany({
        include: { hotEntry: true },
        orderBy: { tsUtc: 'desc' },
        take: limit,
      });

      return alerts.map((alert: any) => {
        const payload = JSON.parse(alert.payloadJson);
        return {
          symbol: alert.hotEntry.symbol,
          kind: alert.kind,
          message: payload.message,
          timestamp: alert.tsUtc,
        };
      });
    } catch (error) {
      logger.error('Failed to get alert history:', error);
      throw error;
    }
  }

  private async getActiveEntries(): Promise<HotListEntry[]> {
    try {
      const entries = await this.prisma.hotEntry.findMany({
        where: { isActive: true },
        include: { triggerStates: true },
      });

      return entries.map((entry: any) => ({
        hotId: entry.hotId,
        contractAddress: entry.contractAddress,
        chainId: entry.chainId,
        symbol: entry.symbol,
        name: entry.name,
        imageUrl: entry.imageUrl,
        websites: entry.websitesJson ? JSON.parse(entry.websitesJson) : [],
        socials: entry.socialsJson ? JSON.parse(entry.socialsJson) : [],
        addedAtUtc: entry.addedAtUtc,
        failsafeFired: entry.failsafeFired,
        activeTriggers: entry.triggerStates.map((ts: any) => ({
          kind: ts.trigKind as 'pct' | 'mcap',
          value: ts.trigValue,
          fired: ts.fired,
          anchorPrice: ts.anchorPrice,
          anchorMcap: ts.anchorMcap,
        })),
      }));
    } catch (error) {
      logger.error('Failed to get active hot list entries:', error);
      throw error;
    }
  }

  private async recordAlert(alert: HotAlert, pair: PairInfo): Promise<void> {
    const payload = { ...alert, pairInfo: pair };
    
    try {
      await this.db.recordHotTriggerAlert(alert.hotId, payload);
    } catch (error) {
      logger.error('Failed to record hot alert:', error);
    }
  }

  private async markFailsafeFired(hotId: number): Promise<void> {
    await this.prisma.hotEntry.update({
      where: { hotId },
      data: { failsafeFired: true },
    });
  }

  private async markTriggerFired(hotId: number, triggerKind: string, triggerValue: number): Promise<void> {
    await this.prisma.hotTriggerState.update({
      where: {
        hotId_trigKind_trigValue: {
          hotId,
          trigKind: triggerKind,
          trigValue: triggerValue,
        },
      },
      data: { fired: true },
    });
  }

  private async removeEntryById(hotId: number): Promise<void> {
    await this.prisma.hotEntry.update({ where: { hotId }, data: { isActive: false } });
  }

  private async deactivateEntry(hotId: number): Promise<void> {
    await this.prisma.hotEntry.update({ where: { hotId }, data: { isActive: false } });
  }

  private async getEntryById(hotId: number): Promise<HotListEntry> {
    const entry = await this.prisma.hotEntry.findUnique({ where: { hotId }, include: { triggerStates: true } });
    return {
      hotId: entry!.hotId,
      contractAddress: entry!.contractAddress,
      chainId: entry!.chainId,
      symbol: entry!.symbol,
      name: entry!.name || '',
      imageUrl: entry!.imageUrl || '',
      websites: entry!.websitesJson ? JSON.parse(entry!.websitesJson) : [],
      socials: entry!.socialsJson ? JSON.parse(entry!.socialsJson) : [],
      addedAtUtc: entry!.addedAtUtc,
      failsafeFired: entry!.failsafeFired,
      activeTriggers: entry!.triggerStates.map((ts: any) => ({
        kind: ts.trigKind as 'pct' | 'mcap',
        value: ts.trigValue,
        fired: ts.fired,
        anchorPrice: ts.anchorPrice,
        anchorMcap: ts.anchorMcap,
      })),
    };
  }
}