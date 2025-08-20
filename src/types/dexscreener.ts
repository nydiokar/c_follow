export interface DexScreenerPair {
  chainId: string;
  dexId: string;
  url: string;
  tokenAddress: string;
  labels?: string[];
  baseToken: {
    address: string;
    name: string;
    symbol: string;
  };
  quoteToken: {
    address: string;
    name: string;
    symbol: string;
  };
  priceNative: string;
  priceUsd?: string;
  txns: {
    m5: {
      buys: number;
      sells: number;
    };
    h1: {
      buys: number;
      sells: number;
    };
    h6: {
      buys: number;
      sells: number;
    };
    h24: {
      buys: number;
      sells: number;
    };
  };
  volume: {
    h24: number;
    h6: number;
    h1: number;
    m5: number;
  };
  priceChange: {
    m5: number;
    h1: number;
    h6: number;
    h24: number;
  };
  liquidity?: {
    usd?: number;
    base: number;
    quote: number;
  };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
  info?: {
    imageUrl?: string;
    websites?: { url: string }[];
    socials?: { platform: string; handle: string }[];
  } | undefined;
}

export interface DexScreenerResponse {
  schemaVersion: string;
  pairs: DexScreenerPair[] | null;
}

export interface PairInfo {
  chainId: string;
  // Base token contract/mint address (used for lookups when querying by token)
  tokenAddress: string;
  symbol: string;
  name: string;
  price: number;
  marketCap: number | null;
  volume24h: number;
  priceChange24h: number;
  priceChange1h: number;
  liquidity: number | null;
  info?: {
    imageUrl?: string;
    websites?: { url: string }[];
    socials?: { platform: string; handle: string }[];
  } | undefined;
  lastUpdated: number;
}

export interface ApiRateLimiter {
  canMakeRequest(): boolean;
  recordRequest(): void;
  getNextAvailableTime(): number;
}