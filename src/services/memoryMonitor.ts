import { logger } from '../utils/logger';
import { DatabaseManager } from '../utils/database';

interface MemorySnapshot {
  timestamp: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
  rss: number; // Resident Set Size (actual physical memory)
  arrayBuffers: number;
}

interface MemoryStats {
  current: MemorySnapshot;
  history: MemorySnapshot[];
  trends: {
    heapGrowthRate: number; // MB per hour
    externalGrowthRate: number;
    rssGrowthRate: number;
    memoryLeakWarning: boolean;
    suddenSpike: boolean; // Detects sudden memory increases
    spikeDetails: {
      fromMB: number;
      toMB: number;
      increaseMB: number;
      timeAgo: string;
    } | null;
  };
  analysis: {
    largestComponent: string;
    externalToHeapRatio: number;
    totalMemoryMB: number;
    memoryPressure: 'low' | 'medium' | 'high' | 'critical';
  };
}

export class MemoryMonitor {
  private history: MemorySnapshot[] = [];
  private readonly maxHistorySize = 288; // 24 hours at 5min intervals
  private readonly snapshotInterval = 5 * 60 * 1000; // 5 minutes
  private intervalId: NodeJS.Timeout | null = null;
  private readonly memoryLimitMB = 500; // From ecosystem.config.js

  start(): void {
    if (this.intervalId) return;
    
    // Take initial snapshot
    this.takeSnapshot().catch(error => {
      logger.error('Initial memory snapshot failed:', error);
    });
    
    // Set up interval for regular snapshots
    this.intervalId = setInterval(async () => {
      await this.takeSnapshot().catch(error => {
        logger.error('Memory snapshot failed:', error);
      });
    }, this.snapshotInterval);
    
    logger.info('Memory monitoring started - taking snapshots every 5 minutes');
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('Memory monitoring stopped');
    }
  }

  private async takeSnapshot(): Promise<void> {
    const usage = process.memoryUsage();
    const snapshot: MemorySnapshot = {
      timestamp: Date.now(),
      heapUsed: Math.round(usage.heapUsed / 1024 / 1024),
      heapTotal: Math.round(usage.heapTotal / 1024 / 1024),
      external: Math.round(usage.external / 1024 / 1024),
      rss: Math.round(usage.rss / 1024 / 1024),
      arrayBuffers: Math.round(usage.arrayBuffers / 1024 / 1024)
    };

    this.history.push(snapshot);
    
    // Keep history within limits
    if (this.history.length > this.maxHistorySize) {
      this.history = this.history.slice(-this.maxHistorySize);
    }

    // Monitor memory without forced GC - let's observe natural patterns
    if (snapshot.rss > this.memoryLimitMB * 0.9) {
      logger.warn('Memory usage approaching limit', {
        rss: snapshot.rss,
        limit: this.memoryLimitMB,
        external: snapshot.external,
        heap: snapshot.heapUsed,
        other: snapshot.rss - snapshot.heapUsed - snapshot.external
      });
    }
  }

  getStats(): MemoryStats {
    if (this.history.length === 0) {
      this.takeSnapshot().catch(error => {
        logger.error('Stats snapshot failed:', error);
      });
    }

    const current = this.history[this.history.length - 1]!;
    const trends = this.calculateTrends();
    const analysis = this.analyzeMemory(current);

    return {
      current,
      history: this.history.slice(-24), // Last 2 hours for API response
      trends,
      analysis
    };
  }

  private calculateTrends() {
    if (this.history.length < 2) {
      return {
        heapGrowthRate: 0,
        externalGrowthRate: 0,
        rssGrowthRate: 0,
        memoryLeakWarning: false,
        suddenSpike: false,
        spikeDetails: null
      };
    }

    // Need at least 2 hours of data (24 samples) to avoid startup false positives
    const recentHistory = this.history.slice(-24);
    if (recentHistory.length < 12) { // Need at least 1 hour of samples
      return {
        heapGrowthRate: 0,
        externalGrowthRate: 0,
        rssGrowthRate: 0,
        memoryLeakWarning: false,
        suddenSpike: false,
        spikeDetails: null
      };
    }

    // Skip first 30 minutes of samples to avoid startup allocation noise
    const stableHistory = recentHistory.slice(6); // Skip first 6 samples (30 min)
    if (stableHistory.length < 6) {
      return {
        heapGrowthRate: 0,
        externalGrowthRate: 0,
        rssGrowthRate: 0,
        memoryLeakWarning: false,
        suddenSpike: false,
        spikeDetails: null
      };
    }

    const first = stableHistory[0]!;
    const last = stableHistory[stableHistory.length - 1]!;
    const hoursDiff = (last.timestamp - first.timestamp) / (1000 * 60 * 60);

    if (hoursDiff < 0.5) { // Need at least 30 minutes of stable data
      return {
        heapGrowthRate: 0,
        externalGrowthRate: 0,
        rssGrowthRate: 0,
        memoryLeakWarning: false,
        suddenSpike: false,
        spikeDetails: null
      };
    }

    const heapGrowthRate = (last.heapUsed - first.heapUsed) / hoursDiff;
    const externalGrowthRate = (last.external - first.external) / hoursDiff;
    const rssGrowthRate = (last.rss - first.rss) / hoursDiff;

    // More conservative memory leak detection:
    // - Need sustained growth >15MB/hour for RSS
    // - Need at least 2 hours of data
    // - Exclude growth during first hour after restart
    const memoryLeakWarning = hoursDiff >= 2 && rssGrowthRate > 15 && heapGrowthRate > 5;

    // Detect sudden memory spikes (>100MB increase within 30 minutes)
    const { suddenSpike, spikeDetails } = this.detectMemorySpike();

    return {
      heapGrowthRate: Math.round(heapGrowthRate * 100) / 100,
      externalGrowthRate: Math.round(externalGrowthRate * 100) / 100,
      rssGrowthRate: Math.round(rssGrowthRate * 100) / 100,
      memoryLeakWarning,
      suddenSpike,
      spikeDetails
    };
  }

  private analyzeMemory(snapshot: MemorySnapshot) {
    const components = {
      heap: snapshot.heapUsed,
      external: snapshot.external,
      other: snapshot.rss - snapshot.heapUsed - snapshot.external
    };

    let largestComponent = 'heap';
    if (components.external > components.heap && components.external > components.other) {
      largestComponent = 'external';
    } else if (components.other > components.heap && components.other > components.external) {
      largestComponent = 'other';
    }

    const externalToHeapRatio = snapshot.heapUsed > 0 ? 
      Math.round((snapshot.external / snapshot.heapUsed) * 100) / 100 : 0;

    let memoryPressure: 'low' | 'medium' | 'high' | 'critical' = 'low';
    const usagePercent = snapshot.rss / this.memoryLimitMB;

    if (usagePercent > 0.95) memoryPressure = 'critical';
    else if (usagePercent > 0.85) memoryPressure = 'high';
    else if (usagePercent > 0.70) memoryPressure = 'medium';

    return {
      largestComponent,
      externalToHeapRatio,
      totalMemoryMB: snapshot.rss,
      memoryPressure
    };
  }

  // Get memory breakdown for webhook/WS analysis
  getMemoryBreakdown() {
    if (this.history.length === 0) {
      this.takeSnapshot().catch(error => {
        logger.error('Breakdown snapshot failed:', error);
      });
    }
    const current = this.history[this.history.length - 1]!;
    
    // Get additional system info for analysis
    const gcStats = this.getGCStats();
    const processInfo = this.getProcessInfo();
    
    return {
      processMemory: {
        rss: current.rss, // Total process memory
        heap: current.heapUsed,
        external: current.external, // Native modules, buffers, etc
        arrayBuffers: current.arrayBuffers,
        other: current.rss - current.heapUsed - current.external
      },
      analysis: {
        externalMemoryDominance: current.external > current.heapUsed * 2,
        memoryFragmentation: (current.heapTotal - current.heapUsed) / current.heapTotal,
        likelyMemoryConsumers: this.identifyMemoryConsumers(current),
        gcPressure: gcStats
      },
      processInfo,
      suspects: {
        databaseConnections: 'SQLite + Prisma (WAL mode enabled)',
        webhookBuffers: 'Express + body parsing (1MB limit)',
        httpConnections: 'Axios DexScreener API (300 req/min)',
        telegramBot: 'Telegraf bot framework',
        nativeModules: 'Node.js sqlite3, crypto modules'
      },
      recommendations: this.getRecommendations(current)
    };
  }

  private getGCStats() {
    try {
      if (global.gc) {
        const before = process.memoryUsage();
        global.gc();
        const after = process.memoryUsage();
        
        return {
          freedMemoryMB: Math.round((before.heapUsed - after.heapUsed) / 1024 / 1024),
          gcAvailable: true,
          beforeGC: Math.round(before.heapUsed / 1024 / 1024),
          afterGC: Math.round(after.heapUsed / 1024 / 1024)
        };
      }
    } catch (e) {
      // GC failed or not available
    }
    
    return { gcAvailable: false };
  }

  private getProcessInfo() {
    return {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      uptime: Math.round(process.uptime()),
      pid: process.pid,
      cwd: process.cwd(),
      execPath: process.execPath
    };
  }

  private identifyMemoryConsumers(snapshot: MemorySnapshot): string[] {
    const consumers: string[] = [];
    
    // External memory is 12x larger than heap - this is the main issue
    if (snapshot.external > snapshot.heapUsed * 10) {
      consumers.push('CRITICAL: External memory dominance (likely native modules/database)');
    }
    
    if (snapshot.external > 300) {
      consumers.push('High external memory usage (database/HTTP connections)');
    }
    
    if (snapshot.arrayBuffers > 50) {
      consumers.push('Significant ArrayBuffer usage (network buffers)');
    }
    
    if (snapshot.heapUsed > 100) {
      consumers.push('High JavaScript heap usage');
    }
    
    return consumers;
  }

  private getRecommendations(snapshot: MemorySnapshot): string[] {
    const recommendations: string[] = [];
    
    if (snapshot.external > snapshot.heapUsed * 5) {
      recommendations.push('Investigate native module memory usage');
      recommendations.push('Check database connection pooling configuration');
      recommendations.push('Review HTTP agent settings (keepAlive, maxSockets)');
    }
    
    if (snapshot.rss > 400) {
      recommendations.push('Consider implementing manual GC triggers during low activity');
      recommendations.push('Review webhook processing buffer sizes');
    }
    
    if (snapshot.arrayBuffers > 50) {
      recommendations.push('Monitor network buffer accumulation');
    }
    
    return recommendations;
  }

  // Detect low-activity windows to safely run GC
  private isLowActivityWindow(): boolean {
    const now = Date.now();
    const currentSeconds = Math.floor((now / 1000) % 60); // Seconds within 1-minute cycle
    
    // Hot list checks run every 1 minute (60 seconds)
    // Avoid GC during seconds 0-10 of each minute (when hot checks run)
    // This gives 50 seconds of safe window per minute
    const isHotCheckWindow = currentSeconds <= 10;
    
    // Also avoid first few minutes of each hour when hourly tasks run
    const currentMinute = Math.floor((now / (1000 * 60)) % 60);
    const isHourlyTaskWindow = currentMinute <= 2;
    
    // And avoid webhook processing bursts (tokens come in constantly but in waves)
    // Skip GC if we're in the first 20 seconds of each minute (peak activity)
    const isPeakActivity = currentSeconds <= 20;
    
    return !isHotCheckWindow && !isHourlyTaskWindow && !isPeakActivity;
  }

  // Detect sudden memory spikes (>100MB increase within 30 minutes)
  private detectMemorySpike(): { suddenSpike: boolean; spikeDetails: { fromMB: number; toMB: number; increaseMB: number; timeAgo: string; } | null } {
    if (this.history.length < 12) { // Need at least 1 hour of data
      return { suddenSpike: false, spikeDetails: null };
    }

    const current = this.history[this.history.length - 1]!;
    const thirtyMinAgo = current.timestamp - (30 * 60 * 1000);
    
    // Find the closest sample to 30 minutes ago
    let baselineSnapshot = this.history[this.history.length - 7]; // ~30 min ago (6 samples = 30 min)
    if (!baselineSnapshot) {
      baselineSnapshot = this.history[0]; // Use oldest available if less than 30 min of data
    }
    
    if (!baselineSnapshot) {
      return { suddenSpike: false, spikeDetails: null }; // Not enough data
    }
    
    const memoryIncrease = current.rss - baselineSnapshot.rss;
    const timeAgoMinutes = Math.round((current.timestamp - baselineSnapshot.timestamp) / (60 * 1000));
    
    // Consider it a spike if memory increased by >100MB in the timeframe
    // OR increased by >150MB from any point in the last 2 hours
    const isSpike = memoryIncrease > 100;
    
    // Check for larger spikes in the last 2 hours
    const twoHoursAgo = current.timestamp - (2 * 60 * 60 * 1000);
    let largestIncrease = memoryIncrease;
    let spikeBaselineSnapshot = baselineSnapshot;
    
    for (const snapshot of this.history) {
      if (snapshot.timestamp >= twoHoursAgo && snapshot.timestamp < current.timestamp) {
        const increase = current.rss - snapshot.rss;
        if (increase > largestIncrease) {
          largestIncrease = increase;
          spikeBaselineSnapshot = snapshot;
        }
      }
    }
    
    const isSuddenSpike = largestIncrease > 150 || isSpike;
    
    if (isSuddenSpike && spikeBaselineSnapshot) {
      const timeSinceSpike = Math.round((current.timestamp - spikeBaselineSnapshot.timestamp) / (60 * 1000));
      return {
        suddenSpike: true,
        spikeDetails: {
          fromMB: spikeBaselineSnapshot.rss,
          toMB: current.rss,
          increaseMB: largestIncrease,
          timeAgo: timeSinceSpike < 60 ? `${timeSinceSpike}m` : `${Math.round(timeSinceSpike / 60)}h`
        }
      };
    }
    
    return { suddenSpike: false, spikeDetails: null };
  }

  // Force garbage collection and return memory stats (for debugging)
  forceGCAndAnalyze() {
    if (!global.gc) {
      return { error: 'GC not available (needs --expose-gc flag)' };
    }
    
    const before = process.memoryUsage();
    global.gc();
    const after = process.memoryUsage();
    
    return {
      beforeGC: {
        rss: Math.round(before.rss / 1024 / 1024),
        heapUsed: Math.round(before.heapUsed / 1024 / 1024),
        external: Math.round(before.external / 1024 / 1024)
      },
      afterGC: {
        rss: Math.round(after.rss / 1024 / 1024),
        heapUsed: Math.round(after.heapUsed / 1024 / 1024),
        external: Math.round(after.external / 1024 / 1024)
      },
      freed: {
        rss: Math.round((before.rss - after.rss) / 1024 / 1024),
        heap: Math.round((before.heapUsed - after.heapUsed) / 1024 / 1024),
        external: Math.round((before.external - after.external) / 1024 / 1024)
      }
    };
  }
}

export const globalMemoryMonitor = new MemoryMonitor();