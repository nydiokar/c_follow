import cron from 'node-cron';
import { DatabaseManager } from '../utils/database';
import { DexScreenerService } from './dexscreener';
import { TelegramService } from './telegram';
import { logger } from '../utils/logger';

const DEFAULT_TIME = '09:00';

function parseTimeToCron(time: string): string {
  const [hourStr, minStr] = time.split(':');
  const hour = Math.max(0, Math.min(23, parseInt(hourStr || '9', 10)));
  const minute = Math.max(0, Math.min(59, parseInt(minStr || '0', 10)));
  return `${minute} ${hour} * * *`;
}

export function scheduleMintReport(
  dexScreener: DexScreenerService,
  telegram: TelegramService,
  timezone: string
): void {
  const time = process.env.MINT_REPORT_TIME || DEFAULT_TIME;
  const cronExpr = parseTimeToCron(time);
  logger.info(`Scheduling Mint 24H report at ${time} (${timezone})`);

  cron.schedule(cronExpr, async () => {
    await runMintReport(dexScreener, telegram, timezone);
  }, { scheduled: true, timezone });
}

export async function runMintReport(
  dexScreener: DexScreenerService,
  telegram: TelegramService,
  timezone: string
): Promise<void> {
  const prisma = DatabaseManager.getInstance();
  const nowMs = Date.now();
  const cutoffMs = nowMs - 24 * 60 * 60 * 1000;

  try {
    const rows = await prisma.mintEvent.findMany({
      where: {
        isFirst: true,
        timestamp: { gte: BigInt(cutoffMs) }
      },
      select: { mint: true, timestamp: true }
    });

    if (rows.length === 0) {
      logger.info('Mint report: no first-mint events in the last 24h');
      const tsLocal = new Date().toLocaleString('en-US', { timeZone: timezone, hour12: false });
      const msg = `🆕 Token Mints (last 24h) — ${tsLocal}\n\n📭 No new token mints detected in the last 24 hours.`;
      const fingerprint = `mint24h_empty_${Math.floor(nowMs / 1000)}`;
      await telegram.sendToGroupOrAdmin(msg, undefined, fingerprint);
      return;
    }

    const requests = rows.map((r) => ({ chainId: 'solana', tokenAddress: r.mint }));
    const resultMap = await dexScreener.batchGetTokens(requests);

    const minCap = parseFloat(process.env.MINT_CAP_MIN || '200000');
    const maxCap = parseFloat(process.env.MINT_CAP_MAX || '1500000');

    const items: Array<{
      symbol: string;
      mcap: number;
      price: number;
      liquidity: number;
      priceChange1h: number;
      priceChange24h: number;
      socials?: { platform: string; handle: string }[];
      mint: string;
      ts: bigint;
    }> = [];

    for (const r of rows) {
      const key = `solana:${r.mint}`;
      const info = resultMap.get(key);
      if (!info || !info.marketCap || !info.liquidity || info.liquidity <= 0) continue;
      const mcap = info.marketCap;
      if (mcap >= minCap && mcap <= maxCap) {
        const item: {
          symbol: string;
          mcap: number;
          price: number;
          liquidity: number;
          priceChange1h: number;
          priceChange24h: number;
          socials?: { platform: string; handle: string }[];
          mint: string;
          ts: bigint;
        } = {
          symbol: info.symbol || r.mint.slice(0, 6),
          mcap,
          price: info.price,
          liquidity: info.liquidity,
          priceChange1h: info.priceChange1h,
          priceChange24h: info.priceChange24h,
          mint: r.mint,
          ts: r.timestamp
        };
        
        if (info.info?.socials) {
          item.socials = info.info.socials;
        }
        
        items.push(item);
      }
    }

    if (items.length === 0) {
      logger.info('Mint report: no tokens within target market cap range');
      const tsLocal = new Date().toLocaleString('en-US', { timeZone: timezone, hour12: false });
      const msg = `🆕 Token Mints (last 24h) — ${tsLocal}\n\n📊 ${rows.length} new tokens detected, but none within target range $${minCap.toLocaleString()} - $${maxCap.toLocaleString()} with sufficient liquidity.`;
      const fingerprint = `mint24h_norange_${Math.floor(nowMs / 1000)}`;
      await telegram.sendToGroupOrAdmin(msg, undefined, fingerprint);
      return;
    }

    items.sort((a, b) => b.mcap - a.mcap || (Number(b.ts) - Number(a.ts)));

    const tsLocal = new Date().toLocaleString('en-US', { timeZone: timezone, hour12: false });
    let msg = `🆕 Token Mints (last 24h) — ${tsLocal}\n`;
    msg += `📊 ${rows.length} total mints → ${items.length} within range $${minCap.toLocaleString()} - $${maxCap.toLocaleString()}\n\n`;

    for (let i = 0; i < Math.min(items.length, 50); i++) {
      const it = items[i]!;
      const priceStr = it.price < 1 ? it.price.toFixed(6) : it.price.toFixed(4);
      const liqStr = `$${Math.round(it.liquidity).toLocaleString()}`;
      
      // Format price changes with + for positive values
      const change1h = it.priceChange1h >= 0 ? `+${it.priceChange1h.toFixed(1)}%` : `${it.priceChange1h.toFixed(1)}%`;
      const change24h = it.priceChange24h >= 0 ? `+${it.priceChange24h.toFixed(1)}%` : `${it.priceChange24h.toFixed(1)}%`;
      
      // Format socials
      let socialsStr = '';
      if (it.socials && it.socials.length > 0) {
        const twitterSocial = it.socials.find(s => s.platform.toLowerCase() === 'twitter');
        const telegramSocial = it.socials.find(s => s.platform.toLowerCase() === 'telegram');
        
        if (twitterSocial) socialsStr += ` | 🐦 @${twitterSocial.handle}`;
        if (telegramSocial) socialsStr += ` | 📢 @${telegramSocial.handle}`;
      }
      
      msg += `${i + 1}. ${it.symbol} — Mcap $${Math.round(it.mcap).toLocaleString()} | Px ${priceStr} | 1h ${change1h} | 24h ${change24h} | Lq ${liqStr}${socialsStr}\n`;
      msg += `   ${it.mint}\n\n`;
    }

    const fingerprint = `mint24h_${Math.floor(nowMs / 1000)}`;
    // Use the same routing logic as sendTriggerAlert and sendHotAlert
    await telegram.sendToGroupOrAdmin(msg, undefined, fingerprint);
    logger.info(`Mint report sent with ${items.length} tokens (showing up to 50)`);
  } catch (error) {
    logger.error('Mint report failed', { error });
  }
}


