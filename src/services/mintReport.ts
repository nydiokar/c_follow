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
      liquidity?: number | null;
      mint: string;
      ts: bigint;
    }> = [];

    for (const r of rows) {
      const key = `solana:${r.mint}`;
      const info = resultMap.get(key);
      if (!info || !info.marketCap) continue;
      const mcap = info.marketCap;
      if (mcap >= minCap && mcap <= maxCap) {
        items.push({
          symbol: info.symbol || r.mint.slice(0, 6),
          mcap,
          price: info.price,
          liquidity: info.liquidity,
          mint: r.mint,
          ts: r.timestamp
        });
      }
    }

    if (items.length === 0) {
      logger.info('Mint report: no tokens within target market cap range');
      return;
    }

    items.sort((a, b) => b.mcap - a.mcap || (Number(b.ts) - Number(a.ts)));

    const tsLocal = new Date().toLocaleString('en-US', { timeZone: timezone, hour12: false });
    let msg = `🆕 Token Mints (last 24h) — ${tsLocal}\n`;
    msg += `Range: $${minCap.toLocaleString()} - $${maxCap.toLocaleString()}\n\n`;

    for (const it of items.slice(0, 50)) {
      const priceStr = it.price < 1 ? it.price.toFixed(6) : it.price.toFixed(4);
      const liqStr = it.liquidity ? `$${Math.round(it.liquidity).toLocaleString()}` : 'n/a';
      msg += `• ${it.symbol} — Mcap $${Math.round(it.mcap).toLocaleString()} | Px ${priceStr} | Lq ${liqStr} | ${it.mint}\n`;
    }

    const fingerprint = `mint24h_${Math.floor(nowMs / 1000)}`;
    await telegram.sendMessage(process.env.TELEGRAM_CHAT_ID!, msg, undefined, fingerprint);
    logger.info(`Mint report sent with ${items.length} tokens (showing up to 50)`);
  } catch (error) {
    logger.error('Mint report failed', { error });
  }
}


