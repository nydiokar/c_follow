import cron from 'node-cron';
import { DatabaseManager } from '../utils/database';
import { DexScreenerService } from './dexscreener';
import { TelegramService } from './telegram';
import { TokenProcessorService } from './tokenProcessor';
import { TokenClassifier } from '../utils/tokenClassifier';
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

async function processTokenChunk(
  chunk: Array<{ chainId: string; tokenAddress: string; row: any }>,
  chunkResultMap: Map<string, any>,
  items: Array<any>,
  minCap: number,
  maxCap: number,
  counters: {
    noData: number;
    noMcap: number;
    noLiquidity: number;
    tooLow: number;
    tooHigh: number;
    newScamTokens: string[];
    noDataTokens: string[];
    deadTokens: string[];
    cleanTokens: string[];
    allLegitimateMarketCaps: number[];
  }
): Promise<void> {
  for (const { tokenAddress, row } of chunk) {
    const key = `solana:${tokenAddress}`;
    const info = chunkResultMap.get(key);
    
    // Use shared classification logic for unprocessed tokens
    if (row.scamStatus === null) {
      const classification = TokenClassifier.classifyToken(info);
      
      switch (classification.classification) {
        case 'no_data':
          counters.noData++;
          counters.noDataTokens.push(row.mint);
          continue;
        case 'scam':
          counters.newScamTokens.push(row.mint);
          continue;
        case 'dead':
          if (classification.reason === 'No market cap') counters.noMcap++;
          else if (classification.reason === 'No liquidity') counters.noLiquidity++;
          counters.deadTokens.push(row.mint);
          continue;
        case 'clean':
          counters.cleanTokens.push(row.mint);
          break;
      }
    } else {
      // For already processed clean tokens, still need to check if API data exists
      if (!info) {
        counters.noData++;
        continue;
      }
      if (!info.marketCap) {
        counters.noMcap++;
        continue;
      }
      if (!info.liquidity || info.liquidity <= 0) {
        counters.noLiquidity++;
        continue;
      }
    }

    // At this point, info must exist and have valid data
    if (!info || !info.marketCap || !info.liquidity) {
      continue; // Should not happen after classification, but safety check
    }
    
    const mcap = info.marketCap;
    const liquidity = info.liquidity;
    const volume24h = info.volume24h || 0;
    
    // This token is legitimate (not scam, has data) - collect its market cap for overview stats
    counters.allLegitimateMarketCaps.push(mcap);
    
    // Apply filters: market cap range, liquidity > $12k, volume > $100k
    if (mcap < minCap) {
      counters.tooLow++;
      continue;
    }
    if (mcap > maxCap) {
      counters.tooHigh++;
      continue;
    }
    if (liquidity <= 12000 || volume24h <= 100000) {
      // Additional filter: liquidity and volume requirements
      continue;
    }
    
    // Passed all filters - add to items
    const item: any = {
      symbol: info.symbol || row.mint.slice(0, 6),
      mcap,
      price: info.price,
      liquidity: info.liquidity,
      priceChange1h: info.priceChange1h,
      priceChange24h: info.priceChange24h,
      mint: row.mint,
      ts: row.timestamp
    };
    
    if (info.info?.socials) {
      item.socials = info.info.socials;
    }
    
    items.push(item);
  }
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
    // Get all tokens EXCEPT those already marked as scam
    const rows = await prisma.mintEvent.findMany({
      where: {
        isFirst: true,
        timestamp: { gte: BigInt(cutoffMs) },
        OR: [
          { scamStatus: null },      // Unprocessed tokens
          { scamStatus: 'clean' }    // Previously marked clean tokens  
        ]
        // This excludes: 'scam' and 'no_data' tokens
      },
      select: { mint: true, timestamp: true, processedAt: true, scamStatus: true }
    });

    // Debug: log what we actually fetched
    const statusCounts = rows.reduce((acc, r) => {
      const status = r.scamStatus || 'null';
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    logger.info(`Mint report query fetched: ${JSON.stringify(statusCounts)} (total: ${rows.length})`);

    // Separate processed clean vs unprocessed tokens  
    const processedClean = rows.filter(r => r.scamStatus === 'clean');
    const unprocessed = rows.filter(r => r.scamStatus === null);

    if (rows.length === 0) {
      logger.info('Mint report: no first-mint events in the last 24h (excluding scams)');
      const tsLocal = new Date().toLocaleString('en-US', { timeZone: timezone, hour12: false });
      const msg = `🆕 Token Mints (last 24h) — ${tsLocal}\n\n📭 No new token mints detected in the last 24 hours.`;
      const fingerprint = `mint24h_empty_${Math.floor(nowMs / 1000)}`;
      await telegram.sendToGroupOrAdmin(msg, undefined, fingerprint);
      return;
    }

    logger.info(`Mint report: ${processedClean.length} processed clean, ${unprocessed.length} unprocessed tokens`);

    // Process in chunks to avoid memory overload
    const CHUNK_SIZE = 2000; // Process 2000 tokens at a time
    const requests = rows.map((r) => ({ chainId: 'solana', tokenAddress: r.mint, row: r }));
    logger.info(`Processing ${requests.length} total tokens in chunks of ${CHUNK_SIZE}`);
    
    const minCap = parseFloat(process.env.MINT_CAP_MIN || '200000');
    const maxCap = parseFloat(process.env.MINT_CAP_MAX || '1500000');
    logger.info(`Filtering tokens with mcap between $${minCap.toLocaleString()} - $${maxCap.toLocaleString()}`);

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

    let totalNoData = 0, totalNoMcap = 0, totalNoLiquidity = 0, totalTooLow = 0, totalTooHigh = 0;
    const newScamTokens: string[] = [];
    const noDataTokens: string[] = [];
    const deadTokens: string[] = [];
    const cleanTokens: string[] = [];
    const allLegitimateMarketCaps: number[] = []; // For overview stats
    
    // Process chunks sequentially
    for (let i = 0; i < requests.length; i += CHUNK_SIZE) {
      const chunk = requests.slice(i, i + CHUNK_SIZE);
      const chunkRequests = chunk.map(item => ({ chainId: item.chainId, tokenAddress: item.tokenAddress }));
      
      logger.info(`Processing chunk ${Math.floor(i/CHUNK_SIZE) + 1}/${Math.ceil(requests.length/CHUNK_SIZE)} (${chunk.length} tokens)`);
      
      const chunkResultMap = await dexScreener.batchGetTokens(chunkRequests);
      const foundInChunk = Array.from(chunkResultMap.values()).filter(t => t !== null).length;
      logger.info(`Found data for ${foundInChunk}/${chunk.length} tokens in this chunk`);
      
      // Process this chunk and keep only qualifying tokens
      await processTokenChunk(chunk, chunkResultMap, items, minCap, maxCap, {
        noData: totalNoData,
        noMcap: totalNoMcap,
        noLiquidity: totalNoLiquidity,
        tooLow: totalTooLow,
        tooHigh: totalTooHigh,
        newScamTokens,
        noDataTokens,
        deadTokens,
        cleanTokens,
        allLegitimateMarketCaps
      });
      
      // Force garbage collection after each chunk (if available)
      if (global.gc) {
        global.gc();
      }
    }
    
    // Chunk processing complete - all qualifying items are in the items array
    const noData = totalNoData;
    const noMcap = totalNoMcap; 
    const noLiquidity = totalNoLiquidity;
    const tooLow = totalTooLow;
    const tooHigh = totalTooHigh;
    const passedFilter = items.length;

    // Market cap distribution from final items
    if (items.length > 0) {
      const validMcaps = items.map(item => item.mcap).sort((a, b) => a - b);
      const p10 = validMcaps[Math.floor(validMcaps.length * 0.1)] || 0;
      const p50 = validMcaps[Math.floor(validMcaps.length * 0.5)] || 0;
      const p90 = validMcaps[Math.floor(validMcaps.length * 0.9)] || 0;
      const max = validMcaps[validMcaps.length-1] || 0;
      logger.info(`Market cap distribution: p10=$${p10.toLocaleString()}, p50=$${p50.toLocaleString()}, p90=$${p90.toLocaleString()}, max=$${max.toLocaleString()}`);
    }

    // Mark newly detected scams in database (async, don't wait)
    if (newScamTokens.length > 0) {
      TokenProcessorService.markTokensAsScam(newScamTokens); // Fire and forget
      logger.info(`Mint report detected ${newScamTokens.length} new scam tokens`);
    }

    // Mark tokens with no data as "no_data" to avoid reprocessing them
    if (noDataTokens.length > 0) {
      TokenProcessorService.markTokensAsNoData(noDataTokens); // Fire and forget  
      logger.info(`Mint report marked ${noDataTokens.length} tokens as no-data (will be skipped in future)`);
    }

    // Mark dead tokens (no liquidity/mcap) to avoid reprocessing them
    if (deadTokens.length > 0) {
      TokenProcessorService.markTokensAsDead(deadTokens); // Fire and forget
      logger.info(`Mint report marked ${deadTokens.length} tokens as dead (no liquidity/mcap - will be skipped in future)`);
    }

    // Mark valid tokens as clean (they have data, mcap, liquidity - legitimate tokens)
    if (cleanTokens.length > 0) {
      TokenProcessorService.markTokensAsClean(cleanTokens); // Fire and forget
      logger.info(`Mint report marked ${cleanTokens.length} tokens as clean (legitimate tokens)`);
    }

    // Log filtering results
    logger.info(`Filtering results: ${noData} no data, ${noMcap} no mcap, ${noLiquidity} no liquidity, ${tooLow} too low mcap, ${tooHigh} too high mcap, ${passedFilter} passed all filters`);

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
    
    // Add market cap overview stats for ALL legitimate tokens (excluding scams/no-data)
    if (allLegitimateMarketCaps.length > 0) {
      const sortedMcaps = [...allLegitimateMarketCaps].sort((a, b) => a - b);
      const avg = sortedMcaps.reduce((sum, mc) => sum + mc, 0) / sortedMcaps.length;
      const median = sortedMcaps[Math.floor(sortedMcaps.length * 0.5)] || 0;
      const max = sortedMcaps[sortedMcaps.length - 1] || 0;
      msg += `📈 Market Cap Overview (all ${allLegitimateMarketCaps.length} legitimate tokens):\n`;
      msg += `   • Average: $${avg.toLocaleString(undefined, {maximumFractionDigits: 0})}\n`;
      msg += `   • Median: $${median.toLocaleString(undefined, {maximumFractionDigits: 0})}\n`;
      msg += `   • 🚀 Maximum: $${max.toLocaleString(undefined, {maximumFractionDigits: 0})}\n\n`;
    }

    for (let i = 0; i < items.length; i++) {
      const it = items[i]!;
      const priceStr = it.price < 1 ? it.price.toFixed(6) : it.price.toFixed(4);
      const liqStr = `$${Math.round(it.liquidity).toLocaleString()}`;
      
      // Format price changes with + for positive values
      const change1h = it.priceChange1h >= 0 ? `+${it.priceChange1h.toFixed(1)}%` : `${it.priceChange1h.toFixed(1)}%`;
      const change24h = it.priceChange24h >= 0 ? `+${it.priceChange24h.toFixed(1)}%` : `${it.priceChange24h.toFixed(1)}%`;
      
      // Format socials
      let socialsStr = '';
      if (it.socials && it.socials.length > 0) {
        const twitterSocial = it.socials.find(s => s.platform?.toLowerCase() === 'twitter');
        const telegramSocial = it.socials.find(s => s.platform?.toLowerCase() === 'telegram');
        
        if (twitterSocial) socialsStr += ` | 🐦 @${twitterSocial.handle}`;
        if (telegramSocial) socialsStr += ` | 📢 @${telegramSocial.handle}`;
      }
      
      msg += `${i + 1}. ${it.symbol} — Mcap $${Math.round(it.mcap).toLocaleString()} | Px ${priceStr} | 1h ${change1h} | 24h ${change24h} | Lq ${liqStr}${socialsStr}\n`;
      msg += `   ${it.mint}\n\n`;
    }

    const fingerprint = `mint24h_${Math.floor(nowMs / 1000)}`;
    // Use the same routing logic as sendTriggerAlert and sendHotAlert
    await telegram.sendToGroupOrAdmin(msg, undefined, fingerprint);
    logger.info(`Mint report sent with ${items.length} tokens`);
  } catch (error) {
    logger.error('Mint report failed', { 
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      type: typeof error
    });
  }
}


