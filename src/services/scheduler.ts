import cron from 'node-cron';
import { DatabaseService } from './database';
import { LongListService } from './longlist';
import { HotListService } from './hotlist';
import { TelegramService } from './telegram';
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
  private tasks: cron.ScheduledTask[] = [];
  private timezone: string;
  private isRunning = false;

  constructor(
    db: DatabaseService,
    longList: LongListService,
    hotList: HotListService,
    telegram: TelegramService,
    timezone: string = 'UTC'
  ) {
    this.db = db;
    this.longList = longList;
    this.hotList = hotList;
    this.telegram = telegram;
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
    this.setupHotChecks(config.hotIntervalMinutes);

    logger.info('Scheduled tasks:', {
      anchorTimes: config.anchorTimesLocal,
      longCheckpointHours: config.longCheckpointHours,
      hotIntervalMinutes: config.hotIntervalMinutes
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
    const cronExpression = `0 */${intervalHours} * * *`;
    
    const task = cron.schedule(cronExpression, async () => {
      await this.runLongCheckpoint();
    }, {
      scheduled: true,
      timezone: this.timezone
    });
    
    this.tasks.push(task);
    
    logger.info(`Scheduled long list checkpoints every ${intervalHours} hours`);
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

      let report = `📊 *Long List Anchor Report* (${timestamp})\n\n`;
      report += `\`Ticker    Price    24h Δ%   From 72h High   24h Vol\`\n`;
      report += `\`────────────────────────────────────────────────────\`\n`;

      for (const coin of reportData) {
        const price = coin.price < 1 ? coin.price.toFixed(6) : coin.price.toFixed(4);
        const change24h = coin.change24h >= 0 ? `+${coin.change24h.toFixed(1)}` : coin.change24h.toFixed(1);
        const retrace = coin.retraceFrom72hHigh.toFixed(1);
        const volume = this.formatVolume(coin.volume24h);
        
        report += `\`${coin.symbol.padEnd(8)} ${price.padStart(8)} ${change24h.padStart(7)}% ${retrace.padStart(6)}% ${volume.padStart(10)}\`\n`;
      }

      const fingerprint = `anchor_report_${Math.floor(Date.now() / 1000)}`;
      await this.telegram.sendMessage(
        process.env.TELEGRAM_CHAT_ID!,
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