# Follow Coin Bot - Developer Guide

## Overview

This guide provides comprehensive instructions for developers who want to extend, modify, or contribute to the Follow Coin Bot system. The codebase is built with TypeScript and follows enterprise-grade architecture patterns.

## Development Environment Setup

### Prerequisites

#### Required Software
- **Node.js**: v18.0.0+ (recommend v20.x LTS)
- **npm**: v9.0.0+ (comes with Node.js)
- **TypeScript**: v5.3.0+ (installed locally)
- **Git**: Latest version
- **Code Editor**: VS Code recommended with extensions

#### Recommended VS Code Extensions
```json
{
  "recommendations": [
    "ms-vscode.vscode-typescript-next",
    "Prisma.prisma",
    "ms-vscode.vscode-json",
    "bradlc.vscode-tailwindcss",
    "esbenp.prettier-vscode",
    "ms-vscode.vscode-eslint"
  ]
}
```

### Local Development Setup

#### 1. Clone and Install
```bash
git clone <repository-url>
cd follow-coin-bot
npm install
```

#### 2. Environment Configuration
```bash
# Copy example environment file
cp .env.example .env

# Edit with your values
nano .env
```

**Development .env:**
```bash
# Required
TELEGRAM_BOT_TOKEN=your_development_bot_token
TELEGRAM_CHAT_ID=your_chat_id
DATABASE_URL=file:./prisma/data/dev.db

# Development settings
NODE_ENV=development
LOG_LEVEL=debug
DEXSCREENER_RATE_LIMIT_MS=500
```

#### 3. Database Setup
```bash
# Generate Prisma client
npm run db:generate

# Initialize database
npm run db:push

# Optional: View database
npm run db:studio
```

#### 4. Start Development
```bash
# Development mode with hot reload
npm run dev

# Alternative: Build and run
npm run build
npm start
```

### Development Tools

#### TypeScript Configuration
```json
// tsconfig.json highlights
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "node",
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true
  }
}
```

#### Testing Setup
```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run specific test file
npm test -- validation.test.ts
```

#### Linting and Formatting
```bash
# Run ESLint
npm run lint

# Run Prettier
npm run format

# Fix auto-fixable issues
npm run lint -- --fix
```

## Project Structure

### Directory Organization

```
src/
├── database/           # Database migrations and utilities
├── events/            # Event bus and event handlers
│   └── alertBus.ts    # Central event management
├── services/          # Core business logic services
│   ├── database.ts    # Database operations
│   ├── dexscreener.ts # External API integration
│   ├── longlist.ts    # Long-term monitoring
│   ├── hotlist.ts     # Short-term alerts
│   ├── telegram.ts    # Bot interface
│   ├── scheduler.ts   # Task scheduling
│   ├── rateLimiter.ts # Rate limiting
│   ├── health.ts      # Health monitoring
│   ├── jobQueue.ts    # Background jobs
│   ├── rollingWindow.ts # Data windowing
│   ├── backfill.ts    # Historical data
│   └── migration.ts   # Database versioning
├── types/             # TypeScript type definitions
│   ├── database.ts    # Database entities
│   ├── dexscreener.ts # API responses
│   ├── telegram.ts    # Bot interfaces
│   ├── triggers.ts    # Alert configurations
│   └── hotlist.ts     # Hot list types
├── utils/             # Utility functions and helpers
│   ├── database.ts    # Database connection management
│   ├── logger.ts      # Logging configuration
│   ├── errorHandler.ts # Error management
│   ├── validation.ts  # Input validation
│   └── formatters.ts  # Data formatting
├── tests/             # Test files
│   ├── setup.ts       # Test configuration
│   ├── validation.test.ts # Validation tests
│   └── formatters.test.ts # Formatter tests
└── index.ts           # Application entry point
```

### Architecture Patterns

#### Service Layer Pattern
Each service has a single responsibility and clear interface:

```typescript
// Example service structure
export class ExampleService {
  private dependency: DependencyService;
  
  constructor(dependency: DependencyService) {
    this.dependency = dependency;
  }
  
  async publicMethod(param: string): Promise<Result> {
    // Implementation
  }
  
  private helperMethod(): void {
    // Private helper
  }
}
```

#### Event-Driven Architecture
Services communicate via events to maintain loose coupling:

```typescript
// Publishing events
globalAlertBus.publish({
  type: 'long_trigger',
  data: alertData,
  priority: 'high',
  timestamp: Date.now()
});

// Subscribing to events
globalAlertBus.subscribe({
  id: 'unique_subscriber_id',
  handler: async (event) => {
    await handleEvent(event);
  }
});
```

#### Error Handling Pattern
Consistent error handling throughout the codebase:

```typescript
// Using error wrapper
await withErrorHandling(
  () => riskyOperation(),
  createErrorContext('operation_name', { param: value })
);

// Custom error types
throw new ValidationError('Invalid parameter', { param });
throw new NotFoundError('Resource not found', { id });
```

## Core Components

### Database Layer

#### Prisma Integration
The system uses Prisma ORM for type-safe database operations:

```typescript
// Example database operation
async addCoin(chain: string, tokenAddress: string, symbol: string): Promise<Coin> {
  try {
    return await this.prisma.coin.create({
      data: {
        chain,
        tokenAddress,
        symbol,
        isActive: true
      }
    });
  } catch (error) {
    throw new DatabaseError('Failed to create coin', { chain, tokenAddress, symbol });
  }
}
```

#### Database Migrations
```bash
# Create new migration
npx prisma migrate dev --name add_new_feature

# Generate Prisma client after schema changes
npx prisma generate

# Apply migrations in production
npx prisma migrate deploy
```

#### Schema Modifications
When modifying `prisma/schema.prisma`:

1. **Update schema file**
2. **Generate migration**: `npx prisma migrate dev`
3. **Update TypeScript types** if needed
4. **Test changes** thoroughly
5. **Update documentation**

### Service Development

#### Creating New Services

1. **Define Interface**
```typescript
// types/newService.ts
export interface NewServiceConfig {
  setting1: string;
  setting2: number;
}

export interface NewServiceResult {
  success: boolean;
  data?: any;
  error?: string;
}
```

2. **Implement Service**
```typescript
// services/newService.ts
import { NewServiceConfig, NewServiceResult } from '../types/newService.js';
import { logger } from '../utils/logger.js';

export class NewService {
  private config: NewServiceConfig;
  
  constructor(config: NewServiceConfig) {
    this.config = config;
  }
  
  async performOperation(): Promise<NewServiceResult> {
    try {
      logger.info('Starting operation', { service: 'NewService' });
      
      // Implementation logic
      
      return { success: true, data: result };
    } catch (error) {
      logger.error('Operation failed', { error, service: 'NewService' });
      return { success: false, error: error.message };
    }
  }
}
```

3. **Register Service**
```typescript
// index.ts (in initialization)
this.newService = new NewService({
  setting1: 'value',
  setting2: 123
});
```

4. **Add Tests**
```typescript
// tests/newService.test.ts
import { NewService } from '../services/newService.js';

describe('NewService', () => {
  let service: NewService;
  
  beforeEach(() => {
    service = new NewService({ setting1: 'test', setting2: 456 });
  });
  
  test('should perform operation successfully', async () => {
    const result = await service.performOperation();
    expect(result.success).toBe(true);
  });
});
```

#### Service Communication

Services should communicate via events for loose coupling:

```typescript
// Service publishing event
export class ProducerService {
  async doWork(): Promise<void> {
    const result = await this.performWork();
    
    globalAlertBus.publish({
      type: 'work_completed',
      data: result,
      priority: 'medium',
      timestamp: Date.now()
    });
  }
}

// Service consuming event
export class ConsumerService {
  constructor() {
    globalAlertBus.subscribe({
      id: 'consumer_service',
      handler: this.handleWorkCompleted.bind(this)
    });
  }
  
  private async handleWorkCompleted(event: AlertEvent): Promise<void> {
    if (event.type === 'work_completed') {
      await this.processResult(event.data);
    }
  }
}
```

### Adding New Alert Types

#### 1. Define Alert Type
```typescript
// types/alerts.ts
export interface CustomAlert {
  coinId: number;
  symbol: string;
  alertType: 'custom';
  threshold: number;
  currentValue: number;
  message: string;
  timestamp: number;
}
```

#### 2. Implement Alert Logic
```typescript
// services/customAlerts.ts
export class CustomAlertService {
  evaluateCustomAlert(coin: Coin, threshold: number): CustomAlert | null {
    // Custom alert evaluation logic
    const currentValue = this.getCurrentValue(coin);
    
    if (currentValue >= threshold) {
      return {
        coinId: coin.coinId,
        symbol: coin.symbol,
        alertType: 'custom',
        threshold,
        currentValue,
        message: `${coin.symbol} reached custom threshold: ${currentValue}`,
        timestamp: Date.now()
      };
    }
    
    return null;
  }
}
```

#### 3. Integrate with Alert Bus
```typescript
// In service that checks alerts
const customAlert = this.customAlertService.evaluateCustomAlert(coin, threshold);
if (customAlert) {
  globalAlertBus.publish({
    type: 'custom_alert',
    data: customAlert,
    priority: 'medium',
    timestamp: Date.now()
  });
}
```

#### 4. Handle Alert Delivery
```typescript
// In telegram service
globalAlertBus.subscribe({
  id: 'telegram_custom_alerts',
  handler: async (event) => {
    if (event.type === 'custom_alert') {
      await this.sendCustomAlert(event.data);
    }
  }
});
```

### Adding New Commands

#### 1. Define Command Interface
```typescript
// types/telegram.ts
export interface CustomCommand extends BotCommand {
  command: '/custom';
  description: 'Custom command description';
  handler: (ctx: Context, args: string[]) => Promise<void>;
}
```

#### 2. Implement Command Handler
```typescript
// services/telegram.ts
private async handleCustomCommand(ctx: Context, args: string[]): Promise<void> {
  try {
    // Validate arguments
    if (args.length < 1) {
      await ctx.reply('Usage: /custom <parameter>');
      return;
    }
    
    const parameter = args[0];
    
    // Process command
    const result = await this.processCustomCommand(parameter);
    
    // Send response
    await ctx.reply(`Custom command result: ${result}`);
    
  } catch (error) {
    logger.error('Custom command failed', { error, args });
    await ctx.reply('❌ Custom command failed. Please try again.');
  }
}
```

#### 3. Register Command
```typescript
// In setupCommands method
this.commands.push({
  command: '/custom',
  description: 'Custom command description',
  handler: this.handleCustomCommand.bind(this)
});
```

#### 4. Add Command Tests
```typescript
// tests/telegram.test.ts
describe('Custom Command', () => {
  test('should handle custom command correctly', async () => {
    const mockCtx = createMockContext();
    await telegramService.handleCustomCommand(mockCtx, ['test-param']);
    
    expect(mockCtx.reply).toHaveBeenCalledWith(
      expect.stringContaining('Custom command result')
    );
  });
});
```

## Testing

### Testing Strategy

#### Unit Tests
Test individual functions and methods in isolation:

```typescript
// tests/validation.test.ts
import { DataValidator } from '../utils/validation.js';

describe('DataValidator', () => {
  let validator: DataValidator;
  
  beforeEach(() => {
    validator = new DataValidator();
  });
  
  describe('validateSymbol', () => {
    test('should accept valid symbols', () => {
      expect(validator.validateSymbol('SOL')).toBe(true);
      expect(validator.validateSymbol('BTC')).toBe(true);
      expect(validator.validateSymbol('MEME')).toBe(true);
    });
    
    test('should reject invalid symbols', () => {
      expect(validator.validateSymbol('')).toBe(false);
      expect(validator.validateSymbol('A')).toBe(false);
      expect(validator.validateSymbol('TOOLONG')).toBe(false);
    });
  });
});
```

#### Integration Tests
Test service interactions and database operations:

```typescript
// tests/database.integration.test.ts
import { DatabaseService } from '../services/database.js';

describe('Database Integration', () => {
  let db: DatabaseService;
  
  beforeAll(async () => {
    db = new DatabaseService();
    await db.initialize();
  });
  
  afterAll(async () => {
    await db.disconnect();
  });
  
  test('should add and retrieve coin', async () => {
    const coin = await db.addCoin('solana', 'test-address', 'TEST');
    expect(coin.symbol).toBe('TEST');
    
    const retrieved = await db.getCoinBySymbol('TEST');
    expect(retrieved?.coinId).toBe(coin.coinId);
  });
});
```

#### Mock External Dependencies
```typescript
// tests/mocks/dexscreener.mock.ts
export const mockDexScreenerService = {
  fetchPairInfo: jest.fn().mockResolvedValue({
    priceUsd: '1.234',
    volume: { h24: 100000 },
    marketCap: 1000000
  }),
  isServiceAvailable: jest.fn().mockResolvedValue(true)
};
```

### Test Configuration

#### Jest Setup
```javascript
// jest.config.js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  setupFilesAfterEnv: ['<rootDir>/src/tests/setup.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/tests/**/*'
  ]
};
```

#### Test Database Setup
```typescript
// tests/setup.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: { db: { url: 'file:./test.db' } }
});

beforeAll(async () => {
  // Setup test database
  await prisma.$executeRaw`PRAGMA foreign_keys = ON`;
});

afterAll(async () => {
  // Cleanup
  await prisma.$disconnect();
});
```

## Debugging

### Logging Configuration

The system uses Winston for structured logging:

```typescript
// utils/logger.ts configuration
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.simple()
    }),
    new winston.transports.File({ 
      filename: 'logs/app.log' 
    })
  ]
});
```

### Debug Techniques

#### Adding Debug Logs
```typescript
// Add contextual logging
logger.debug('Processing coin data', {
  coinId: coin.coinId,
  symbol: coin.symbol,
  operation: 'price_update'
});

// Log performance metrics
const startTime = Date.now();
await expensiveOperation();
logger.debug('Operation completed', {
  duration: Date.now() - startTime,
  operation: 'expensive_operation'
});
```

#### Error Context
```typescript
// Comprehensive error context
try {
  await riskyOperation(param1, param2);
} catch (error) {
  const context = createErrorContext('risky_operation', {
    param1,
    param2,
    timestamp: Date.now(),
    userId: ctx.from?.id
  });
  
  await globalErrorHandler.handleError(error, context);
  throw error;
}
```

#### Development Tools

**Database Inspection:**
```bash
# Open Prisma Studio
npm run db:studio

# Direct SQLite access
sqlite3 prisma/data/dev.db
.tables
.schema coin
SELECT * FROM coin LIMIT 10;
```

**Log Analysis:**
```bash
# Tail application logs
tail -f logs/app.log

# Filter for errors
grep "ERROR" logs/app.log

# JSON log parsing
cat logs/app.log | jq '.message'
```

## Performance Optimization

### Database Optimization

#### Query Optimization
```typescript
// Efficient query patterns
const coinsWithState = await prisma.coin.findMany({
  where: { isActive: true },
  include: {
    longWatch: true,
    longState: true
  }
});

// Batch operations
await prisma.rollingDataPoint.createMany({
  data: dataPoints,
  skipDuplicates: true
});
```

#### Index Strategy
```sql
-- Add indexes for common queries
CREATE INDEX idx_rolling_data_coin_timestamp 
ON rolling_data_points(coin_id, timestamp);

CREATE INDEX idx_alert_history_coin_kind_ts 
ON alert_history(coin_id, kind, ts_utc);
```

### Memory Management

#### Connection Pooling
```typescript
// Singleton database connection
class DatabaseManager {
  private static instance: PrismaClient | null = null;
  
  static async getConnection(): Promise<PrismaClient> {
    if (!this.instance) {
      this.instance = new PrismaClient({
        datasources: { db: { url: process.env.DATABASE_URL } }
      });
    }
    return this.instance;
  }
}
```

#### Data Cleanup
```typescript
// Automated cleanup of old data
async cleanupOldData(): Promise<void> {
  const cutoffTime = Date.now() - (72 * 60 * 60 * 1000); // 72 hours
  
  await prisma.rollingDataPoint.deleteMany({
    where: { timestamp: { lt: cutoffTime } }
  });
}
```

### Rate Limiting

#### API Rate Limiting
```typescript
class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private capacity: number;
  private refillRate: number;
  
  async acquire(): Promise<boolean> {
    this.refillTokens();
    
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    
    return false;
  }
  
  private refillTokens(): void {
    const now = Date.now();
    const timePassed = now - this.lastRefill;
    const tokensToAdd = (timePassed / 1000) * this.refillRate;
    
    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }
}
```

## Contributing Guidelines

### Code Standards

#### TypeScript Guidelines
- Use strict type checking
- Prefer interfaces over types for objects
- Use explicit return types for public methods
- Avoid `any` type; use proper typing
- Use optional chaining and nullish coalescing

#### Naming Conventions
- **Classes**: PascalCase (`DatabaseService`)
- **Functions/Methods**: camelCase (`addCoin`)
- **Variables**: camelCase (`coinData`)
- **Constants**: UPPER_SNAKE_CASE (`MAX_RETRIES`)
- **Files**: kebab-case (`long-list.service.ts`)

#### Documentation Requirements
```typescript
/**
 * Adds a cryptocurrency to the long list monitoring system.
 * 
 * @param symbol - Trading symbol (e.g., "SOL", "BTC")
 * @param config - Optional trigger configuration
 * @returns Promise resolving to the created LongWatch entry
 * @throws {ValidationError} When symbol format is invalid
 * @throws {DuplicateError} When coin already exists in long list
 * 
 * @example
 * ```typescript
 * await longListService.addCoin("MEME", {
 *   retracePct: 20,
 *   breakoutPct: 15
 * });
 * ```
 */
async addCoin(symbol: string, config?: Partial<TriggerConfig>): Promise<LongWatch> {
  // Implementation
}
```

### Pull Request Process

1. **Create Feature Branch**
   ```bash
   git checkout -b feature/new-alert-type
   ```

2. **Implement Changes**
   - Write code following standards
   - Add comprehensive tests
   - Update documentation
   - Ensure type safety

3. **Test Changes**
   ```bash
   npm test
   npm run lint
   npm run build
   ```

4. **Commit Changes**
   ```bash
   git add .
   git commit -m "feat: add custom alert type with threshold configuration"
   ```

5. **Push and Create PR**
   ```bash
   git push origin feature/new-alert-type
   ```

### Commit Message Format
```
type(scope): description

body (optional)

footer (optional)
```

**Types:**
- `feat`: New features
- `fix`: Bug fixes
- `docs`: Documentation changes
- `refactor`: Code refactoring
- `test`: Test additions/modifications
- `chore`: Maintenance tasks

**Examples:**
```
feat(alerts): add volume-based breakout detection
fix(database): resolve connection leak in migration service
docs(api): update command reference with new parameters
refactor(services): extract common alert logic to base class
```

## Extension Examples

### Adding New Data Sources

#### 1. Define Data Source Interface
```typescript
// types/dataSources.ts
export interface DataSource {
  name: string;
  fetchPriceData(symbol: string): Promise<PriceData>;
  isAvailable(): Promise<boolean>;
}

export interface PriceData {
  price: number;
  volume24h: number;
  marketCap?: number;
  timestamp: number;
}
```

#### 2. Implement Data Source
```typescript
// services/newDataSource.ts
export class NewDataSource implements DataSource {
  name = 'NewDataSource';
  private baseUrl = 'https://api.newdatasource.com';
  private apiKey: string;
  
  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }
  
  async fetchPriceData(symbol: string): Promise<PriceData> {
    const response = await fetch(`${this.baseUrl}/price/${symbol}`, {
      headers: { 'Authorization': `Bearer ${this.apiKey}` }
    });
    
    const data = await response.json();
    
    return {
      price: parseFloat(data.price),
      volume24h: parseFloat(data.volume_24h),
      marketCap: data.market_cap ? parseFloat(data.market_cap) : undefined,
      timestamp: Date.now()
    };
  }
  
  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`);
      return response.ok;
    } catch {
      return false;
    }
  }
}
```

#### 3. Integrate with Data Aggregator
```typescript
// services/dataAggregator.ts
export class DataAggregator {
  private sources: DataSource[] = [];
  
  addSource(source: DataSource): void {
    this.sources.push(source);
  }
  
  async fetchPriceData(symbol: string): Promise<PriceData> {
    for (const source of this.sources) {
      try {
        if (await source.isAvailable()) {
          return await source.fetchPriceData(symbol);
        }
      } catch (error) {
        logger.warn(`Data source ${source.name} failed`, { error, symbol });
        continue;
      }
    }
    
    throw new Error('No data sources available');
  }
}
```

This developer guide provides comprehensive information for extending and maintaining the Follow Coin Bot system. Follow these patterns and guidelines to ensure code quality and system reliability.