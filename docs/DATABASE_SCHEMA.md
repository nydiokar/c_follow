# Follow Coin Bot - Database Schema Documentation

## Overview

The Follow Coin Bot uses SQLite with Prisma ORM for data persistence. The database is optimized for high-frequency cryptocurrency tracking with proper indexing, WAL mode for performance, and comprehensive relationship modeling.

## Database Configuration

### SQLite Optimizations
- **WAL Mode**: Write-Ahead Logging for concurrent read/write operations
- **Automatic Checkpointing**: Optimized checkpoint intervals
- **Connection Pooling**: Singleton pattern prevents connection leaks
- **Indexed Queries**: Strategic indexing for performance-critical operations

### Prisma Configuration
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}
```

## Core Tables

### 1. Coin Table
**Purpose**: Master registry of all tracked cryptocurrencies

```sql
CREATE TABLE coin (
  coin_id INTEGER PRIMARY KEY AUTOINCREMENT,
  chain VARCHAR NOT NULL,
  pair_address VARCHAR NOT NULL,
  symbol VARCHAR NOT NULL,
  name VARCHAR,
  decimals INTEGER,
  is_active BOOLEAN NOT NULL DEFAULT 1
);

-- Indexes
CREATE UNIQUE INDEX coin_chain_pair_address_key ON coin(chain, pair_address);
CREATE INDEX coin_symbol_idx ON coin(symbol);
CREATE INDEX coin_is_active_idx ON coin(is_active);
```

**Fields:**
- `coin_id`: Primary key, auto-increment
- `chain`: Blockchain identifier (e.g., "solana", "ethereum")
- `pair_address`: Unique trading pair address on blockchain
- `symbol`: Trading symbol (e.g., "SOL", "BTC", "MEME")
- `name`: Full cryptocurrency name (optional)
- `decimals`: Token decimal places (optional)
- `is_active`: Soft delete flag for coin removal

**Relationships:**
- One-to-one with `LongWatch` (optional)
- One-to-one with `LongState` (optional)
- One-to-many with `HotEntry`
- One-to-many with `AlertHistory`
- One-to-many with `SymbolAlias`
- One-to-many with `RollingDataPoint`

**Example Data:**
```sql
INSERT INTO coin (chain, pair_address, symbol, name, decimals, is_active) 
VALUES ('solana', '5P8gyFpfXrsDKzkkd8YbRR8Aw9yStN1B3TtEk7R8pump', 'MEME', 'Meme Coin', 9, 1);
```

### 2. LongWatch Table
**Purpose**: Configuration for long-term cryptocurrency monitoring

```sql
CREATE TABLE long_watch (
  coin_id INTEGER PRIMARY KEY,
  added_at_utc INTEGER NOT NULL,
  retrace_on BOOLEAN NOT NULL DEFAULT 1,
  stall_on BOOLEAN NOT NULL DEFAULT 1,
  breakout_on BOOLEAN NOT NULL DEFAULT 1,
  mcap_on BOOLEAN NOT NULL DEFAULT 0,
  retrace_pct REAL NOT NULL DEFAULT 15.0,
  stall_vol_pct REAL NOT NULL DEFAULT 30.0,
  stall_band_pct REAL NOT NULL DEFAULT 5.0,
  breakout_pct REAL NOT NULL DEFAULT 12.0,
  breakout_vol_x REAL NOT NULL DEFAULT 1.5,
  mcap_levels VARCHAR,
  notes VARCHAR,
  FOREIGN KEY (coin_id) REFERENCES coin(coin_id) ON DELETE CASCADE
);
```

**Configuration Fields:**
- `retrace_on`: Enable retracement alerts (price drops from 72h high)
- `stall_on`: Enable stall detection (low volume + price compression)
- `breakout_on`: Enable breakout alerts (price + volume momentum)
- `mcap_on`: Enable market cap milestone alerts
- `retrace_pct`: Retracement percentage threshold (default 15%)
- `stall_vol_pct`: Volume drop threshold for stalls (default 30%)
- `stall_band_pct`: Price compression band (default 5%)
- `breakout_pct`: Price increase for breakout (default 12%)
- `breakout_vol_x`: Volume multiplier for breakout (default 1.5x)
- `mcap_levels`: JSON string of market cap milestone levels
- `notes`: User notes for the coin

**Example Configuration:**
```sql
INSERT INTO long_watch (coin_id, added_at_utc, retrace_pct, breakout_pct, mcap_levels) 
VALUES (1, 1703462400, 20.0, 15.0, '[1000000, 5000000, 10000000]');
```

### 3. LongState Table
**Purpose**: Current state tracking for long list coins

```sql
CREATE TABLE long_state (
  coin_id INTEGER PRIMARY KEY,
  h12_high REAL,
  h24_high REAL,
  h72_high REAL,
  h12_low REAL,
  h24_low REAL,
  h72_low REAL,
  v12_sum REAL,
  v24_sum REAL,
  last_price REAL,
  last_mcap REAL,
  last_updated_utc INTEGER NOT NULL,
  last_retrace_fire_utc INTEGER,
  last_stall_fire_utc INTEGER,
  last_breakout_fire_utc INTEGER,
  last_mcap_fire_utc INTEGER,
  FOREIGN KEY (coin_id) REFERENCES coin(coin_id) ON DELETE CASCADE
);

-- Index for efficient updates
CREATE INDEX long_state_last_updated_utc_idx ON long_state(last_updated_utc);
```

**State Fields:**
- `h12_high/h24_high/h72_high`: Rolling high prices over 12/24/72 hours
- `h12_low/h24_low/h72_low`: Rolling low prices over 12/24/72 hours
- `v12_sum/v24_sum`: Rolling volume sums over 12/24 hours
- `last_price/last_mcap`: Most recent price and market cap
- `last_updated_utc`: Timestamp of last data update
- `last_*_fire_utc`: Timestamps of last trigger fires (for cooldowns)

### 4. HotEntry Table
**Purpose**: Short-term alert configurations with anchor prices

```sql
CREATE TABLE hot_entry (
  hot_id INTEGER PRIMARY KEY AUTOINCREMENT,
  coin_id INTEGER NOT NULL,
  added_at_utc INTEGER NOT NULL,
  anchor_price REAL NOT NULL,
  anchor_mcap REAL,
  pct_target REAL,
  mcap_targets VARCHAR,
  failsafe_fired BOOLEAN NOT NULL DEFAULT 0,
  FOREIGN KEY (coin_id) REFERENCES coin(coin_id) ON DELETE CASCADE
);

CREATE INDEX hot_entry_coin_id_idx ON hot_entry(coin_id);
```

**Fields:**
- `anchor_price`: Reference price for percentage calculations
- `anchor_mcap`: Reference market cap (optional)
- `pct_target`: Percentage target for alerts (e.g., +25%, -10%)
- `mcap_targets`: JSON array of market cap milestone targets
- `failsafe_fired`: Whether 60% drawdown alert has been triggered

**Example:**
```sql
INSERT INTO hot_entry (coin_id, added_at_utc, anchor_price, pct_target, mcap_targets) 
VALUES (1, 1703462400, 0.5, 25.0, '[100000, 500000, 1000000]');
```

### 5. HotTriggerState Table
**Purpose**: Tracking fired triggers for hot list entries

```sql
CREATE TABLE hot_trigger_state (
  hot_id INTEGER NOT NULL,
  trig_kind VARCHAR NOT NULL,
  trig_value REAL NOT NULL,
  fired BOOLEAN NOT NULL DEFAULT 0,
  PRIMARY KEY (hot_id, trig_kind, trig_value),
  FOREIGN KEY (hot_id) REFERENCES hot_entry(hot_id) ON DELETE CASCADE
);
```

**Fields:**
- `trig_kind`: Type of trigger ("pct" or "mcap")
- `trig_value`: Specific trigger value
- `fired`: Whether this trigger has been activated

**Example:**
```sql
INSERT INTO hot_trigger_state (hot_id, trig_kind, trig_value, fired) 
VALUES (1, 'pct', 25.0, 0), (1, 'mcap', 1000000.0, 0);
```

## Supporting Tables

### 6. AlertHistory Table
**Purpose**: Complete audit trail of all alerts sent

```sql
CREATE TABLE alert_history (
  alert_id INTEGER PRIMARY KEY AUTOINCREMENT,
  hot_id INTEGER,
  coin_id INTEGER NOT NULL,
  ts_utc INTEGER NOT NULL,
  kind VARCHAR NOT NULL,
  payload_json VARCHAR NOT NULL,
  fingerprint VARCHAR NOT NULL UNIQUE,
  FOREIGN KEY (coin_id) REFERENCES coin(coin_id) ON DELETE CASCADE,
  FOREIGN KEY (hot_id) REFERENCES hot_entry(hot_id) ON DELETE SET NULL
);

CREATE INDEX alert_history_coin_id_ts_utc_idx ON alert_history(coin_id, ts_utc);
```

**Fields:**
- `kind`: Alert type ("retrace", "stall", "breakout", "mcap", "hot_pct", "hot_mcap", "failsafe")
- `payload_json`: Complete alert data in JSON format
- `fingerprint`: Unique hash for deduplication
- `ts_utc`: Alert timestamp

### 7. RollingDataPoint Table
**Purpose**: Historical price and volume data for analysis

```sql
CREATE TABLE rolling_data_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  coin_id INTEGER NOT NULL,
  timestamp INTEGER NOT NULL,
  price REAL NOT NULL,
  volume REAL NOT NULL,
  market_cap REAL,
  FOREIGN KEY (coin_id) REFERENCES coin(coin_id) ON DELETE CASCADE
);

CREATE INDEX rolling_data_points_coin_id_timestamp_idx ON rolling_data_points(coin_id, timestamp);
```

**Data Management:**
- Automatic cleanup of data older than 72 hours
- Efficient range queries for rolling window calculations
- Bulk insert optimizations for high-frequency updates

### 8. Outbox Table
**Purpose**: Message delivery queue with retry logic

```sql
CREATE TABLE outbox (
  outbox_id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts_utc INTEGER NOT NULL,
  chat_id VARCHAR NOT NULL,
  message_text VARCHAR NOT NULL,
  fingerprint VARCHAR NOT NULL UNIQUE,
  sent_ok BOOLEAN NOT NULL DEFAULT 0,
  sent_ts_utc INTEGER
);

CREATE INDEX outbox_sent_ok_ts_utc_idx ON outbox(sent_ok, ts_utc);
```

**Message Processing:**
- Priority-based delivery ordering
- Deduplication via fingerprint hashing
- Retry logic for failed deliveries
- Delivery confirmation tracking

### 9. ScheduleCfg Table
**Purpose**: System configuration and scheduling parameters

```sql
CREATE TABLE schedule_cfg (
  cfg_id INTEGER PRIMARY KEY DEFAULT 1,
  anchor_times_local VARCHAR NOT NULL,
  anchor_period_hours INTEGER NOT NULL DEFAULT 12,
  long_checkpoint_hours INTEGER NOT NULL DEFAULT 6,
  hot_interval_minutes INTEGER NOT NULL DEFAULT 5,
  cooldown_hours REAL NOT NULL DEFAULT 2.0,
  hysteresis_pct REAL NOT NULL DEFAULT 30.0
);
```

**Configuration Options:**
- `anchor_times_local`: Cron expressions for anchor reports
- `anchor_period_hours`: Hours between anchor reports
- `long_checkpoint_hours`: Hours between long list checks
- `hot_interval_minutes`: Minutes between hot list checks
- `cooldown_hours`: Cooldown period between duplicate alerts
- `hysteresis_pct`: Hysteresis percentage for trigger sensitivity

### 10. SymbolAlias Table
**Purpose**: Alternative symbol mappings for user convenience

```sql
CREATE TABLE symbol_alias (
  alias VARCHAR PRIMARY KEY,
  coin_id INTEGER NOT NULL,
  FOREIGN KEY (coin_id) REFERENCES coin(coin_id) ON DELETE CASCADE
);
```

**Usage Examples:**
- Map "SOL" → Solana coin_id
- Map "BTC" → Bitcoin coin_id  
- Map user-friendly names to technical symbols

### 11. Migration Table
**Purpose**: Database version control and migration tracking

```sql
CREATE TABLE migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name VARCHAR NOT NULL UNIQUE,
  executed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

## Relationship Diagram

```
                    ┌─────────────┐
                    │    Coin     │ (Master Table)
                    │  coin_id    │
                    │   symbol    │
                    │  chain      │
                    │pair_address │
                    └──────┬──────┘
                           │
                           │ (1:1)
                ┌──────────┼──────────┐
                │          │          │
          ┌─────▼────┐    │    ┌─────▼────┐
          │LongWatch │    │    │LongState │
          │ (config) │    │    │ (state)  │
          └──────────┘    │    └──────────┘
                          │
                          │ (1:many)
                    ┌─────▼─────┐
                    │ HotEntry  │
                    │ hot_id    │
                    │anchor_price│
                    └─────┬─────┘
                          │
                          │ (1:many)
                    ┌─────▼─────┐
                    │HotTrigger │
                    │  State    │
                    └───────────┘

        ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
        │AlertHistory │   │RollingData  │   │SymbolAlias │
        │             │   │   Point     │   │             │
        └─────────────┘   └─────────────┘   └─────────────┘
                │                 │                 │
                └─────────────────┼─────────────────┘
                                  │
                            (All link to Coin)
```

## Query Patterns

### High-Frequency Operations

#### Rolling Window Updates
```sql
-- Insert new price data
INSERT INTO rolling_data_points (coin_id, timestamp, price, volume, market_cap) 
VALUES (?, ?, ?, ?, ?);

-- Calculate 24h high
SELECT MAX(price) FROM rolling_data_points 
WHERE coin_id = ? AND timestamp > (? - 86400);

-- Calculate 12h volume sum
SELECT SUM(volume) FROM rolling_data_points 
WHERE coin_id = ? AND timestamp > (? - 43200);
```

#### State Updates
```sql
-- Update long state with rolling calculations
UPDATE long_state SET 
  h24_high = ?, h12_high = ?, h72_high = ?,
  v24_sum = ?, v12_sum = ?,
  last_price = ?, last_mcap = ?,
  last_updated_utc = ?
WHERE coin_id = ?;
```

#### Alert Processing
```sql
-- Check for coins needing trigger evaluation
SELECT c.coin_id, c.symbol, ls.*, lw.*
FROM coin c
JOIN long_watch lw ON c.coin_id = lw.coin_id
JOIN long_state ls ON c.coin_id = ls.coin_id
WHERE c.is_active = 1 
  AND ls.last_updated_utc > (? - 3600);

-- Check alert cooldowns
SELECT COUNT(*) FROM alert_history 
WHERE coin_id = ? AND kind = ? AND ts_utc > (? - ?);
```

### Batch Operations

#### Data Cleanup
```sql
-- Remove old rolling data (older than 72 hours)
DELETE FROM rolling_data_points 
WHERE timestamp < (? - 259200);

-- Archive old alerts (older than 30 days)
DELETE FROM alert_history 
WHERE ts_utc < (? - 2592000);
```

#### Bulk Insertions
```sql
-- Batch insert price data
INSERT INTO rolling_data_points (coin_id, timestamp, price, volume, market_cap) 
VALUES 
  (1, 1703462400, 0.5, 10000, 50000),
  (2, 1703462400, 1.2, 25000, 120000),
  -- ... more rows
```

## Performance Optimizations

### Indexing Strategy

#### Primary Indexes
- **Unique constraints**: Prevent duplicate coins and ensure data integrity
- **Foreign key indexes**: Fast join operations between related tables
- **Timestamp indexes**: Efficient time-range queries

#### Query-Specific Indexes
```sql
-- For alert history queries
CREATE INDEX alert_history_kind_ts_idx ON alert_history(kind, ts_utc);

-- For active coin lookups
CREATE INDEX coin_active_symbol_idx ON coin(is_active, symbol);

-- For rolling data cleanup
CREATE INDEX rolling_data_timestamp_idx ON rolling_data_points(timestamp);
```

### Connection Management

#### Singleton Pattern
```typescript
class DatabaseManager {
  private static instance: PrismaClient | null = null;
  
  static async initialize() {
    if (!this.instance) {
      this.instance = new PrismaClient({
        datasources: { db: { url: process.env.DATABASE_URL } },
        log: ['query', 'info', 'warn', 'error']
      });
    }
    return this.instance;
  }
}
```

#### Connection Pool Configuration
- **Max connections**: 10 (single-instance deployment)
- **Connection timeout**: 30 seconds
- **Idle timeout**: 300 seconds
- **Statement timeout**: 60 seconds

### Transaction Management

#### Bulk Operations
```typescript
await prisma.$transaction(async (tx) => {
  // Update state
  await tx.longState.update({
    where: { coinId },
    data: newState
  });
  
  // Insert rolling data
  await tx.rollingDataPoint.createMany({
    data: rollingData
  });
  
  // Record alert
  await tx.alertHistory.create({
    data: alertData
  });
});
```

#### Error Handling
- Automatic retry on deadlock
- Transaction rollback on failure
- Connection recovery on disconnect

## Data Retention Policies

### Rolling Data Points
- **Retention**: 72 hours for long list analysis
- **Cleanup frequency**: Every 6 hours
- **Cleanup batch size**: 1000 records per operation

### Alert History
- **Retention**: 30 days for audit trail
- **Cleanup frequency**: Daily
- **Archive process**: Export to JSON before deletion

### Outbox Messages
- **Retention**: 7 days for delivery confirmation
- **Cleanup frequency**: Daily
- **Failed message retry**: 3 attempts with exponential backoff

## Backup and Recovery

### Backup Strategy
- **Full backup**: Daily SQLite file copy
- **Incremental backup**: WAL file preservation
- **Compression**: Gzip for space efficiency
- **Validation**: Integrity check after backup

### Recovery Procedures
- **Point-in-time recovery**: WAL replay to specific timestamp
- **Corruption recovery**: Backup restoration with data loss notification
- **Migration recovery**: Rollback to previous schema version

### Monitoring
- **Database size**: Monitor for unexpected growth
- **Query performance**: Log slow queries (>1 second)
- **Connection health**: Monitor connection pool utilization
- **Error rates**: Track database error frequency