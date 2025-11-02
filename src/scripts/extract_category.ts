/**
 * Extract Specific Category from Jupiter Fetch Results
 *
 * This helper script allows you to extract tokens from specific categories
 * after running fetch_jupiter_tokens.ts
 */

import fs from 'fs';
import path from 'path';

interface CategoryData {
  [key: string]: any[];
}

function extractCategory(categoryKey: string): void {
  const inputFile = path.join(__dirname, '../data/jupiter_tokens/by_category.json');

  if (!fs.existsSync(inputFile)) {
    console.error('❌ Error: by_category.json not found');
    console.error('Run "npm run fetch-tokens" first to fetch data from Jupiter API');
    process.exit(1);
  }

  const data: CategoryData = JSON.parse(fs.readFileSync(inputFile, 'utf-8'));

  // List available categories if no key specified
  if (!categoryKey) {
    console.log('\n📋 Available Categories:\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    Object.entries(data).forEach(([key, tokens]) => {
      console.log(`${key.padEnd(35)} ${tokens.length} tokens`);
    });
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('Usage: npm run extract-category -- <category_key>');
    console.log('\nExamples:');
    console.log('  npm run extract-category -- toptrending_24h');
    console.log('  npm run extract-category -- toporganicscore_6h');
    console.log('  npm run extract-category -- verified\n');
    return;
  }

  // Check if category exists
  if (!data[categoryKey]) {
    console.error(`❌ Error: Category "${categoryKey}" not found\n`);
    console.error('Available categories:');
    Object.keys(data).forEach(key => console.error(`  - ${key}`));
    process.exit(1);
  }

  const tokens = data[categoryKey];

  // Filter out invalid tokens
  const validTokens = tokens.filter(token =>
    token.id &&
    token.symbol &&
    token.id.length >= 32
  );

  // Create simplified list
  const simplifiedList = validTokens.map(token => ({
    address: token.id,
    symbol: token.symbol,
    name: token.name,
    mcap: token.mcap,
    liquidity: token.liquidity,
    verified: token.isVerified,
    organicScore: token.organicScore
  }));

  // Create output file
  const outputFile = path.join(__dirname, `../data/jupiter_tokens/${categoryKey}.json`);
  fs.writeFileSync(outputFile, JSON.stringify(simplifiedList, null, 2));

  // Also save just addresses
  const addresses = validTokens.map(token => token.id);
  const addressesFile = path.join(__dirname, `../data/jupiter_tokens/${categoryKey}_addresses.json`);
  fs.writeFileSync(addressesFile, JSON.stringify(addresses, null, 2));

  console.log('\n✅ Extraction Complete!\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Category: ${categoryKey}`);
  console.log(`Tokens: ${validTokens.length}`);
  console.log(`\nOutput Files:`);
  console.log(`  • ${outputFile}`);
  console.log(`  • ${addressesFile}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (validTokens.length > 0) {
    console.log('Top 10 Tokens:');
    validTokens.slice(0, 10).forEach((token, i) => {
      const mcapStr = token.mcap ? `$${(token.mcap / 1_000_000).toFixed(2)}M` : 'N/A';
      console.log(`  ${i + 1}. ${token.symbol.padEnd(10)} ${mcapStr.padStart(12)}`);
    });
    console.log('');
  }

  console.log('Next Steps:');
  console.log(`  npm run bulk-add -- data/jupiter_tokens/${categoryKey}.json\n`);
}

// CLI execution
if (require.main === module) {
  const args = process.argv.slice(2);
  const categoryKey = args[0];
  extractCategory(categoryKey);
}

export { extractCategory };
