import { EventEmitter } from 'events';
import { TriggerResult } from '../types/triggers';
import { HotAlert } from '../types/hotlist';
import { logger } from '../utils/logger';

export interface AlertEvent {
  id: string;
  timestamp: number;
  type: 'long_trigger' | 'hot_alert' | 'system_alert';
  data: any;
  priority: 'low' | 'normal' | 'high' | 'critical';
}

export interface AlertSubscriber {
  id: string;
  handler: (event: AlertEvent) => Promise<void>;
  filters?: {
    types?: string[];
    symbols?: string[];
    priority?: string[];
  };
}

export class AlertEventBus extends EventEmitter {
  private subscribers = new Map<string, AlertSubscriber>();
  private eventHistory: AlertEvent[] = [];
  private readonly maxHistorySize = 1000;

  constructor() {
    super();
    this.setMaxListeners(50); // Increase limit for multiple subscribers
  }

  subscribe(subscriber: AlertSubscriber): void {
    this.subscribers.set(subscriber.id, subscriber);
    this.on('alert', this.createEventHandler(subscriber));
    
    logger.info(`Alert subscriber registered: ${subscriber.id}`);
  }

  unsubscribe(subscriberId: string): void {
    const subscriber = this.subscribers.get(subscriberId);
    if (subscriber) {
      this.removeAllListeners(`alert_${subscriberId}`);
      this.subscribers.delete(subscriberId);
      logger.info(`Alert subscriber unregistered: ${subscriberId}`);
    }
  }

  private createEventHandler(subscriber: AlertSubscriber) {
    return async (event: AlertEvent) => {
      try {
        // Apply filters
        if (subscriber.filters) {
          if (subscriber.filters.types && !subscriber.filters.types.includes(event.type)) {
            return;
          }
          
          if (subscriber.filters.priority && !subscriber.filters.priority.includes(event.priority)) {
            return;
          }
          
          if (subscriber.filters.symbols && event.data.symbol && 
              !subscriber.filters.symbols.includes(event.data.symbol)) {
            return;
          }
        }

        await subscriber.handler(event);
      } catch (error) {
        logger.error(`Error in alert subscriber ${subscriber.id}:`, error);
      }
    };
  }

  async emitLongTrigger(trigger: TriggerResult): Promise<void> {
    const event: AlertEvent = {
      id: `trigger_${trigger.coinId}_${trigger.triggerType}_${Date.now()}`,
      timestamp: Date.now(),
      type: 'long_trigger',
      data: trigger,
      priority: this.getTriggerPriority(trigger)
    };

    await this.emitEvent(event);
  }

  async emitHotAlert(alert: HotAlert): Promise<void> {
    const event: AlertEvent = {
      id: `hot_${alert.hotId}_${alert.alertType}_${Date.now()}`,
      timestamp: Date.now(),
      type: 'hot_alert',
      data: alert,
      priority: this.getHotAlertPriority(alert)
    };

    await this.emitEvent(event);
  }

  async emitSystemAlert(message: string, priority: 'low' | 'normal' | 'high' | 'critical' = 'normal'): Promise<void> {
    const event: AlertEvent = {
      id: `system_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      type: 'system_alert',
      data: { message },
      priority
    };

    await this.emitEvent(event);
  }

  private async emitEvent(event: AlertEvent): Promise<void> {
    // Add to history
    this.eventHistory.unshift(event);
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory = this.eventHistory.slice(0, this.maxHistorySize);
    }

    // Emit to subscribers
    this.emit('alert', event);
    
    logger.debug(`Alert event emitted: ${event.type} - ${event.id}`);
  }

  private getTriggerPriority(trigger: TriggerResult): 'low' | 'normal' | 'high' | 'critical' {
    switch (trigger.triggerType) {
      case 'retrace':
        return trigger.retraceFromHigh && trigger.retraceFromHigh > 30 ? 'high' : 'normal';
      case 'breakout':
        return 'high';
      case 'mcap':
        return 'normal';
      case 'stall':
        return 'low';
      default:
        return 'normal';
    }
  }

  private getHotAlertPriority(alert: HotAlert): 'low' | 'normal' | 'high' | 'critical' {
    switch (alert.alertType) {
      case 'failsafe':
        return 'critical';
      case 'pct':
        return Math.abs(alert.deltaFromAnchor) > 50 ? 'high' : 'normal';
      case 'mcap':
        return 'normal';
      default:
        return 'normal';
    }
  }

  getEventHistory(limit: number = 50): AlertEvent[] {
    return this.eventHistory.slice(0, limit);
  }

  getSubscriberCount(): number {
    return this.subscribers.size;
  }

  async clearHistory(): Promise<void> {
    this.eventHistory = [];
    logger.info('Alert event history cleared');
  }

  getStats(): {
    totalEvents: number;
    subscriberCount: number;
    eventsByType: Record<string, number>;
    eventsByPriority: Record<string, number>;
  } {
    const eventsByType: Record<string, number> = {};
    const eventsByPriority: Record<string, number> = {};

    for (const event of this.eventHistory) {
      eventsByType[event.type] = (eventsByType[event.type] || 0) + 1;
      eventsByPriority[event.priority] = (eventsByPriority[event.priority] || 0) + 1;
    }

    return {
      totalEvents: this.eventHistory.length,
      subscriberCount: this.subscribers.size,
      eventsByType,
      eventsByPriority
    };
  }
}

export const globalAlertBus = new AlertEventBus();