import { logger } from '../utils/logger';

export interface Job {
  id: string;
  type: string;
  data: unknown;
  priority: number;
  maxRetries: number;
  currentRetries: number;
  createdAt: number;
  scheduledAt?: number | undefined;
  processingStartedAt?: number | undefined;
}

export interface JobHandler {
  type: string;
  handler: (job: Job) => Promise<void>;
  concurrency?: number;
}

export class BackgroundJobQueue {
  private jobs = new Map<string, Job>();
  private handlers = new Map<string, JobHandler>();
  private processing = new Set<string>();
  private isRunning = false;
  private processingInterval: NodeJS.Timeout | undefined = undefined;
  private readonly maxConcurrentJobs = 5;

  constructor() {
    this.processingInterval = setInterval(() => {
      this.processJobs().catch(error => {
        logger.error('Error in job processing loop:', error);
      });
    }, 1000); // Process jobs every second
  }

  addHandler(handler: JobHandler): void {
    this.handlers.set(handler.type, handler);
    logger.info(`Job handler registered for type: ${handler.type}`);
  }

  removeHandler(type: string): void {
    this.handlers.delete(type);
    logger.info(`Job handler removed for type: ${type}`);
  }

  async addJob(
    type: string,
    data: unknown,
    options: {
      priority?: number;
      maxRetries?: number;
      delay?: number;
    } = {}
  ): Promise<string> {
    const job: Job = {
      id: `${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      data,
      priority: options.priority || 5,
      maxRetries: options.maxRetries || 3,
      currentRetries: 0,
      createdAt: Date.now(),
      scheduledAt: options.delay ? Date.now() + options.delay : undefined
    };

    this.jobs.set(job.id, job);
    logger.debug(`Job added: ${job.id} (type: ${type}, priority: ${job.priority})`);
    
    return job.id;
  }

  async removeJob(jobId: string): Promise<boolean> {
    if (this.processing.has(jobId)) {
      logger.warn(`Cannot remove job ${jobId}: currently processing`);
      return false;
    }

    const removed = this.jobs.delete(jobId);
    if (removed) {
      logger.debug(`Job removed: ${jobId}`);
    }
    
    return removed;
  }

  private async processJobs(): Promise<void> {
    if (!this.isRunning || this.processing.size >= this.maxConcurrentJobs) {
      return;
    }

    const readyJobs = this.getReadyJobs();
    if (readyJobs.length === 0) {
      return;
    }

    // Sort by priority (lower number = higher priority)
    readyJobs.sort((a, b) => a.priority - b.priority);

    const availableSlots = this.maxConcurrentJobs - this.processing.size;
    const jobsToProcess = readyJobs.slice(0, availableSlots);

    for (const job of jobsToProcess) {
      this.processJob(job).catch(error => {
        logger.error(`Error processing job ${job.id}:`, error);
      });
    }
  }

  private getReadyJobs(): Job[] {
    const now = Date.now();
    const readyJobs: Job[] = [];

    for (const job of this.jobs.values()) {
      if (this.processing.has(job.id)) continue;
      
      if (job.scheduledAt && job.scheduledAt > now) continue;
      
      if (!this.handlers.has(job.type)) {
        logger.warn(`No handler found for job type: ${job.type}`);
        continue;
      }

      readyJobs.push(job);
    }

    return readyJobs;
  }

  private async processJob(job: Job): Promise<void> {
    this.processing.add(job.id);
    job.processingStartedAt = Date.now();

    const handler = this.handlers.get(job.type);
    if (!handler) {
      logger.error(`No handler found for job type: ${job.type}`);
      this.processing.delete(job.id);
      this.jobs.delete(job.id);
      return;
    }

    try {
      logger.debug(`Processing job: ${job.id} (attempt ${job.currentRetries + 1})`);
      
      await handler.handler(job);
      
      // Job completed successfully
      this.jobs.delete(job.id);
      this.processing.delete(job.id);
      
      logger.debug(`Job completed: ${job.id}`);
      
    } catch (error) {
      logger.error(`Job failed: ${job.id}`, error);
      
      job.currentRetries++;
      this.processing.delete(job.id);
      
      if (job.currentRetries >= job.maxRetries) {
        logger.error(`Job ${job.id} failed after ${job.maxRetries} retries, removing`);
        this.jobs.delete(job.id);
      } else {
        // Schedule retry with exponential backoff
        const delay = Math.pow(2, job.currentRetries) * 1000; // 2s, 4s, 8s, etc.
        job.scheduledAt = Date.now() + delay;
        logger.info(`Job ${job.id} will retry in ${delay}ms`);
      }
    }
  }

  start(): void {
    this.isRunning = true;
    logger.info('Background job queue started');
  }

  stop(): void {
    this.isRunning = false;
    
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = undefined;
    }
    
    logger.info('Background job queue stopped');
  }

  async waitForCompletion(timeout: number = 30000): Promise<void> {
    const start = Date.now();
    
    while (this.jobs.size > 0 && (Date.now() - start) < timeout) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    if (this.jobs.size > 0) {
      logger.warn(`Job queue timeout: ${this.jobs.size} jobs remaining`);
    }
  }

  getStats(): {
    totalJobs: number;
    processingJobs: number;
    pendingJobs: number;
    jobsByType: Record<string, number>;
    avgProcessingTime: number;
  } {
    const jobsByType: Record<string, number> = {};
    let totalProcessingTime = 0;
    let completedJobs = 0;

    for (const job of this.jobs.values()) {
      jobsByType[job.type] = (jobsByType[job.type] || 0) + 1;
      
      if (job.processingStartedAt) {
        totalProcessingTime += Date.now() - job.processingStartedAt;
        completedJobs++;
      }
    }

    return {
      totalJobs: this.jobs.size,
      processingJobs: this.processing.size,
      pendingJobs: this.jobs.size - this.processing.size,
      jobsByType,
      avgProcessingTime: completedJobs > 0 ? totalProcessingTime / completedJobs : 0
    };
  }

  clearCompletedJobs(): void {
    // Only clear jobs that aren't processing
    for (const [jobId, job] of this.jobs.entries()) {
      if (!this.processing.has(jobId)) {
        this.jobs.delete(jobId);
      }
    }
    
    logger.info('Cleared completed jobs from queue');
  }
}

export const globalJobQueue = new BackgroundJobQueue();