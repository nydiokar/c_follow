# Program Registry

Automatic Solana program discovery and classification from webhook data.

## Quick Start

### View Pending Programs
```bash
./scripts/review_programs.sh
```

### Update Registry (runs automatically via cron)
```bash
python3 scripts/update_program_registry.py
```

## How It Works

**Automated (Weekly - Monday 9 AM):**
1. Extracts all program IDs from database
2. Updates `src/data/solana_program_registry.json`
3. Sends Telegram notification with top 20 programs + Solscan links

**Manual Review:**
1. Get Telegram notification with clickable Solscan links
2. Click links, identify programs (can do from anywhere - phone, laptop)
3. When back at computer: edit registry, move from `pending_review` to `programs`
4. Commit and push changes

## Program Categories

| Category | Description | Filter? | Examples |
|----------|-------------|---------|----------|
| `system` | Core Solana programs | Yes | SPL Token, System Program |
| `dex_amm` | DEXs and liquidity | Yes | Raydium, Orca, Jupiter |
| `token_launchpad` | Token creation | **No** | Pump.fun, Moonshot |
| `nft` | NFT programs | Yes | Metaplex |
| `unknown` | Unclassified | Yes | Needs investigation |

## Classification Template

When you identify a program, edit `src/data/program_registry.json`:

**Move from `pending_review` to `programs`:**

```json
"PROGRAM_ID": {
  "name": "Program Name",
  "category": "token_launchpad",
  "verified": "manual",
  "verified_date": "2025-10-02",
  "count": 1234,
  "sources": ["PUMP_FUN"],
  "sample_tx": "...",
  "notes": "Optional notes"
}
```

## Quick Identification Tips

**Token Launchpad** (KEEP):
- Names: "pump", "moon", "launch", "creator"
- High frequency in token mints

**DEX/AMM** (FILTER):
- Names: "swap", "pool", "liquidity", "dex"
- Associated with trading

**System** (FILTER):
- Official Solana programs
- Very high transaction counts

**Unknown** (FILTER by default):
- Can't determine purpose
- Mark as unknown, revisit later

## Files

- **`src/data/solana_program_registry.json`** - The registry (80 programs, 74 pending)
- **`scripts/update_program_registry.py`** - Auto-update script (fast Python version)
- **`scripts/review_programs.sh`** - Review helper

## Current Status

**Total:** 79 programs
**Verified:** 6
**Pending Review:** 73

Run `./scripts/review_programs.sh` to see top 10 pending programs.

## Usage in Code

```typescript
import registry from './src/data/solana_program_registry.json';

function shouldFilterProgram(programId: string): boolean {
  const program = registry.programs[programId];
  if (!program) return true; // Filter unknown

  const category = program.category;
  return registry.categories[category]?.should_filter ?? true;
}
```

## Public Sharing

After pushing to GitHub, share via:
```
https://raw.githubusercontent.com/nydiokar/c_follow/main/src/data/solana_program_registry.json
```

## Cron Setup

Already configured to run weekly (Monday 9 AM):
```bash
0 9 * * 1 cd /home/cifran/dev/c_follow && npx ts-node scripts/update_program_registry.ts >> logs/program_registry_updates.log 2>&1
```
