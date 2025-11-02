// Quick bulk add without TypeScript strictness
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Import services - need to use compiled JS
const { DexScreenerService } = require('../dist/services/dexscreener');

async function addToken(address) {
  const dexScreener = new DexScreenerService();

  try {
    const pair = await dexScreener.getPairInfo('solana', address);

    if (!pair || !dexScreener.validatePairData(pair)) {
      return { success: false, error: 'No valid pair data' };
    }

    // Check if exists
    const existing = await prisma.coin.findFirst({
      where: { tokenAddress: pair.tokenAddress }
    });

    if (existing) {
      return { success: false, error: 'Already exists', skipped: true };
    }

    // Create coin
    const coin = await prisma.coin.create({
      data: {
        symbol: pair.symbol,
        chain: 'solana',
        tokenAddress: pair.tokenAddress,
        name: pair.name
      }
    });

    // Create long watch
    await prisma.longWatch.create({
      data: {
        coinId: coin.coinId,
        addedAtUtc: Math.floor(Date.now() / 1000),
        retraceOn: true,
        retracePct: 15,
        stallOn: true,
        stallVolPct: 30,
        stallBandPct: 5,
        breakoutOn: true,
        breakoutPct: 12,
        breakoutVolX: 1.5,
        mcapOn: false,
        mcapLevels: ''
      }
    });

    // Create state
    await prisma.longState.create({
      data: {
        coinId: coin.coinId,
        lastUpdatedUtc: Math.floor(Date.now() / 1000)
      }
    });

    return { success: true, symbol: pair.symbol, mcap: pair.marketCap };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function main() {
  const jsonFile = process.argv[2] || 'data/jupiter_tokens/searched_tokens.json';
  const tokens = JSON.parse(fs.readFileSync(jsonFile, 'utf-8'));

  console.log(`\n🚀 Adding ${tokens.length} tokens to long list...\n`);

  let added = 0, skipped = 0, failed = 0;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const address = token.id || token.address;

    if (!address) {
      console.log(`[${i+1}/${tokens.length}] ❌ ${token.symbol} - No address`);
      failed++;
      continue;
    }

    const result = await addToken(address);

    if (result.success) {
      const mcapStr = result.mcap ? `$${(result.mcap / 1_000_000).toFixed(2)}M` : 'N/A';
      console.log(`[${i+1}/${tokens.length}] ✅ ${result.symbol} - Added (${mcapStr})`);
      added++;
    } else if (result.skipped) {
      console.log(`[${i+1}/${tokens.length}] ⏭️  ${token.symbol} - Already exists`);
      skipped++;
    } else {
      console.log(`[${i+1}/${tokens.length}] ❌ ${token.symbol} - ${result.error}`);
      failed++;
    }

    await new Promise(resolve => setTimeout(resolve, 300));
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 Summary');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`✅ Added: ${added}`);
  console.log(`⏭️  Skipped: ${skipped}`);
  console.log(`❌ Failed: ${failed}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  await prisma.$disconnect();
}

main().catch(console.error);
