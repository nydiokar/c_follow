import axios from 'axios';
import { logger } from '../../utils/logger';

export type FetchedTx = {
  signature: string;
  blockTime?: number;
  slot?: number;
  logs?: string[];
  meta?: any;
  transaction?: any;
};

export class TransactionFetcher {
  private rpcUrl: string;
  private concurrency: number;
  private inFlight = 0;
  private queue: Array<{ sig: string; resolve: (r: FetchedTx | null) => void; reject: (e: unknown) => void }> = [];

  constructor(params: { apiKey: string; concurrency?: number }) {
    this.rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${params.apiKey}`;
    this.concurrency = Math.max(1, params.concurrency || 2);
  }

  public async fetch(signature: string): Promise<FetchedTx | null> {
    return new Promise((resolve, reject) => {
      this.queue.push({ sig: signature, resolve, reject });
      this.drain();
    });
  }

  private async drain(): Promise<void> {
    while (this.inFlight < this.concurrency && this.queue.length > 0) {
      const item = this.queue.shift()!;
      this.inFlight++;
      this.fetchOnce(item.sig)
        .then(item.resolve)
        .catch(item.reject)
        .finally(() => {
          this.inFlight--;
          setImmediate(() => this.drain());
        });
    }
  }

  private async fetchOnce(signature: string): Promise<FetchedTx | null> {
    try {
      const body = {
        jsonrpc: '2.0',
        id: 1,
        method: 'getTransaction',
        params: [signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]
      };
      const { data } = await axios.post(this.rpcUrl, body, { timeout: 10000 });
      if (!data?.result) return null;
      const r = data.result;
      return {
        signature,
        blockTime: r.blockTime,
        slot: r.slot,
        logs: r?.meta?.logMessages,
        meta: r.meta,
        transaction: r.transaction
      };
    } catch (e) {
      logger.warn('getTransaction failed', { signature, error: (e as Error).message });
      return null;
    }
  }
}


