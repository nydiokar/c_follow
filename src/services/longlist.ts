import { DatabaseService } from './database';
import { DexScreenerService } from './dexscreener';
import { TriggerConfig, LongListState, TriggerResult, TriggerEvaluator, AnchorReportData } from '../types/triggers';
import { PairInfo } from '../types/dexscreener';
import { logger } from '../utils/logger';
import { RollingWindowManager } from './rollingWindow';
import { globalAlertBus } from '../events/alertBus';
import { Formatters } from '../utils/formatters';

class LongListTriggerEvaluator implements TriggerEvaluator {
  evaluateRetrace(state: LongListState, config: TriggerConfig, currentPrice: number, cooldownHours: number): boolean {
    if (!config.retraceOn || !state.h72High || currentPrice <= 0) {
      return false;
    }

    const now = Math.floor(Date.now() / 1000);
    const cooldownSeconds = cooldownHours * 3600;
    
    if (state.lastRetraceFireUtc && (now - state.lastRetraceFireUtc) < cooldownSeconds) {
      return false;
    }

    const retraceThreshold = state.h72High * (1 - config.retracePct / 100);
    return currentPrice <= retraceThreshold;
  }

  evaluateStall(state: LongListState, config: TriggerConfig, currentVolume: number, currentPrice: number, cooldownHours: number): boolean {
    if (!config.stallOn || !state.v24Sum || !state.h12High || !state.h12Low) {
      return false;
    }

    const now = Math.floor(Date.now() / 1000);
    const cooldownSeconds = cooldownHours * 3600;
    
    if (state.lastStallFireUtc && (now - state.lastStallFireUtc) < cooldownSeconds) {
      return false;
    }

    const volumeDropped = currentVolume <= (state.v24Sum * (1 - config.stallVolPct / 100));
    const priceInBand = (
      state.h12High <= currentPrice * (1 + config.stallBandPct / 100) &&
      state.h12Low >= currentPrice * (1 - config.stallBandPct / 100)
    );

    return volumeDropped && priceInBand;
  }

  evaluateBreakout(state: LongListState, config: TriggerConfig, currentPrice: number, currentVolume: number, cooldownHours: number): boolean {
    if (!config.breakoutOn || !state.h12High || !state.v12Sum) {
      return false;
    }

    const now = Math.floor(Date.now() / 1000);
    const cooldownSeconds = cooldownHours * 3600;
    
    if (state.lastBreakoutFireUtc && (now - state.lastBreakoutFireUtc) < cooldownSeconds) {
      return false;
    }

    const priceBreakout = currentPrice >= (state.h12High * (1 + config.breakoutPct / 100));
    const volumeIncrease = currentVolume >= (state.v12Sum * config.breakoutVolX);

    return priceBreakout && volumeIncrease;
  }

  evaluateMcap(state: LongListState, config: TriggerConfig, currentMcap: number, cooldownHours: number): { triggered: boolean; level?: number } {
    if (!config.mcapOn || !config.mcapLevels || currentMcap <= 0) {
      return { triggered: false };
    }

    const now = Math.floor(Date.now() / 1000);
    const cooldownSeconds = cooldownHours * 3600;
    
    if (state.lastMcapFireUtc && (now - state.lastMcapFireUtc) < cooldownSeconds) {
      return { triggered: false };
    }

    const levels = config.mcapLevels.sort((a, b) => a - b);
    
    for (const level of levels) {
      if (currentMcap >= level && (!state.lastMcap || state.lastMcap < level)) {
        return { triggered: true, level };
      }
    }

    return { triggered: false };
  }
}

export class LongListService {
  private db: DatabaseService;
  private dexScreener: DexScreenerService;
  private triggerEvaluator: TriggerEvaluator;
  private rollingWindow: RollingWindowManager;

  constructor(db: DatabaseService, dexScreener: DexScreenerService, rollingWindow: RollingWindowManager) {
    this.db = db;
    this.dexScreener = dexScreener;
    this.triggerEvaluator = new LongListTriggerEvaluator();
    this.rollingWindow = rollingWindow;
  }

  async addCoin(symbol: string, chainId: string = 'solana'): Promise<boolean> {
    try {
      const searchResults = await this.dexScreener.searchPairs(symbol);
      
      if (searchResults.length === 0) {
        throw new Error(`No pairs found for symbol: ${symbol}`);
      }

      const chainPairs = searchResults.filter(p => p.chainId === chainId);
      const pair = chainPairs.length > 0 ? chainPairs[0] : searchResults[0];

      if (!pair || !this.dexScreener.validatePairData(pair)) {
        throw new Error(`Invalid pair data for ${symbol}`);
      }

      await this.db.addCoinToLongList(
        pair.symbol,
        pair.chainId,
        pair.pairAddress,
        pair.name
      );

      logger.info(`Added ${symbol} to long list`, { 
        symbol: pair.symbol, 
        chain: pair.chainId, 
        pairAddress: pair.pairAddress 
      });

      return true;
    } catch (error) {
      logger.error(`Failed to add coin ${symbol} to long list:`, error);
      throw error;
    }
  }

  async removeCoin(symbol: string): Promise<boolean> {
    try {
      const result = await this.db.removeCoinFromLongList(symbol);
      if (result) {
        logger.info(`Removed ${symbol} from long list`);
      }
      return result;
    } catch (error) {
      logger.error(`Failed to remove coin ${symbol} from long list:`, error);
      throw error;
    }
  }

  async updateTriggerSettings(
    symbol: string,
    settings: {
      trigger?: string;
      enabled?: boolean;
      retracePct?: number;
      stallVolPct?: number;
      stallBandPct?: number;
      breakoutPct?: number;
      breakoutVolX?: number;
      mcapLevels?: number[];
    }
  ): Promise<boolean> {
    try {
      const updateData: any = {};

      if (settings.trigger && typeof settings.enabled !== 'undefined') {
        switch (settings.trigger) {
          case 'retrace':
            updateData.retraceOn = settings.enabled;
            break;
          case 'stall':
            updateData.stallOn = settings.enabled;
            break;
          case 'breakout':
            updateData.breakoutOn = settings.enabled;
            break;
          case 'mcap':
            updateData.mcapOn = settings.enabled;
            break;
        }
      }

      if (typeof settings.retracePct !== 'undefined') {
        updateData.retracePct = settings.retracePct;
      }
      if (typeof settings.stallVolPct !== 'undefined') {
        updateData.stallVolPct = settings.stallVolPct;
      }
      if (typeof settings.stallBandPct !== 'undefined') {
        updateData.stallBandPct = settings.stallBandPct;
      }
      if (typeof settings.breakoutPct !== 'undefined') {
        updateData.breakoutPct = settings.breakoutPct;
      }
      if (typeof settings.breakoutVolX !== 'undefined') {
        updateData.breakoutVolX = settings.breakoutVolX;
      }
      if (settings.mcapLevels) {
        updateData.mcapLevels = settings.mcapLevels.join(',');
      }

      const result = await this.db.updateTriggerConfig(symbol, updateData);
      
      if (result) {
        logger.info(`Updated trigger settings for ${symbol}`, settings);
      }
      
      return result;
    } catch (error) {
      logger.error(`Failed to update trigger settings for ${symbol}:`, error);
      throw error;
    }
  }

  async checkTriggers(): Promise<TriggerResult[]> {
    try {
      const coins = await this.db.getLongListCoins();
      const states = await this.db.getLongStates();
      const config = await this.db.getScheduleConfig();

      if (coins.length === 0) {
        return [];
      }

      const pairRequests = coins.map(coin => ({
        chainId: coin.chain,
        pairAddress: coin.pairAddress
      }));

      const pairData = await this.dexScreener.batchGetPairs(pairRequests);
      const stateMap = new Map(states.map(s => [s.coinId, s]));
      const triggers: TriggerResult[] = [];

      for (const coin of coins) {
        const key = `${coin.chain}:${coin.pairAddress}`;
        const pair = pairData.get(key);
        const state = stateMap.get(coin.coinId);

        if (!pair || !state || !this.dexScreener.validatePairData(pair)) {
          continue;
        }

        await this.updateStateData(coin.coinId, pair, state);

        const triggerConfig: TriggerConfig = {
          retraceOn: coin.config.retraceOn && config.globalRetraceOn,
          stallOn: coin.config.stallOn && config.globalStallOn,
          breakoutOn: coin.config.breakoutOn && config.globalBreakoutOn,
          mcapOn: coin.config.mcapOn && config.globalMcapOn,
          retracePct: coin.config.retracePct,
          stallVolPct: coin.config.stallVolPct,
          stallBandPct: coin.config.stallBandPct,
          breakoutPct: coin.config.breakoutPct,
          breakoutVolX: coin.config.breakoutVolX,
          mcapLevels: coin.config.mcapLevels ? 
            coin.config.mcapLevels.split(',').map((l: string) => parseFloat(l)).filter((l: number) => !isNaN(l)) : 
            []
        };

        const evaluatedTriggers = this.evaluateAllTriggers(
          coin.coinId,
          coin.symbol,
          state,
          triggerConfig,
          pair,
          config.cooldownHours
        );

        triggers.push(...evaluatedTriggers);

        for (const trigger of evaluatedTriggers) {
          await this.db.recordTriggerFire(coin.coinId, trigger.triggerType);
          await this.db.recordLongTriggerAlert(coin.coinId, trigger);
          await globalAlertBus.emitLongTrigger(trigger);
        }
      }

      logger.info(`Evaluated triggers for ${coins.length} coins, found ${triggers.length} alerts`);
      return triggers;

    } catch (error) {
      logger.error('Failed to check triggers:', error);
      throw error;
    }
  }

  private evaluateAllTriggers(
    coinId: number,
    symbol: string,
    state: LongListState,
    config: TriggerConfig,
    pair: PairInfo,
    cooldownHours: number
  ): TriggerResult[] {
    const triggers: TriggerResult[] = [];

    if (this.triggerEvaluator.evaluateRetrace(state, config, pair.price, cooldownHours)) {
      const retracePercent = state.h72High ? 
        ((state.h72High - pair.price) / state.h72High * 100) : 0;
      
      triggers.push({
        coinId,
        symbol,
        triggerType: 'retrace',
        message: `${symbol} retraced ${retracePercent.toFixed(1)}% from 72h high`,
        price: pair.price,
        marketCap: pair.marketCap || 0,
        volume24h: pair.volume24h,
        priceChange24h: pair.priceChange24h,
        retraceFromHigh: retracePercent
      });
    }

    if (this.triggerEvaluator.evaluateStall(state, config, pair.volume24h, pair.price, cooldownHours)) {
      triggers.push({
        coinId,
        symbol,
        triggerType: 'stall',
        message: `${symbol} momentum stalled: volume down ${config.stallVolPct}%, price in ${config.stallBandPct}% band`,
        price: pair.price,
        marketCap: pair.marketCap || 0,
        volume24h: pair.volume24h,
        priceChange24h: pair.priceChange24h
      });
    }

    if (this.triggerEvaluator.evaluateBreakout(state, config, pair.price, pair.volume24h, cooldownHours)) {
      const breakoutPercent = state.h12High ? 
        ((pair.price - state.h12High) / state.h12High * 100) : 0;
      
      triggers.push({
        coinId,
        symbol,
        triggerType: 'breakout',
        message: `${symbol} breakout: +${breakoutPercent.toFixed(1)}% with ${config.breakoutVolX}x volume`,
        price: pair.price,
        marketCap: pair.marketCap || 0,
        volume24h: pair.volume24h,
        priceChange24h: pair.priceChange24h
      });
    }

    if (pair.marketCap) {
      const mcapResult = this.triggerEvaluator.evaluateMcap(state, config, pair.marketCap, cooldownHours);
      if (mcapResult.triggered && mcapResult.level) {
        triggers.push({
          coinId,
          symbol,
          triggerType: 'mcap',
          message: `${symbol} market cap reached ${this.formatMarketCap(mcapResult.level)}`,
          price: pair.price,
          marketCap: pair.marketCap,
          volume24h: pair.volume24h,
          priceChange24h: pair.priceChange24h,
          targetLevel: mcapResult.level
        });
      }
    }

    return triggers;
  }

  private async updateStateData(coinId: number, pair: PairInfo, currentState: LongListState): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const h12 = 12 * 3600;
    const h24 = 24 * 3600;
    const h72 = 72 * 3600;

    const newState = {
      h12High: Math.max(currentState.h12High || pair.price, pair.price),
      h24High: Math.max(currentState.h24High || pair.price, pair.price),
      h72High: Math.max(currentState.h72High || pair.price, pair.price),
      h12Low: Math.min(currentState.h12Low || pair.price, pair.price),
      h24Low: Math.min(currentState.h24Low || pair.price, pair.price),
      h72Low: Math.min(currentState.h72Low || pair.price, pair.price),
      v12Sum: pair.volume24h * 0.5,
      v24Sum: pair.volume24h
    };

    if (currentState.lastUpdatedUtc && (now - currentState.lastUpdatedUtc) > h12) {
      newState.h12High = pair.price;
      newState.h12Low = pair.price;
    }

    if (currentState.lastUpdatedUtc && (now - currentState.lastUpdatedUtc) > h24) {
      newState.h24High = pair.price;
      newState.h24Low = pair.price;
    }

    if (currentState.lastUpdatedUtc && (now - currentState.lastUpdatedUtc) > h72) {
      newState.h72High = pair.price;
      newState.h72Low = pair.price;
    }

    const updateData: any = {
      price: pair.price,
      volume24h: pair.volume24h,
      ...newState
    };
    
    if (pair.marketCap !== null) {
      updateData.marketCap = pair.marketCap;
    }
    
    await this.db.updateLongState(coinId, updateData);
  }

  async generateAnchorReport(): Promise<AnchorReportData[]> {
    try {
      const coins = await this.db.getLongListCoins();
      const states = await this.db.getLongStates();

      if (coins.length === 0) {
        return [];
      }

      const pairRequests = coins.map(coin => ({
        chainId: coin.chain,
        pairAddress: coin.pairAddress
      }));

      const pairData = await this.dexScreener.batchGetPairs(pairRequests);
      const stateMap = new Map(states.map(s => [s.coinId, s]));
      const reportData: AnchorReportData[] = [];

      for (const coin of coins) {
        const key = `${coin.chain}:${coin.pairAddress}`;
        const pair = pairData.get(key);
        const state = stateMap.get(coin.coinId);

        if (!pair || !state || !this.dexScreener.validatePairData(pair)) {
          continue;
        }

        const retraceFrom72hHigh = state.h72High ? 
          ((state.h72High - pair.price) / state.h72High * 100) : 0;

        reportData.push({
          symbol: pair.symbol,
          price: pair.price,
          change24h: pair.priceChange24h,
          retraceFrom72hHigh,
          volume24h: pair.volume24h
        });
      }

      reportData.sort((a, b) => b.retraceFrom72hHigh - a.retraceFrom72hHigh);

      return reportData;
    } catch (error) {
      logger.error('Failed to generate anchor report:', error);
      throw error;
    }
  }

  private formatMarketCap(value: number): string {
    return Formatters.formatMarketCap(value);
  }
}