# Bulk Add Tokens to Long List

This guide explains how to fetch tokens from Jupiter API and bulk add them to your long list.

## Overview

The process consists of two steps:

1. **Fetch tokens** from Jupiter API (various categories)
2. **Bulk add** filtered tokens to your long list

## Step 1: Fetch Tokens from Jupiter

### Available Categories

The fetch script retrieves tokens from multiple Jupiter API endpoints:

**Category Endpoints:**
- `toporganicscore` - Tokens with highest organic trading score
- `toptraded` - Most traded tokens by volume
- `toptrending` - Trending tokens with rising activity

**Time Intervals:**
- `5m` - Last 5 minutes
- `1h` - Last hour
- `6h` - Last 6 hours
- `24h` - Last 24 hours

**Additional Endpoints:**
- `recent` - Recently listed tokens
- `verified` - Verified tokens only
- `lst` - Liquid staking tokens

### Run the Fetch Script

```bash
npm run fetch-tokens
```

### Output Files

The script saves data to `data/jupiter_tokens/`:

```
data/jupiter_tokens/
├── all_tokens.json          # All unique tokens with full metadata
├── token_list.json          # Simplified list (address, symbol, mcap, etc.)
├── addresses.json           # Just contract addresses (simple array)
├── by_category.json         # Tokens grouped by category/interval
└── stats.json              # Summary statistics
```

### Example Output

```
🚀 Starting Jupiter token fetch...

Fetching: https://lite-api.jup.ag/tokens/v2/toporganicscore/24h?limit=100
✅ toporganicscore_24h: 100 tokens

Fetching: https://lite-api.jup.ag/tokens/v2/toptraded/24h?limit=100
✅ toptraded_24h: 100 tokens

...

📊 Summary:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total Unique Tokens: 342
With Market Cap: 315
With Liquidity: 298
Verified: 156

Top 10 by Market Cap:
  1. SOL        $42520.00M
  2. USDC       $38200.00M
  3. USDT       $35800.00M
  ...
```

## Step 2: Bulk Add to Long List

### Basic Usage

```bash
# Add all tokens from the simplified list
npm run bulk-add -- data/jupiter_tokens/token_list.json

# Add from addresses file
npm run bulk-add -- data/jupiter_tokens/addresses.json
```

### Advanced Filtering Options

#### Dry Run (Preview without adding)
```bash
npm run bulk-add -- --dry-run data/jupiter_tokens/token_list.json
```

#### Filter by Market Cap
```bash
# Only add tokens with market cap >= $1M
npm run bulk-add -- --min-mcap 1000000 data/jupiter_tokens/token_list.json

# Only add tokens with market cap >= $10M
npm run bulk-add -- --min-mcap 10000000 data/jupiter_tokens/token_list.json
```

#### Filter by Liquidity
```bash
# Only add tokens with liquidity >= $500K
npm run bulk-add -- --min-liquidity 500000 data/jupiter_tokens/token_list.json
```

#### Verified Tokens Only
```bash
npm run bulk-add -- --verified-only data/jupiter_tokens/token_list.json
```

#### Limit Number of Tokens
```bash
# Add only first 50 tokens
npm run bulk-add -- --max 50 data/jupiter_tokens/token_list.json
```

#### Adjust Rate Limiting
```bash
# Wait 500ms between API calls (default is 300ms)
npm run bulk-add -- --rate-limit 500 data/jupiter_tokens/token_list.json
```

#### Combine Multiple Filters
```bash
# Add verified tokens with mcap >= $5M, max 100 tokens
npm run bulk-add -- --verified-only --min-mcap 5000000 --max 100 data/jupiter_tokens/token_list.json
```

### Output Example

```
🚀 Starting bulk add to long list...

📋 Filtered: 85 tokens (from 342 total)
📊 Found 12 existing tokens in long list

⚙️  Options:
  • Min Market Cap: $1.00M
  • Max Tokens: 100
  • Rate Limit: 300ms

[1/85] ✅ BONK - Added (MCap: $2.34M)
[2/85] ⏭️  SOL - Already in long list
[3/85] ✅ WIF - Added (MCap: $1.82M)
[4/85] ❌ SCAM - No valid pair data found
...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 Bulk Add Summary
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total Processed: 85
✅ Successfully Added: 67
⏭️  Already Exists: 12
⏭️  Skipped: 0
❌ Failed: 6
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📝 Results saved to: data/jupiter_tokens/bulk_add_results_2025-01-15T10-30-45.json
```

## Common Workflows

### Workflow 1: Add Top 50 High Quality Tokens

```bash
# 1. Fetch latest tokens
npm run fetch-tokens

# 2. Add top 50 verified tokens with mcap >= $5M
npm run bulk-add -- --verified-only --min-mcap 5000000 --max 50 data/jupiter_tokens/token_list.json
```

### Workflow 2: Add All Trending Tokens

To add only tokens from a specific category, you need to extract them first:

```bash
# 1. Fetch tokens
npm run fetch-tokens

# 2. Create a custom JSON file with just trending tokens
# (You'll need to manually extract from by_category.json)

# 3. Add them
npm run bulk-add -- data/jupiter_tokens/trending_only.json
```

### Workflow 3: Safe Dry Run First

```bash
# 1. Fetch tokens
npm run fetch-tokens

# 2. Preview what would be added (dry run)
npm run bulk-add -- --dry-run --min-mcap 1000000 data/jupiter_tokens/token_list.json

# 3. If satisfied, run for real
npm run bulk-add -- --min-mcap 1000000 data/jupiter_tokens/token_list.json
```

### Workflow 4: Daily Updates

Create a cron job to fetch and add new tokens daily:

```bash
#!/bin/bash
# daily_update.sh

cd /path/to/c_follow

# Fetch latest tokens
npm run fetch-tokens

# Add new tokens with filters
npm run bulk-add -- --verified-only --min-mcap 2000000 --max 100 data/jupiter_tokens/token_list.json
```

## Understanding Results Files

After each bulk add, a results file is saved with timestamp:

```json
{
  "stats": {
    "total": 85,
    "added": 67,
    "skipped": 6,
    "failed": 12,
    "alreadyExists": 6
  },
  "results": [
    {
      "address": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "symbol": "USDC",
      "status": "added",
      "data": {
        "coinId": 123,
        "symbol": "USDC",
        "name": "USD Coin",
        "price": 1.00,
        "mcap": 38200000000
      }
    }
  ],
  "options": {
    "minMarketCap": 1000000,
    "maxTokens": 100
  },
  "timestamp": "2025-01-15T10:30:45.123Z"
}
```

## Token List Formats

The bulk add script supports multiple input formats:

### Format 1: Array of Addresses
```json
[
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"
]
```

### Format 2: Array of Objects (Simplified)
```json
[
  {
    "address": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "symbol": "USDC",
    "name": "USD Coin",
    "mcap": 38200000000,
    "verified": true
  }
]
```

### Format 3: Full Jupiter Token Objects
```json
[
  {
    "id": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "symbol": "USDC",
    "name": "USD Coin",
    "decimals": 6,
    "mcap": 38200000000,
    "liquidity": 5000000,
    "isVerified": true,
    "organicScore": 95.5
  }
]
```

## Deduplication

The bulk add script automatically:

- ✅ Skips tokens already in your long list
- ✅ Checks for duplicates within the input list
- ✅ Uses DexScreener to validate tokens exist
- ✅ Prevents adding invalid/scam tokens

## Rate Limiting

**Important:** The script includes built-in rate limiting to avoid:
- Getting rate-limited by DexScreener API
- Overloading your database
- Telegram API issues

Default: 300ms between tokens (≈200 tokens per minute)

Adjust with `--rate-limit` if needed.

## Troubleshooting

### Error: "No valid pair data found"
**Solution:** Token doesn't have liquidity on DEXes tracked by DexScreener. This is normal for scam/dead tokens.

### Error: "Invalid address format"
**Solution:** Ensure addresses are valid Solana base58 strings (32-44 characters).

### Error: "Failed to fetch"
**Solution:**
- Check internet connection
- Verify Jupiter API is accessible
- Wait a few minutes (API might be rate limiting you)

### Many tokens failing to add
**Solution:**
- Increase `--rate-limit` to 500ms or higher
- Use `--dry-run` first to preview
- Check DexScreener API status

### Script hangs/times out
**Solution:**
- Reduce `--max` to add fewer tokens per run
- Increase `--rate-limit`
- Check database isn't locked

## Help

```bash
npm run bulk-add -- --help
```

## Complete Example Session

```bash
# 1. Fetch latest tokens from Jupiter
npm run fetch-tokens

# 2. Check what was fetched
cat data/jupiter_tokens/stats.json

# 3. Dry run to see what would be added
npm run bulk-add -- --dry-run --min-mcap 5000000 --max 50 data/jupiter_tokens/token_list.json

# 4. Actually add the tokens
npm run bulk-add -- --min-mcap 5000000 --max 50 data/jupiter_tokens/token_list.json

# 5. Verify via Telegram
# Use /alerts command to see your new tokens
```

## Next Steps

After bulk adding tokens:

1. Use `/alerts` command in Telegram to verify tokens were added
2. Customize trigger settings per token with `/long_set` if needed
3. Use `/report_now` to see current status of all tokens
4. Monitor alerts as they come in!

## Advanced: Custom Token Lists

You can create your own token lists manually:

```json
[
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"
]
```

Save as `my_tokens.json` and run:
```bash
npm run bulk-add -- my_tokens.json
```
