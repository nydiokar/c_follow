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

    const priceChangeFromAnchor = ((currentPrice - entry.anchorPrice) / entry.anchorPrice) * 100;

    if (!entry.failsafeFired && this.shouldTriggerFailsafe(entry, currentPrice, currentMcap)) {
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

    for (const trigger of entry.activeTriggers) {
      if (trigger.fired) continue;

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
    return !hasActiveTriggers && entry.failsafeFired;
  }

  private shouldTriggerFailsafe(entry: HotListEntry, currentPrice: number, currentMcap?: number): boolean {
    const priceDrawdown = ((entry.anchorPrice - currentPrice) / entry.anchorPrice) * 100;
    if (priceDrawdown >= this.failsafeThreshold) {
      return true;
    }

    if (entry.anchorMcap && currentMcap) {
      const mcapDrawdown = ((entry.anchorMcap - currentMcap) / entry.anchorMcap) * 100;
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
      pctTarget?: number;
      mcapTargets?: number[];
    } = {}
  ): Promise<boolean> {
    try {
      console.log('HotListService.addEntry called with:', { contractAddress, tokenData, options });
      const now = Math.floor(Date.now() / 1000);

      const result = await this.prisma.$transaction(async (tx: any) => {
        console.log('Starting database transaction...');

        // Upsert Coin
        const coin = await tx.coin.upsert({
          where: {
            chain_pairAddress: {
              chain: tokenData.chainId,
              pairAddress: tokenData.pairAddress
            }
          },
          update: {
            symbol: tokenData.symbol,
            name: tokenData.name,
            isActive: true
          },
          create: {
            chain: tokenData.chainId,
            pairAddress: tokenData.pairAddress,
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
            anchorPrice: tokenData.price,
            anchorMcap: tokenData.marketCap,
            pctTarget: options.pctTarget,
            mcapTargets: options.mcapTargets ? options.mcapTargets.join(',') : null,
            coinId: coin.coinId
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
            anchorPrice: tokenData.price,
            anchorMcap: tokenData.marketCap,
            pctTarget: options.pctTarget,
            mcapTargets: options.mcapTargets ? options.mcapTargets.join(',') : null,
            coinId: coin.coinId
          },
        });
        console.log('HotEntry created with ID:', hotEntry.hotId);

        if (options.pctTarget !== undefined) {
          await tx.hotTriggerState.upsert({
            where: {
              hotId_trigKind_trigValue: {
                hotId: hotEntry.hotId,
                trigKind: 'pct',
                trigValue: options.pctTarget,
              }
            },
            update: { fired: false },
            create: {
              hotId: hotEntry.hotId,
              trigKind: 'pct',
              trigValue: options.pctTarget,
              fired: false,
            },
          });
          console.log('PCT trigger upserted for:', options.pctTarget);
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
              },
            });
          }
          console.log('MCAP triggers upserted for:', options.mcapTargets);
        }
        
        console.log('Transaction completed successfully, returning hotId:', hotEntry.hotId);
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

      console.log('addEntry method completed successfully, returning true');
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
    try {
      const entries = await this.getActiveEntries();
      if (entries.length === 0) return [];

      const pairRequests = entries.map(entry => ({
        chainId: entry.chainId,
        pairAddress: entry.contractAddress,
      }));

      const pairDataMap = await this.dexScreener.batchGetPairs(pairRequests);
      const alerts: HotAlert[] = [];

      for (const entry of entries) {
        const key = `${entry.chainId}:${entry.contractAddress}`;
        const pair = pairDataMap.get(key);

        if (!pair || !this.dexScreener.validatePairData(pair)) {
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

        if (this.evaluator.shouldRemoveEntry(entry)) {
          await this.removeEntryById(entry.hotId);
          logger.info(`Auto-removed hot list entry for ${entry.symbol} (no active triggers + failsafe fired)`);
        }
      }

      logger.info(`Checked ${entries.length} hot list entries, found ${alerts.length} alerts`);
      return alerts;
    } catch (error) {
      logger.error('Failed to check hot list alerts:', error);
      throw error;
    }
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
        anchorPrice: entry.anchorPrice,
        anchorMcap: entry.anchorMcap || undefined,
        pctTarget: entry.pctTarget || undefined,
        mcapTargets: entry.mcapTargets ?
          entry.mcapTargets.split(',').map((t: string) => parseFloat(t)).filter((t: number) => !isNaN(t)) :
          undefined,
        failsafeFired: entry.failsafeFired,
        activeTriggers: entry.triggerStates.map((ts: any) => ({
          kind: ts.trigKind as 'pct' | 'mcap',
          value: ts.trigValue,
          fired: ts.fired,
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
    await this.prisma.hotEntry.delete({
      where: { hotId },
    });
  }
}