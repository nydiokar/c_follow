import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { PairInfo, ApiRateLimiter } from '../types/dexscreener';
import { logger } from '../utils/logger';

interface JupiterTokenResponse {
  name: string;
  symbol: string;
  id: string; // this is the address
  usdPrice: number;
  mcap: number; // market cap
  liquidity: number;
  stats24h?: {
    buyVolume?: number;
    sellVolume?: number;
    priceChange?: number;
  };
  stats1h?: {
    priceChange?: number;
  };
  updatedAt: string;
  extensions?: {
    website?: string;
    twitter?: string;
    telegram?: string;
  };
}

class JupiterRateLimiter implements ApiRateLimiter {
  private requests: number[] = [];
  private readonly maxRequests: number = 600; // 600 requests per minute
  private readonly timeWindow: number = 60000; // 1 minute

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

export class JupiterTokenService {
  private readonly client: AxiosInstance;
  private readonly rateLimiter: ApiRateLimiter;
  private readonly baseURL = 'https://lite-api.jup.ag';

  constructor() {
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: 15000,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'follow-coin-bot/1.0.0'
      }
    });

    this.rateLimiter = new JupiterRateLimiter();

    this.client.interceptors.request.use(async (config) => {
      while (!this.rateLimiter.canMakeRequest()) {
        const waitTime = this.rateLimiter.getNextAvailableTime();
        if (waitTime > 0) {
          logger.debug(`Jupiter rate limit reached, waiting ${waitTime}ms`);
          await new Promise(resolve => setTimeout(resolve, Math.min(waitTime, 1000)));
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
          logger.debug('Jupiter rate limit hit - retrying...');
        } else {
          logger.error('Jupiter API error:', {
            status: error.response?.status,
            message: error.message
          });
        }
        return Promise.reject(error);
      }
    );
  }

  async getTokensByMints(mintAddresses: string[]): Promise<PairInfo[]> {
    if (mintAddresses.length === 0) return [];
    
    // Jupiter supports up to 100 tokens per request via comma-separated query
    const MAX_TOKENS_PER_REQUEST = 50;
    const allTokens: PairInfo[] = [];
    
    for (let i = 0; i < mintAddresses.length; i += MAX_TOKENS_PER_REQUEST) {
      const batch = mintAddresses.slice(i, i + MAX_TOKENS_PER_REQUEST);
      
      try {
        // Removed debug log to reduce noise

        // Jupiter Token API V2 search endpoint with comma-separated mints
        const mintList = batch.join(',');
        const url = `/tokens/v2/search?query=${mintList}`;
        
        const response: AxiosResponse<JupiterTokenResponse[]> = await this.client.get(url);
        if (mintAddresses.length >= 20) {
          logger.info(`Jupiter API returned ${response.data?.length || 0} tokens for batch of ${batch.length}`);
        } else {
          logger.debug(`Jupiter API returned ${response.data?.length || 0} tokens for batch of ${batch.length}`);
        }
        
        if (!response.data || response.data.length === 0) {
          // Batch had no results, continuing silently
          continue;
        }

        // Received tokens, transforming data
        const transformedTokens = response.data.map(token => this.transformTokenData(token));
        allTokens.push(...transformedTokens);
      } catch (error) {
        const batchNum = Math.floor(i/MAX_TOKENS_PER_REQUEST) + 1;
        logger.debug(`Failed to fetch Jupiter batch ${batchNum}:`, { 
          error: error instanceof Error ? error.message : String(error),
          tokenCount: batch.length 
        });
        // Continue with other batches instead of throwing
        continue;
      }
    }
    
    return allTokens;
  }

  private transformTokenData(token: JupiterTokenResponse): PairInfo {
    // Convert Jupiter format to PairInfo format for compatibility
    const socials: { platform: string; handle: string }[] = [];
    
    if (token.extensions?.twitter) {
      socials.push({ platform: 'twitter', handle: token.extensions.twitter });
    }
    if (token.extensions?.telegram) {
      socials.push({ platform: 'telegram', handle: token.extensions.telegram });
    }

    // Build info object properly to satisfy TypeScript
    let info: { imageUrl?: string; websites?: { url: string }[]; socials?: { platform: string; handle: string }[] } | undefined = undefined;
    
    if (socials.length > 0 || token.extensions?.website) {
      info = {};
      if (socials.length > 0) {
        info.socials = socials;
      }
      if (token.extensions?.website) {
        info.websites = [{ url: token.extensions.website }];
      }
    }

    return {
      chainId: 'solana',
      tokenAddress: token.id,
      symbol: token.symbol || 'UNKNOWN',
      name: token.name || 'Unknown Token',
      price: token.usdPrice || 0,
      marketCap: token.mcap || null,
      volume24h: (token.stats24h?.buyVolume || 0) + (token.stats24h?.sellVolume || 0),
      priceChange24h: token.stats24h?.priceChange || 0,
      priceChange1h: token.stats1h?.priceChange || 0,
      liquidity: token.liquidity || null,
      info,
      lastUpdated: Date.now()
    };
  }

  async batchGetTokens(requests: Array<{ chainId: string; tokenAddress: string }>): Promise<Map<string, PairInfo | null>> {
    const results = new Map<string, PairInfo | null>();
    
    // Only handle Solana requests
    const solanaRequests = requests.filter(req => req.chainId === 'solana');
    const mintAddresses = solanaRequests.map(req => req.tokenAddress);
    
    try {
      const tokens = await this.getTokensByMints(mintAddresses);
      
      // Create lookup map by token address
      const tokenMap = new Map<string, PairInfo>();
      tokens.forEach(token => {
        tokenMap.set(token.tokenAddress, token);
      });
      
      // Map results back to original request format
      for (const req of requests) {
        const key = `${req.chainId}:${req.tokenAddress}`;
        if (req.chainId === 'solana') {
          results.set(key, tokenMap.get(req.tokenAddress) || null);
        } else {
          results.set(key, null); // Non-Solana chains not supported
        }
      }
    } catch (error) {
      logger.error('Jupiter batch request failed:', error);
      // Set all requests to null on complete failure
      for (const req of requests) {
        const key = `${req.chainId}:${req.tokenAddress}`;
        results.set(key, null);
      }
    }
    
    return results;
  }
}