import { logger } from '../utils/logger';

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  keyGenerator?: (identifier: string) => string;
}

export interface AlertRateLimiter {
  canSendAlert(coinId: number, triggerType: string): boolean;
  recordAlert(coinId: number, triggerType: string): void;
  reset(): void;
}

export interface GlobalRateLimiter {
  canSendMessage(): boolean;
  recordMessage(): void;
  getNextAvailableSlot(): number;
}

class TokenBucketRateLimiter implements GlobalRateLimiter {
  public tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillRate: number; // tokens per second
  
  constructor(maxTokens: number, refillRate: number) {
    this.maxTokens = maxTokens;
    this.refillRate = refillRate;
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  private refillTokens(): void {
    const now = Date.now();
    const timePassed = (now - this.lastRefill) / 1000; // seconds
    const tokensToAdd = timePassed * this.refillRate;
    
    this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  canSendMessage(): boolean {
    this.refillTokens();
    return this.tokens >= 1;
  }

  recordMessage(): void {
    this.refillTokens();
    if (this.tokens >= 1) {
      this.tokens -= 1;
    }
  }

  getNextAvailableSlot(): number {
    this.refillTokens();
    if (this.tokens >= 1) return 0;
    
    const tokensNeeded = 1 - this.tokens;
    return (tokensNeeded / this.refillRate) * 1000; // milliseconds
  }
}

class CooldownAlertLimiter implements AlertRateLimiter {
  public cooldowns = new Map<string, number>();
  private readonly cooldownMs: number;
  private readonly hysteresisMs: number;

  constructor(cooldownHours: number = 2, hysteresisPct: number = 30) {
    this.cooldownMs = cooldownHours * 60 * 60 * 1000;
    this.hysteresisMs = (hysteresisPct / 100) * this.cooldownMs;
  }

  canSendAlert(coinId: number, triggerType: string): boolean {
    const key = `${coinId}_${triggerType}`;
    const lastAlert = this.cooldowns.get(key);
    
    if (!lastAlert) return true;
    
    const now = Date.now();
    const timeSinceLastAlert = now - lastAlert;
    
    return timeSinceLastAlert >= this.cooldownMs;
  }

  recordAlert(coinId: number, triggerType: string): void {
    const key = `${coinId}_${triggerType}`;
    this.cooldowns.set(key, Date.now());
  }

  reset(): void {
    this.cooldowns.clear();
  }

  getRemainingCooldown(coinId: number, triggerType: string): number {
    const key = `${coinId}_${triggerType}`;
    const lastAlert = this.cooldowns.get(key);
    
    if (!lastAlert) return 0;
    
    const now = Date.now();
    const elapsed = now - lastAlert;
    const remaining = this.cooldownMs - elapsed;
    
    return Math.max(0, remaining);
  }
}

export class AlertDeduplicator {
  public recentAlerts = new Map<string, number>();
  private readonly dedupeWindowMs: number;

  constructor(dedupeWindowMs: number = 30000) { // 30 seconds
    this.dedupeWindowMs = dedupeWindowMs;
  }

  isDuplicate(fingerprint: string): boolean {
    const lastSent = this.recentAlerts.get(fingerprint);
    
    if (!lastSent) return false;
    
    const now = Date.now();
    return (now - lastSent) < this.dedupeWindowMs;
  }

  recordAlert(fingerprint: string): void {
    this.recentAlerts.set(fingerprint, Date.now());
    
    this.cleanup();
  }

  private cleanup(): void {
    const now = Date.now();
    const cutoff = now - this.dedupeWindowMs;
    
    for (const [fingerprint, timestamp] of this.recentAlerts.entries()) {
      if (timestamp < cutoff) {
        this.recentAlerts.delete(fingerprint);
      }
    }
  }

  reset(): void {
    this.recentAlerts.clear();
  }
}

export class RateLimitService {
  private globalLimiter: GlobalRateLimiter;
  private alertLimiter: AlertRateLimiter;
  private deduplicator: AlertDeduplicator;
  private messageQueue: Array<{
    message: string;
    timestamp: number;
    priority: 'high' | 'normal' | 'low';
  }> = [];

  constructor(
    maxMessagesPerMinute: number = 20,
    alertCooldownHours: number = 2,
    hysteresisPct: number = 30
  ) {
    this.globalLimiter = new TokenBucketRateLimiter(
      maxMessagesPerMinute,
      maxMessagesPerMinute / 60 // messages per second
    );
    
    this.alertLimiter = new CooldownAlertLimiter(alertCooldownHours, hysteresisPct);
    this.deduplicator = new AlertDeduplicator();
  }

  canSendAlert(coinId: number, triggerType: string, fingerprint?: string): {
    allowed: boolean;
    reason?: string;
    waitTimeMs?: number;
  } {
    if (fingerprint && this.deduplicator.isDuplicate(fingerprint)) {
      return {
        allowed: false,
        reason: 'duplicate',
        waitTimeMs: 0
      };
    }

    if (!this.alertLimiter.canSendAlert(coinId, triggerType)) {
      const remaining = (this.alertLimiter as CooldownAlertLimiter).getRemainingCooldown(coinId, triggerType);
      return {
        allowed: false,
        reason: 'cooldown',
        waitTimeMs: remaining
      };
    }

    if (!this.globalLimiter.canSendMessage()) {
      const waitTime = this.globalLimiter.getNextAvailableSlot();
      return {
        allowed: false,
        reason: 'rate_limit',
        waitTimeMs: waitTime
      };
    }

    return { allowed: true };
  }

  recordAlert(coinId: number, triggerType: string, fingerprint?: string): void {
    this.alertLimiter.recordAlert(coinId, triggerType);
    this.globalLimiter.recordMessage();
    
    if (fingerprint) {
      this.deduplicator.recordAlert(fingerprint);
    }

    logger.debug(`Recorded alert for coin ${coinId}, trigger ${triggerType}`);
  }

  canSendMessage(): { allowed: boolean; waitTimeMs?: number } {
    if (!this.globalLimiter.canSendMessage()) {
      const waitTime = this.globalLimiter.getNextAvailableSlot();
      return { allowed: false, waitTimeMs: waitTime };
    }

    return { allowed: true };
  }

  recordMessage(): void {
    this.globalLimiter.recordMessage();
  }

  queueMessage(message: string, priority: 'high' | 'normal' | 'low' = 'normal'): void {
    this.messageQueue.push({
      message,
      timestamp: Date.now(),
      priority
    });

    this.messageQueue.sort((a, b) => {
      const priorityOrder = { high: 0, normal: 1, low: 2 };
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      
      return a.timestamp - b.timestamp;
    });

    this.messageQueue = this.messageQueue.slice(0, 100);

    logger.debug(`Queued message with priority ${priority}, queue size: ${this.messageQueue.length}`);
  }

  getQueuedMessages(maxCount: number = 10): Array<{
    message: string;
    timestamp: number;
    priority: 'high' | 'normal' | 'low';
  }> {
    const messages = this.messageQueue.slice(0, maxCount);
    this.messageQueue = this.messageQueue.slice(maxCount);
    return messages;
  }

  getQueueSize(): number {
    return this.messageQueue.length;
  }

  clearQueue(): void {
    this.messageQueue = [];
    logger.info('Message queue cleared');
  }

  getRateLimitStats(): {
    globalTokensRemaining: number;
    queueSize: number;
    activeCooldowns: number;
    recentDuplicates: number;
  } {
    const globalTokens = (this.globalLimiter as TokenBucketRateLimiter).tokens || 0;
    const activeCooldowns = (this.alertLimiter as CooldownAlertLimiter).cooldowns?.size || 0;
    const recentDuplicates = this.deduplicator.recentAlerts?.size || 0;

    return {
      globalTokensRemaining: Math.floor(globalTokens),
      queueSize: this.messageQueue.length,
      activeCooldowns,
      recentDuplicates
    };
  }

  reset(): void {
    this.alertLimiter.reset();
    this.deduplicator.reset();
    this.clearQueue();
    logger.info('Rate limiter reset');
  }
}

export function createRateLimitService(config?: {
  maxMessagesPerMinute?: number;
  alertCooldownHours?: number;
  hysteresisPct?: number;
}): RateLimitService {
  return new RateLimitService(
    config?.maxMessagesPerMinute,
    config?.alertCooldownHours,
    config?.hysteresisPct
  );
}