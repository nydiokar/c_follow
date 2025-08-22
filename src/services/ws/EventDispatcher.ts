import { logger } from '../../utils/logger';

export type CandidateTx = {
  signature: string;
  slot?: number;
  programId?: string;
  reason: 'logs:dex' | 'program:spl-token' | 'program:token-2022';
  hintMint?: string;
};

export class EventDispatcher {
  private onCandidate: (tx: CandidateTx) => void;

  constructor(onCandidate: (tx: CandidateTx) => void) {
    this.onCandidate = onCandidate;
  }

  public handleLogEvent(evt: any): void {
    try {
      const sig: string | undefined = evt?.value?.signature;
      if (!sig) return;
      const slot: number | undefined = evt?.context?.slot || evt?.slot;
      // program id not present in logs payload directly; reason conveys source
      const candidate: CandidateTx = { signature: sig, reason: 'logs:dex' };
      if (typeof slot === 'number') {
        candidate.slot = slot;
      }
      this.onCandidate(candidate);
    } catch (e) {
      logger.warn('handleLogEvent failed', { error: (e as Error).message });
    }
  }

  public handleProgramAccountEvent(evt: any, tokenProgram: 'spl-token' | 'token-2022'): void {
    try {
      const acc = evt?.value;
      const data = acc?.account?.data;
      const pubkey: string | undefined = acc?.pubkey;
      if (!data || !pubkey) return;

      // Mint account typically < 165 bytes; SPL mint is 82 bytes
      const length: number | undefined = typeof data?.length === 'number' ? data.length : acc?.account?.space;
      if (typeof length === 'number' && length < 165) {
        // No signature in program notification; emit with hintMint only
        this.onCandidate({ signature: pubkey, reason: tokenProgram === 'spl-token' ? 'program:spl-token' : 'program:token-2022', hintMint: pubkey });
      }
    } catch (e) {
      logger.warn('handleProgramAccountEvent failed', { error: (e as Error).message });
    }
  }

  // No transactionSubscribe path (non-Professional plan)
}


