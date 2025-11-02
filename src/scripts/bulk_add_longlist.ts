/**
 * Bulk Add Tokens to Long List
 *
 * This script reads token lists from JSON files and adds them to the long list
 * with proper deduplication, rate limiting, and error handling.
 */

import fs from 'fs';
import path from 'path';
import { DatabaseManager } from '../src/utils/database';
import { DexScreenerService } from '../src/services/dexscreener';
import { logger } from '../src/utils/logger';

interface TokenToAdd {
  address: string;
  symbol?: string;
  name?: string;
  mcap?: number;
  liquidity?: number;
  verified?: boolean;
  organicScore?: number;
}

interface BulkAddOptions {
  dryRun?: boolean;           // Don't actually add, just preview
  minMarketCap?: number;      // Minimum market cap filter
  minLiquidity?: number;      // Minimum liquidity filter
  verifiedOnly?: boolean;     // Only add verified tokens
  skipExisting?: boolean;     // Skip tokens already in long list
  maxTokens?: number;         // Maximum number of tokens to add
  rateLimitMs?: number;       // Milliseconds between API calls
}

class BulkAddService {
  private prisma;
  private dexScreener: DexScreenerService;

  constructor() {
    this.prisma = DatabaseManager.getInstance();
    this.dexScreener = new DexScreenerService();
  }

  async loadTokenList(filePath: string): Promise<TokenToAdd[]> {
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(__dirname, '..', filePath);

    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found: ${fullPath}`);
    }

    const data = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));

    // Handle different input formats
    if (Array.isArray(data)) {
      // If it's an array of strings (just addresses)
      if (typeof data[0] === 'string') {
        return data.map(address => ({ address }));
      }
      // If it's an array of objects
      return data.map(token => ({
        address: token.address || token.id || token.contractAddress,
        symbol: token.symbol,
        name: token.name,
        mcap: token.mcap,
        liquidity: token.liquidity,
        verified: token.verified || token.isVerified,
        organicScore: token.organicScore
      }));
    }

    throw new Error('Invalid token list format. Expected array.');
  }

  async getExistingTokens(): Promise<Set<string>> {
    const existing = await this.prisma.coin.findMany({
      select: { tokenAddress: true }
    });

    return new Set(existing.map(coin => coin.tokenAddress));
  }

  filterTokens(tokens: TokenToAdd[], options: BulkAddOptions): TokenToAdd[] {
    let filtered = [...tokens];

    // Filter by market cap
    if (options.minMarketCap) {
      filtered = filtered.filter(token =>
        token.mcap && token.mcap >= options.minMarketCap!
      );
    }

    // Filter by liquidity
    if (options.minLiquidity) {
      filtered = filtered.filter(token =>
        token.liquidity && token.liquidity >= options.minLiquidity!
      );
    }

    // Filter by verified status
    if (options.verifiedOnly) {
      filtered = filtered.filter(token => token.verified === true);
    }

    // Limit number of tokens
    if (options.maxTokens) {
      filtered = filtered.slice(0, options.maxTokens);
    }

    return filtered;
  }

  async addToken(token: TokenToAdd): Promise<{ success: boolean; error?: string; data?: any }> {
    try {
      // Validate address format
      if (!token.address || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(token.address)) {
        return { success: false, error: 'Invalid address format' };
      }

      // Get token info from DexScreener
      const pair = await this.dexScreener.getPairInfo('solana', token.address);

      if (!pair || !this.dexScreener.validatePairData(pair)) {
        return { success: false, error: 'No valid pair data found' };
      }

      // Check if already exists
      const existing = await this.prisma.coin.findFirst({
        where: { tokenAddress: pair.tokenAddress }
      });

      if (existing) {
        return { success: false, error: 'Already exists' };
      }

      // Create coin entry
      const coin = await this.prisma.coin.create({
        data: {
          symbol: pair.symbol,
          chain: 'solana',
          tokenAddress: pair.tokenAddress,
          name: pair.name
        }
      });

      // Create long watch config with default settings
      await this.prisma.longWatch.create({
        data: {
          coinId: coin.coinId,
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

      // Create initial state
      await this.prisma.longState.create({
        data: { coinId: coin.coinId }
      });

      return {
        success: true,
        data: {
          coinId: coin.coinId,
          symbol: pair.symbol,
          name: pair.name,
          price: pair.price,
          mcap: pair.marketCap
        }
      };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async bulkAdd(tokens: TokenToAdd[], options: BulkAddOptions = {}) {
    const {
      dryRun = false,
      skipExisting = true,
      rateLimitMs = 300
    } = options;

    console.log('\n🚀 Starting bulk add to long list...\n');

    // Filter tokens based on criteria
    const filtered = this.filterTokens(tokens, options);
    console.log(`📋 Filtered: ${filtered.length} tokens (from ${tokens.length} total)`);

    // Get existing tokens if needed
    let existingTokens = new Set<string>();
    if (skipExisting) {
      existingTokens = await this.getExistingTokens();
      console.log(`📊 Found ${existingTokens.size} existing tokens in long list\n`);
    }

    // Stats tracking
    const stats = {
      total: filtered.length,
      added: 0,
      skipped: 0,
      failed: 0,
      alreadyExists: 0
    };

    const results: Array<{
      address: string;
      symbol?: string;
      status: 'added' | 'skipped' | 'failed' | 'exists';
      error?: string;
      data?: any;
    }> = [];

    // Process each token
    for (let i = 0; i < filtered.length; i++) {
      const token = filtered[i];
      const progress = `[${i + 1}/${filtered.length}]`;

      // Skip if already exists
      if (skipExisting && existingTokens.has(token.address)) {
        console.log(`${progress} ⏭️  ${token.symbol || token.address.slice(0, 8)} - Already in long list`);
        stats.skipped++;
        stats.alreadyExists++;
        results.push({ address: token.address, symbol: token.symbol, status: 'exists' });
        continue;
      }

      if (dryRun) {
        console.log(`${progress} 🔍 [DRY RUN] Would add: ${token.symbol || token.address.slice(0, 8)}`);
        stats.skipped++;
        results.push({ address: token.address, symbol: token.symbol, status: 'skipped' });
        continue;
      }

      // Add token
      const result = await this.addToken(token);

      if (result.success) {
        console.log(`${progress} ✅ ${result.data.symbol} - Added (MCap: ${result.data.mcap ? `$${(result.data.mcap / 1_000_000).toFixed(2)}M` : 'N/A'})`);
        stats.added++;
        results.push({
          address: token.address,
          symbol: result.data.symbol,
          status: 'added',
          data: result.data
        });
      } else {
        console.log(`${progress} ❌ ${token.symbol || token.address.slice(0, 8)} - ${result.error}`);
        stats.failed++;
        results.push({
          address: token.address,
          symbol: token.symbol,
          status: 'failed',
          error: result.error
        });
      }

      // Rate limiting
      if (i < filtered.length - 1) {
        await new Promise(resolve => setTimeout(resolve, rateLimitMs));
      }
    }

    // Generate summary
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 Bulk Add Summary');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Total Processed: ${stats.total}`);
    console.log(`✅ Successfully Added: ${stats.added}`);
    console.log(`⏭️  Already Exists: ${stats.alreadyExists}`);
    console.log(`⏭️  Skipped: ${stats.skipped - stats.alreadyExists}`);
    console.log(`❌ Failed: ${stats.failed}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Save results to file
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const resultsFile = path.join(__dirname, `../data/jupiter_tokens/bulk_add_results_${timestamp}.json`);

    fs.writeFileSync(
      resultsFile,
      JSON.stringify({ stats, results, options, timestamp: new Date().toISOString() }, null, 2)
    );

    console.log(`📝 Results saved to: ${resultsFile}\n`);

    return { stats, results };
  }

  async disconnect() {
    await this.prisma.$disconnect();
  }
}

// CLI Usage
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help')) {
    console.log(`
Usage: npm run bulk-add -- [options] <file>

Options:
  --dry-run              Preview without actually adding tokens
  --min-mcap <value>     Minimum market cap (e.g., 1000000 for 1M)
  --min-liquidity <value> Minimum liquidity
  --verified-only        Only add verified tokens
  --max <number>         Maximum number of tokens to add
  --rate-limit <ms>      Milliseconds between requests (default: 300)

Examples:
  # Dry run to preview
  npm run bulk-add -- --dry-run data/jupiter_tokens/token_list.json

  # Add tokens with minimum 1M market cap
  npm run bulk-add -- --min-mcap 1000000 data/jupiter_tokens/token_list.json

  # Add only verified tokens, max 50
  npm run bulk-add -- --verified-only --max 50 data/jupiter_tokens/token_list.json

  # Add from addresses file
  npm run bulk-add -- data/jupiter_tokens/addresses.json
    `);
    process.exit(0);
  }

  const options: BulkAddOptions = {
    skipExisting: true,
    rateLimitMs: 300
  };

  let filePath = '';

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--verified-only') {
      options.verifiedOnly = true;
    } else if (arg === '--min-mcap') {
      options.minMarketCap = parseFloat(args[++i]);
    } else if (arg === '--min-liquidity') {
      options.minLiquidity = parseFloat(args[++i]);
    } else if (arg === '--max') {
      options.maxTokens = parseInt(args[++i], 10);
    } else if (arg === '--rate-limit') {
      options.rateLimitMs = parseInt(args[++i], 10);
    } else if (!arg.startsWith('--')) {
      filePath = arg;
    }
  }

  if (!filePath) {
    console.error('❌ Error: No input file specified');
    process.exit(1);
  }

  const service = new BulkAddService();

  try {
    // Load token list
    console.log(`📁 Loading tokens from: ${filePath}`);
    const tokens = await service.loadTokenList(filePath);
    console.log(`✅ Loaded ${tokens.length} tokens\n`);

    // Display options
    console.log('⚙️  Options:');
    if (options.dryRun) console.log('  • Dry Run: YES');
    if (options.minMarketCap) console.log(`  • Min Market Cap: $${(options.minMarketCap / 1_000_000).toFixed(2)}M`);
    if (options.minLiquidity) console.log(`  • Min Liquidity: $${(options.minLiquidity / 1_000).toFixed(2)}K`);
    if (options.verifiedOnly) console.log('  • Verified Only: YES');
    if (options.maxTokens) console.log(`  • Max Tokens: ${options.maxTokens}`);
    console.log(`  • Rate Limit: ${options.rateLimitMs}ms`);
    console.log('');

    // Execute bulk add
    await service.bulkAdd(tokens, options);

  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  } finally {
    await service.disconnect();
  }
}

if (require.main === module) {
  main().catch(console.error);
}

export { BulkAddService, TokenToAdd, BulkAddOptions };
