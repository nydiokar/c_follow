import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { 
  DexScreenerResponse, 
  PairInfo,
  DexScreenerPair,
  ApiRateLimiter 
} from '../types/dexscreener';
import { logger } from '../utils/logger';
import { JupiterTokenService } from './jupiterToken';

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
  private readonly baseURL = 'https://api.dexscreener.com';
  private readonly jupiterFallback: JupiterTokenService;

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
    this.jupiterFallback = new JupiterTokenService();

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
        // Clean up rate limit errors - don't log full URLs
        if (error.response?.status === 429) {
          logger.debug('DexScreener rate limit hit - retrying...');
        } else {
          logger.error('DexScreener API error:', {
            status: error.response?.status,
            message: error.message
          });
        }
        return Promise.reject(error);
      }
    );
  }

  async getPairsByChain(chainId: string, tokenAddresses: string[]): Promise<PairInfo[]> {
    if (tokenAddresses.length === 0) return [];
    
    // DexScreener has URL length limits, batch requests with max 50 addresses per request
    const MAX_ADDRESSES_PER_REQUEST = 50;
    const allPairs: PairInfo[] = [];
    
    for (let i = 0; i < tokenAddresses.length; i += MAX_ADDRESSES_PER_REQUEST) {
      const batch = tokenAddresses.slice(i, i + MAX_ADDRESSES_PER_REQUEST);
      const addressParam = batch.join(',');
      const url = `/tokens/v1/${chainId}/${addressParam}`;
      
      try {
        logger.debug(`Fetching batch ${Math.floor(i/MAX_ADDRESSES_PER_REQUEST) + 1}/${Math.ceil(tokenAddresses.length/MAX_ADDRESSES_PER_REQUEST)} for chain ${chainId}`, { 
          addressCount: batch.length 
        });
        const response: AxiosResponse<DexScreenerResponse> = await this.client.get(url);
      
        // The /tokens/v1 endpoint returns an array of pairs directly
        const pairs = Array.isArray(response.data) ? response.data : (response.data as any)?.pairs;
        
        if (!pairs || pairs.length === 0) {
          logger.debug(`No pairs returned for batch ${Math.floor(i/MAX_ADDRESSES_PER_REQUEST) + 1}, addresses: ${addressParam}`);
          continue;
        }

        logger.debug(`Received ${pairs.length} pairs from batch ${Math.floor(i/MAX_ADDRESSES_PER_REQUEST) + 1}`);
        const transformedPairs = pairs.map((pair: DexScreenerPair) => this.transformPairData(pair));
        allPairs.push(...transformedPairs);
      } catch (error) {
        const batchNum = Math.floor(i/MAX_ADDRESSES_PER_REQUEST) + 1;
        logger.error(`Failed to fetch DexScreener batch ${batchNum} for ${chainId}:`, { 
          error: error instanceof Error ? error.message : String(error),
          tokenCount: batch.length 
        });
        // Continue with other batches instead of throwing
        continue;
      }
    }
    
    return allPairs;
  }

  async getPairInfo(chainId: string, tokenAddress: string): Promise<PairInfo | null> {
    const pairs = await this.getPairsByChain(chainId, [tokenAddress]);
    return pairs.length > 0 && pairs[0] ? pairs[0] : null;
  }

  private transformPairData(pair: DexScreenerPair): PairInfo {
    const price = parseFloat(pair.priceUsd || '0');
    const marketCap = pair.marketCap || pair.fdv || null;
    const volume24h = pair.volume?.h24 || 0;
    const priceChange24h = pair.priceChange?.h24 || 0;
    const priceChange1h = pair.priceChange?.h1 || 0;
    const liquidity = pair.liquidity?.usd || null;

    if (price <= 0) {
      logger.debug(`Invalid price for pair ${pair.tokenAddress}: ${price}`);
    }

    return {
      chainId: pair.chainId,
      tokenAddress: pair.baseToken.address,
      symbol: pair.baseToken.symbol,
      name: pair.baseToken.name,
      price,
      marketCap,
      volume24h,
      priceChange24h,
      priceChange1h,
      liquidity,
      info: pair.info,
      lastUpdated: Date.now()
    };
  }

  validatePairData(pairInfo: PairInfo): boolean {
    // Basic validation
    if (!pairInfo.price || pairInfo.price <= 0) {
      logger.debug(`Invalid price for ${pairInfo.symbol}: ${pairInfo.price}`);
      return false;
    }

    if (pairInfo.volume24h < 0) {
      logger.warn(`Invalid volume for ${pairInfo.symbol}: ${pairInfo.volume24h}`);
      return false;
    }
    
    // Enhanced checks for anomalies
    const priceChangeAbs = Math.abs(pairInfo.priceChange24h);
    
    // Handle extreme price changes
    if (priceChangeAbs > 95) {
      // Check if volume confirms the price change
      const volumeSupportsChange = pairInfo.volume24h > 0 && 
        (pairInfo.marketCap ? pairInfo.volume24h > pairInfo.marketCap * 0.05 : true);
      
      if (!volumeSupportsChange) {
        logger.warn(`Suspicious price change for ${pairInfo.symbol}: ${pairInfo.priceChange24h}% with insufficient volume`);
        return false;
      }
      
      logger.info(`Large but valid price change for ${pairInfo.symbol}: ${pairInfo.priceChange24h}% with supporting volume`);
    }
    
    // Volume can legitimately exceed market cap during dumps/pumps, no need to warn
    
    // Check for zero liquidity
    if (pairInfo.liquidity !== undefined && pairInfo.liquidity !== null && pairInfo.liquidity <= 0) {
      logger.warn(`Zero liquidity for ${pairInfo.symbol}, data may be inaccurate`);
      return false;
    }

    return true;
  }

  async batchGetTokens(requests: Array<{ chainId: string; tokenAddress: string }>): Promise<Map<string, PairInfo | null>> {
    // tokenAddress here is actually the token contract/mint address used to add entries
    const results = new Map<string, PairInfo | null>();
    const chainGroups = new Map<string, string[]>();
    const failedRequests: Array<{ chainId: string; tokenAddress: string }> = [];

    for (const req of requests) {
      const addresses = chainGroups.get(req.chainId) || [];
      addresses.push(req.tokenAddress);
      chainGroups.set(req.chainId, addresses);
    }

    // Try DexScreener first
    for (const [chainId, tokenAddresses] of chainGroups) {
      try {
        const pairs = await this.getPairsByChain(chainId, tokenAddresses);
        // Only log for large batches (mint reports), not hot list checks
        if (tokenAddresses.length >= 20) {
          logger.info(`DexScreener returned ${pairs.length} pairs for ${tokenAddresses.length} ${chainId} tokens`);
        } else {
          logger.debug(`DexScreener returned ${pairs.length} pairs for ${tokenAddresses.length} ${chainId} tokens`);
        }

        // Build selection per token address: choose best pair by liquidity, then 24h volume
        const bestByToken = new Map<string, PairInfo>();
        for (const p of pairs) {
          const key = p.tokenAddress;
          const existing = bestByToken.get(key);
          if (!existing) {
            bestByToken.set(key, p);
            continue;
          }
          const existingScore = (existing.liquidity || 0) * 1_000_000 + existing.volume24h;
          const newScore = (p.liquidity || 0) * 1_000_000 + p.volume24h;
          if (newScore > existingScore) {
            bestByToken.set(key, p);
          }
        }
        if (tokenAddresses.length >= 20) {
          logger.info(`DexScreener found ${bestByToken.size} best tokens for ${chainId}`);
        } else {
          logger.debug(`DexScreener found ${bestByToken.size} best tokens for ${chainId}`);
        }

        for (const tokenAddr of tokenAddresses) {
          const key = `${chainId}:${tokenAddr}`;
          const result = bestByToken.get(tokenAddr);
          if (result) {
            results.set(key, result);
          } else {
            // Mark failed tokens for Jupiter fallback
            failedRequests.push({ chainId, tokenAddress: tokenAddr });
          }
        }
      } catch (error) {
        logger.error(`Failed to fetch batch for chain ${chainId}:`, error);
        // Add all tokens from this chain to failed requests for Jupiter fallback
        for (const tokenAddr of tokenAddresses) {
          failedRequests.push({ chainId, tokenAddress: tokenAddr });
        }
      }
    }

    // Fallback to Jupiter for failed requests
    if (failedRequests.length > 0) {
      if (failedRequests.length >= 20) {
        logger.info(`DexScreener failed for ${failedRequests.length} tokens, trying Jupiter fallback`);
      } else {
        logger.debug(`DexScreener failed for ${failedRequests.length} tokens, trying Jupiter fallback`);
      }
      try {
        const jupiterResults = await this.jupiterFallback.batchGetTokens(failedRequests);
        
        // Merge Jupiter results into main results
        for (const [key, value] of jupiterResults) {
          if (!results.has(key)) { // Only add if not already resolved by DexScreener
            results.set(key, value);
          }
        }
        
        const jupiterSuccessCount = Array.from(jupiterResults.values()).filter(v => v !== null).length;
        if (failedRequests.length >= 20) {
          logger.info(`Jupiter fallback resolved ${jupiterSuccessCount}/${failedRequests.length} tokens`);
        } else {
          logger.debug(`Jupiter fallback resolved ${jupiterSuccessCount}/${failedRequests.length} tokens`);
        }
      } catch (error) {
        logger.error('Jupiter fallback also failed:', error);
        // Set remaining failed requests to null
        for (const req of failedRequests) {
          const key = `${req.chainId}:${req.tokenAddress}`;
          if (!results.has(key)) {
            results.set(key, null);
          }
        }
      }
    }

    return results;
  }
}