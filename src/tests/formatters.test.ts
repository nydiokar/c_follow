import { Formatters } from '../utils/formatters';

describe('Formatters', () => {
  describe('formatPrice', () => {
    it('should format prices with correct decimals', () => {
      expect(Formatters.formatPrice(1.2345)).toBe('1.2345');
      expect(Formatters.formatPrice(0.000123)).toBe('0.000123');
      expect(Formatters.formatPrice(123.456)).toBe('123.4560');
    });
  });

  describe('formatVolume', () => {
    it('should format volume with appropriate units', () => {
      expect(Formatters.formatVolume(1500000000)).toBe('1.5B');
      expect(Formatters.formatVolume(2500000)).toBe('2.5M');
      expect(Formatters.formatVolume(3500)).toBe('3.5K');
      expect(Formatters.formatVolume(150)).toBe('150');
    });
  });

  describe('formatMarketCap', () => {
    it('should format market cap with currency symbol', () => {
      expect(Formatters.formatMarketCap(1500000000)).toBe('$1.5B');
      expect(Formatters.formatMarketCap(2500000)).toBe('$2.5M');
      expect(Formatters.formatMarketCap(3500)).toBe('$3.5K');
      expect(Formatters.formatMarketCap(150)).toBe('$150');
    });
  });

  describe('formatPriceChange', () => {
    it('should format price changes with correct signs', () => {
      expect(Formatters.formatPriceChange(5.5)).toBe('+5.5%');
      expect(Formatters.formatPriceChange(-3.2)).toBe('-3.2%');
      expect(Formatters.formatPriceChange(0)).toBe('+0.0%');
    });
  });

  describe('formatDuration', () => {
    it('should format durations correctly', () => {
      expect(Formatters.formatDuration(90000)).toBe('1m 30s'); // 90 seconds
      expect(Formatters.formatDuration(3661000)).toBe('1h 1m'); // 1 hour 1 minute 1 second
      expect(Formatters.formatDuration(86400000)).toBe('1d 0h'); // 24 hours
    });
  });

  describe('escapeMarkdown', () => {
    it('should escape markdown special characters', () => {
      expect(Formatters.escapeMarkdown('*bold*')).toBe('\\*bold\\*');
      expect(Formatters.escapeMarkdown('_italic_')).toBe('\\_italic\\_');
      expect(Formatters.escapeMarkdown('[link](url)')).toBe('\\[link\\]\\(url\\)');
    });
  });
});