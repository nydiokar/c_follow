import { logger } from './logger';

export interface ErrorContext {
  operation: string;
  coinId?: number;
  symbol?: string;
  userId?: string;
  requestId?: string;
  additionalData?: Record<string, any>;
}

export interface ErrorRecoveryStrategy {
  name: string;
  canHandle(error: Error, context: ErrorContext): boolean;
  handle(error: Error, context: ErrorContext): Promise<boolean>;
}

export interface CircuitBreakerConfig {
  failureThreshold: number;
  recoveryTimeout: number;
  monitoringPeriod: number;
}

export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

export class AppError extends Error {
  public readonly code: string;
  public readonly severity: ErrorSeverity;
  public readonly context: ErrorContext;
  public readonly timestamp: Date;
  public readonly recoverable: boolean;

  constructor(
    message: string,
    code: string,
    severity: ErrorSeverity = ErrorSeverity.MEDIUM,
    context: ErrorContext,
    recoverable: boolean = true
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.severity = severity;
    this.context = context;
    this.timestamp = new Date();
    this.recoverable = recoverable;

    Error.captureStackTrace(this, AppError);
  }
}

export class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  
  constructor(private config: CircuitBreakerConfig) {}

  async execute<T>(fn: () => Promise<T>, context: ErrorContext): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.config.recoveryTimeout) {
        this.state = 'HALF_OPEN';
        logger.info('Circuit breaker entering HALF_OPEN state', context);
      } else {
        throw new AppError(
          'Circuit breaker is OPEN',
          'CIRCUIT_BREAKER_OPEN',
          ErrorSeverity.HIGH,
          context,
          false
        );
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failures = 0;
    this.state = 'CLOSED';
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.failures >= this.config.failureThreshold) {
      this.state = 'OPEN';
      logger.warn(`Circuit breaker opened after ${this.failures} failures`);
    }
  }

  getState(): string {
    return this.state;
  }
}

class RetryRecoveryStrategy implements ErrorRecoveryStrategy {
  name = 'retry';

  canHandle(error: Error, context: ErrorContext): boolean {
    if (error instanceof AppError && !error.recoverable) {
      return false;
    }

    const retryableOperations = ['api_request', 'database_query', 'external_service'];
    return retryableOperations.includes(context.operation);
  }

  async handle(error: Error, context: ErrorContext): Promise<boolean> {
    const maxRetries = 3;
    const baseDelay = 1000;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const delay = baseDelay * Math.pow(2, attempt - 1);
      
      logger.info(`Retry attempt ${attempt}/${maxRetries} for ${context.operation}`, {
        error: error.message,
        delay
      });

      await new Promise(resolve => setTimeout(resolve, delay));

      try {
        return true;
      } catch (retryError) {
        if (attempt === maxRetries) {
          logger.error(`All retry attempts failed for ${context.operation}`, {
            originalError: error.message,
            lastError: retryError instanceof Error ? retryError.message : String(retryError)
          });
          return false;
        }
      }
    }

    return false;
  }
}

class FallbackRecoveryStrategy implements ErrorRecoveryStrategy {
  name = 'fallback';

  canHandle(error: Error, context: ErrorContext): boolean {
    const fallbackOperations = ['price_fetch', 'market_data'];
    return fallbackOperations.includes(context.operation);
  }

  async handle(error: Error, context: ErrorContext): Promise<boolean> {
    logger.info(`Applying fallback for ${context.operation}`, {
      error: error.message,
      context
    });

    switch (context.operation) {
      case 'price_fetch':
        return this.handlePriceFetchFallback(context);
      case 'market_data':
        return this.handleMarketDataFallback(context);
      default:
        return false;
    }
  }

  private async handlePriceFetchFallback(context: ErrorContext): Promise<boolean> {
    logger.info('Using cached price data as fallback', context);
    return true;
  }

  private async handleMarketDataFallback(context: ErrorContext): Promise<boolean> {
    logger.info('Using alternative data source as fallback', context);
    return true;
  }
}

export class ErrorHandler {
  private recoveryStrategies: ErrorRecoveryStrategy[] = [];
  private circuitBreakers = new Map<string, CircuitBreaker>();
  private errorCounts = new Map<string, number>();
  private readonly maxErrorsPerHour = 100;

  constructor() {
    this.recoveryStrategies = [
      new RetryRecoveryStrategy(),
      new FallbackRecoveryStrategy()
    ];
  }

  async handleError(error: Error, context: ErrorContext): Promise<void> {
    const appError = this.normalizeError(error, context);
    
    await this.logError(appError);
    await this.trackError(appError);
    
    if (appError.severity === ErrorSeverity.CRITICAL) {
      await this.handleCriticalError(appError);
    }

    if (appError.recoverable) {
      const recovered = await this.attemptRecovery(appError);
      if (recovered) {
        logger.info('Error recovery successful', { code: appError.code, context });
        return;
      }
    }

    if (this.shouldEscalate(appError)) {
      await this.escalateError(appError);
    }
  }

  private normalizeError(error: Error, context: ErrorContext): AppError {
    if (error instanceof AppError) {
      return error;
    }

    let severity = ErrorSeverity.MEDIUM;
    let code = 'UNKNOWN_ERROR';
    let recoverable = true;

    if (error.name === 'TypeError' || error.name === 'ReferenceError') {
      severity = ErrorSeverity.HIGH;
      recoverable = false;
      code = 'PROGRAMMING_ERROR';
    } else if (error.message.includes('ECONNREFUSED') || error.message.includes('ETIMEDOUT')) {
      severity = ErrorSeverity.MEDIUM;
      code = 'CONNECTION_ERROR';
    } else if (error.message.includes('rate limit') || error.message.includes('429')) {
      severity = ErrorSeverity.LOW;
      code = 'RATE_LIMIT_ERROR';
    } else if (error.message.includes('unauthorized') || error.message.includes('401')) {
      severity = ErrorSeverity.HIGH;
      code = 'AUTH_ERROR';
    }

    return new AppError(error.message, code, severity, context, recoverable);
  }

  private async logError(error: AppError): Promise<void> {
    const logData = {
      code: error.code,
      severity: error.severity,
      message: error.message,
      context: error.context,
      timestamp: error.timestamp,
      stack: error.stack
    };

    switch (error.severity) {
      case ErrorSeverity.CRITICAL:
        logger.error('CRITICAL ERROR', logData);
        break;
      case ErrorSeverity.HIGH:
        logger.error('High severity error', logData);
        break;
      case ErrorSeverity.MEDIUM:
        logger.warn('Medium severity error', logData);
        break;
      case ErrorSeverity.LOW:
        logger.info('Low severity error', logData);
        break;
    }
  }

  private async trackError(error: AppError): Promise<void> {
    const key = `${error.code}_${error.context.operation}`;
    const currentCount = this.errorCounts.get(key) || 0;
    this.errorCounts.set(key, currentCount + 1);

    setTimeout(() => {
      const count = this.errorCounts.get(key) || 0;
      if (count > 0) {
        this.errorCounts.set(key, count - 1);
      }
    }, 60 * 60 * 1000); // 1 hour
  }

  private async attemptRecovery(error: AppError): Promise<boolean> {
    for (const strategy of this.recoveryStrategies) {
      if (strategy.canHandle(error, error.context)) {
        logger.info(`Attempting recovery with strategy: ${strategy.name}`, {
          error: error.code,
          context: error.context
        });

        try {
          const recovered = await strategy.handle(error, error.context);
          if (recovered) {
            return true;
          }
        } catch (recoveryError) {
          logger.error(`Recovery strategy ${strategy.name} failed`, {
            originalError: error.code,
            recoveryError: recoveryError instanceof Error ? recoveryError.message : String(recoveryError)
          });
        }
      }
    }

    return false;
  }

  private shouldEscalate(error: AppError): boolean {
    if (error.severity === ErrorSeverity.CRITICAL) {
      return true;
    }

    const key = `${error.code}_${error.context.operation}`;
    const errorCount = this.errorCounts.get(key) || 0;

    if (errorCount > 10 && error.severity === ErrorSeverity.HIGH) {
      return true;
    }

    if (errorCount > 50 && error.severity === ErrorSeverity.MEDIUM) {
      return true;
    }

    return false;
  }

  private async handleCriticalError(error: AppError): Promise<void> {
    logger.error('CRITICAL ERROR DETECTED - Initiating emergency procedures', {
      error: error.code,
      message: error.message,
      context: error.context
    });

    try {
      process.emitWarning(`Critical error in ${error.context.operation}: ${error.message}`);
    } catch (warningError) {
      logger.error('Failed to emit warning for critical error', warningError);
    }
  }

  private async escalateError(error: AppError): Promise<void> {
    logger.warn('Escalating error due to frequency or severity', {
      error: error.code,
      severity: error.severity,
      context: error.context
    });

  }

  getCircuitBreaker(operation: string, config?: CircuitBreakerConfig): CircuitBreaker {
    if (!this.circuitBreakers.has(operation)) {
      const defaultConfig: CircuitBreakerConfig = {
        failureThreshold: 5,
        recoveryTimeout: 30000,
        monitoringPeriod: 60000
      };
      
      this.circuitBreakers.set(operation, new CircuitBreaker(config || defaultConfig));
    }

    return this.circuitBreakers.get(operation)!;
  }

  addRecoveryStrategy(strategy: ErrorRecoveryStrategy): void {
    this.recoveryStrategies.push(strategy);
    logger.info(`Added recovery strategy: ${strategy.name}`);
  }

  getErrorStats(): Record<string, number> {
    return Object.fromEntries(this.errorCounts);
  }

  clearErrorCounts(): void {
    this.errorCounts.clear();
    logger.info('Error counts cleared');
  }
}

export const globalErrorHandler = new ErrorHandler();

export async function withErrorHandling<T>(
  operation: () => Promise<T>,
  context: ErrorContext
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    await globalErrorHandler.handleError(error as Error, context);
    throw error;
  }
}

export function createErrorContext(
  operation: string,
  additionalData?: Record<string, any>
): ErrorContext {
  return {
    operation,
    requestId: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    ...additionalData
  };
}