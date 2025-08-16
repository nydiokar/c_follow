import { DatabaseManager } from '../utils/database';
import { logger } from '../utils/logger';

export interface MigrationDefinition {
  name: string;
  up: () => Promise<void>;
  down?: () => Promise<void>;
}

export class MigrationService {
  private migrations: MigrationDefinition[] = [];

  constructor() {
    this.registerCoreMigrations();
  }

  private registerCoreMigrations(): void {
    this.addMigration({
      name: '001_initial_schema',
      up: async () => {
        // Core schema is already created by Prisma
        logger.info('Initial schema migration completed');
      }
    });

    this.addMigration({
      name: '002_add_rolling_data_points',
      up: async () => {
        const prisma = DatabaseManager.getInstance();
        
        // Create rolling data points table if it doesn't exist
        await prisma.$executeRaw`
          CREATE TABLE IF NOT EXISTS rolling_data_points (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            coin_id INTEGER NOT NULL,
            timestamp INTEGER NOT NULL,
            price REAL NOT NULL,
            volume REAL NOT NULL,
            market_cap REAL,
            FOREIGN KEY (coin_id) REFERENCES coin(coin_id) ON DELETE CASCADE
          )
        `;
        
        await prisma.$executeRaw`
          CREATE INDEX IF NOT EXISTS idx_rolling_data_coin_timestamp 
          ON rolling_data_points(coin_id, timestamp)
        `;
        
        logger.info('Rolling data points table migration completed');
      }
    });

    this.addMigration({
      name: '003_add_sqlite_optimizations',
      up: async () => {
        const prisma = DatabaseManager.getInstance();
        
        // Add indexes for better performance
        await prisma.$executeRaw`
          CREATE INDEX IF NOT EXISTS idx_long_state_price_update 
          ON long_state(last_updated_utc, last_price)
        `;
        
        await prisma.$executeRaw`
          CREATE INDEX IF NOT EXISTS idx_hot_entry_anchor 
          ON hot_entry(added_at_utc, anchor_price)
        `;
        
        await prisma.$executeRaw`
          CREATE INDEX IF NOT EXISTS idx_alert_history_timestamp 
          ON alert_history(ts_utc DESC)
        `;
        
        logger.info('SQLite optimization indexes migration completed');
      }
    });

    this.addMigration({
      name: '004_add_performance_indexes',
      up: async () => {
        const prisma = DatabaseManager.getInstance();
        
        // Composite indexes for common queries
        await prisma.$executeRaw`
          CREATE INDEX IF NOT EXISTS idx_coin_active_chain 
          ON coin(is_active, chain) WHERE is_active = 1
        `;
        
        await prisma.$executeRaw`
          CREATE INDEX IF NOT EXISTS idx_long_watch_triggers 
          ON long_watch(retrace_on, stall_on, breakout_on, mcap_on)
        `;
        
        await prisma.$executeRaw`
          CREATE INDEX IF NOT EXISTS idx_hot_trigger_unfired 
          ON hot_trigger_state(hot_id, fired) WHERE fired = 0
        `;
        
        logger.info('Performance indexes migration completed');
      }
    });
  }

  addMigration(migration: MigrationDefinition): void {
    this.migrations.push(migration);
    logger.debug(`Migration registered: ${migration.name}`);
  }

  async runMigrations(): Promise<void> {
    const prisma = DatabaseManager.getInstance();
    
    // Ensure migrations table exists
    await this.ensureMigrationsTable();
    
    // Get completed migrations
    const completedMigrations = await prisma.migration.findMany({
      select: { name: true }
    });
    
    const completedNames = new Set(completedMigrations.map((m: any) => m.name));
    
    // Run pending migrations
    const pendingMigrations = this.migrations.filter(m => !completedNames.has(m.name));
    
    if (pendingMigrations.length === 0) {
      logger.info('No pending migrations');
      return;
    }
    
    logger.info(`Running ${pendingMigrations.length} pending migrations`);
    
    for (const migration of pendingMigrations) {
      try {
        logger.info(`Running migration: ${migration.name}`);
        
        await migration.up();
        
        // Record migration as completed
        await prisma.migration.create({
          data: { name: migration.name }
        });
        
        logger.info(`Migration completed: ${migration.name}`);
        
      } catch (error) {
        logger.error(`Migration failed: ${migration.name}`, error);
        throw new Error(`Migration ${migration.name} failed: ${error}`);
      }
    }
    
    logger.info('All migrations completed successfully');
  }

  private async ensureMigrationsTable(): Promise<void> {
    const prisma = DatabaseManager.getInstance();
    
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        executed_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;
  }

  async rollbackMigration(migrationName: string): Promise<void> {
    const prisma = DatabaseManager.getInstance();
    
    const migration = this.migrations.find(m => m.name === migrationName);
    if (!migration) {
      throw new Error(`Migration not found: ${migrationName}`);
    }
    
    if (!migration.down) {
      throw new Error(`Migration ${migrationName} does not support rollback`);
    }
    
    try {
      logger.info(`Rolling back migration: ${migrationName}`);
      
      await migration.down();
      
      // Remove migration record
      await prisma.migration.delete({
        where: { name: migrationName }
      });
      
      logger.info(`Migration rolled back: ${migrationName}`);
      
    } catch (error) {
      logger.error(`Migration rollback failed: ${migrationName}`, error);
      throw error;
    }
  }

  async getMigrationStatus(): Promise<Array<{
    name: string;
    executed: boolean;
    executedAt?: Date;
  }>> {
    const prisma = DatabaseManager.getInstance();
    
    const completedMigrations = await prisma.migration.findMany();
    const completedMap = new Map<string, Date>(
      completedMigrations.map((m: { name: string; executedAt: Date }) => [m.name, m.executedAt])
    );
    
    return this.migrations.map(migration => {
      const executedAt = completedMap.get(migration.name);
      return {
        name: migration.name,
        executed: completedMap.has(migration.name),
        ...(executedAt && { executedAt })
      };
    });
  }

  async resetDatabase(): Promise<void> {
    const prisma = DatabaseManager.getInstance();
    
    logger.warn('Resetting database - this will delete all data');
    
    // Drop all tables in reverse dependency order
    const tables = [
      'rolling_data_points',
      'hot_trigger_state',
      'alert_history',
      'hot_entry',
      'long_state',
      'long_watch',
      'symbol_alias',
      'outbox',
      'schedule_cfg',
      'coin',
      'migrations'
    ];
    
    for (const table of tables) {
      try {
        await prisma.$executeRaw`DROP TABLE IF EXISTS ${table}`;
      } catch (error) {
        logger.warn(`Failed to drop table ${table}:`, error);
      }
    }
    
    logger.info('Database reset completed');
  }
}