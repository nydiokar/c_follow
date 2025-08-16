import { DatabaseManager } from '../utils/database';
import { logger } from '../utils/logger';
import { PrismaTransactionClient, CoinData, LongStateData, ScheduleConfigData, UpdateLongStateData } from '../types/database';

export class DatabaseService {
  private prisma = DatabaseManager.getInstance();

  constructor() {
    // Database initialization handled by DatabaseManager
  }

  async initialize(): Promise<void> {
    // Initialization handled by DatabaseManager
    logger.info('DatabaseService initialized');
  }

  async addCoinToLongList(symbol: string, chain: string, pairAddress: string, name?: string): Promise<number> {
    const now = Math.floor(Date.now() / 1000);

    const result = await this.prisma.$transaction(async (tx: PrismaTransactionClient) => {
      const coin = await tx.coin.upsert({
        where: {
          chain_pairAddress: {
            chain,
            pairAddress
          }
        },
        update: {
          symbol,
          name: name || null,
          isActive: true
        },
        create: {
          chain,
          pairAddress,
          symbol,
          name: name || null,
          isActive: true
        }
      });

      const existingWatch = await tx.longWatch.findUnique({
        where: { coinId: coin.coinId }
      });

      if (!existingWatch) {
        await tx.longWatch.create({
          data: {
            coinId: coin.coinId,
            addedAtUtc: now
          }
        });

        await tx.longState.create({
          data: {
            coinId: coin.coinId,
            lastUpdatedUtc: now
          }
        });
      }

      return coin.coinId;
    });

    logger.info(`Added coin ${symbol} to long list with ID ${result}`);
    return result;
  }

  async removeCoinFromLongList(symbol: string): Promise<boolean> {
    const coin = await this.prisma.coin.findFirst({
      where: { symbol },
      include: { longWatch: true }
    });

    if (!coin || !coin.longWatch) {
      return false;
    }

    await this.prisma.longWatch.delete({
      where: { coinId: coin.coinId }
    });

    logger.info(`Removed coin ${symbol} from long list`);
    return true;
  }

  async getLongListCoins(): Promise<Array<{
    coinId: number;
    chain: string;
    pairAddress: string;
    symbol: string;
    name?: string;
    config: {
      retraceOn: boolean;
      stallOn: boolean;
      breakoutOn: boolean;
      mcapOn: boolean;
      retracePct: number;
      stallVolPct: number;
      stallBandPct: number;
      breakoutPct: number;
      breakoutVolX: number;
      mcapLevels?: string;
    };
  }>> {
    const result = await this.prisma.coin.findMany({
      where: {
        isActive: true,
        longWatch: {
          isNot: null
        }
      },
      include: {
        longWatch: true
      }
    });

    return result.map((coin: any): CoinData => ({
      coinId: coin.coinId,
      chain: coin.chain,
      pairAddress: coin.pairAddress,
      symbol: coin.symbol,
      name: coin.name || undefined,
      config: {
        retraceOn: coin.longWatch!.retraceOn,
        stallOn: coin.longWatch!.stallOn,
        breakoutOn: coin.longWatch!.breakoutOn,
        mcapOn: coin.longWatch!.mcapOn,
        retracePct: coin.longWatch!.retracePct,
        stallVolPct: coin.longWatch!.stallVolPct,
        stallBandPct: coin.longWatch!.stallBandPct,
        breakoutPct: coin.longWatch!.breakoutPct,
        breakoutVolX: coin.longWatch!.breakoutVolX,
        mcapLevels: coin.longWatch!.mcapLevels || undefined
      }
    }));
  }

  async updateLongState(
    coinId: number,
    data: UpdateLongStateData
  ): Promise<void> {
    const now = Math.floor(Date.now() / 1000);

    await this.prisma.longState.upsert({
      where: { coinId },
      update: {
        lastPrice: data.price,
        lastMcap: data.marketCap || null,
        h12High: data.h12High || null,
        h24High: data.h24High || null,
        h72High: data.h72High || null,
        h12Low: data.h12Low || null,
        h24Low: data.h24Low || null,
        h72Low: data.h72Low || null,
        v12Sum: data.v12Sum || null,
        v24Sum: data.v24Sum || null,
        lastUpdatedUtc: now
      },
      create: {
        coinId,
        lastPrice: data.price,
        lastMcap: data.marketCap || null,
        h12High: data.h12High || null,
        h24High: data.h24High || null,
        h72High: data.h72High || null,
        h12Low: data.h12Low || null,
        h24Low: data.h24Low || null,
        h72Low: data.h72Low || null,
        v12Sum: data.v12Sum || null,
        v24Sum: data.v24Sum || null,
        lastUpdatedUtc: now
      }
    });
  }

  async recordTriggerFire(coinId: number, triggerType: 'retrace' | 'stall' | 'breakout' | 'mcap'): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const updateData: Record<string, number> = {};

    switch (triggerType) {
      case 'retrace':
        updateData.lastRetraceFireUtc = now;
        break;
      case 'stall':
        updateData.lastStallFireUtc = now;
        break;
      case 'breakout':
        updateData.lastBreakoutFireUtc = now;
        break;
      case 'mcap':
        updateData.lastMcapFireUtc = now;
        break;
    }

    await this.prisma.longState.update({
      where: { coinId },
      data: updateData
    });

    logger.debug(`Recorded ${triggerType} trigger fire for coin ${coinId}`);
  }

  async recordLongTriggerAlert(coinId: number, trigger: any): Promise<void> {
    const fingerprint = `long_${coinId}_${trigger.triggerType}_${trigger.timestamp || Date.now()}`;
    
    try {
      await this.prisma.alertHistory.create({
        data: {
          coinId,
          tsUtc: Math.floor(Date.now() / 1000),
          kind: trigger.triggerType,
          payloadJson: JSON.stringify(trigger),
          fingerprint,
        },
      });
    } catch (error) {
      if ((error as any)?.code !== 'P2002') { // Ignore unique constraint errors
        throw error;
      }
    }
  }

  async recordHotTriggerAlert(hotId: number, alert: any): Promise<void> {
    const fingerprint = `hot_${hotId}_${alert.alertType}_${alert.timestamp}`;
    
    try {
      await this.prisma.alertHistory.create({
        data: {
          hotId,
          tsUtc: Math.floor(alert.timestamp / 1000),
          kind: alert.alertType,
          payloadJson: JSON.stringify(alert),
          fingerprint,
          symbol: alert.symbol,
        },
      });
    } catch (error) {
      if ((error as any)?.code !== 'P2002') { // Ignore unique constraint errors
        throw error;
      }
    }
  }

  async getLongStates(): Promise<Array<{
    coinId: number;
    h12High?: number;
    h24High?: number;
    h72High?: number;
    h12Low?: number;
    h24Low?: number;
    h72Low?: number;
    v12Sum?: number;
    v24Sum?: number;
    lastPrice?: number;
    lastMcap?: number;
    lastUpdatedUtc: number;
    lastRetraceFireUtc?: number;
    lastStallFireUtc?: number;
    lastBreakoutFireUtc?: number;
    lastMcapFireUtc?: number;
  }>> {
    const states = await this.prisma.longState.findMany();
    return states.map((state: any): LongStateData => ({
      coinId: state.coinId,
      h12High: state.h12High || undefined,
      h24High: state.h24High || undefined,
      h72High: state.h72High || undefined,
      h12Low: state.h12Low || undefined,
      h24Low: state.h24Low || undefined,
      h72Low: state.h72Low || undefined,
      v12Sum: state.v12Sum || undefined,
      v24Sum: state.v24Sum || undefined,
      lastPrice: state.lastPrice || undefined,
      lastMcap: state.lastMcap || undefined,
      lastUpdatedUtc: state.lastUpdatedUtc,
      lastRetraceFireUtc: state.lastRetraceFireUtc || undefined,
      lastStallFireUtc: state.lastStallFireUtc || undefined,
      lastBreakoutFireUtc: state.lastBreakoutFireUtc || undefined,
      lastMcapFireUtc: state.lastMcapFireUtc || undefined
    }));
  }

  async getScheduleConfig(): Promise<ScheduleConfigData> {
    const config = await this.prisma.scheduleCfg.findUnique({
      where: { cfgId: 1 }
    });

    if (!config) {
      throw new Error('Schedule configuration not found');
    }

    return {
      anchorTimesLocal: config.anchorTimesLocal,
      anchorPeriodHours: config.anchorPeriodHours,
      longCheckpointHours: config.longCheckpointHours,
      hotIntervalMinutes: config.hotIntervalMinutes,
      cooldownHours: config.cooldownHours,
      hysteresisPct: config.hysteresisPct,
      globalRetraceOn: config.globalRetraceOn,
      globalStallOn: config.globalStallOn,
      globalBreakoutOn: config.globalBreakoutOn,
      globalMcapOn: config.globalMcapOn
    };
  }

  async updateTriggerConfig(
    symbol: string,
    config: Partial<{
      retraceOn: boolean;
      stallOn: boolean;
      breakoutOn: boolean;
      mcapOn: boolean;
      retracePct: number;
      stallVolPct: number;
      stallBandPct: number;
      breakoutPct: number;
      breakoutVolX: number;
      mcapLevels: string;
    }>
  ): Promise<boolean> {
    const coin = await this.prisma.coin.findFirst({
      where: { symbol },
      include: { longWatch: true }
    });

    if (!coin || !coin.longWatch) {
      return false;
    }

    await this.prisma.longWatch.update({
      where: { coinId: coin.coinId },
      data: config
    });

    return true;
  }

  async updateGlobalTriggerSettings(settings: {
    globalRetraceOn?: boolean;
    globalStallOn?: boolean;
    globalBreakoutOn?: boolean;
    globalMcapOn?: boolean;
  }): Promise<void> {
    await this.prisma.scheduleCfg.update({
      where: { cfgId: 1 },
      data: settings
    });
    
    logger.info('Global trigger settings updated:', settings);
  }

  async getAllRecentAlerts(limit: number = 50): Promise<Array<{
    symbol: string;
    kind: string;
    message: string;
    timestamp: number;
    source: 'hot' | 'long';
  }>> {
    try {
      const alerts = await this.prisma.alertHistory.findMany({
        include: { 
          hotEntry: true,
          coin: true
        },
        orderBy: { tsUtc: 'desc' },
        take: limit,
      });

      return alerts.map((alert: any) => {
        const payload = JSON.parse(alert.payloadJson);
        return {
          symbol: alert.hotEntry?.symbol || alert.coin?.symbol || 'Unknown',
          kind: alert.kind,
          message: payload.message,
          timestamp: alert.tsUtc,
          source: alert.hotId ? 'hot' : 'long' as 'hot' | 'long'
        };
      });
    } catch (error) {
      logger.error('Failed to get all recent alerts:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    // Disconnection handled by DatabaseManager
    logger.info('DatabaseService disconnected');
  }
}