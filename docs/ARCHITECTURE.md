# Follow Coin Bot - System Architecture

## Overview

Follow Coin Bot is a sophisticated cryptocurrency tracking and alerting system built with TypeScript, designed for production use with enterprise-grade features. The system monitors cryptocurrency prices via DexScreener API and provides intelligent alerts through Telegram bot integration.

## Core Components

```
┌─────────────────────────────────────────────────────────────────┐
│                        Follow Coin Bot                         │
│                         (Main Application)                     │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Service Layer                             │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │   Telegram  │  │  Long List  │  │  Hot List   │            │
│  │   Service   │  │   Service   │  │   Service   │            │
│  └─────────────┘  └─────────────┘  └─────────────┘            │
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │ DexScreener │  │  Scheduler  │  │Rate Limiter │            │
│  │   Service   │  │   Service   │  │   Service   │            │
│  └─────────────┘  └─────────────┘  └─────────────┘            │
└─────────────────────────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Core Services                              │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │ Job Queue   │  │Alert Event │  │   Health    │            │
│  │  Manager    │  │    Bus      │  │  Monitor    │            │
│  └─────────────┘  └─────────────┘  └─────────────┘            │
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │ Rolling     │  │  Backfill   │  │  Migration  │            │
│  │  Window     │  │  Service    │  │   Service   │            │
│  └─────────────┘  └─────────────┘  └─────────────┘            │
└─────────────────────────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Data Layer                                   │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │ Database    │  │  Database   │  │   Prisma    │            │
│  │  Service    │  │  Manager    │  │   Client    │            │
│  └─────────────┘  └─────────────┘  └─────────────┘            │
│                                                                 │
│                 ┌─────────────────────────┐                    │
│                 │      SQLite Database    │                    │
│                 │     (WAL Mode, Indexed) │                    │
│                 └─────────────────────────┘                    │
└─────────────────────────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Utilities Layer                              │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │   Logger    │  │Error Handler│  │ Validator   │            │
│  │  (Winston)  │  │   Service   │  │  Service    │            │
│  └─────────────┘  └─────────────┘  └─────────────┘            │
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐                              │
│  │ Formatters  │  │  Type       │                              │
│  │  Utilities  │  │Definitions  │                              │
│  └─────────────┘  └─────────────┘                              │
└─────────────────────────────────────────────────────────────────┘
```

## Architecture Patterns

### 1. Event-Driven Architecture

The system uses a publisher-subscriber pattern with the Alert Event Bus:

```typescript
globalAlertBus.publish({
  type: 'long_trigger',
  data: triggerAlert,
  priority: 'high',
  timestamp: Date.now()
});
```

**Benefits:**
- Loose coupling between services
- Easy to add new alert handlers
- Reliable message delivery with retry logic
- Priority-based message processing

### 2. Singleton Pattern

Critical services use singleton pattern for resource management:

```typescript
class DatabaseManager {
  private static instance: PrismaClient | null = null;
  
  static async initialize() {
    if (!this.instance) {
      this.instance = new PrismaClient({
        datasources: { db: { url: process.env.DATABASE_URL } }
      });
    }
  }
}
```

**Benefits:**
- Prevents connection leaks
- Ensures single database connection pool
- Centralizes resource management

### 3. Circuit Breaker Pattern

API services implement circuit breakers for resilience:

```typescript
class DexScreenerService {
  private circuitBreaker = new CircuitBreaker({
    threshold: 5,
    timeout: 30000,
    resetTimeout: 60000
  });
  
  async fetchData(url: string) {
    return this.circuitBreaker.execute(() => this.httpClient.get(url));
  }
}
```

**Benefits:**
- Prevents cascade failures
- Automatic recovery from API outages
- Configurable failure thresholds

### 4. Factory Pattern

Service initialization uses factory pattern:

```typescript
class ServiceFactory {
  static async createServices(config: AppConfig) {
    const db = new DatabaseService();
    const dexScreener = new DexScreenerService(config.rateLimitMs);
    const longList = new LongListService(db, dexScreener);
    return { db, dexScreener, longList };
  }
}
```

## Data Flow Architecture

### 1. Price Data Ingestion

```
DexScreener API → Rate Limiter → Data Validator → Rolling Window → Database
```

1. **API Request**: DexScreener service fetches price/volume data
2. **Rate Limiting**: Token bucket algorithm prevents API abuse
3. **Validation**: Data validator ensures data integrity
4. **Storage**: Rolling window manager stores historical data
5. **Persistence**: Database service persists to SQLite

### 2. Alert Processing

```
Price Change → Trigger Logic → Alert Bus → Message Queue → Telegram
```

1. **Detection**: Long/Hot list services detect trigger conditions
2. **Validation**: Alert logic validates against cooldown periods
3. **Publishing**: Alert bus publishes events to subscribers
4. **Queuing**: Message queue handles delivery with retries
5. **Delivery**: Telegram service sends formatted messages

### 3. Command Processing

```
Telegram Command → Parser → Service Method → Database Update → Response
```

1. **Reception**: Telegram bot receives command
2. **Parsing**: Command parser extracts parameters
3. **Execution**: Appropriate service method handles logic
4. **Persistence**: Database updates reflect changes
5. **Feedback**: Response sent to user

## Service Architecture Details

### Core Services

#### DatabaseService
- **Purpose**: Database operations and transaction management
- **Features**: Connection pooling, query optimization, transaction handling
- **Dependencies**: Prisma Client, Database Manager

#### DexScreenerService
- **Purpose**: External API integration for price data
- **Features**: Rate limiting, circuit breaker, data validation
- **Dependencies**: Axios, Rate Limiter

#### LongListService
- **Purpose**: Long-term cryptocurrency monitoring
- **Features**: Rolling window analysis, multiple alert types
- **Dependencies**: Database Service, DexScreener Service, Rolling Window

#### HotListService
- **Purpose**: Quick alerts for short-term price movements
- **Features**: Percentage-based triggers, market cap milestones
- **Dependencies**: Database Service, DexScreener Service

#### TelegramService
- **Purpose**: User interface and notification delivery
- **Features**: Command handling, message formatting, queue management
- **Dependencies**: Telegraf, Database Service, Long/Hot List Services

### Background Services

#### JobQueue
- **Purpose**: Asynchronous task processing
- **Features**: Job persistence, retry logic, priority queues
- **Implementation**: In-memory queue with database persistence

#### SchedulerService
- **Purpose**: Cron-based task scheduling
- **Features**: Timezone support, configurable intervals
- **Dependencies**: node-cron, Long/Hot List Services

#### HealthMonitor
- **Purpose**: System health tracking and alerting
- **Features**: Service health checks, performance metrics
- **Dependencies**: All core services

#### RateLimitService
- **Purpose**: API rate limiting and abuse prevention
- **Features**: Token bucket algorithm, per-service limits
- **Implementation**: In-memory token buckets

## Database Architecture

### Schema Design

The database uses 11 tables with proper relationships and indexing:

#### Core Tables
- **Coin**: Master coin registry with symbol, chain, pair address
- **LongWatch**: Long-term monitoring configurations
- **LongState**: Current state tracking for long list coins
- **HotEntry**: Short-term alert configurations
- **HotTriggerState**: Trigger state tracking for hot list

#### Supporting Tables
- **AlertHistory**: Complete alert audit trail
- **RollingDataPoint**: Historical price/volume data
- **Outbox**: Message delivery queue
- **ScheduleCfg**: System configuration
- **SymbolAlias**: Symbol mapping for user convenience
- **Migration**: Database version management

### Performance Optimizations

#### Indexing Strategy
```sql
-- Primary performance indexes
CREATE INDEX idx_coin_symbol ON coin(symbol);
CREATE INDEX idx_coin_active ON coin(is_active);
CREATE INDEX idx_rolling_coin_time ON rolling_data_points(coin_id, timestamp);
CREATE INDEX idx_alerts_coin_time ON alert_history(coin_id, ts_utc);
```

#### WAL Mode Configuration
- Write-Ahead Logging for concurrent read/write performance
- Automatic checkpoint management
- Optimized for high-frequency price updates

#### Connection Pooling
- Single connection pool via singleton pattern
- Connection lifecycle management
- Graceful shutdown handling

## Security Architecture

### Environment Variable Management
- Required variables validation on startup
- No hardcoded secrets in source code
- Development/production environment separation

### Input Validation
- All user inputs validated and sanitized
- SQL injection prevention via Prisma
- Command parameter validation

### Rate Limiting
- Multiple layers: API, Telegram, Internal services
- Configurable limits per service
- Abuse detection and prevention

### Error Handling
- Comprehensive error catching and logging
- No sensitive data in error messages
- Graceful degradation on failures

## Scalability Considerations

### Current Architecture Supports
- **Concurrent Users**: 100+ via Telegram bot
- **Coins Tracked**: 1000+ in database
- **Alert Frequency**: Sub-second trigger detection
- **Message Throughput**: 60 messages/minute (Telegram limit)

### Horizontal Scaling Options
1. **Database**: SQLite → PostgreSQL for multi-instance
2. **Message Queue**: In-memory → Redis/RabbitMQ
3. **Load Balancing**: Multiple bot instances
4. **Caching**: Redis for hot data

### Vertical Scaling
- Optimized for single-instance deployment
- Memory efficient data structures
- CPU-optimized algorithms
- I/O async operations throughout

## Monitoring and Observability

### Logging Strategy
- Structured logging via Winston
- Multiple log levels: error, warn, info, debug
- Contextual information in all log entries
- Separate log files by service

### Health Checks
- Service-level health monitoring
- Performance metrics collection
- Automatic error recovery
- System resource monitoring

### Alerting
- System health alerts via Telegram
- Error threshold notifications
- Performance degradation warnings
- Service availability monitoring

## Deployment Architecture

### Single Instance Deployment
```
Application Server
├── Node.js Runtime
├── SQLite Database (WAL mode)
├── Log Files
└── Configuration Files
```

### Process Management
- PM2 for process monitoring and restart
- Graceful shutdown handling
- Memory leak prevention
- CPU usage optimization

### File Structure
```
follow-coin/
├── dist/           # Compiled JavaScript
├── prisma/         # Database schema and migrations
├── src/            # TypeScript source code
├── logs/           # Application logs
├── data/           # SQLite database files
└── node_modules/   # Dependencies
```

This architecture provides a robust, scalable foundation for cryptocurrency tracking with enterprise-grade reliability and performance characteristics.