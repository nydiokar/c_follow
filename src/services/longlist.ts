import { DatabaseService } from './database';
import { DexScreenerService } from './dexscreener';
import { TriggerConfig, LongListState, TriggerResult, TriggerEvaluator, AnchorReportData } from '../types/triggers';
import { PairInfo } from '../types/dexscreener';
import { logger } from '../utils/logger';
import { RollingWindowManager } from './rollingWindow';
import { globalAlertBus } from '../events/alertBus';
import { Formatters } from '../utils/formatters';

class LongListTriggerEvaluator implements TriggerEvaluator {
  /**
   * Simple trigger evaluator following the plan specification
   * No complex hysteresis - just basic cooldowns and conditions
   */

  evaluateRetrace(state: LongListState, config: TriggerConfig, currentPrice: number, cooldownHours: number): boolean {
    if (!config.retraceOn || !state.h72High || currentPrice <= 0) {
      return false;
    }

    const now = Math.floor(Date.now() / 1000);
    const cooldownSeconds = cooldownHours * 3600;
    
    // Check cooldown period (2h as per plan)
    if (state.lastRetraceFireUtc && (now - state.lastRetraceFireUtc) < cooldownSeconds) {
      logger.debug(`Retrace trigger blocked by cooldown for ${state.coinId}`);
      return false;
    }

    // Simple retrace condition: price drops below threshold from 72h high
    const retraceThreshold = state.h72High * (1 - config.retracePct / 100);
    return currentPrice <= retraceThreshold;
  }

  evaluateStall(state: LongListState, config: TriggerConfig, currentVolume: number, currentPrice: number, cooldownHours: number): boolean {
    if (!config.stallOn || !state.v24Sum || !state.h12High || !state.h12Low) {
      return false;
    }

    const now = Math.floor(Date.now() / 1000);
    const cooldownSeconds = cooldownHours * 3600;
    
    // Check cooldown period (2h as per plan)
    if (state.lastStallFireUtc && (now - state.lastStallFireUtc) < cooldownSeconds) {
      logger.debug(`Stall trigger blocked by cooldown for ${state.coinId}`);
      return false;
    }
    
    // Simple stall condition: volume down 30% vs 24h AND price in ±5% band over 12h
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
    
    // Check cooldown period (2h as per plan)
    if (state.lastBreakoutFireUtc && (now - state.lastBreakoutFireUtc) < cooldownSeconds) {
      logger.debug(`Breakout trigger blocked by cooldown for ${state.coinId}`);
      return false;
    }

    // Simple breakout condition: price +12% vs 12h baseline AND volume 1.5x vs 12h
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
        pair.tokenAddress,
        pair.name
      );

      logger.info(`Added ${symbol} to long list`, { 
        symbol: pair.symbol, 
        chain: pair.chainId, 
        tokenAddress: pair.tokenAddress 
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
        tokenAddress: coin.tokenAddress
      }));

      const pairData = await this.dexScreener.batchGetTokens(pairRequests);
      const stateMap = new Map(states.map(s => [s.coinId, s]));
      const triggers: TriggerResult[] = [];

      for (const coin of coins) {
        const key = `${coin.chain}:${coin.tokenAddress}`;
        const pair = pairData.get(key);
        const state = stateMap.get(coin.coinId);

        if (!pair || !state || !this.dexScreener.validatePairData(pair)) {
          continue;
        }
        
        // Check if we have enough historical data before evaluating triggers
        const isWarmupComplete = await this.rollingWindow.isWarmupComplete(coin.coinId, 12); // Require at least 12 hours of data
        if (!isWarmupComplete) {
          logger.info(`Skipping triggers for ${coin.symbol} - warmup not complete`);
          // Still update state data even if we skip triggers
          await this.updateStateData(coin.coinId, pair, state);
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
          logger.info(`Recording trigger for ${coin.symbol}: type=${trigger.triggerType}, price=${trigger.price}`);
          
          try {
            await this.db.recordTriggerFire(coin.coinId, trigger.triggerType, trigger.price);
            await this.db.recordLongTriggerAlert(coin.coinId, trigger);
            await globalAlertBus.emitLongTrigger(trigger);
          } catch (error) {
            logger.error(`Failed to record ${trigger.triggerType} trigger for ${coin.symbol}:`, error);
            throw error;
          }
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
    
    // Check if we have historical data points
    const dataPoints = await this.rollingWindow.getDataPointsCount(coinId);
    const hasHistory = dataPoints > 0;
    
    // Create new state with more accurate handling
    const newState: any = {
      h12High: currentState.h12High !== undefined ? Math.max(currentState.h12High, pair.price) : pair.price,
      h24High: currentState.h24High !== undefined ? Math.max(currentState.h24High, pair.price) : pair.price,
      h72High: currentState.h72High !== undefined ? Math.max(currentState.h72High, pair.price) : pair.price,
      h12Low: currentState.h12Low !== undefined ? Math.min(currentState.h12Low, pair.price) : pair.price,
      h24Low: currentState.h24Low !== undefined ? Math.min(currentState.h24Low, pair.price) : pair.price,
      h72Low: currentState.h72Low !== undefined ? Math.min(currentState.h72Low, pair.price) : pair.price,
    };
    
    // Get more accurate volume data if possible
    if (hasHistory) {
      try {
        newState.v12Sum = await this.rollingWindow.getSumVolume(coinId, now - h12, now);
        newState.v24Sum = pair.volume24h; // Already 24h from API
      } catch (error) {
        logger.warn(`Failed to get accurate volume data, using estimates for ${coinId}`, error);
        newState.v12Sum = pair.volume24h * 0.5; // Fallback
        newState.v24Sum = pair.volume24h;
      }
    } else {
      // Initial data without history
      newState.v12Sum = pair.volume24h * 0.5;
      newState.v24Sum = pair.volume24h;
    }

    // Reset time period values if enough time has passed
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

      const tokenRequests = coins.map(coin => ({
        chainId: coin.chain,
        tokenAddress: coin.tokenAddress
      }));

      const tokenData = await this.dexScreener.batchGetTokens(tokenRequests);
      const stateMap = new Map(states.map(s => [s.coinId, s]));
      const reportData: AnchorReportData[] = [];

      for (const coin of coins) {
        const key = `${coin.chain}:${coin.tokenAddress}`;
        const pair = tokenData.get(key);
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