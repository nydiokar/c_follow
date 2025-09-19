# Market Cap Tracking Implementation Plan

## Overview
Implement comprehensive market cap tracking using Jupiter API to provide accurate daily market metrics (highs, lows, averages) for the 24h mint report.

## Current State Analysis

### What We Have
- **TokenProcessor**: Runs every 3 hours, classifies tokens as clean/scam/dead using DexScreener + Jupiter
- **MintReport**: Runs daily at 09:00, fetches market data for clean tokens, reports $200K-$1.5M range
- **LongState Table**: Already has fields for h24High, h24Low, lastMcap, lastUpdatedUtc
- **Job Queue**: Existing infrastructure in `jobQueue.ts`

### The Problem
- Current mint report only shows market cap at time of discovery
- No historical tracking of daily highs/lows/ranges
- Missing the "macro picture" of market performance

## Proposed Solution

### Jupiter API Advantages
```json
{
  "mcap": 77275352037.79674,
  "stats5m": { "priceChange": 0.021 },
  "stats1h": { "priceChange": -0.145 },
  "stats6h": { "priceChange": 0.379 },
  "stats24h": { "priceChange": 1.507 }
}
```

**Benefits over DexScreener:**
- Granular time periods (5m, 1h, 6h, 24h)
- Better price change tracking
- 100 tokens per request (vs 50 for DexScreener)
- Rate limit: 60 RPM = 6,000 tokens/minute

## Implementation Plan

### Phase 1: Standalone Service (Testing) ⚠️ LOW RISK

#### 1.1 Create MarketCapTracker Service
**File:** `src/services/marketCapTracker.ts`

```typescript
export class MarketCapTracker {
  private jupiter: JupiterTokenService;
  private rateLimiter: RateLimiter; // 60 RPM limit
  
  async updateMarketCapData(tokenAddresses: string[]): Promise<void> {
    // Batch process 100 tokens per request
    // Calculate highs/lows from price changes
    // Store in LongState table
  }
  
  private calculateHistoricalRange(currentMcap: number, priceChanges: PriceStats): {
    estimatedHigh: number;
    estimatedLow: number;
  } {
    // Use Jupiter's price change data to estimate daily range
  }
}
```

#### 1.2 Test Jupiter API Integration
**File:** `test-jupiter-mcap.ts`

```typescript
// Test with 10 clean tokens
// Verify response format matches expected structure  
// Test rate limiting (60 RPM)
// Validate market cap calculations
```

#### 1.3 Database Schema Update (Optional)
**Option A:** Use existing LongState table
- Reuse h24High, h24Low, lastMcap fields
- Add lastJupiterUpdate timestamp

**Option B:** New MarketCapHistory table
```sql
CREATE TABLE market_cap_history (
  id INTEGER PRIMARY KEY,
  coin_id INTEGER,
  timestamp INTEGER,
  current_mcap REAL,
  estimated_24h_high REAL,
  estimated_24h_low REAL,
  price_change_24h REAL,
  updated_at INTEGER
);
```

### Phase 2: Job Queue Integration ⚠️ MEDIUM RISK

#### 2.1 Add Market Cap Job Type
**File:** `src/services/jobQueue.ts`

```typescript
export enum JobType {
  // ... existing types
  UPDATE_MARKET_CAP = 'UPDATE_MARKET_CAP'
}

interface UpdateMarketCapJob {
  type: JobType.UPDATE_MARKET_CAP;
  tokenAddresses: string[];
  batchSize: number; // 100
}
```

#### 2.2 Job Processing Logic
```typescript
// Queue processes 100 tokens every second (to respect 60 RPM)
// Handles failures with retry logic
// Updates LongState records
// Logs progress and errors
```

### Phase 3: TokenProcessor Integration ⚠️ HIGH RISK

#### 3.1 Modify TokenProcessor
**File:** `src/services/tokenProcessor.ts`

```typescript
async runIncrementalProcessing(): Promise<void> {
  // ... existing classification logic ...
  
  // NEW: Queue market cap updates for clean tokens
  const cleanTokenAddresses = cleanTokens.map(t => t.address);
  if (cleanTokenAddresses.length > 0) {
    await this.jobQueue.addJob({
      type: JobType.UPDATE_MARKET_CAP,
      tokenAddresses: cleanTokenAddresses,
      batchSize: 100
    });
  }
}
```

### Phase 4: MintReport Integration ⚠️ HIGH RISK

#### 4.1 Modify MintReport Data Source
**File:** `src/services/mintReport.ts`

**Current:**
```typescript
// Fetches live data from DexScreener for all tokens
const results = await this.dexScreener.batchGetTokens(requests);
```

**New:**
```typescript
// Read accumulated data from LongState
const marketCapOverview = await this.getMarketCapOverview(tokenAddresses);
// Still fetch live data for detailed token list (filtered $200K-$1.5M)
```

#### 4.2 Enhanced Market Cap Overview
```typescript
async getMarketCapOverview(tokenAddresses: string[]): Promise<MarketCapOverview> {
  const longStates = await prisma.longState.findMany({
    where: { 
      coin: { tokenAddress: { in: tokenAddresses } },
      lastUpdatedUtc: { gte: last24Hours }
    }
  });
  
  return {
    totalTokens: longStates.length,
    avgMarketCap: calculateAverage(longStates.map(s => s.lastMcap)),
    medianMarketCap: calculateMedian(longStates.map(s => s.lastMcap)),
    maxMarketCapReached: Math.max(...longStates.map(s => s.h24High)),
    minMarketCapReached: Math.min(...longStates.map(s => s.h24Low))
  };
}
```

## Files That Need Changes

### New Files
- `src/services/marketCapTracker.ts` - Core service
- `test-jupiter-mcap.ts` - Testing script
- `docs/mc_update.md` - This document

### Modified Files
- `src/services/jobQueue.ts` - Add new job type
- `src/services/tokenProcessor.ts` - Queue market cap jobs
- `src/services/mintReport.ts` - Read from LongState instead of live API

### Database Changes
- Either use existing LongState table or create new MarketCapHistory table
- Add indexes for efficient queries

## Risk Assessment

### Phase 1 (LOW RISK)
- ✅ No changes to existing systems
- ✅ Can test independently
- ✅ Easy to rollback

### Phase 2 (MEDIUM RISK)
- ⚠️ Adds new job processing load
- ⚠️ Database writes increase
- ✅ Doesn't affect existing functionality

### Phase 3-4 (HIGH RISK)
- 🚨 Modifies core TokenProcessor
- 🚨 Changes MintReport data flow
- 🚨 Could break existing reports

## Testing Strategy

### Phase 1 Testing
1. Test Jupiter API with 10 tokens
2. Verify rate limiting works
3. Test market cap calculations
4. Validate data storage

### Integration Testing
1. Run parallel to existing system
2. Compare results between old/new approach
3. Monitor for data discrepancies
4. Validate performance impact

### Rollback Plan
1. Feature flags for new functionality
2. Ability to fall back to DexScreener
3. Database rollback scripts
4. Monitoring and alerting

## Success Metrics

### Data Quality
- Market cap estimates within 10% of actual values
- 95% successful token processing rate
- No data gaps longer than 6 hours

### Performance
- Job processing completes within 30 minutes for 10K tokens
- No impact on existing TokenProcessor performance
- MintReport generation time < 5 minutes

### System Health
- Rate limits respected (stay under 60 RPM)
- No increase in error rates
- Database performance maintained

## Timeline

### Week 1: Phase 1 (Standalone Testing)
- Build MarketCapTracker service
- Test Jupiter API integration
- Validate calculations

### Week 2: Phase 2 (Job Queue)
- Integrate with job queue
- Test batch processing
- Monitor performance

### Week 3: Phase 3-4 (Integration)
- Modify TokenProcessor
- Update MintReport
- End-to-end testing

### Week 4: Monitoring & Optimization
- Performance tuning
- Bug fixes
- Documentation updates

## Questions to Resolve

1. **Database Choice**: Use existing LongState or create new table?
2. **Job Scheduling**: Every 3 hours with TokenProcessor or independent schedule?
3. **Failure Handling**: How to handle Jupiter API failures?
4. **Data Retention**: How long to keep historical market cap data?
5. **Monitoring**: What alerts/dashboards do we need?

## Next Steps

1. **Create test script** to validate Jupiter API response format
2. **Choose database schema** (LongState vs new table)
3. **Build standalone MarketCapTracker** service
4. **Test with small batch** of tokens
5. **Get approval** before proceeding to integration phases