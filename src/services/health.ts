import { DatabaseManager } from '../utils/database';
import { logger } from '../utils/logger';
import { globalJobQueue } from './jobQueue';
import { globalAlertBus } from '../events/alertBus';

export interface HealthStatus {
  healthy: boolean;
  timestamp: number;
  services: {
    database: ServiceHealth;
    jobQueue: ServiceHealth;
    alertBus: ServiceHealth;
    dexScreener?: ServiceHealth;
    telegram?: ServiceHealth;
  };
  metrics: {
    uptime: number;
    memoryUsage: NodeJS.MemoryUsage;
    systemLoad?: number[] | undefined;
  };
}

export interface ServiceHealth {
  healthy: boolean;
  latency?: number | undefined;
  error?: string | undefined;
  lastCheck: number;
  metadata?: Record<string, unknown> | undefined;
}

export class HealthCheckService {
  private lastHealthCheck: HealthStatus | null = null;
  private healthCheckInterval: NodeJS.Timeout | undefined = undefined;
  private readonly checkIntervalMs = 30000; // 30 seconds
  private startTime = Date.now();

  constructor() {
    this.startHealthChecks();
  }

  private startHealthChecks(): void {
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck().catch(error => {
        logger.error('Health check failed:', error);
      });
    }, this.checkIntervalMs);

    logger.info('Health check service started');
  }

  async performHealthCheck(): Promise<HealthStatus> {
    const timestamp = Date.now();

    const [
      databaseHealth,
      jobQueueHealth,
      alertBusHealth
    ] = await Promise.allSettled([
      this.checkDatabase(),
      this.checkJobQueue(),
      this.checkAlertBus()
    ]);

    const services = {
      database: this.extractResult(databaseHealth),
      jobQueue: this.extractResult(jobQueueHealth),
      alertBus: this.extractResult(alertBusHealth)
    };

    const allHealthy = Object.values(services).every(service => service.healthy);

    const healthStatus: HealthStatus = {
      healthy: allHealthy,
      timestamp,
      services,
      metrics: {
        uptime: timestamp - this.startTime,
        memoryUsage: process.memoryUsage(),
        systemLoad: this.getSystemLoad() || undefined
      }
    };

    this.lastHealthCheck = healthStatus;

    if (!allHealthy) {
      logger.warn('Health check failed', { services });
      await this.handleUnhealthyState(healthStatus);
    } else {
      logger.debug('Health check passed');
    }

    return healthStatus;
  }

  private extractResult(result: PromiseSettledResult<ServiceHealth>): ServiceHealth {
    if (result.status === 'fulfilled') {
      return result.value;
    } else {
      return {
        healthy: false,
        error: result.reason?.message || 'Unknown error',
        lastCheck: Date.now()
      };
    }
  }

  private async checkDatabase(): Promise<ServiceHealth> {
    try {
      const result = await DatabaseManager.healthCheck();
      return {
        healthy: result.healthy,
        latency: result.latency || undefined,
        error: result.error || undefined,
        lastCheck: Date.now(),
        metadata: {
          connectionPool: 'active' // Could add more DB-specific metrics
        }
      };
    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : 'Database check failed',
        lastCheck: Date.now()
      };
    }
  }

  private async checkJobQueue(): Promise<ServiceHealth> {
    try {
      const stats = globalJobQueue.getStats();
      const healthy = stats.processingJobs < 100; // Arbitrary threshold

      return {
        healthy,
        lastCheck: Date.now(),
        metadata: {
          totalJobs: stats.totalJobs,
          processingJobs: stats.processingJobs,
          pendingJobs: stats.pendingJobs,
          avgProcessingTime: stats.avgProcessingTime
        }
      };
    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : 'Job queue check failed',
        lastCheck: Date.now()
      };
    }
  }

  private async checkAlertBus(): Promise<ServiceHealth> {
    try {
      const stats = globalAlertBus.getStats();
      const healthy = stats.subscriberCount > 0; // Should have subscribers

      return {
        healthy,
        lastCheck: Date.now(),
        metadata: {
          subscriberCount: stats.subscriberCount,
          totalEvents: stats.totalEvents,
          eventsByType: stats.eventsByType
        }
      };
    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : 'Alert bus check failed',
        lastCheck: Date.now()
      };
    }
  }

  private getSystemLoad(): number[] | undefined {
    try {
      return require('os').loadavg();
    } catch {
      return undefined;
    }
  }

  private async handleUnhealthyState(health: HealthStatus): Promise<void> {
    const unhealthyServices = Object.entries(health.services)
      .filter(([_, service]) => !service.healthy)
      .map(([name, service]) => `${name}: ${service.error || 'Unknown issue'}`);

    const alertMessage = `System health check failed:\n${unhealthyServices.join('\n')}`;

    try {
      await globalAlertBus.emitSystemAlert(alertMessage, 'high');
    } catch (error) {
      logger.error('Failed to emit health alert:', error);
    }
  }

  async getHealthStatus(): Promise<HealthStatus> {
    if (!this.lastHealthCheck || (Date.now() - this.lastHealthCheck.timestamp) > this.checkIntervalMs) {
      return await this.performHealthCheck();
    }
    return this.lastHealthCheck;
  }

  async isHealthy(): Promise<boolean> {
    const health = await this.getHealthStatus();
    return health.healthy;
  }

  async getServiceHealth(serviceName: string): Promise<ServiceHealth | null> {
    const health = await this.getHealthStatus();
    return health.services[serviceName as keyof typeof health.services] || null;
  }

  stop(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }
    logger.info('Health check service stopped');
  }

  async waitForHealthy(timeoutMs: number = 30000): Promise<boolean> {
    const start = Date.now();
    
    while (Date.now() - start < timeoutMs) {
      const healthy = await this.isHealthy();
      if (healthy) return true;
      
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    return false;
  }

  getMetrics(): {
    checksPerformed: number;
    lastCheckTime: number;
    avgResponseTime: number;
    healthyPercentage: number;
  } {
    // This would typically track metrics over time
    // For now, return basic info
    return {
      checksPerformed: this.lastHealthCheck ? 1 : 0,
      lastCheckTime: this.lastHealthCheck?.timestamp || 0,
      avgResponseTime: 0, // Would need to track this
      healthyPercentage: this.lastHealthCheck?.healthy ? 100 : 0
    };
  }
}

export const globalHealthCheck = new HealthCheckService();