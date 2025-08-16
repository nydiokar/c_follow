import { createDataValidator, validateNumericRange, isValidSymbol } from '../utils/validation';
import { PairInfo } from '../types/dexscreener';

describe('Data Validation', () => {
  const validator = createDataValidator();

  describe('validatePairData', () => {
    const validPairInfo: PairInfo = {
      chainId: 'solana',
      tokenAddress: '0x123',
      symbol: 'TEST',
      name: 'Test Token',
      price: 1.50,
      marketCap: 1000000,
      volume24h: 50000,
      priceChange24h: 5.5,
      liquidity: 200000,
      lastUpdated: Date.now()
    };

    it('should validate correct pair data', () => {
      const result = validator.validatePairData(validPairInfo);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject negative prices', () => {
      const invalidPair = { ...validPairInfo, price: -1 };
      const result = validator.validatePairData(invalidPair);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Invalid price for TEST: -1');
    });

    it('should reject negative volume', () => {
      const invalidPair = { ...validPairInfo, volume24h: -1000 };
      const result = validator.validatePairData(invalidPair);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Invalid volume for TEST: -1000');
    });

    it('should reject extreme price changes', () => {
      const invalidPair = { ...validPairInfo, priceChange24h: 1500 };
      const result = validator.validatePairData(invalidPair);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Extreme price change for TEST: 1500%');
    });

    it('should reject invalid symbols', () => {
      const invalidPair = { ...validPairInfo, symbol: 'INVALID_SYMBOL_TOO_LONG' };
      const result = validator.validatePairData(invalidPair);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Invalid symbol format: INVALID_SYMBOL_TOO_LONG');
    });
  });

  describe('validatePairDataBatch', () => {
    it('should separate valid and invalid data', () => {
      const data = [
        {
          chainId: 'solana',
          tokenAddress: '0x123',
          symbol: 'VALID',
          name: 'Valid Token',
          price: 1.50,
          marketCap: 1000000,
          volume24h: 50000,
          priceChange24h: 5.5,
          liquidity: 200000,
          lastUpdated: Date.now()
        },
        {
          chainId: 'solana',
          tokenAddress: '0x456',
          symbol: 'INVALID',
          name: 'Invalid Token',
          price: -1, // Invalid price
          marketCap: 1000000,
          volume24h: 50000,
          priceChange24h: 5.5,
          liquidity: 200000,
          lastUpdated: Date.now()
        }
      ];

      const result = validator.validatePairDataBatch(data);
      expect(result.valid).toHaveLength(1);
      expect(result.invalid).toHaveLength(1);
      expect(result.invalid[0]?.errors).toContain('Invalid price for INVALID: -1');
    });
  });

  describe('detectSuspiciousPatterns', () => {
    it('should detect zero volume streaks', () => {
      const data = [
        { price: 1, volume: 0, timestamp: 1000 },
        { price: 1, volume: 0, timestamp: 2000 },
        { price: 1, volume: 0, timestamp: 3000 },
        { price: 1, volume: 0, timestamp: 4000 }
      ];

      const issues = validator.detectSuspiciousPatterns(data);
      expect(issues).toContainEqual({
        type: 'zero_volume_streak',
        message: '3 consecutive periods with zero volume',
        severity: 'medium'
      });
    });

    it('should detect excessive volatility', () => {
      const data = [
        { price: 1, volume: 1000, timestamp: 1000 },
        { price: 2, volume: 1000, timestamp: 2000 }, // 100% change
        { price: 1, volume: 1000, timestamp: 3000 }, // 50% change
        { price: 2, volume: 1000, timestamp: 4000 }  // 100% change
      ];

      const issues = validator.detectSuspiciousPatterns(data);
      expect(issues.some(issue => issue.type === 'excessive_volatility')).toBe(true);
    });
  });
});

describe('Utility Functions', () => {
  describe('validateNumericRange', () => {
    it('should validate numbers within range', () => {
      const result = validateNumericRange(5, 1, 10, 'test value');
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should reject numbers below minimum', () => {
      const result = validateNumericRange(0, 1, 10, 'test value');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('test value must be at least 1');
    });

    it('should reject numbers above maximum', () => {
      const result = validateNumericRange(15, 1, 10, 'test value');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('test value must not exceed 10');
    });

    it('should reject NaN values', () => {
      const result = validateNumericRange(NaN, 1, 10, 'test value');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('test value must be a valid number');
    });
  });

  describe('isValidSymbol', () => {
    it('should accept valid symbols', () => {
      expect(isValidSymbol('BTC')).toBe(true);
      expect(isValidSymbol('ETH-USD')).toBe(true);
      expect(isValidSymbol('SOL_USDC')).toBe(true);
      expect(isValidSymbol('TOKEN123')).toBe(true);
    });

    it('should reject invalid symbols', () => {
      expect(isValidSymbol('')).toBe(false);
      expect(isValidSymbol('A')).toBe(true); // Single char is valid
      expect(isValidSymbol('SYMBOL_TOO_LONG_FOR_VALIDATION')).toBe(false);
      expect(isValidSymbol('SYMBOL@INVALID')).toBe(false);
      expect(isValidSymbol('SYMBOL WITH SPACES')).toBe(false);
    });
  });
});