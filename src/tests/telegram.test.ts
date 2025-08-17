import { TelegramService } from '../services/telegram';
import { DatabaseService } from '../services/database';
import { LongListService } from '../services/longlist';
import { HotListService } from '../services/hotlist';
import { DexScreenerService } from '../services/dexscreener';
import { RollingWindowManager } from '../services/rollingWindow';
import { Message } from 'telegraf/types';
import { PairInfo } from '../types/dexscreener';

// Mock dependencies
jest.mock('../services/database');
jest.mock('../services/longlist');
jest.mock('../services/hotlist');
jest.mock('../services/dexscreener');
jest.mock('../services/rollingWindow');

const mockDb = jest.mocked(new DatabaseService());
const mockDexScreener = jest.mocked(new DexScreenerService(200));
const mockRollingWindow = jest.mocked(new RollingWindowManager());
const mockLongList = jest.mocked(new LongListService(mockDb, mockDexScreener, mockRollingWindow));
const mockHotList = jest.mocked(new HotListService(mockDb, mockDexScreener));

describe('TelegramService', () => {
  let service: TelegramService;

  beforeEach(() => {
    service = new TelegramService(
      'mock-token',
      'mock-chat-id',
      undefined, // groupChatId
      mockDb,
      mockLongList,
      mockHotList,
      mockDexScreener
    );

    // Mock sendMessage to just return true (successful send) by default
    jest.spyOn(service, 'sendMessage').mockResolvedValue(true);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('handleStart', () => {
    it('should send welcome message', async () => {
      const mockMsg = { chat: { id: 123 } } as Message;

      await service['handleStart'](mockMsg);

      expect(service.sendMessage).toHaveBeenCalledWith(
        '123',
        expect.stringContaining('🚀 *Follow Coin Bot Started*'),
        'MarkdownV2'
      );
    });
  });

  describe('handleHelp', () => {
    it('should send help message with escaped MarkdownV2', async () => {
      const mockMsg = { chat: { id: 123 } } as Message;

      await service['handleHelp'](mockMsg);

      expect(service.sendMessage).toHaveBeenCalledWith(
        '123',
        expect.stringContaining('🤖 *Follow Coin Bot - Quick Reference*'),
        'MarkdownV2'
      );
    });
  });

  describe('handleLongAdd', () => {
    it('should add coin and send success message', async () => {
      const mockMsg = { chat: { id: 123 } } as Message;
      const mockMatch = [ '', '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU' ] as RegExpMatchArray;
      
      // Mock the DexScreener to return a valid pair
      const mockPair: PairInfo = {
        chainId: 'solana',
        tokenAddress: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
        symbol: 'TEST',
        name: 'Test Token',
        price: 1.0,
        marketCap: 1000000,
        volume24h: 500000,
        priceChange24h: 5,
        liquidity: 100000,
        info: { websites: [], socials: [] },
        lastUpdated: Date.now()
      };
      mockDexScreener.getPairInfo.mockResolvedValue(mockPair);
      mockLongList.addCoin.mockResolvedValue(true);

      await service['handleLongAdd'](mockMsg, mockMatch);

      expect(mockLongList.addCoin).toHaveBeenCalledWith('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');
      expect(service.sendMessage).toHaveBeenCalledWith('123', expect.stringContaining('✅ *Added to Long List*'), 'MarkdownV2');
    });

    it('should handle missing contract address', async () => {
      const mockMsg = { chat: { id: 123 } } as Message;
      const mockMatch = null;

      await service['handleLongAdd'](mockMsg, mockMatch);

      expect(service.sendMessage).toHaveBeenCalledWith('123', expect.stringContaining('❌ *Usage:* `/long_add CONTRACT_ADDRESS`'), 'MarkdownV2');
    });

    it('should handle invalid contract address format', async () => {
      const mockMsg = { chat: { id: 123 } } as Message;
      const mockMatch = [ '', 'invalid' ] as RegExpMatchArray;

      await service['handleLongAdd'](mockMsg, mockMatch);

      expect(service.sendMessage).toHaveBeenCalledWith('123', expect.stringContaining('❌ *Invalid contract address format*'), 'MarkdownV2');
    });
  });

  describe('handleLongRemove', () => {
    it('should remove coin and send success message', async () => {
      const mockMsg = { chat: { id: 123 } } as Message;
      const mockMatch = [ '', '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU' ] as RegExpMatchArray;
      mockLongList.removeCoin.mockResolvedValue(true);

      await service['handleLongRemove'](mockMsg, mockMatch);

      expect(mockLongList.removeCoin).toHaveBeenCalledWith('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');
      expect(service.sendMessage).toHaveBeenCalledWith('123', expect.stringContaining('✅ *Removed from Long List*'), 'MarkdownV2');
    });

    it('should handle coin not found', async () => {
      const mockMsg = { chat: { id: 123 } } as Message;
      const mockMatch = [ '', '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU' ] as RegExpMatchArray;
      mockLongList.removeCoin.mockResolvedValue(false);

      await service['handleLongRemove'](mockMsg, mockMatch);

      expect(service.sendMessage).toHaveBeenCalledWith('123', expect.stringContaining('❌ *Token not found*'), 'MarkdownV2');
    });

    it('should handle missing contract address', async () => {
      const mockMsg = { chat: { id: 123 } } as Message;
      const mockMatch = null;

      await service['handleLongRemove'](mockMsg, mockMatch);

      expect(service.sendMessage).toHaveBeenCalledWith('123', expect.stringContaining('❌ *Usage:* `/long_rm CONTRACT_ADDRESS`'), 'MarkdownV2');
    });
  });

  describe('handleLongTrigger', () => {
    it('should update global trigger and send success', async () => {
      const mockMsg = { chat: { id: 123 } } as Message;
      const mockMatch = [ '', 'retrace on' ] as RegExpMatchArray;
      mockDb.updateGlobalTriggerSettings.mockResolvedValue(undefined);

      await service['handleLongTrigger'](mockMsg, mockMatch);

      expect(mockDb.updateGlobalTriggerSettings).toHaveBeenCalledWith({ globalRetraceOn: true });
      expect(service.sendMessage).toHaveBeenCalledWith('123', expect.stringContaining('✅ *Global retrace triggers enabled*'), 'MarkdownV2');
    });

    it('should handle invalid input', async () => {
      const mockMsg = { chat: { id: 123 } } as Message;
      const mockMatch = [ '', 'invalid' ] as RegExpMatchArray;

      await service['handleLongTrigger'](mockMsg, mockMatch);

      expect(service.sendMessage).toHaveBeenCalledWith('123', expect.stringContaining('❌ *Usage:* `/long_trigger [retrace|stall|breakout|mcap] [on|off]`'), 'MarkdownV2');
    });
  });

  describe('handleLongSet', () => {
    it('should update settings and send success', async () => {
      const mockMsg = { chat: { id: 123 } } as Message;
      const mockMatch = [ '', '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU retrace=15' ] as RegExpMatchArray;
      mockLongList.updateTriggerSettings.mockResolvedValue(true);

      await service['handleLongSet'](mockMsg, mockMatch);

      expect(mockLongList.updateTriggerSettings).toHaveBeenCalledWith('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', { retracePct: 15 });
      expect(service.sendMessage).toHaveBeenCalledWith('123', expect.stringContaining('✅ *Settings Updated*'), 'MarkdownV2');
    });

    it('should handle invalid input', async () => {
      const mockMsg = { chat: { id: 123 } } as Message;
      const mockMatch = null;

      await service['handleLongSet'](mockMsg, mockMatch);

      expect(service.sendMessage).toHaveBeenCalledWith('123', expect.stringContaining('❌ *Usage:* `/long_set CONTRACT_ADDRESS [param=value]...`'), 'MarkdownV2');
    });
  });

  describe('handleReportNow', () => {
    it('should generate and send report', async () => {
      const mockMsg = { chat: { id: 123 } } as Message;
      mockLongList.generateAnchorReport.mockResolvedValue([
        { symbol: 'BTC', price: 60000, change24h: 5, retraceFrom72hHigh: -2, volume24h: 1000000 }
      ]);

      await service['handleReportNow'](mockMsg);

      expect(service.sendMessage).toHaveBeenCalledWith('123', expect.stringContaining('📊 *Long List Snapshot*'), 'MarkdownV2');
    });

    it('should handle no coins', async () => {
      const mockMsg = { chat: { id: 123 } } as Message;
      mockLongList.generateAnchorReport.mockResolvedValue([]);

      await service['handleReportNow'](mockMsg);

      expect(service.sendMessage).toHaveBeenCalledWith('123', 'No coins in long list');
    });
  });

  describe('handleHotAdd', () => {
    const testContract = 'AnR1qNfefHwL8GY7C4iqzBjJZyKzw6Z7N9kXY81bpump';

    it('should add entry with valid params using real contract', async () => {
      const mockMsg = { chat: { id: 123 } } as Message;
      const mockMatch = [ '', `${testContract} -10% mcap=1M` ] as RegExpMatchArray;
      const mockPair: PairInfo = {
        chainId: 'solana',
        tokenAddress: 'mockPair',
        symbol: 'TEST',
        name: 'Test Coin',
        price: 1,
        marketCap: 1000000,
        volume24h: 500000,
        priceChange24h: 5,
        liquidity: 100000,
        info: { websites: [{ url: 'https://example.com' }], socials: [], imageUrl: 'mock.png' },
        lastUpdated: Date.now()
      };
      mockDexScreener.getPairInfo.mockResolvedValue(mockPair);
      mockHotList.addEntry.mockResolvedValue(true);

      await service['handleHotAdd'](mockMsg, mockMatch);

      expect(mockDexScreener.getPairInfo).toHaveBeenCalledWith('solana', testContract);
      expect(mockHotList.addEntry).toHaveBeenCalledWith(testContract, mockPair, { pctTargets: [-10], mcapTargets: [1000000] });
      expect(service.sendMessage).toHaveBeenCalledWith('123', expect.stringContaining('✅ *Token Added to Hot List*'), 'MarkdownV2');
    });

    it('should reject invalid address', async () => {
      const mockMsg = { chat: { id: 123 } } as Message;
      const mockMatch = [ '', 'invalid' ] as RegExpMatchArray;

      await service['handleHotAdd'](mockMsg, mockMatch);

      expect(service.sendMessage).toHaveBeenCalledWith('123', expect.stringContaining('❌ *Invalid contract address format*'));
    });

    it('should reject missing triggers', async () => {
      const mockMsg = { chat: { id: 123 } } as Message;
      const mockMatch = [ '', testContract ] as RegExpMatchArray;

      await service['handleHotAdd'](mockMsg, mockMatch);

      expect(service.sendMessage).toHaveBeenCalledWith('123', expect.stringContaining('❌ *Error:* You must specify at least one trigger criteria!'), 'MarkdownV2');
    });
  });

  describe('handleHotRemove', () => {
    const testContract = 'G5UtMcE2ZUtJrNQ1ZxKYg2QtjG7Dn2p5QwjsKU2epump';

    it('should remove entry', async () => {
      const mockMsg = { chat: { id: 123 } } as Message;
      const mockMatch = [ '', testContract ] as RegExpMatchArray;
      mockHotList.removeEntry.mockResolvedValue(true);

      await service['handleHotRemove'](mockMsg, mockMatch);

      expect(mockHotList.removeEntry).toHaveBeenCalledWith(testContract);
      expect(service.sendMessage).toHaveBeenCalledWith('123', expect.stringContaining('✅ Removed token with contract'), 'MarkdownV2');
    });

    it('should handle not found', async () => {
      const mockMsg = { chat: { id: 123 } } as Message;
      const mockMatch = [ '', testContract ] as RegExpMatchArray;
      mockHotList.removeEntry.mockResolvedValue(false);

      await service['handleHotRemove'](mockMsg, mockMatch);

      expect(service.sendMessage).toHaveBeenCalledWith('123', expect.stringContaining('❌ Token with contract'), 'MarkdownV2');
    });

    it('should handle missing address', async () => {
      const mockMsg = { chat: { id: 123 } } as Message;
      const mockMatch = null;

      await service['handleHotRemove'](mockMsg, mockMatch);

      expect(service.sendMessage).toHaveBeenCalledWith('123', expect.stringContaining('Usage: /hot_rm CONTRACT_ADDRESS'), 'MarkdownV2');
    });
  });

  describe('handleHotList', () => {
    it('should list entries', async () => {
      const mockMsg = { chat: { id: 123 } } as Message;
      mockHotList.listEntries.mockResolvedValue([{ 
        hotId: 1,
        contractAddress: 'test',
        chainId: 'solana',
        symbol: 'TEST',
        name: 'Test',
        addedAtUtc: Date.now() / 1000,
        websites: [{ label: 'Website', url: 'https://example.com' }],
        socials: [{ label: 'Twitter', url: 'https://twitter.com/test' }],
        activeTriggers: [],
        failsafeFired: false
      }]);

      await service['handleHotList'](mockMsg);

      expect(service.sendMessage).toHaveBeenCalledWith('123', expect.stringContaining('🔥 Hot List Entries'), 'MarkdownV2', undefined, true);
    });

    it('should handle empty list', async () => {
      const mockMsg = { chat: { id: 123 } } as Message;
      mockHotList.listEntries.mockResolvedValue([]);

      await service['handleHotList'](mockMsg);

      expect(service.sendMessage).toHaveBeenCalledWith('123', expect.stringContaining('🔥 *Hot list is empty*'), 'MarkdownV2');
    });
  });

  describe('handleAlerts', () => {
    it('should send alerts with escaped MarkdownV2', async () => {
      const mockMsg = { chat: { id: 123 } } as Message;
      mockDb.getAllRecentAlerts.mockResolvedValue([{ timestamp: Date.now() / 1000, symbol: 'TEST', kind: 'pct', message: 'Test', source: 'hot' }]);

      await service['handleAlerts'](mockMsg);

      expect(service.sendMessage).toHaveBeenCalledWith('123', expect.stringContaining('\\(Hot + Long\\)'), 'MarkdownV2');
    });

    it('should handle no alerts', async () => {
      const mockMsg = { chat: { id: 123 } } as Message;
      mockDb.getAllRecentAlerts.mockResolvedValue([]);

      await service['handleAlerts'](mockMsg);

      expect(service.sendMessage).toHaveBeenCalledWith('123', 'No recent alerts', 'MarkdownV2');
    });
  });

  describe('handleStatus', () => {
    it('should send status message', async () => {
      const mockMsg = { chat: { id: 123 } } as Message;
      mockHotList.listEntries.mockResolvedValue([]);

      await service['handleStatus'](mockMsg);

      expect(service.sendMessage).toHaveBeenCalledWith('123', expect.stringContaining('📊 *Bot Status*'), 'MarkdownV2');
    });
  });

  describe('sendMessage', () => {
    it('should send message successfully', async () => {
      await service.sendMessage('123', 'test', 'MarkdownV2');

      expect(service.sendMessage).toHaveBeenCalled();
    });
  });

  describe('sendTriggerAlert', () => {
    it('should send trigger alert', async () => {
      const mockTrigger = { coinId: 1, triggerType: 'retrace', message: 'Test', price: 100, priceChange24h: 5, volume24h: 1000, marketCap: 1000000 };

      await service.sendTriggerAlert(mockTrigger);

      expect(service.sendMessage).toHaveBeenCalledWith('mock-chat-id', expect.stringContaining('🚨 *LONG TRIGGER*'), 'MarkdownV2', expect.any(String));
    });
  });

  describe('sendHotAlert', () => {
    it('should send hot alert', async () => {
      const mockAlert = { hotId: 1, alertType: 'pct', message: 'Test', currentPrice: 100, deltaFromAnchor: 10, currentMcap: 1000000 };

      await service.sendHotAlert(mockAlert);

      expect(service.sendMessage).toHaveBeenCalledWith('mock-chat-id', expect.stringContaining('🔥 *HOT ALERT*'), 'MarkdownV2', expect.any(String));
    });
  });

  describe('formatVolume', () => {
    it('should format volume correctly', () => {
      expect(service['formatVolume'](1500000)).toBe('1.5M');
      expect(service['formatVolume'](5000)).toBe('5.0K');
      expect(service['formatVolume'](500)).toBe('500');
    });
  });

  describe('formatMarketCap', () => {
    it('should format market cap correctly', () => {
      expect(service['formatMarketCap'](1500000000)).toBe('$1.5B');
      expect(service['formatMarketCap'](5000000)).toBe('$5.0M');
      expect(service['formatMarketCap'](5000)).toBe('$5.0K');
      expect(service['formatMarketCap'](500)).toBe('$500');
    });
  });
});
