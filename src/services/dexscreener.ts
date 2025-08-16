import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { 
  DexScreenerResponse, 
  DexScreenerSearchResponse,
  PairInfo,
  DexScreenerPair,
  ApiRateLimiter 
} from '../types/dexscreener';
import { logger } from '../utils/logger';

class RateLimiter implements ApiRateLimiter {
  private requests: number[] = [];
  private readonly maxRequests: number;
  private readonly timeWindow: number;

  constructor(maxRequests: number, timeWindowMs: number) {
    this.maxRequests = maxRequests;
    this.timeWindow = timeWindowMs;
  }

  canMakeRequest(): boolean {
    const now = Date.now();
    this.requests = this.requests.filter(time => now - time < this.timeWindow);
    return this.requests.length < this.maxRequests;
  }

  recordRequest(): void {
    this.requests.push(Date.now());
  }

  getNextAvailableTime(): number {
    if (this.canMakeRequest()) return 0;
    
    const now = Date.now();
    const oldestRequest = this.requests[0];
    return oldestRequest ? oldestRequest + this.timeWindow - now : 0;
  }
}

export class DexScreenerService {
  private readonly client: AxiosInstance;
  private readonly rateLimiter: ApiRateLimiter;
  private readonly baseURL = 'https://api.dexscreener.com/latest';

  constructor(rateLimitMs: number = 200) {
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: 10000,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'follow-coin-bot/1.0.0'
      }
    });

    this.rateLimiter = new RateLimiter(300, 60000);

    this.client.interceptors.request.use(async (config) => {
      while (!this.rateLimiter.canMakeRequest()) {
        const waitTime = this.rateLimiter.getNextAvailableTime();
        if (waitTime > 0) {
          logger.debug(`Rate limit reached, waiting ${waitTime}ms`);
          await new Promise(resolve => setTimeout(resolve, Math.min(waitTime, rateLimitMs)));
        }
      }
      this.rateLimiter.recordRequest();
      return config;
    });

    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        logger.error('DexScreener API error:', {
          url: error.config?.url,
          status: error.response?.status,
          message: error.message
        });
        return Promise.reject(error);
      }
    );
  }

  async getPairsByChain(chainId: string, pairAddresses: string[]): Promise<PairInfo[]> {
    if (pairAddresses.length === 0) return [];
    
    const addressParam = pairAddresses.join(',');
    const url = `/dex/pairs/${chainId}/${addressParam}`;
    
    try {
      const response: AxiosResponse<DexScreenerResponse> = await this.client.get(url);
      
      if (!response.data.pairs) {
        logger.warn(`No pairs returned for chain ${chainId}, addresses: ${addressParam}`);
        return [];
      }

      return response.data.pairs.map(pair => this.transformPairData(pair));
    } catch (error) {
      logger.error(`Failed to fetch pairs for chain ${chainId}:`, error);
      throw new Error(`Failed to fetch pair data: ${error}`);
    }
  }

  async searchPairs(query: string): Promise<PairInfo[]> {
    const url = `/dex/search/?q=${encodeURIComponent(query)}`;
    
    try {
      const response: AxiosResponse<DexScreenerSearchResponse> = await this.client.get(url);
      
      if (!response.data.pairs) {
        logger.info(`No pairs found for query: ${query}`);
        return [];
      }

      return response.data.pairs.map(pair => this.transformPairData(pair));
    } catch (error) {
      logger.error(`Failed to search pairs for query ${query}:`, error);
      throw new Error(`Failed to search pairs: ${error}`);
    }
  }

  async getPairInfo(chainId: string, pairAddress: string): Promise<PairInfo | null> {
    const pairs = await this.getPairsByChain(chainId, [pairAddress]);
    return pairs.length > 0 && pairs[0] ? pairs[0] : null;
  }

  private transformPairData(pair: DexScreenerPair): PairInfo {
    const price = parseFloat(pair.priceUsd || '0');
    const marketCap = pair.marketCap || pair.fdv || null;
    const volume24h = pair.volume?.h24 || 0;
    const priceChange24h = pair.priceChange?.h24 || 0;
    const liquidity = pair.liquidity?.usd || null;

    if (price <= 0) {
      logger.warn(`Invalid price for pair ${pair.pairAddress}: ${price}`);
    }

    return {
      chainId: pair.chainId,
      pairAddress: pair.pairAddress,
      symbol: pair.baseToken.symbol,
      name: pair.baseToken.name,
      price,
      marketCap,
      volume24h,
      priceChange24h,
      liquidity,
      info: pair.info, // Pass the whole info object
      lastUpdated: Date.now()
    };
  }

  validatePairData(pairInfo: PairInfo): boolean {
    if (!pairInfo.price || pairInfo.price <= 0) {
      logger.warn(`Invalid price for ${pairInfo.symbol}: ${pairInfo.price}`);
      return false;
    }

    if (pairInfo.volume24h < 0) {
      logger.warn(`Invalid volume for ${pairInfo.symbol}: ${pairInfo.volume24h}`);
      return false;
    }

    const priceChangeAbs = Math.abs(pairInfo.priceChange24h);
    if (priceChangeAbs > 95) {
      logger.warn(`Suspicious price change for ${pairInfo.symbol}: ${pairInfo.priceChange24h}%`);
      return false;
    }

    return true;
  }

  async batchGetPairs(requests: Array<{ chainId: string; pairAddress: string }>): Promise<Map<string, PairInfo | null>> {
    const results = new Map<string, PairInfo | null>();
    const chainGroups = new Map<string, string[]>();
    
    for (const req of requests) {
      const addresses = chainGroups.get(req.chainId) || [];
      addresses.push(req.pairAddress);
      chainGroups.set(req.chainId, addresses);
    }

    for (const [chainId, addresses] of chainGroups) {
      try {
        const pairs = await this.getPairsByChain(chainId, addresses);
        const pairMap = new Map(pairs.map(p => [p.pairAddress, p]));
        
        for (const address of addresses) {
          const key = `${chainId}:${address}`;
          results.set(key, pairMap.get(address) || null);
        }
      } catch (error) {
        logger.error(`Failed to fetch batch for chain ${chainId}:`, error);
        for (const address of addresses) {
          const key = `${chainId}:${address}`;
          results.set(key, null);
        }
      }
    }

    return results;
  }
}