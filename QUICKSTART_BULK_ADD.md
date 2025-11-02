# Quick Start: Bulk Add Tokens to Long List

## TL;DR

```bash
# 1. Fetch tokens from Jupiter API
npm run fetch-tokens

# 2. Add top tokens with minimum $1M market cap
npm run bulk-add -- --min-mcap 1000000 --max 100 data/jupiter_tokens/token_list.json
```

## Jupiter API Categories Available

The fetch script retrieves from these categories:

| Category | Description | Intervals |
|----------|-------------|-----------|
| **toporganicscore** | Highest organic trading activity | 5m, 1h, 6h, 24h |
| **toptraded** | Most traded by volume | 5m, 1h, 6h, 24h |
| **toptrending** | Rising activity/trending | 5m, 1h, 6h, 24h |
| **recent** | Recently listed tokens | - |
| **verified** | Verified tokens only | - |
| **lst** | Liquid staking tokens | - |

## Step-by-Step Guide

### Step 1: Fetch Latest Tokens

```bash
npm run fetch-tokens
```

**What it does:**
- Fetches tokens from all Jupiter API categories
- Deduplicates and validates addresses
- Saves multiple output formats

**Output location:** `data/jupiter_tokens/`

**Files created:**
- `all_tokens.json` - Full metadata for all tokens
- `token_list.json` - Simplified list (recommended for bulk add)
- `addresses.json` - Just contract addresses
- `by_category.json` - Grouped by category
- `stats.json` - Summary statistics

### Step 2: Extract Specific Category (Optional)

If you want tokens from only ONE category:

```bash
# List available categories
npm run extract-category

# Extract specific category
npm run extract-category -- toptrending_24h
```

This creates:
- `data/jupiter_tokens/toptrending_24h.json`
- `data/jupiter_tokens/toptrending_24h_addresses.json`

### Step 3: Bulk Add to Long List

#### Basic (Add everything)
```bash
npm run bulk-add -- data/jupiter_tokens/token_list.json
```

#### Recommended (Filtered by quality)
```bash
# Add top 100 tokens with market cap >= $1M
npm run bulk-add -- --min-mcap 1000000 --max 100 data/jupiter_tokens/token_list.json
```

#### Conservative (High quality only)
```bash
# Add verified tokens with mcap >= $5M, liquidity >= $500K
npm run bulk-add -- --verified-only --min-mcap 5000000 --min-liquidity 500000 --max 50 data/jupiter_tokens/token_list.json
```

#### Preview First (Dry Run)
```bash
# See what would be added without actually adding
npm run bulk-add -- --dry-run --min-mcap 1000000 data/jupiter_tokens/token_list.json
```

## All Command Line Options

```
--dry-run              Preview without actually adding
--min-mcap <value>     Minimum market cap (e.g., 1000000 = $1M)
--min-liquidity <val>  Minimum liquidity
--verified-only        Only add verified tokens
--max <number>         Maximum number to add
--rate-limit <ms>      Wait time between requests (default: 300ms)
```

## Common Use Cases

### Use Case 1: Add Top Trending Tokens
```bash
# 1. Fetch all tokens
npm run fetch-tokens

# 2. Extract just trending
npm run extract-category -- toptrending_24h

# 3. Add them
npm run bulk-add -- --max 50 data/jupiter_tokens/toptrending_24h.json
```

### Use Case 2: Add High Quality Tokens Only
```bash
npm run fetch-tokens
npm run bulk-add -- --verified-only --min-mcap 10000000 --max 30 data/jupiter_tokens/token_list.json
```

### Use Case 3: Add from Custom List
Create `my_tokens.json`:
```json
[
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"
]
```

Then run:
```bash
npm run bulk-add -- my_tokens.json
```

## What Happens During Bulk Add?

1. **Load tokens** from your JSON file
2. **Filter** by your criteria (mcap, liquidity, verified, etc.)
3. **Check existing** - Skip tokens already in long list
4. **Validate** - Verify each token exists on DexScreener
5. **Add to database** - Create coin, long_watch, and long_state entries
6. **Rate limit** - Wait between requests to avoid API limits
7. **Save results** - Generate detailed results file

## Default Trigger Settings

All bulk-added tokens get these default settings:

| Trigger | Setting | Description |
|---------|---------|-------------|
| **Retrace** | ON, 15% | Alert on 15% drop from 72h high |
| **Stall** | ON, 30% vol drop, 5% band | Volume down + price stagnant |
| **Breakout** | ON, 12%, 1.5x vol | Price up 12% with volume surge |
| **Market Cap** | OFF | No mcap triggers by default |

Customize per-token with: `/long_set CONTRACT_ADDRESS retrace=20`

## Output Example

```
🚀 Starting bulk add to long list...

📋 Filtered: 85 tokens (from 342 total)
📊 Found 12 existing tokens in long list

⚙️  Options:
  • Min Market Cap: $1.00M
  • Max Tokens: 100

[1/85] ✅ BONK - Added (MCap: $2.34M)
[2/85] ⏭️  SOL - Already in long list
[3/85] ✅ WIF - Added (MCap: $1.82M)
...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 Bulk Add Summary
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total Processed: 85
✅ Successfully Added: 67
⏭️  Already Exists: 12
❌ Failed: 6
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Verify Results

After bulk adding, verify via Telegram:

```
/alerts          # See all tokens in long list
/report_now      # Generate status report
/status          # Bot health check
```

## Troubleshooting

**"No valid pair data found"**
→ Token doesn't exist on DexScreener-tracked DEXes (likely scam/dead)

**Many failures**
→ Increase `--rate-limit` to 500ms or use `--min-liquidity` filter

**Script hangs**
→ Reduce `--max` or increase `--rate-limit`

## Full Documentation

See `scripts/README_BULK_ADD.md` for comprehensive documentation.

## Daily Update Workflow

Create `update_tokens.sh`:
```bash
#!/bin/bash
cd /path/to/c_follow
npm run fetch-tokens
npm run bulk-add -- --min-mcap 2000000 --max 50 data/jupiter_tokens/token_list.json
```

Add to crontab:
```
0 1 * * * /path/to/update_tokens.sh
```

## Key Points

✅ **Automatic deduplication** - Won't add duplicates
✅ **Rate limited** - Safe for APIs
✅ **Dry run mode** - Preview before adding
✅ **Flexible filtering** - Market cap, liquidity, verified status
✅ **Results logging** - Full audit trail
✅ **Multiple formats** - Works with addresses or full objects

## Need Help?

```bash
npm run bulk-add -- --help
```

---

**Ready?** Start with:
```bash
npm run fetch-tokens && npm run bulk-add -- --dry-run --min-mcap 1000000 data/jupiter_tokens/token_list.json
```
