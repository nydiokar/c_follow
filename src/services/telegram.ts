import { Telegraf, Context } from 'telegraf';
import { Update, Message } from 'telegraf/typings/core/types/typegram';
import { DatabaseService } from './database';
import { LongListService } from './longlist';
import { HotListService } from './hotlist';
import { DexScreenerService } from './dexscreener';
import { MessageSender, OutboxMessage } from '../types/telegram';
import { logger } from '../utils/logger';
import { PrismaClient } from '@prisma/client';

export class TelegramService implements MessageSender {
  private bot: Telegraf<Context<Update>>;
  private db: DatabaseService;
  private longList: LongListService;
  private hotList: HotListService;
  private dexScreener: DexScreenerService;
  private prisma: PrismaClient;
  private chatId: string;

  constructor(
    token: string, 
    chatId: string,
    db: DatabaseService,
    longList: LongListService,
    hotList: HotListService,
    dexScreener: DexScreenerService
  ) {
    this.bot = new Telegraf(token);
    this.chatId = chatId;
    this.db = db;
    this.longList = longList;
    this.hotList = hotList;
    this.dexScreener = dexScreener;
    this.prisma = new PrismaClient();

    this.setupCommands();
    this.registerEventHandlers();
  }

  private setupCommands(): void {
    // Remove the old regex-based command system - it's interfering with bot.command
    // All commands are now handled by bot.command handlers below
    
    console.log('Setting up bot commands...');
    
    this.bot.command('start', this.handleStartCommand.bind(this));
    this.bot.command('help', this.handleHelpCommand.bind(this));
    this.bot.command('long_add', this.handleLongAddCommand.bind(this));
    this.bot.command('long_rm', this.handleLongRemoveCommand.bind(this));
    this.bot.command('long_trigger', this.handleLongTriggerCommand.bind(this));
    this.bot.command('long_set', this.handleLongSetCommand.bind(this));
    this.bot.command('report_now', this.handleReportNowCommand.bind(this));
    this.bot.command('hot_add', this.handleHotAddCommand.bind(this));
    this.bot.command('hot_rm', this.handleHotRemoveCommand.bind(this));
    this.bot.command('hot_list', this.handleHotListCommand.bind(this));
    this.bot.command('alerts', this.handleAlertsCommand.bind(this));
    
    console.log('Bot commands registered successfully');
  }

  private registerEventHandlers(): void {
    this.bot.catch((error: unknown) => {
      logger.error('Telegram bot error:', error);
    });
  }

  private async handleStartCommand(ctx: Context<Update>): Promise<void> {
    await this.handleStart(ctx.message as Message);
  }

  private async handleHelpCommand(ctx: Context<Update>): Promise<void> {
    await this.handleHelp(ctx.message as Message);
  }

  private async handleLongAddCommand(ctx: Context<Update>): Promise<void> {
    const text = (ctx.message as any)?.text || '';
    const match = text.match(/^\/long_add\s*(.*)/);
    await this.handleLongAdd(ctx.message as Message, match);
  }

  private async handleLongRemoveCommand(ctx: Context<Update>): Promise<void> {
    const text = (ctx.message as any)?.text || '';
    const match = text.match(/^\/long_rm\s*(.*)/);
    await this.handleLongRemove(ctx.message as Message, match);
  }

  private async handleLongTriggerCommand(ctx: Context<Update>): Promise<void> {
    const text = (ctx.message as any)?.text || '';
    const match = text.match(/^\/long_trigger\s*(.*)/);
    await this.handleLongTrigger(ctx.message as Message, match);
  }

  private async handleLongSetCommand(ctx: Context<Update>): Promise<void> {
    const text = (ctx.message as any)?.text || '';
    const match = text.match(/^\/long_set\s*(.*)/);
    await this.handleLongSet(ctx.message as Message, match);
  }

  private async handleReportNowCommand(ctx: Context<Update>): Promise<void> {
    await this.handleReportNow(ctx.message as Message);
  }

  private async handleHotAddCommand(ctx: Context<Update>): Promise<void> {
    const text = (ctx.message as any)?.text || '';
    const match = text.match(/^\/hot_add\s*(.*)/);
    await this.handleHotAdd(ctx.message as Message, match);
  }

  private async handleHotRemoveCommand(ctx: Context<Update>): Promise<void> {
    const text = (ctx.message as any)?.text || '';
    const match = text.match(/^\/hot_rm\s*(.*)/);
    await this.handleHotRemove(ctx.message as Message, match);
  }

  private async handleHotListCommand(ctx: Context<Update>): Promise<void> {
    await this.handleHotList(ctx.message as Message);
  }

  private async handleAlertsCommand(ctx: Context<Update>): Promise<void> {
    await this.handleAlerts(ctx.message as Message);
  }

  private async handleStart(msg: Message): Promise<void> {
    const welcomeText = `
🚀 *Follow Coin Bot Started*

This bot helps you track cryptocurrency price movements with:

📊 *Long List* - Persistent monitoring with triggers
• Retracement alerts (price drops from highs)
• Momentum stall detection
• Breakout notifications
• Market cap thresholds

🔥 *Hot List* - Quick alerts for specific targets
• Percentage change alerts
• Market cap milestones  
• 60% drawdown failsafe

Use /help to see all available commands.
`;

    await this.sendMessage(msg.chat.id.toString(), welcomeText, 'MarkdownV2');
  }

  private async handleHelp(msg: Message): Promise<void> {
    const helpText = `
🤖 *Follow Coin Bot Commands*

📊 *Long List (Persistent Monitoring)*
• \`/long_add SYMBOL\` - Add coin to long list
• \`/long_rm SYMBOL\` - Remove coin from long list  
• \`/long_trigger [type] [on|off]\` - Toggle triggers
• \`/long_set SYMBOL retrace=15\` - Set custom thresholds
• \`/report_now\` - Generate immediate anchor report

🔥 *Hot List (Quick Alerts)*
• \`/hot_add CONTRACT_ADDRESS ±% mcap=VALUE\` - Add with triggers
• \`/hot_rm CONTRACT_ADDRESS\` - Remove from hot list
• \`/hot_list\` - Show all hot list entries
• \`/alerts\` - Show recent alerts

📈 *Trigger Examples*
• \`/hot_add 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU -15%\` - Alert when price drops 15%
• \`/hot_add 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU +20%\` - Alert when price rises 20%
• \`/hot_add 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU mcap=500K\` - Alert at 500K market cap
• \`/hot_add 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU -10% mcap=1M\` - Both triggers

💡 *Note:* 
• Hot list requires at least one trigger (pct or mcap)
• Use contract/mint addresses, not symbols
• Supports Solana addresses (32-44 characters)
`;

    await this.sendMessage(msg.chat.id.toString(), helpText, 'MarkdownV2');
  }

  private async handleLongAdd(msg: Message, match: RegExpMatchArray | null): Promise<void> {
    const args = match?.[1]?.trim().split(/\s+/) || [];
    const symbol = args[0];

    if (!symbol) {
      await this.sendMessage(msg.chat.id.toString(), 'Usage: /long_add SYMBOL');
      return;
    }

    try {
      await this.longList.addCoin(symbol.toUpperCase());
      await this.sendMessage(
        msg.chat.id.toString(), 
        `✅ Added ${symbol.toUpperCase()} to long list`
      );
    } catch (error) {
      await this.sendMessage(
        msg.chat.id.toString(), 
        `❌ Failed to add ${symbol}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleLongRemove(msg: Message, match: RegExpMatchArray | null): Promise<void> {
    const args = match?.[1]?.trim().split(/\s+/) || [];
    const symbol = args[0];

    if (!symbol) {
      await this.sendMessage(msg.chat.id.toString(), 'Usage: /long_rm SYMBOL');
      return;
    }

    try {
      const removed = await this.longList.removeCoin(symbol.toUpperCase());
      if (removed) {
        await this.sendMessage(
          msg.chat.id.toString(), 
          `✅ Removed ${symbol.toUpperCase()} from long list`
        );
      } else {
        await this.sendMessage(
          msg.chat.id.toString(), 
          `❌ ${symbol.toUpperCase()} not found in long list`
        );
      }
    } catch (error) {
      await this.sendMessage(
        msg.chat.id.toString(), 
        `❌ Failed to remove ${symbol}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleLongTrigger(msg: Message, match: RegExpMatchArray | null): Promise<void> {
    const args = match?.[1]?.trim().split(/\s+/) || [];
    const trigger = args[0];
    const state = args[1];

    if (!trigger || !state || !['retrace', 'stall', 'breakout', 'mcap'].includes(trigger) || !['on', 'off'].includes(state)) {
      await this.sendMessage(
        msg.chat.id.toString(), 
        'Usage: /long_trigger [retrace|stall|breakout|mcap] [on|off]'
      );
      return;
    }

    const enabled = state === 'on';
    
    await this.sendMessage(
      msg.chat.id.toString(), 
      `Global ${trigger} triggers ${enabled ? 'enabled' : 'disabled'}. Use /long_set for per-coin settings.`
    );
  }

  private async handleLongSet(msg: Message, match: RegExpMatchArray | null): Promise<void> {
    const args = match?.[1]?.trim().split(/\s+/) || [];
    const symbol = args[0];
    const settings = args.slice(1);

    if (!symbol || settings.length === 0) {
      await this.sendMessage(
        msg.chat.id.toString(), 
        'Usage: /long_set SYMBOL retrace=15 breakout=12 mcap=300000,1000000'
      );
      return;
    }

    try {
      const updateData: any = {};
      
      for (const setting of settings) {
        const [key, value] = setting.split('=');
        if (!key || !value) continue;

        switch (key) {
          case 'retrace':
            updateData.retracePct = parseFloat(value);
            break;
          case 'breakout':
            updateData.breakoutPct = parseFloat(value);
            break;
          case 'stall_vol':
            updateData.stallVolPct = parseFloat(value);
            break;
          case 'mcap':
            updateData.mcapLevels = value.split(',').map(v => parseFloat(v)).filter(v => !isNaN(v));
            break;
        }
      }

      const updated = await this.longList.updateTriggerSettings(symbol.toUpperCase(), updateData);
      
      if (updated) {
        await this.sendMessage(
          msg.chat.id.toString(), 
          `✅ Updated settings for ${symbol.toUpperCase()}`
        );
      } else {
        await this.sendMessage(
          msg.chat.id.toString(), 
          `❌ ${symbol.toUpperCase()} not found in long list`
        );
      }
    } catch (error) {
      await this.sendMessage(
        msg.chat.id.toString(), 
        `❌ Failed to update settings: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleReportNow(msg: Message): Promise<void> {
    try {
      const reportData = await this.longList.generateAnchorReport();
      
      if (reportData.length === 0) {
        await this.sendMessage(msg.chat.id.toString(), 'No coins in long list');
        return;
      }

      const timestamp = new Date().toLocaleString('en-US', { 
        timeZone: process.env.TIMEZONE || 'UTC',
        hour12: false 
      });

      let report = `📊 *Long List Snapshot* (${timestamp})\n\n`;
      report += `\`Ticker    Price    24h Δ%   From 72h High   24h Vol\`\n`;
      report += `\`────────────────────────────────────────────────────\`\n`;

      for (const coin of reportData) {
        const price = coin.price < 1 ? coin.price.toFixed(6) : coin.price.toFixed(4);
        const change24h = coin.change24h >= 0 ? `+${coin.change24h.toFixed(1)}` : coin.change24h.toFixed(1);
        const retrace = coin.retraceFrom72hHigh.toFixed(1);
        const volume = this.formatVolume(coin.volume24h);
        
        report += `\`${coin.symbol.padEnd(8)} ${price.padStart(8)} ${change24h.padStart(7)}% ${retrace.padStart(6)}% ${volume.padStart(10)}\`\n`;
      }

      await this.sendMessage(msg.chat.id.toString(), report, 'MarkdownV2');
    } catch (error) {
      await this.sendMessage(
        msg.chat.id.toString(), 
        `❌ Failed to generate report: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleHotAdd(msg: Message, match: RegExpMatchArray | null): Promise<void> {
    const args = match?.[1]?.trim().split(/\s+/) || [];
    const contractAddress = args[0];
    const params = args.slice(1);

    if (!contractAddress) {
      await this.sendMessage(
        msg.chat.id.toString(), 
        '❌ *Usage:* `/hot_add CONTRACT_ADDRESS [±%] [mcap=VALUE]`\n\n' +
        '*Examples:*\n' +
        '• `/hot_add 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU -15%`\n' +
        '• `/hot_add 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU +20%`\n' +
        '• `/hot_add 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU -10% mcap=1M`\n\n' +
        '*Note:* You must specify at least one trigger (±% or mcap)'
      );
      return;
    }

    // Validate contract address format (basic check for Solana addresses)
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(contractAddress)) {
      await this.sendMessage(
        msg.chat.id.toString(), 
        '❌ *Invalid contract address format*\n\n' +
        'Please provide a valid Solana mint/contract address.\n' +
        'Example: `7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU`'
      );
      return;
    }

    // Validate that at least one trigger criteria is provided
    if (params.length === 0) {
      await this.sendMessage(
        msg.chat.id.toString(), 
        '❌ *Error:* You must specify at least one trigger criteria!\n\n' +
        '*Valid formats:*\n' +
        '• `-15%` (15% price drop)\n' +
        '• `+20%` (20% price rise)\n' +
        '• `mcap=1M` (1 million market cap)\n' +
        '• `mcap=500K` (500K market cap)\n\n' +
        '*Example:* `/hot_add ' + contractAddress + ' -15%`'
      );
      return;
    }

    try {
      // Parse trigger parameters
      const options: any = {};
      let hasValidTrigger = false;
      
      for (const param of params) {
        // Check if it's a percentage trigger (e.g., -15%, +20%)
        if (param.includes('%')) {
          const percentageMatch = param.match(/^([+-]?\d+(?:\.\d+)?)%$/);
          if (percentageMatch && percentageMatch[1]) {
            const pctValue = parseFloat(percentageMatch[1]);
            if (!isNaN(pctValue)) {
              options.pctTarget = pctValue;
              hasValidTrigger = true;
              continue;
            }
          }
          
          // Invalid percentage format
          await this.sendMessage(
            msg.chat.id.toString(), 
            `❌ *Invalid percentage format:* \`${param}\`\n` +
            'Use format: `-15%` or `+20%`'
          );
          return;
        }
        
        // Check if it's a market cap parameter
        if (param.startsWith('mcap=')) {
          const [key, value] = param.split('=');
          if (!key || !value) {
            await this.sendMessage(
              msg.chat.id.toString(), 
              `❌ *Invalid parameter format:* \`${param}\`\n` +
              'Use format: `mcap=1M` or `mcap=500K`'
            );
            return;
          }

          // Parse market cap with support for K, M, B suffixes
          const mcapStr = value.toUpperCase();
          let mcapValue: number;
          
          if (mcapStr.endsWith('K')) {
            mcapValue = parseFloat(mcapStr.slice(0, -1)) * 1000;
          } else if (mcapStr.endsWith('M')) {
            mcapValue = parseFloat(mcapStr.slice(0, -1)) * 1000000;
          } else if (mcapStr.endsWith('B')) {
            mcapValue = parseFloat(mcapStr.slice(0, -1)) * 1000000000;
          } else {
            mcapValue = parseFloat(mcapStr);
          }
          
          if (isNaN(mcapValue) || mcapValue <= 0) {
            await this.sendMessage(
              msg.chat.id.toString(), 
              `❌ *Invalid market cap:* \`${value}\`\n` +
              'Use format: `mcap=1M`, `mcap=500K`, or `mcap=1000000`'
            );
            return;
          }
          
          options.mcapTargets = [mcapValue];
          hasValidTrigger = true;
        } else {
          // Unknown parameter
          await this.sendMessage(
            msg.chat.id.toString(), 
            `❌ *Unknown parameter:* \`${param}\`\n` +
            'Valid parameters: percentage (e.g., `-15%`) or `mcap=VALUE`'
          );
          return;
        }
      }

      if (!hasValidTrigger) {
        await this.sendMessage(
          msg.chat.id.toString(), 
          '❌ *Error:* No valid trigger criteria provided!\n\n' +
          'You must specify at least one of:\n' +
          '• `-15%` (percentage change)\n' +
          '• `mcap=1M` (market cap target)'
        );
        return;
      }

      // Fetch token data from DexScreener
      const pairs = await this.dexScreener.searchPairs(contractAddress);
      
      if (!pairs || pairs.length === 0) {
        await this.sendMessage(msg.chat.id.toString(), `❌ *Token not found*\n\nNo trading pairs found for contract: \`${contractAddress}\``, 'MarkdownV2');
        return;
      }

      const pair = pairs[0];
      if (!pair) {
        await this.sendMessage(msg.chat.id.toString(), `❌ *Error*\n\nFailed to get token data for contract: \`${contractAddress}\``, 'MarkdownV2');
        return;
      }

      // Add to hot list
      await this.hotList.addEntry(contractAddress, pair, options);

      // Show confirmation with actual token data
      let message = `✅ *Token Added to Hot List*\n\n`;
      message += `*Token Info:*\n`;
      message += `🔗 Contract: \`${contractAddress}\`\n`;
      message += `📛 Symbol: ${pair.symbol}\n`;
      message += `📝 Name: ${pair.name}\n`;
      const website = pair.info?.websites?.find((w: { url: string }) => w.url)?.url;
      if (website) {
        message += `🌐 Website: [${website.replace(/^(https?:\/\/)?(www\.)?/, '')}](${website})\n`;
      }
      message += `💰 Price: $${pair.price.toFixed(6)}\n`;
      message += `📊 Market Cap: ${this.formatMarketCap(pair.marketCap || 0)}\n\n`;

      message += `*Triggers Set:*\n`;
      
      if (options.pctTarget) {
        const direction = options.pctTarget > 0 ? '📈' : '📉';
        const currentPrice = pair.price;
        const targetPrice = currentPrice * (1 + options.pctTarget / 100);
        message += `${direction} *Price:* ${options.pctTarget > 0 ? '+' : ''}${options.pctTarget}%\n`;
        message += `   Target: $${targetPrice.toFixed(6)} (from $${currentPrice.toFixed(6)})\n`;
      }
      
      if (options.mcapTargets) {
        message += `💰 *Market Cap:* ${this.formatMarketCap(options.mcapTargets[0])}\n`;
      }
      
      message += `\n*Note:* 60% drawdown failsafe is always active`;
      
      console.log('About to send message to chat:', msg.chat.id);
      console.log('Message content:', message.substring(0, 200) + '...');
      
      try {
        await this.sendMessage(msg.chat.id.toString(), message, 'MarkdownV2');
        console.log('Message sent successfully!');
      } catch (sendError) {
        console.error('Failed to send message:', sendError);
        logger.error('Failed to send confirmation message:', sendError);
        // Try to send a simple error message
        try {
          await this.bot.telegram.sendMessage(msg.chat.id.toString(), '✅ Token added successfully but failed to send details. Check /hot_list to confirm.');
          console.log('Fallback message sent successfully!');
        } catch (fallbackError) {
          console.error('Even fallback message failed:', fallbackError);
        }
      }
      
    } catch (error) {
      logger.error('Error adding token to hot list:', error);
      await this.sendMessage(
        msg.chat.id.toString(), 
        `❌ *Failed to add token:* ${error instanceof Error ? error.message : 'Unknown error'}\n\n` +
        'This might be due to:\n' +
        '• Invalid contract address\n' +
        '• Token not found on supported chains\n' +
        '• Network issues'
      );
    }
  }

  private async handleHotRemove(msg: Message, match: RegExpMatchArray | null): Promise<void> {
    const args = match?.[1]?.trim().split(/\s+/) || [];
    const contractAddress = args[0];

    if (!contractAddress) {
      await this.sendMessage(
        msg.chat.id.toString(), 
        'Usage: /hot_rm CONTRACT_ADDRESS\n\n' +
        'Example: `/hot_rm 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU`'
      );
      return;
    }

    try {
      const removed = await this.hotList.removeEntry(contractAddress);
      if (removed) {
        await this.sendMessage(
          msg.chat.id.toString(), 
          `✅ Removed token with contract \`${contractAddress}\` from hot list`
        );
      } else {
        await this.sendMessage(
          msg.chat.id.toString(), 
          `❌ Token with contract \`${contractAddress}\` not found in hot list`
        );
      }
    } catch (error) {
      await this.sendMessage(
        msg.chat.id.toString(), 
        `❌ Failed to remove token: ${error instanceof Error ? error.message : 'Unknown error'}`
      );  
    }
  }

  private async handleHotList(msg: Message): Promise<void> {
    try {
      const entries = await this.hotList.listEntries();
      
      if (entries.length === 0) {
        await this.sendMessage(msg.chat.id.toString(), 'No coins in hot list');
        return;
      }

      let message = `🔥 *Hot List Entries*\n\n`;
      
      for (const entry of entries) {
        const addedDate = new Date(entry.addedAtUtc * 1000).toLocaleDateString();
        message += `*${entry.symbol}*\n`;
        message += `Anchor: $${entry.anchorPrice.toFixed(6)} (${addedDate})\n`;
        
        if (entry.pctTarget) {
          const status = entry.activeTriggers.find(t => t.kind === 'pct')?.fired ? '✅' : '⏳';
          message += `${status} Target: ${entry.pctTarget > 0 ? '+' : ''}${entry.pctTarget}%\n`;
        }
        
        if (entry.mcapTargets && entry.mcapTargets.length > 0) {
          for (const target of entry.mcapTargets) {
            const status = entry.activeTriggers.find(t => t.kind === 'mcap' && t.value === target)?.fired ? '✅' : '⏳';
            message += `${status} MCAP: ${this.formatMarketCap(target)}\n`;
          }
        }
        
        message += `${entry.failsafeFired ? '🚨' : '🛡️'} Failsafe: ${entry.failsafeFired ? 'FIRED' : 'Active'}\n\n`;
      }

      await this.sendMessage(msg.chat.id.toString(), message, 'MarkdownV2');
    } catch (error) {
      await this.sendMessage(
        msg.chat.id.toString(), 
        `❌ Failed to show hot list: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleAlerts(msg: Message): Promise<void> {
    try {
      const alerts = await this.hotList.getAlertHistory(20);
      
      if (alerts.length === 0) {
        await this.sendMessage(msg.chat.id.toString(), 'No recent alerts');
        return;
      }

      let message = `🔔 *Recent Hot List Alerts*\n\n`;
      
      for (const alert of alerts) {
        const timestamp = new Date(alert.timestamp * 1000).toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        });
        
        message += `${timestamp} | ${alert.message}\n`;
      }

      await this.sendMessage(msg.chat.id.toString(), message, 'MarkdownV2');
    } catch (error) {
      await this.sendMessage(
        msg.chat.id.toString(), 
        `❌ Failed to show alerts: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async sendMessage(chatId: string, text: string, parseMode?: 'MarkdownV2' | 'HTML', fingerprint?: string): Promise<boolean> {
    try {
      if (fingerprint) {
        const existing = await this.prisma.outbox.findUnique({
          where: { fingerprint }
        });
        
        if (existing?.sentOk) {
          logger.debug(`Message already sent: ${fingerprint}`);
          return true;
        }
      }

      const options: any = {};
      if (parseMode) options.parse_mode = parseMode;

      await this.bot.telegram.sendMessage(chatId, text, options);
      
      if (fingerprint) {
        await this.prisma.outbox.upsert({
          where: { fingerprint },
          update: {
            sentOk: true,
            sentTsUtc: Math.floor(Date.now() / 1000)
          },
          create: {
            tsUtc: Math.floor(Date.now() / 1000),
            chatId,
            messageText: text,
            fingerprint,
            sentOk: true,
            sentTsUtc: Math.floor(Date.now() / 1000)
          }
        });
      }

      return true;
    } catch (error) {
      logger.error('Failed to send message:', error);
      
      if (fingerprint) {
        await this.prisma.outbox.upsert({
          where: { fingerprint },
          update: { sentOk: false },
          create: {
            tsUtc: Math.floor(Date.now() / 1000),
            chatId,
            messageText: text,
            fingerprint,
            sentOk: false
          }
        });
      }
      
      return false;
    }
  }

  async sendBulkMessages(messages: OutboxMessage[]): Promise<number> {
    let sent = 0;
    
    for (const message of messages) {
      const success = await this.sendMessage(message.chatId, message.text, undefined, message.fingerprint);
      if (success) sent++;
      
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    return sent;
  }

  async sendTriggerAlert(trigger: any): Promise<void> {
    const fingerprint = `trigger_${trigger.coinId}_${trigger.triggerType}_${trigger.timestamp || Date.now()}`;
    
    let message = `🚨 *LONG TRIGGER*\n\n`;
    message += `${trigger.message}\n`;
    message += `Price: $${trigger.price.toFixed(6)}\n`;
    message += `24h Change: ${trigger.priceChange24h >= 0 ? '+' : ''}${trigger.priceChange24h.toFixed(1)}%\n`;
    message += `Volume: ${this.formatVolume(trigger.volume24h)}`;
    
    if (trigger.marketCap) {
      message += `\nMarket Cap: ${this.formatMarketCap(trigger.marketCap)}`;
    }

    await this.sendMessage(this.chatId, message, 'MarkdownV2', fingerprint);
  }

  async sendHotAlert(alert: any): Promise<void> {
    const fingerprint = `hot_${alert.hotId}_${alert.alertType}_${alert.timestamp}`;
    
    let message = `🔥 *HOT ALERT*\n\n`;
    message += `${alert.message}\n`;
    message += `Price: $${alert.currentPrice.toFixed(6)}\n`;
    message += `Change: ${alert.deltaFromAnchor >= 0 ? '+' : ''}${alert.deltaFromAnchor.toFixed(1)}%`;
    
    if (alert.currentMcap) {
      message += `\nMarket Cap: ${this.formatMarketCap(alert.currentMcap)}`;
    }

    await this.sendMessage(this.chatId, message, 'MarkdownV2', fingerprint);
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

  private formatMarketCap(value: number): string {
    if (value >= 1_000_000_000) {
      return `$${(value / 1_000_000_000).toFixed(1)}B`;
    }
    if (value >= 1_000_000) {
      return `$${(value / 1_000_000).toFixed(1)}M`;
    }
    if (value >= 1_000) {
      return `$${(value / 1_000).toFixed(1)}K`;
    }
    return `$${value.toFixed(0)}`;
  }

  async stop(): Promise<void> {
    this.bot.stop();
    await this.prisma.$disconnect();
    logger.info('Telegram bot stopped');
  }

  async start(): Promise<void> {
    try {
      console.log('=== TELEGRAM BOT START ===');
      console.log('Launching Telegram bot...');
      console.log('Bot instance:', this.bot ? 'Created' : 'NULL');
      console.log('Chat ID:', this.chatId);
      
      console.log('About to call bot.launch()...');
      
      // Add timeout to prevent hanging
      const launchPromise = this.bot.launch();
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('bot.launch() timed out after 10 seconds')), 10000)
      );
      
      await Promise.race([launchPromise, timeoutPromise]);
      console.log('✅ bot.launch() completed successfully');
      
      console.log('Telegram bot launched successfully and listening for messages');
      logger.info('Telegram bot launched successfully');
      
      // Test message to verify bot can send messages
      console.log('Sending test message to chat:', this.chatId);
      try {
        const result = await this.bot.telegram.sendMessage(this.chatId, '🚀 Bot started successfully!');
        console.log('✅ Test message sent successfully - bot is working!');
        console.log('Message result:', result);
      } catch (testError) {
        console.error('❌ Test message failed - bot cannot send messages:', testError);
        console.error('Test error details:', JSON.stringify(testError, null, 2));
      }
      
      console.log('=== TELEGRAM BOT START COMPLETE ===');
      
    } catch (error) {
      console.error('❌ Failed to launch Telegram bot:', error);
      console.error('Launch error details:', JSON.stringify(error, null, 2));
      logger.error('Failed to launch Telegram bot:', error);
      throw error;
    }
  }
}