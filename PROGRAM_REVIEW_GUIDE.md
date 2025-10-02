# Program Registry Review Guide

## How to Review Programs

When the GitHub Action creates a PR with new programs, follow this guide to classify them.

### Categories

| Category | Description | Should Filter? | Examples |
|----------|-------------|----------------|----------|
| `system` | Core Solana infrastructure | ✅ Yes | SPL Token, System Program, Compute Budget |
| `dex_amm` | DEXs and liquidity pools | ✅ Yes | Raydium, Orca, Jupiter |
| `token_launchpad` | Token creation platforms | ❌ No | Pump.fun, Moonshot |
| `nft` | NFT-related programs | ✅ Yes | Metaplex, Magic Eden |
| `unknown` | Unclassified | ✅ Yes (default) | Pending investigation |

### Review Process

1. **Open the PR** created by GitHub Action
2. **Check `pending_review` section** in `src/data/program_registry.json`
3. **For each program:**
   - Click the `solscan_url` link
   - Check program name, description, and transaction history
   - Determine category
   - Move to `programs` section with classification

### Review Template

```json
"PROGRAM_ID_HERE": {
  "name": "Program Name from Solscan",
  "category": "token_launchpad",
  "verified": "manual",
  "verified_date": "2025-10-02",
  "notes": "Optional: any relevant info",
  "count": 1234,
  "sources": ["PUMP_FUN"],
  "sample_tx": "..."
}
```

### Quick Identification Tips

**Token Launchpad** (KEEP):
- Programs with names like "pump", "moon", "launch", "creator"
- High frequency in token mints
- Associated with new token creation

**DEX/AMM** (FILTER):
- Names containing "swap", "pool", "liquidity", "amm", "dex"
- Associated with trading activity
- Often paired with other DEX programs

**System** (FILTER):
- Official Solana program names
- Very high transaction counts
- Generic infrastructure

**Unknown** (FILTER by default):
- Can't determine purpose
- Low frequency (<10 transactions)
- Mark as unknown and revisit later

### Example Review Session

```bash
# 1. View pending programs
cat src/data/program_registry.json | jq '.pending_review[] | {programId, count, solscan_url}'

# 2. For each program, visit Solscan and classify

# 3. Edit src/data/program_registry.json
# Move classified programs from pending_review to programs

# 4. Verify JSON is valid
cat src/data/program_registry.json | jq . > /dev/null && echo "Valid JSON"

# 5. Commit and push to the PR branch
git add src/data/program_registry.json
git commit -m "Classified N programs"
git push
```

### Frequency Matters

- **High frequency (>1000)**: Priority review - likely important
- **Medium (100-1000)**: Review when possible
- **Low (<100)**: Can skip for now, revisit later

### When in Doubt

If you're unsure about a program:
1. Mark it as `category: "unknown"`
2. Set `verified: "needs_investigation"`
3. Come back to it later when you have more context
