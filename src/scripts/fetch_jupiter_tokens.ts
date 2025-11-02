/**
 * Fetch tokens from Jupiter API V2
 *
 * This script fetches tokens from various Jupiter API categories and
 * saves them to JSON files for later bulk import into the long list.
 */

import fs from 'fs';
import path from 'path';

interface JupiterToken {
  id: string;           // Contract address
  name: string;
  symbol: string;
  icon?: string;
  decimals: number;
  circSupply?: number;
  totalSupply?: number;
  usdPrice?: number;
  mcap?: number;
  fdv?: number;
  liquidity?: number;
  holderCount?: number;
  organicScore?: number;
  isVerified?: boolean;
  tags?: string[];
  stats24h?: {
    priceChange?: number;
    volumeChange?: number;
    buyVolume?: number;
    sellVolume?: number;
    numBuys?: number;
    numSells?: number;
    numTraders?: number;
  };
}

interface FetchConfig {
  category: string;
  interval: string;
  limit: number;
}

const BASE_URL = 'https://lite-api.jup.ag';

// Configuration for all fetches
const FETCH_CONFIGS: FetchConfig[] = [
  // Top Organic Score
  { category: 'toporganicscore', interval: '24h', limit: 100 },
  { category: 'toporganicscore', interval: '6h', limit: 100 },

  // Top Traded
  { category: 'toptraded', interval: '24h', limit: 100 },
  { category: 'toptraded', interval: '6h', limit: 100 },

  // Top Trending
  { category: 'toptrending', interval: '24h', limit: 100 },
  { category: 'toptrending', interval: '6h', limit: 100 },
];

// Additional endpoints to fetch
const ADDITIONAL_ENDPOINTS = [
  { name: 'recent', path: '/tokens/v2/recent' },
  { name: 'verified', path: '/tokens/v2/tag/verified?limit=100' },
  { name: 'lst', path: '/tokens/v2/tag/lst?limit=100' },
];

async function fetchTokens(category: string, interval: string, limit: number): Promise<JupiterToken[]> {
  const url = `${BASE_URL}/tokens/v2/${category}/${interval}?limit=${limit}`;
  console.log(`Fetching: ${url}`);

  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error(`Failed to fetch ${category}/${interval}:`, error);
    return [];
  }
}

async function fetchEndpoint(name: string, path: string): Promise<JupiterToken[]> {
  const url = `${BASE_URL}${path}`;
  console.log(`Fetching: ${url}`);

  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error(`Failed to fetch ${name}:`, error);
    return [];
  }
}

async function main() {
  console.log('🚀 Starting Jupiter token fetch...\n');

  const outputDir = path.join(__dirname, '../data/jupiter_tokens');

  // Create output directory if it doesn't exist
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const allTokens: Map<string, JupiterToken> = new Map();
  const categoryData: Record<string, any> = {};

  // Fetch all category endpoints
  for (const config of FETCH_CONFIGS) {
    const tokens = await fetchTokens(config.category, config.interval, config.limit);
    const key = `${config.category}_${config.interval}`;
    categoryData[key] = tokens;

    // Add to master list
    tokens.forEach(token => {
      if (token.id && !allTokens.has(token.id)) {
        allTokens.set(token.id, token);
      }
    });

    console.log(`✅ ${key}: ${tokens.length} tokens\n`);

    // Rate limiting - wait 500ms between requests
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Fetch additional endpoints
  for (const endpoint of ADDITIONAL_ENDPOINTS) {
    const tokens = await fetchEndpoint(endpoint.name, endpoint.path);
    categoryData[endpoint.name] = tokens;

    // Add to master list
    tokens.forEach(token => {
      if (token.id && !allTokens.has(token.id)) {
        allTokens.set(token.id, token);
      }
    });

    console.log(`✅ ${endpoint.name}: ${tokens.length} tokens\n`);

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Convert map to array and filter
  const uniqueTokens = Array.from(allTokens.values());

  // Filter out tokens without basic required data
  const validTokens = uniqueTokens.filter(token => {
    return token.id &&
           token.symbol &&
           token.name &&
           token.id.length >= 32; // Valid Solana address
  });

  // Sort by market cap (descending)
  validTokens.sort((a, b) => {
    const mcapA = a.mcap || 0;
    const mcapB = b.mcap || 0;
    return mcapB - mcapA;
  });

  // Save all data
  console.log('\n📝 Saving data...\n');

  // Save by category
  fs.writeFileSync(
    path.join(outputDir, 'by_category.json'),
    JSON.stringify(categoryData, null, 2)
  );
  console.log(`✅ Saved by_category.json`);

  // Save all unique tokens
  fs.writeFileSync(
    path.join(outputDir, 'all_tokens.json'),
    JSON.stringify(validTokens, null, 2)
  );
  console.log(`✅ Saved all_tokens.json (${validTokens.length} unique tokens)`);

  // Save simplified list (just addresses and symbols)
  const simplifiedList = validTokens.map(token => ({
    address: token.id,
    symbol: token.symbol,
    name: token.name,
    mcap: token.mcap,
    liquidity: token.liquidity,
    verified: token.isVerified,
    organicScore: token.organicScore
  }));

  fs.writeFileSync(
    path.join(outputDir, 'token_list.json'),
    JSON.stringify(simplifiedList, null, 2)
  );
  console.log(`✅ Saved token_list.json (simplified)`);

  // Save just addresses (for easy import)
  const addresses = validTokens.map(token => token.id);
  fs.writeFileSync(
    path.join(outputDir, 'addresses.json'),
    JSON.stringify(addresses, null, 2)
  );
  console.log(`✅ Saved addresses.json (${addresses.length} addresses)`);

  // Generate statistics report
  const stats = {
    totalUnique: validTokens.length,
    withMarketCap: validTokens.filter(t => t.mcap && t.mcap > 0).length,
    withLiquidity: validTokens.filter(t => t.liquidity && t.liquidity > 0).length,
    verified: validTokens.filter(t => t.isVerified).length,
    topByMcap: validTokens.slice(0, 10).map(t => ({
      symbol: t.symbol,
      mcap: t.mcap,
      address: t.id
    })),
    categoryCounts: Object.entries(categoryData).reduce((acc, [key, tokens]) => {
      acc[key] = tokens.length;
      return acc;
    }, {} as Record<string, number>)
  };

  fs.writeFileSync(
    path.join(outputDir, 'stats.json'),
    JSON.stringify(stats, null, 2)
  );
  console.log(`✅ Saved stats.json`);

  // Print summary
  console.log('\n📊 Summary:');
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Total Unique Tokens: ${stats.totalUnique}`);
  console.log(`With Market Cap: ${stats.withMarketCap}`);
  console.log(`With Liquidity: ${stats.withLiquidity}`);
  console.log(`Verified: ${stats.verified}`);
  console.log('\nTop 10 by Market Cap:');
  stats.topByMcap.forEach((token, i) => {
    const mcapStr = token.mcap ? `$${(token.mcap / 1_000_000).toFixed(2)}M` : 'N/A';
    console.log(`  ${i + 1}. ${token.symbol.padEnd(10)} ${mcapStr}`);
  });
  console.log('\nCategory Counts:');
  Object.entries(stats.categoryCounts).forEach(([key, count]) => {
    console.log(`  ${key.padEnd(30)} ${count} tokens`);
  });
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`\n✅ All data saved to: ${outputDir}\n`);
}

main().catch(console.error);
