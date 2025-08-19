import express from 'express';
import { DatabaseManager } from '../utils/database';
import { logger } from '../utils/logger';

const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
const SPL_TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEh9xnFJz5dG27K7ivozsQJ4xxQh';

type AnyRecord = Record<string, any>;

// Simple 24h TTL cache for seen mints to drop repeats early
const seenMints = new Map<string, number>();
const SEEN_TTL_MS = 24 * 60 * 60 * 1000;

function pruneSeenMints(now: number): void {
  for (const [mint, ts] of seenMints) {
    if (now - ts > SEEN_TTL_MS) {
      seenMints.delete(mint);
    }
  }
}

function headerSecretOk(req: express.Request): boolean {
  const expected = process.env.HELIUS_WEBHOOK_SECRET;
  if (!expected) return true; // no secret configured → accept (dev mode)
  const provided = (req.headers['x-helius-secret'] || req.headers['x-helio-secret'] || req.headers['x-helius-signature']) as string | undefined;
  if (!provided) return false;
  // Minimal check: exact match. If HMAC is desired, switch to raw-body verification.
  return provided === expected;
}

function collectAllInstructions(tx: AnyRecord): AnyRecord[] {
  const outer: AnyRecord[] = Array.isArray(tx?.instructions) ? tx.instructions : [];
  const innerGroups: AnyRecord[][] = Array.isArray(tx?.innerInstructions) ? tx.innerInstructions : [];
  const inner: AnyRecord[] = innerGroups.flatMap((g) => Array.isArray((g as any).instructions) ? (g as any).instructions : []);
  return [...outer, ...inner];
}

function programIdToInitProgram(programId: string | undefined): 'spl-token' | 'token-2022' | undefined {
  if (!programId) return undefined;
  if (programId === SPL_TOKEN_PROGRAM_ID) return 'spl-token';
  if (programId === TOKEN_2022_PROGRAM_ID) return 'token-2022';
  return undefined;
}

function findMintToMintAddress(instructions: AnyRecord[]): string | undefined {
  for (const ix of instructions) {
    const pid: string | undefined = ix.programId || ix.program || ix.parsed?.programId;
    const parsedType: string | undefined = ix.parsed?.type || ix.parsed?.instructionType;
    const isTokenProgram = pid === SPL_TOKEN_PROGRAM_ID || pid === TOKEN_2022_PROGRAM_ID;
    if (!isTokenProgram) continue;
    const isMintTo = parsedType?.toLowerCase?.().startsWith('mintto');
    if (!isMintTo) continue;
    // SPL Token MintTo accounts layout: accounts[0] is the mint
    const accounts: string[] | undefined = ix.accounts || ix.parsed?.info?.accounts || ix.parsed?.accounts;
    if (Array.isArray(accounts) && accounts[0]) return accounts[0];
    // Fallbacks seen in some payloads
    if (ix.parsed?.info?.mint) return ix.parsed.info.mint;
  }
  return undefined;
}

function firstMintHeuristic(instructions: AnyRecord[], candidateMint: string): { isLaunchInitialization: boolean; initProgram?: 'spl-token' | 'token-2022' } {
  // Look for createAccount (system) then initializeMint*/initializeMint2 for same mint, both before MintTo
  let sawCreateForMint = false;
  let initProgram: 'spl-token' | 'token-2022' | undefined;
  for (const ix of instructions) {
    const pid: string | undefined = ix.programId || ix.program || ix.parsed?.programId;
    const parsedType: string | undefined = ix.parsed?.type || ix.parsed?.instructionType;
    const accounts: string[] | undefined = ix.accounts || ix.parsed?.info?.accounts || ix.parsed?.accounts;
    // createAccount for the mint
    if ((pid === SYSTEM_PROGRAM_ID || pid?.toLowerCase?.() === 'system') && parsedType === 'createAccount') {
      const newAccount = (ix.parsed?.info?.newAccount || (Array.isArray(accounts) ? accounts[0] : undefined)) as string | undefined;
      if (newAccount === candidateMint) {
        sawCreateForMint = true;
      }
    }
    // initializeMint*
    const isInit = parsedType === 'initializeMint' || parsedType === 'initializeMint2';
    if (isInit && Array.isArray(accounts) && accounts[0] === candidateMint) {
      const maybeProgram = programIdToInitProgram(pid);
      if (sawCreateForMint && maybeProgram) {
        initProgram = maybeProgram;
        return { isLaunchInitialization: true, initProgram };
      }
    }
  }
  return { isLaunchInitialization: false };
}

export function registerHeliusWebhookRoutes(app: express.Express): void {
  const prisma = DatabaseManager.getInstance() as any;

  app.post('/webhooks/helius', express.json({ limit: '1mb' }), async (req, res) => {
    try {
      if (!headerSecretOk(req)) {
        return res.status(401).json({ ok: false, error: 'unauthorized' });
      }

      const body = req.body;
      const events: AnyRecord[] = Array.isArray(body) ? body : [body];
      const now = Date.now();
      pruneSeenMints(now);

      for (const event of events) {
        const tx = event?.transaction || event; // tolerate both shapes
        const signature: string | undefined = tx?.signature || event?.signature;
        const timestampSec: number | undefined = tx?.timestamp || event?.timestamp;
        if (!signature || !timestampSec) continue;

        const instructions = collectAllInstructions(tx);
        const mintAddress = findMintToMintAddress(instructions);
        if (!mintAddress) continue;

        // Early dedupe by mint
        if (seenMints.has(mintAddress)) {
          continue;
        }

        // Heuristic A: initializeMint and createAccount in same tx
        const heuristic = firstMintHeuristic(instructions, mintAddress);

        // Accept only if heuristic passes for now (we can add B/C later)
        if (!heuristic.isLaunchInitialization) {
          continue;
        }

        // Persist single isFirst row
        try {
          await prisma.mintEvent.create({
            data: {
              txSignature: signature,
              mint: mintAddress,
              timestamp: BigInt(timestampSec * 1000), // store ms
              decimals: null,
              isLaunchInitialization: true,
              isFirst: true,
              firstMintKey: mintAddress,
              initProgram: heuristic.initProgram,
              validatedBy: 'initHeuristic',
              source: 'webhook',
              rawJson: JSON.stringify(event)
            }
          });
          seenMints.set(mintAddress, now);
          logger.info('Accepted first-mint event', { signature, mintAddress, initProgram: heuristic.initProgram });
        } catch (e: any) {
          // Unique violations mean we already captured it; ignore
          logger.debug('mintEvent create failed/duplicate', { error: e?.code || e?.message });
        }
      }

      return res.json({ ok: true });
    } catch (error) {
      logger.error('Webhook processing error', { error });
      return res.status(500).json({ ok: false });
    }
  });
}


