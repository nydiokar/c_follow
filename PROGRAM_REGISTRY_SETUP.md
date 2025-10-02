# Program Registry - Setup Complete ✅

## What We Built

A **smart, maintainable system** to track and classify Solana programs from your webhook data.

## Files Created

### 1. Data Files
- **`src/data/program_registry.json`** - The registry (79 programs total, 73 pending review)

### 2. Scripts
- **`scripts/update_program_registry.ts`** - Extracts programs from DB, updates registry
- **`scripts/review_programs.sh`** - Helper to view pending programs

### 3. Documentation
- **`PROGRAM_REVIEW_GUIDE.md`** - How to classify programs
- **`PROGRAM_REGISTRY_SETUP.md`** - This file

### 4. Automation
- **`.github/workflows/update-program-registry.yml`** - Weekly auto-update via GitHub Action

## Current Status

**Total programs:** 79
**Verified:** 6 (System programs + Pump.fun)
**Pending review:** 73

**Top programs to review:**
1. `dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN` - 8,591 transactions
2. `LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj` - 7,994 transactions
3. `F9SixdqdmEBP5kprp2gZPZNeMmfHJRCTMFjN22dx3akf` - 759 transactions

## How to Review Programs

### Option 1: Quick Review (15 minutes)
Review just the top 10 programs (covers 99% of transaction volume):

```bash
./scripts/review_programs.sh
# Opens top 10 programs with Solscan links
```

### Option 2: Thorough Review (30-45 minutes)
Review all 73 programs:

```bash
cat src/data/program_registry.json | jq '.pending_review[] | .solscan_url'
# Visit each link, classify, update registry
```

### Classification Template

When you identify a program, move it from `pending_review` to `programs`:

```json
"PROGRAM_ID": {
  "name": "Program Name",
  "category": "token_launchpad|dex_amm|system|nft|unknown",
  "verified": "manual",
  "verified_date": "2025-10-02",
  "count": 1234,
  "sources": ["PUMP_FUN"],
  "sample_tx": "..."
}
```

## Automated Updates

### GitHub Action (Weekly)
Every Monday at 9 AM UTC, the system:
1. Extracts all program IDs from database
2. Checks for new programs
3. If found: Creates PR with new programs in `pending_review`
4. If not: Silent success

### Manual Update
Run anytime:

```bash
npx ts-node scripts/update_program_registry.ts
```

## Usage in Your Application

```typescript
import registry from './src/data/program_registry.json';

// Check if program should be filtered
function shouldFilterProgram(programId: string): boolean {
  const program = registry.programs[programId];
  if (!program) return true; // Filter unknown programs by default

  const category = program.category;
  return registry.categories[category]?.should_filter ?? true;
}

// Example: Filter out DEX/AMM programs when looking for new tokens
const isRelevant = !shouldFilterProgram('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'); // true (Pump.fun)
const isDex = shouldFilterProgram('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8'); // true (Raydium)
```

## Public Export

The registry is a plain JSON file that can be:
- Committed to GitHub
- Accessed via raw.githubusercontent.com
- Shared with other developers
- Used across applications

Example public URL (after pushing to GitHub):
```
https://raw.githubusercontent.com/YOUR_USERNAME/c_follow/main/src/data/program_registry.json
```

## Next Steps

1. **Review programs** - Use `./scripts/review_programs.sh`
2. **Classify top 10** - Focus on high-frequency programs first
3. **Commit changes** - Push updated registry to GitHub
4. **Enable GitHub Action** - Automated weekly updates
5. **Share publicly** - Make registry available to community

## Benefits

✅ **Automated discovery** - New programs flagged automatically
✅ **Easy maintenance** - Weekly PR with new programs
✅ **Human verification** - Manual review ensures accuracy
✅ **Publicly shareable** - JSON format, GitHub hosting
✅ **Low effort** - ~15 min/week to review new programs
✅ **Comprehensive** - Tracks all 79 unique programs from your data
