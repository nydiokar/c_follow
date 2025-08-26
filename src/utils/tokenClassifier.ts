import { PairInfo } from '../types/dexscreener';

export interface TokenClassificationResult {
  classification: 'clean' | 'scam' | 'dead' | 'no_data';
  reason?: string;
}

export class TokenClassifier {
  /**
   * Classifies a token based on API data
   * @param tokenData - Token data from DexScreener/Jupiter API
   * @returns Classification result with reason
   */
  static classifyToken(tokenData: PairInfo | null | undefined): TokenClassificationResult {
    // Rule 1: No API data available
    if (!tokenData) {
      return { classification: 'no_data', reason: 'No API data available' };
    }

    // Rule 2: Obvious scam detection
    if (this.isObviousScam(tokenData)) {
      return { classification: 'scam', reason: 'Failed scam detection rules' };
    }

    // Rule 3: No market cap = dead token
    if (!tokenData.marketCap || tokenData.marketCap <= 0) {
      return { classification: 'dead', reason: 'No market cap' };
    }

    // Rule 4: No liquidity = dead token  
    if (!tokenData.liquidity || tokenData.liquidity <= 0) {
      return { classification: 'dead', reason: 'No liquidity' };
    }

    // Rule 5: Valid token with data, market cap, and liquidity
    return { classification: 'clean', reason: 'Valid token data' };
  }

  /**
   * Batch classify multiple tokens
   * @param apiResults - Map of token addresses to API data
   * @returns Object with arrays of tokens by classification
   */
  static batchClassify(apiResults: Map<string, PairInfo | null>): {
    clean: string[];
    scam: string[];
    dead: string[];
    no_data: string[];
    failed: string[];
  } {
    const result = {
      clean: [] as string[],
      scam: [] as string[],
      dead: [] as string[],
      no_data: [] as string[],
      failed: [] as string[]
    };

    for (const [key, tokenData] of apiResults.entries()) {
      // Extract mint address from key (format: "solana:mintAddress")
      const mint = key.split(':')[1];
      if (!mint) {
        result.failed.push(key);
        continue;
      }

      const classification = this.classifyToken(tokenData);
      result[classification.classification].push(mint);
    }

    return result;
  }

  /**
   * Scam detection rules - same logic as TokenProcessorService
   */
  private static isObviousScam(tokenData: PairInfo): boolean {
    // Rule 1: Zero liquidity but claims significant trading activity
    if (tokenData.liquidity === 0 && tokenData.marketCap && tokenData.marketCap > 1000) {
      return true;
    }
    
    // Rule 2: Volume too low for claimed market cap (less than 0.05% daily)
    if (tokenData.marketCap && tokenData.marketCap > 10000 && (tokenData.volume24h / tokenData.marketCap) < 0.0005) {
      return true;
    }
    
    return false;
  }
}