import { PairInfo } from '../types/dexscreener';
import { logger } from './logger';

export interface ValidationRule {
  name: string;
  validate(data: PairInfo): boolean;
  getMessage(data: PairInfo): string;
}

export interface AnomalyDetector {
  detectAnomalies(data: PairInfo[]): PairInfo[];
  isValidPriceMovement(oldPrice: number, newPrice: number, maxChangePct?: number): boolean;
}

class PriceAnomalyDetector implements AnomalyDetector {
  private readonly maxPriceChangePct = 95.0;
  private readonly minVolume = 100;
  private readonly maxVolumeMultiplier = 50;

  detectAnomalies(data: PairInfo[]): PairInfo[] {
    return data.filter(pair => this.hasAnomalies(pair));
  }

  private hasAnomalies(pair: PairInfo): boolean {
    if (Math.abs(pair.priceChange24h) > this.maxPriceChangePct) {
      logger.warn(`Anomaly detected: extreme price change`, {
        symbol: pair.symbol,
        change: pair.priceChange24h,
        threshold: this.maxPriceChangePct
      });
      return true;
    }

    if (pair.volume24h < this.minVolume && Math.abs(pair.priceChange24h) > 10) {
      logger.warn(`Anomaly detected: high price change with low volume`, {
        symbol: pair.symbol,
        volume: pair.volume24h,
        change: pair.priceChange24h
      });
      return true;
    }

    return false;
  }

  isValidPriceMovement(oldPrice: number, newPrice: number, maxChangePct: number = 95.0): boolean {
    if (oldPrice <= 0 || newPrice <= 0) return false;
    
    const changePct = Math.abs((newPrice - oldPrice) / oldPrice * 100);
    return changePct <= maxChangePct;
  }
}

export class DataValidator {
  private rules: ValidationRule[] = [];
  private anomalyDetector: AnomalyDetector;

  constructor() {
    this.anomalyDetector = new PriceAnomalyDetector();
    this.setupDefaultRules();
  }

  private setupDefaultRules(): void {
    this.rules = [
      {
        name: 'positive_price',
        validate: (data: PairInfo) => data.price > 0,
        getMessage: (data: PairInfo) => `Invalid price for ${data.symbol}: ${data.price}`
      },
      {
        name: 'non_negative_volume',
        validate: (data: PairInfo) => data.volume24h >= 0,
        getMessage: (data: PairInfo) => `Invalid volume for ${data.symbol}: ${data.volume24h}`
      },
      {
        name: 'reasonable_price_change',
        validate: (data: PairInfo) => Math.abs(data.priceChange24h) <= 1000,
        getMessage: (data: PairInfo) => `Extreme price change for ${data.symbol}: ${data.priceChange24h}%`
      },
      {
        name: 'valid_market_cap',
        validate: (data: PairInfo) => !data.marketCap || data.marketCap > 0,
        getMessage: (data: PairInfo) => `Invalid market cap for ${data.symbol}: ${data.marketCap}`
      },
      {
        name: 'valid_liquidity',
        validate: (data: PairInfo) => !data.liquidity || data.liquidity > 0,
        getMessage: (data: PairInfo) => `Invalid liquidity for ${data.symbol}: ${data.liquidity}`
      },
      {
        name: 'symbol_format',
        validate: (data: PairInfo) => /^[A-Z0-9-_]{1,20}$/i.test(data.symbol),
        getMessage: (data: PairInfo) => `Invalid symbol format: ${data.symbol}`
      }
    ];
  }

  validatePairData(data: PairInfo): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    for (const rule of this.rules) {
      if (!rule.validate(data)) {
        errors.push(rule.getMessage(data));
      }
    }

    const isValid = errors.length === 0;
    
    if (!isValid) {
      logger.warn(`Validation failed for ${data.symbol}:`, errors);
    }

    return { isValid, errors };
  }

  validatePairDataBatch(dataArray: PairInfo[]): {
    valid: PairInfo[];
    invalid: Array<{ data: PairInfo; errors: string[] }>;
    anomalies: PairInfo[];
  } {
    const valid: PairInfo[] = [];
    const invalid: Array<{ data: PairInfo; errors: string[] }> = [];
    const anomalies = this.anomalyDetector.detectAnomalies(dataArray);

    for (const data of dataArray) {
      const validation = this.validatePairData(data);
      
      if (validation.isValid && !anomalies.includes(data)) {
        valid.push(data);
      } else if (!validation.isValid) {
        invalid.push({ data, errors: validation.errors });
      }
    }

    return { valid, invalid, anomalies };
  }

  sanitizePairData(data: PairInfo): PairInfo {
    return {
      ...data,
      price: Math.max(0, data.price),
      volume24h: Math.max(0, data.volume24h),
      priceChange24h: Math.max(-99.9, Math.min(1000, data.priceChange24h)),
      marketCap: data.marketCap && data.marketCap > 0 ? data.marketCap : null,
      liquidity: data.liquidity && data.liquidity > 0 ? data.liquidity : null,
      symbol: data.symbol.toUpperCase().trim(),
      name: data.name.trim()
    };
  }

  addCustomRule(rule: ValidationRule): void {
    this.rules.push(rule);
    logger.info(`Added custom validation rule: ${rule.name}`);
  }

  removeRule(name: string): void {
    this.rules = this.rules.filter(rule => rule.name !== name);
    logger.info(`Removed validation rule: ${name}`);
  }

  isValidPriceMovement(oldPrice: number, newPrice: number, maxChangePct?: number): boolean {
    return this.anomalyDetector.isValidPriceMovement(oldPrice, newPrice, maxChangePct);
  }

  detectSuspiciousPatterns(historicalData: Array<{ price: number; volume: number; timestamp: number }>): Array<{
    type: string;
    message: string;
    severity: 'low' | 'medium' | 'high';
  }> {
    const issues: Array<{ type: string; message: string; severity: 'low' | 'medium' | 'high' }> = [];

    if (historicalData.length < 2) return issues;

    let consecutiveZeroVolume = 0;
    let extremePriceChanges = 0;

    for (let i = 1; i < historicalData.length; i++) {
      const current = historicalData[i];
      const previous = historicalData[i - 1];

      if (!current || !previous) continue;

      if (current.volume === 0) {
        consecutiveZeroVolume++;
      } else {
        consecutiveZeroVolume = 0;
      }

      if (previous.price > 0) {
        const priceChange = Math.abs((current.price - previous.price) / previous.price * 100);
        if (priceChange > 50) {
          extremePriceChanges++;
        }
      }
    }

    if (consecutiveZeroVolume >= 3) {
      issues.push({
        type: 'zero_volume_streak',
        message: `${consecutiveZeroVolume} consecutive periods with zero volume`,
        severity: 'medium'
      });
    }

    if (extremePriceChanges > historicalData.length * 0.3) {
      issues.push({
        type: 'excessive_volatility',
        message: `${extremePriceChanges} extreme price changes out of ${historicalData.length} periods`,
        severity: 'high'
      });
    }

    const avgVolume = historicalData.reduce((sum, d) => sum + d.volume, 0) / historicalData.length;
    const recentVolume = historicalData.slice(-3).reduce((sum, d) => sum + d.volume, 0) / 3;

    if (avgVolume > 1000 && recentVolume < avgVolume * 0.1) {
      issues.push({
        type: 'volume_drop',
        message: `Recent volume dropped significantly (${recentVolume.toFixed(0)} vs avg ${avgVolume.toFixed(0)})`,
        severity: 'medium'
      });
    }

    return issues;
  }
}

export function createDataValidator(): DataValidator {
  return new DataValidator();
}

export function isValidSymbol(symbol: string): boolean {
  return /^[A-Z0-9-_]{1,20}$/i.test(symbol.trim());
}

export function sanitizeUserInput(input: string): string {
  return input.trim().replace(/[^a-zA-Z0-9-_.,=+\s]/g, '');
}

export function validateNumericRange(value: number, min: number, max: number, name: string): { valid: boolean; error?: string } {
  if (isNaN(value)) {
    return { valid: false, error: `${name} must be a valid number` };
  }
  
  if (value < min) {
    return { valid: false, error: `${name} must be at least ${min}` };
  }
  
  if (value > max) {
    return { valid: false, error: `${name} must not exceed ${max}` };
  }
  
  return { valid: true };
}