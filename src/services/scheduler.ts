import cron from 'node-cron';
import { DatabaseService } from './database';
import { LongListService } from './longlist';
import { HotListService } from './hotlist';
import { TelegramService } from './telegram';
import { DexScreenerService } from './dexscreener';
import { TokenProcessorService } from './tokenProcessor';
import { Formatters } from '../utils/formatters';
import { logger } from '../utils/logger';

export interface SchedulerConfig {
  anchorTimesLocal: string;
  longCheckpointHours: number;
  hotIntervalMinutes: number;
}

export class SchedulerService {
  private db: DatabaseService;
  private longList: LongListService;
  private hotList: HotListService;
  private telegram: TelegramService;
  private dexScreener: DexScreenerService;
  private tasks: cron.ScheduledTask[] = [];
  private timezone: string;
  private isRunning = false;

  constructor(
    db: DatabaseService,
    longList: LongListService,
    hotList: HotListService,
    telegram: TelegramService,
    dexScreener: DexScreenerService,
    timezone: string = 'UTC'
  ) {
    this.db = db;
    this.longList = longList;
    this.hotList = hotList;
    this.telegram = telegram;
    this.dexScreener = dexScreener;
    this.timezone = timezone;
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Scheduler is already running');
      return;
    }

    try {
      const config = await this.db.getScheduleConfig();
      await this.setupSchedules(config);
      this.isRunning = true;
      logger.info('Scheduler started successfully');
    } catch (error) {
      logger.error('Failed to start scheduler:', error);
      throw error;
    }
  }

  private async setupSchedules(config: SchedulerConfig): Promise<void> {
    this.setupAnchorReports(config.anchorTimesLocal);
    this.setupLongCheckpoints(config.longCheckpointHours);
    
    // Use environment variable for hot list interval, fallback to database config
    const hotIntervalMinutes = parseInt(process.env.HOT_LIST_INTERVAL_MINUTES || '1') || config.hotIntervalMinutes;
    this.setupHotChecks(hotIntervalMinutes);

    // Setup token processing every 3 hours
    this.setupTokenProcessing();

    logger.info('Scheduled tasks:', {
      anchorTimes: config.anchorTimesLocal,
      longCheckpointHours: config.longCheckpointHours,
      hotIntervalMinutes: hotIntervalMinutes,
      tokenProcessing: 'Every 3 hours'
    });
  }

  private setupAnchorReports(anchorTimesLocal: string): void {
    const times = anchorTimesLocal.split(',').map(t => t.trim());
    
    for (const time of times) {
      const [hour, minute] = time.split(':').map(n => parseInt(n));
      const cronExpression = `${minute} ${hour} * * *`;
      
      const task = cron.schedule(cronExpression, async () => {
        await this.runAnchorReport();
      }, {
        scheduled: true,
        timezone: this.timezone
      });
      
      this.tasks.push(task);
      
      logger.info(`Scheduled anchor report for ${time} (${this.timezone})`);
    }
  }

  private setupLongCheckpoints(intervalHours: number): void {
    // Run 5 minutes after token processing to avoid conflicts
    const cronExpression = `5 */${intervalHours} * * *`;
    
    const task = cron.schedule(cronExpression, async () => {
      await this.runLongCheckpoint();
    }, {
      scheduled: true,
      timezone: this.timezone
    });
    
    this.tasks.push(task);
    
    logger.info(`Scheduled long list checkpoints every ${intervalHours} hours (5 minutes after token processing)`);
  }

  private setupHotChecks(intervalMinutes: number): void {
    const cronExpression = `*/${intervalMinutes} * * * *`;
    
    const task = cron.schedule(cronExpression, async () => {
      await this.runHotCheck();
    }, {
      scheduled: true,
      timezone: this.timezone
    });
    
    this.tasks.push(task);
    
    logger.info(`Scheduled hot list checks every ${intervalMinutes} minutes`);
  }

  private setupTokenProcessing(): void {
    // Run every 3 hours
    const cronExpression = `0 */3 * * *`;
    
    const task = cron.schedule(cronExpression, async () => {
      await this.runTokenProcessing();
    }, {
      scheduled: true,
      timezone: this.timezone
    });
    
    this.tasks.push(task);
    
    logger.info(`Scheduled token processing every 3 hours`);
  }

  private async runAnchorReport(): Promise<void> {
    try {
      logger.info('Running anchor report...');
      
      const reportData = await this.longList.generateAnchorReport();
      
      if (reportData.length === 0) {
        logger.info('No coins in long list for anchor report');
        return;
      }

      const timestamp = new Date().toLocaleString('en-US', { 
        timeZone: this.timezone,
        hour12: false 
      });

      // Calculate SOL data from the first coin's performance difference
      // If first coin has +10% and solPerformanceDiff is +5%, then SOL is +5%
      const firstCoin = reportData[0];
      const solChange24h = firstCoin ? firstCoin.change24h - (firstCoin.solPerformanceDiff || 0) : 0;
      
      // We need to fetch SOL price separately - let's do a quick fetch
      const solPair = await this.dexScreener.getPairInfo('solana', 'So11111111111111111111111111111111111111112');
      const solPrice = solPair?.price || 0;
      const solChangeStr = solChange24h >= 0 ? `+${solChange24h.toFixed(1)}` : solChange24h.toFixed(1);
      
      let report = `📊 *Long List Snapshot* (${timestamp})\n`;
      report += `SOL: $${solPrice.toFixed(2)} (${solChangeStr}%)\n\n`;
      report += `\`Ticker   Price (24h Δ%)     │72h High│ Vol  │vs SOL\`\n`;
      report += `\`─────────────────────────────────────────────────────\`\n`;

      for (const coin of reportData) {
        const price = coin.price < 1 ? coin.price.toFixed(6) : coin.price.toFixed(4);
        const change24h = coin.change24h >= 0 ? `+${coin.change24h.toFixed(1)}` : coin.change24h.toFixed(1);
        const priceWithDelta = `${price} (${change24h}%)`;
        
        // Fix the 72h high sign - negative retracement should show as negative
        const retrace = coin.retraceFrom72hHigh >= 0 ? `+${coin.retraceFrom72hHigh.toFixed(1)}` : coin.retraceFrom72hHigh.toFixed(1);
        
        const volume = Formatters.formatVolume(coin.volume24h);
        
        // Format vs SOL performance 
        const solDiff = coin.solPerformanceDiff || 0;
        const solDiffStr = solDiff >= 0 ? `+${solDiff.toFixed(1)}` : solDiff.toFixed(1);
        
        report += `\`${coin.symbol.padEnd(8)} ${priceWithDelta.padEnd(16)} │${retrace.padStart(6)}%│${volume.padStart(5)} │${solDiffStr.padStart(5)}%\`\n`;
      }

      const fingerprint = `anchor_report_${Math.floor(Date.now() / 1000)}`;
      await this.telegram.sendToGroupOrAdmin(
        report,
        'MarkdownV2',
        fingerprint
      );

      logger.info(`Anchor report sent with ${reportData.length} coins`);
    } catch (error) {
      logger.error('Failed to run anchor report:', error);
    }
  }

  private async runLongCheckpoint(): Promise<void> {
    try {
      logger.info('Running long list checkpoint...');
      
      const triggers = await this.longList.checkTriggers();
      
      if (triggers.length === 0) {
        logger.info('No triggers fired in long checkpoint');
        return;
      }

      // Triggers are now automatically sent through the alert bus in longList.checkTriggers()
      // Each individual trigger gets sent as it's detected for immediate user feedback
      logger.info(`Long checkpoint completed with ${triggers.length} triggers`);
    } catch (error) {
      logger.error('Failed to run long checkpoint:', error);
    }
  }

  private async runHotCheck(): Promise<void> {
    try {
      logger.debug('Running hot list check...');
      
      const alerts = await this.hotList.checkAlerts();
      
      if (alerts.length === 0) {
        logger.debug('No hot list alerts');
        return;
      }

      // Alerts are now automatically sent through the alert bus in hotList.checkAlerts()
      // No need to manually send here anymore as the alert bus handles it
      logger.info(`Hot check completed with ${alerts.length} alerts`);
    } catch (error) {
      logger.error('Failed to run hot check:', error);
    }
  }

  private async runTokenProcessing(): Promise<void> {
    try {
      logger.info('Running token processing...');
      
      // Create dedicated DexScreener instance for token processing to avoid conflicts
      const dedicatedDexScreener = new DexScreenerService();
      const processor = new TokenProcessorService(dedicatedDexScreener);
      await processor.runIncrementalProcessing();
      
      logger.info('Token processing completed successfully');
    } catch (error) {
      logger.error('Failed to run token processing:', error);
    }
  }

  private groupTriggersByType(triggers: any[]): Map<string, any[]> {
    const groups = new Map<string, any[]>();
    
    for (const trigger of triggers) {
      const type = trigger.triggerType;
      const existing = groups.get(type) || [];
      existing.push(trigger);
      groups.set(type, existing);
    }
    
    return groups;
  }

  private formatVolume(volume: number): string {
    if (volume >= 1_000_000) {
      return `${(volume / 1_000_000).toFixed(1)}M`;
    }
    if (volume >= 1_000) {
      return `${(volume / 1_000).toFixed(1)}K`;
    }
    return volume.toFixed(0);
  }

  private capitalizeFirst(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  async updateSchedule(): Promise<void> {
    if (!this.isRunning) return;
    
    try {
      this.stop();
      const config = await this.db.getScheduleConfig();
      await this.setupSchedules(config);
      this.isRunning = true;
      logger.info('Schedule updated successfully');
    } catch (error) {
      logger.error('Failed to update schedule:', error);
      throw error;
    }
  }

  stop(): void {
    for (const task of this.tasks) {
      if (task && typeof (task as any).destroy === 'function') {
        (task as any).destroy();
      } else if (task && typeof (task as any).stop === 'function') {
        (task as any).stop();
      }
    }
    this.tasks = [];
    this.isRunning = false;
    logger.info('Scheduler stopped');
  }

  isSchedulerRunning(): boolean {
    return this.isRunning;
  }

  getActiveTasksCount(): number {
    return this.tasks.length;
  }
}