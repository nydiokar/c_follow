# Follow Coin Bot - API Documentation

## Overview

This document provides comprehensive API documentation for all services and methods in the Follow Coin Bot system. The API is organized into service layers with clear interfaces and consistent error handling.

## Service Architecture

### Core Services
- **DatabaseService**: Database operations and transaction management
- **DexScreenerService**: External API integration for cryptocurrency data
- **LongListService**: Long-term cryptocurrency monitoring and alerts
- **HotListService**: Short-term price movement alerts
- **TelegramService**: User interface and notification delivery

### Background Services
- **JobQueue**: Asynchronous task processing
- **SchedulerService**: Cron-based task scheduling
- **HealthMonitor**: System health tracking
- **RateLimitService**: API rate limiting and abuse prevention

## Database Service API

### Interface: `DatabaseService`

#### Core Methods

##### `initialize(): Promise<void>`
Initializes the database connection and performs setup operations.

**Example:**
```typescript
const db = new DatabaseService();
await db.initialize();
```

**Throws:**
- `DatabaseError`: Connection or setup failure

##### `disconnect(): Promise<void>`
Cleanly closes database connections.

**Example:**
```typescript
await db.disconnect();
```

##### `addCoin(chain: string, tokenAddress: string, symbol: string, name?: string): Promise<Coin>`
Adds a new cryptocurrency to the system.

**Parameters:**
- `chain`: Blockchain identifier (e.g., "solana", "ethereum")
- `tokenAddress`: Unique pair address on the blockchain
- `symbol`: Trading symbol (e.g., "SOL", "BTC")
- `name`: Optional full name of the cryptocurrency

**Returns:** `Promise<Coin>` - Created coin object

**Example:**
```typescript
const coin = await db.addCoin(
  "solana", 
  "5P8gyFpfXrsDKzkkd8YbRR8Aw9yStN1B3TtEk7R8pump", 
  "MEME", 
  "Meme Coin"
);
```

**Throws:**
- `ValidationError`: Invalid parameters
- `DuplicateError`: Coin already exists
- `DatabaseError`: Database operation failure

##### `getCoinBySymbol(symbol: string): Promise<Coin | null>`
Retrieves a coin by its trading symbol.

**Parameters:**
- `symbol`: Trading symbol to search for

**Returns:** `Promise<Coin | null>` - Found coin or null

**Example:**
```typescript
const coin = await db.getCoinBySymbol("SOL");
if (coin) {
  console.log(`Found coin: ${coin.name}`);
}
```

##### `addLongWatch(coinId: number, config: Partial<TriggerConfig>): Promise<LongWatch>`
Adds a coin to the long list monitoring system.

**Parameters:**
- `coinId`: Database ID of the coin
- `config`: Trigger configuration object

**Configuration Options:**
```typescript
interface TriggerConfig {
  retraceOn: boolean;        // Enable retracement alerts
  stallOn: boolean;          // Enable stall detection
  breakoutOn: boolean;       // Enable breakout alerts
  mcapOn: boolean;           // Enable market cap alerts
  retracePct: number;        // Retracement percentage (default: 15%)
  stallVolPct: number;       // Stall volume threshold (default: 30%)
  stallBandPct: number;      // Stall price band (default: 5%)
  breakoutPct: number;       // Breakout percentage (default: 12%)
  breakoutVolX: number;      // Volume multiplier (default: 1.5x)
  mcapLevels: number[];      // Market cap milestone levels
}
```

**Example:**
```typescript
const longWatch = await db.addLongWatch(coinId, {
  retraceOn: true,
  retracePct: 20,
  breakoutOn: true,
  breakoutPct: 15,
  mcapLevels: [1000000, 5000000, 10000000]
});
```

##### `removeLongWatch(coinId: number): Promise<boolean>`
Removes a coin from long list monitoring.

**Returns:** `Promise<boolean>` - Success status

##### `addHotEntry(coinId: number, anchorPrice: number, options: HotEntryOptions): Promise<HotEntry>`
Adds a coin to the hot list for quick alerts.

**Parameters:**
- `coinId`: Database ID of the coin
- `anchorPrice`: Reference price for percentage calculations
- `options`: Hot list configuration

**Options Interface:**
```typescript
interface HotEntryOptions {
  pctTarget?: number;        // Percentage target (e.g., +5, -10)
  mcapTargets?: number[];    // Market cap milestone targets
  anchorMcap?: number;       // Reference market cap
}
```

**Example:**
```typescript
const hotEntry = await db.addHotEntry(coinId, 0.5, {
  pctTarget: 25,
  mcapTargets: [100000, 500000, 1000000],
  anchorMcap: 50000
});
```

## DexScreener Service API

### Interface: `DexScreenerService`

#### Core Methods

##### `constructor(rateLimitMs: number)`
Creates a new DexScreener service instance with rate limiting.

**Parameters:**
- `rateLimitMs`: Minimum milliseconds between API calls

##### `fetchPairInfo(chain: string, tokenAddress: string): Promise<PairInfo>`
Fetches current price and volume data for a trading pair.

**Parameters:**
- `chain`: Blockchain identifier
- `tokenAddress`: Trading pair address

**Returns:** `Promise<PairInfo>` - Current pair information

**PairInfo Interface:**
```typescript
interface PairInfo {
  chainId: string;
  tokenAddress: string;
  baseToken: {
    address: string;
    name: string;
    symbol: string;
  };
  priceUsd: string;
  volume: {
    h24: number;
    h6: number;
    h1: number;
    m5: number;
  };
  marketCap?: number;
  liquidity?: {
    usd: number;
    base: number;
    quote: number;
  };
  fdv?: number;
  pairCreatedAt?: number;
}
```

**Example:**
```typescript
const dexScreener = new DexScreenerService(200);
const pairInfo = await dexScreener.fetchPairInfo(
  "solana", 
  "5P8gyFpfXrsDKzkkd8YbRR8Aw9yStN1B3TtEk7R8pump"
);
console.log(`Current price: $${pairInfo.priceUsd}`);
console.log(`24h volume: $${pairInfo.volume.h24}`);
```

**Throws:**
- `RateLimitError`: API rate limit exceeded
- `NetworkError`: Network connectivity issues
- `ValidationError`: Invalid pair address
- `NotFoundError`: Pair not found on DexScreener

##### `fetchMultiplePairs(requests: PairRequest[]): Promise<PairInfo[]>`
Batch fetch multiple pairs in a single request (when supported).

**Parameters:**
- `requests`: Array of pair requests

**Example:**
```typescript
const pairs = await dexScreener.fetchMultiplePairs([
  { chain: "solana", tokenAddress: "addr1" },
  { chain: "solana", tokenAddress: "addr2" }
]);
```

##### `isServiceAvailable(): Promise<boolean>`
Checks if the DexScreener API is accessible.

**Returns:** `Promise<boolean>` - Service availability status

## Long List Service API

### Interface: `LongListService`

#### Core Methods

##### `constructor(db: DatabaseService, dexScreener: DexScreenerService, rollingWindow: RollingWindowManager)`

##### `addCoin(symbol: string, chain: string, tokenAddress: string, config?: Partial<TriggerConfig>): Promise<void>`
Adds a coin to long list monitoring with optional configuration.

**Example:**
```typescript
await longList.addCoin("MEME", "solana", "5P8g...", {
  retracePct: 20,
  breakoutPct: 15,
  mcapLevels: [1000000, 5000000]
});
```

##### `removeCoin(symbol: string): Promise<boolean>`
Removes a coin from long list monitoring.

##### `updateTriggerConfig(symbol: string, config: Partial<TriggerConfig>): Promise<void>`
Updates trigger configuration for a monitored coin.

**Example:**
```typescript
await longList.updateTriggerConfig("MEME", {
  retracePct: 25,
  stallOn: false
});
```

##### `checkTriggers(): Promise<TriggerResult[]>`
Evaluates all long list coins for trigger conditions.

**Returns:** `Promise<TriggerResult[]>` - Array of triggered alerts

**TriggerResult Interface:**
```typescript
interface TriggerResult {
  coinId: number;
  symbol: string;
  triggerType: 'retrace' | 'stall' | 'breakout' | 'mcap';
  message: string;
  currentPrice: number;
  currentMcap?: number;
  data: {
    retracePct?: number;
    h72High?: number;
    volumeRatio?: number;
    priceBreakout?: number;
    mcapLevel?: number;
  };
  timestamp: number;
}
```

##### `getAnchorReport(): Promise<AnchorReportData>`
Generates comprehensive status report for all long list coins.

**Returns:** `Promise<AnchorReportData>` - Current status of all monitored coins

**Example:**
```typescript
const report = await longList.getAnchorReport();
console.log(`Monitoring ${report.coins.length} coins`);
report.coins.forEach(coin => {
  console.log(`${coin.symbol}: $${coin.currentPrice} (${coin.h24Change}% 24h)`);
});
```

##### `toggleTrigger(triggerType: string, enabled: boolean): Promise<void>`
Globally enables/disables a trigger type for all long list coins.

**Parameters:**
- `triggerType`: One of 'retrace', 'stall', 'breakout', 'mcap'
- `enabled`: Whether to enable or disable the trigger

**Example:**
```typescript
// Disable all retracement alerts
await longList.toggleTrigger('retrace', false);
```

## Hot List Service API

### Interface: `HotListService`

#### Core Methods

##### `addEntry(symbol: string, chain: string, tokenAddress: string, anchorPrice: number, options: HotEntryOptions): Promise<void>`
Adds a coin to hot list for quick percentage-based alerts.

**Example:**
```typescript
await hotList.addEntry("MEME", "solana", "5P8g...", 0.5, {
  pctTarget: 25,
  mcapTargets: [100000, 500000],
  anchorMcap: 50000
});
```

##### `removeEntry(symbol: string): Promise<boolean>`
Removes a coin from hot list monitoring.

##### `checkAlerts(): Promise<HotAlert[]>`
Evaluates all hot list entries for alert conditions.

**Returns:** `Promise<HotAlert[]>` - Array of triggered alerts

**HotAlert Interface:**
```typescript
interface HotAlert {
  hotId: number;
  symbol: string;
  alertType: 'pct' | 'mcap' | 'failsafe';
  message: string;
  currentPrice: number;
  currentMcap: number;
  deltaFromAnchor: number;
  targetValue?: number;
  timestamp: number;
}
```

##### `getActiveEntries(): Promise<HotListEntry[]>`
Retrieves all active hot list entries with current status.

**Example:**
```typescript
const entries = await hotList.getActiveEntries();
entries.forEach(entry => {
  console.log(`${entry.symbol}: Anchor $${entry.anchorPrice}, Target ${entry.pctTarget}%`);
});
```

##### `getAlertHistory(limit: number = 50): Promise<HotAlert[]>`
Retrieves recent hot list alert history.

## Telegram Service API

### Interface: `TelegramService`

#### Core Methods

##### `constructor(token: string, chatId: string, db: DatabaseService, longList: LongListService, hotList: HotListService)`

##### Command Handlers

All commands return `Promise<void>` and send responses via Telegram.

##### `/start` - System Welcome
Shows welcome message and system overview.

##### `/help` - Command Reference
Displays complete command reference with examples.

##### `/long_add <symbol>` - Add to Long List
**Usage:** `/long_add MEME`
**Description:** Adds a coin to long-term monitoring with default settings.

##### `/long_rm <symbol>` - Remove from Long List
**Usage:** `/long_rm MEME`
**Description:** Removes a coin from long list monitoring.

##### `/long_trigger <type> <on|off>` - Toggle Triggers
**Usage:** `/long_trigger retrace off`
**Description:** Globally enables/disables trigger types.
**Types:** retrace, stall, breakout, mcap

##### `/long_set <symbol> <param>=<value>` - Configure Settings
**Usage:** `/long_set MEME retrace=20 breakout=15`
**Description:** Updates trigger configuration for specific coin.
**Parameters:**
- `retrace=<pct>`: Retracement percentage
- `stall=<on|off>`: Stall detection
- `breakout=<pct>`: Breakout percentage  
- `mcap=<level1,level2>`: Market cap levels

##### `/hot_add <symbol> [pct=±X] [mcap=X,Y]` - Add to Hot List
**Usage:** `/hot_add MEME pct=25 mcap=100000,500000`
**Description:** Adds quick percentage-based alerts.

##### `/hot_rm <symbol>` - Remove from Hot List
**Usage:** `/hot_rm MEME`

##### `/hot_list` - Show Hot List
Displays all active hot list entries with current status.

##### `/alerts` - Recent Hot Alerts
Shows recent hot list alert history.

##### `/report_now` - Generate Anchor Report
Forces immediate generation of long list status report.

#### Alert Methods

##### `sendTriggerAlert(alert: TriggerResult): Promise<void>`
Sends formatted long list trigger alert.

##### `sendHotAlert(alert: HotAlert): Promise<void>`
Sends formatted hot list alert.

##### `sendSystemAlert(message: string, priority: 'low' | 'medium' | 'high'): Promise<void>`
Sends system status or error alerts.

## Job Queue API

### Interface: `JobQueue`

#### Core Methods

##### `addJob(type: string, data: any, options?: JobOptions): Promise<string>`
Adds a new job to the processing queue.

**Parameters:**
- `type`: Job type identifier
- `data`: Job payload data
- `options`: Job processing options

**JobOptions Interface:**
```typescript
interface JobOptions {
  priority?: number;        // Higher number = higher priority
  delay?: number;          // Delay in milliseconds
  maxAttempts?: number;    // Maximum retry attempts
  backoff?: 'fixed' | 'exponential';
}
```

**Example:**
```typescript
const jobId = await jobQueue.addJob('backfill_coin', {
  coinId: 123,
  chain: 'solana',
  tokenAddress: '5P8g...'
}, {
  priority: 5,
  maxAttempts: 3
});
```

##### `addHandler(handler: JobHandler): void`
Registers a job type handler.

**JobHandler Interface:**
```typescript
interface JobHandler {
  type: string;
  handler: (job: Job) => Promise<void>;
}
```

**Example:**
```typescript
jobQueue.addHandler({
  type: 'process_alert',
  handler: async (job) => {
    const { alertData } = job.data;
    await processAlert(alertData);
  }
});
```

##### `getStats(): JobQueueStats`
Returns current job queue statistics.

**Returns:**
```typescript
interface JobQueueStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  totalProcessed: number;
}
```

## Error Handling

All API methods use consistent error handling patterns:

### Error Types

#### `ValidationError`
Thrown when input parameters fail validation.
```typescript
throw new ValidationError('Invalid symbol format', { symbol });
```

#### `NotFoundError`
Thrown when requested resources don't exist.
```typescript
throw new NotFoundError('Coin not found', { symbol });
```

#### `RateLimitError`
Thrown when API rate limits are exceeded.
```typescript
throw new RateLimitError('DexScreener rate limit exceeded');
```

#### `NetworkError`
Thrown for network connectivity issues.
```typescript
throw new NetworkError('Failed to connect to DexScreener API');
```

#### `DatabaseError`
Thrown for database operation failures.
```typescript
throw new DatabaseError('Failed to insert coin record');
```

### Error Response Format

All errors include:
- **message**: Human-readable error description
- **code**: Machine-readable error code
- **context**: Additional error context data
- **timestamp**: Error occurrence time
- **stack**: Stack trace (development mode only)

### Retry Logic

Services implement automatic retry with exponential backoff:
- **Initial delay**: 1 second
- **Max delay**: 30 seconds
- **Max attempts**: 3 (configurable)
- **Backoff factor**: 2x

## Rate Limiting

### DexScreener API
- **Default limit**: 200ms between requests
- **Burst allowance**: 5 requests
- **Recovery rate**: 1 request per 200ms

### Telegram API
- **Message limit**: 30 messages per second
- **Global limit**: 8000 messages per day
- **Group limit**: 20 messages per minute

### Internal Services
- **Database**: Connection pool limits
- **Job queue**: Concurrent job limits
- **Alert processing**: Deduplication and cooldowns

## Authentication

### Environment Variables Required
```bash
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_CHAT_ID=your_chat_id_here
DATABASE_URL=file:./prisma/data/bot.db
```

### Security Features
- No API keys exposed in source code
- Input validation on all endpoints
- SQL injection prevention via Prisma
- Rate limiting prevents abuse
- Error messages don't expose sensitive data

## Performance Considerations

### Database Optimization
- Indexed queries for fast lookups
- Connection pooling prevents leaks
- WAL mode for concurrent operations
- Batch operations where possible

### Memory Management
- Streaming for large datasets
- Garbage collection friendly patterns
- Connection lifecycle management
- Memory leak detection

### Caching Strategy
- In-memory caching for frequently accessed data
- TTL-based cache invalidation
- Cache warming for critical data
- Circuit breaker pattern for external APIs