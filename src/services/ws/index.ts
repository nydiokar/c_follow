import { HeliusWebSocketConnection, WsEvent } from './WebSocketConnection';
import { SubscriptionRegistry } from './SubscriptionRegistry';
import { EventDispatcher, CandidateTx } from './EventDispatcher';
import { TransactionFetcher } from './TransactionFetcher';
import { DatabaseManager } from '../../utils/database';
import { logger } from '../../utils/logger';

export class WebSocketIngestService {
  private conn: HeliusWebSocketConnection | null = null;
  private registry: SubscriptionRegistry | null = null;
  private dispatcher: EventDispatcher | null = null;
  private fetcher: TransactionFetcher | null = null;
  private seen = new Set<string>();

  start(): void {
    const apiKey = process.env.HELIUS_API_KEY;
    if (!apiKey) {
      logger.warn('WS ingest disabled: HELIUS_API_KEY not set');
      return;
    }
    this.dispatcher = new EventDispatcher((tx) => this.handleCandidate(tx));
    this.conn = new HeliusWebSocketConnection({
      apiKey,
      pingIntervalMs: parseInt(process.env.WS_PING_INTERVAL_MS || '55000'),
      onEvent: (e) => this.handleEvent(e)
    });
    this.fetcher = new TransactionFetcher({ apiKey, concurrency: parseInt(process.env.WS_HTTP_GETTX_CONCURRENCY || '2') });

    const programs = (process.env.WS_LOGS_PROGRAMS || '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const monitorSpl = (process.env.WS_MONITOR_SPL_TOKEN || 'true') === 'true';
    const monitor2022 = (process.env.WS_MONITOR_TOKEN_2022 || 'true') === 'true';

    this.registry = new SubscriptionRegistry({
      conn: this.conn,
      dexCfg: { programIds: programs },
      tokCfg: { splToken: monitorSpl, token2022: monitor2022 }
    });

    this.conn.connect();
    this.registry.registerAll();
    logger.info('WS ingest started', { programs, monitorSpl, monitor2022 });
  }

  stop(): void {
    this.conn?.close();
  }

  private handleEvent(e: WsEvent): void {
    if (!this.dispatcher) return;
    if (e.type === 'log') this.dispatcher.handleLogEvent({ ...e, ...e.payload });
    else if (e.type === 'program-account') {
      // We do not know which token program sent it; attempt to decide from payload owner if present
      const owner = e?.payload?.value?.account?.owner;
      if (owner === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') this.dispatcher.handleProgramAccountEvent(e.payload, 'spl-token');
      else if (owner === 'TokenzQdBNbLqP5VEh9xnFJz5dG27K7ivozsQJ4xxQh') this.dispatcher.handleProgramAccountEvent(e.payload, 'token-2022');
      else this.dispatcher.handleProgramAccountEvent(e.payload, 'spl-token');
    }
  }

  private async handleCandidate(tx: CandidateTx): Promise<void> {
    // Only fetch for logs-based candidates (have real signatures)
    if (tx.reason !== 'logs:dex') return;
    // Deduplicate by signature
    if (this.seen.has(tx.signature)) return;
    this.seen.add(tx.signature);

    const prisma = DatabaseManager.getInstance() as any;

    // Basic sanity on signature format
    if (!/^[1-9A-HJ-NP-Za-km-z]{43,88}$/.test(tx.signature)) return;

    const info = await this.fetcher!.fetch(tx.signature);
    if (!info) return;

    const blockMs = (info.blockTime || 0) * 1000;

    // Extract mint heuristics
    const instructions: any[] = extractAllInstructions(info);
    const mintCandidate: string | undefined = findMintToMintAddress(instructions);
    const heuristic = mintCandidate ? firstMintHeuristic(instructions, mintCandidate) : { isLaunchInitialization: false as const };
    const isFirst = true; // let DB constraint dedupe duplicates; we mark first optimistically

    try {
      await prisma.mintEvent.create({
        data: {
          txSignature: tx.signature,
          mint: mintCandidate || tx.signature,
          timestamp: BigInt(blockMs || Date.now()),
          decimals: null,
          isLaunchInitialization: heuristic.isLaunchInitialization,
          isFirst: isFirst,
          firstMintKey: isFirst ? (mintCandidate || tx.signature) : null,
          initProgram: heuristic && (heuristic as any).initProgram ? (heuristic as any).initProgram : 'unknown',
          validatedBy: heuristic.isLaunchInitialization ? 'initHeuristic' : 'ws',
          source: 'ws',
          eventType: tx.reason,
          rawJson: JSON.stringify({ info })
        }
      });
    } catch (e: any) {
      // ignore unique constraint errors
    }
  }
}

function extractAllInstructions(info: any): any[] {
  const outer = info?.transaction?.message?.instructions || [];
  const innerGroups = info?.meta?.innerInstructions || [];
  const inner = innerGroups.flatMap((g: any) => g?.instructions || []);
  return [...outer, ...inner];
}

const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
const SPL_TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEh9xnFJz5dG27K7ivozsQJ4xxQh';

function programIdToInitProgram(programId: string | undefined): 'spl-token' | 'token-2022' | undefined {
  if (!programId) return undefined;
  if (programId === SPL_TOKEN_PROGRAM_ID) return 'spl-token';
  if (programId === TOKEN_2022_PROGRAM_ID) return 'token-2022';
  return undefined;
}

function findMintToMintAddress(instructions: any[]): string | undefined {
  for (const ix of instructions) {
    const pid: string | undefined = ix.programId || ix.program || ix.parsed?.programId;
    const isTokenProgram = pid === SPL_TOKEN_PROGRAM_ID || pid === TOKEN_2022_PROGRAM_ID;
    if (!isTokenProgram) continue;

    const parsedType: string | undefined = ix.parsed?.type || ix.parsed?.instructionType;
    const isMintTo = parsedType?.toLowerCase?.().startsWith('mintto');
    if (isMintTo) {
      const accounts: string[] | undefined = ix.accounts || ix.parsed?.info?.accounts || ix.parsed?.accounts;
      if (Array.isArray(accounts) && accounts[0]) return accounts[0];
      if (ix.parsed?.info?.mint) return ix.parsed.info.mint as string;
    }

    if (!ix.parsed && Array.isArray(ix.accounts) && ix.accounts.length >= 3) {
      return ix.accounts[0];
    }
  }
  return undefined;
}

function firstMintHeuristic(instructions: any[], candidateMint: string): { isLaunchInitialization: boolean; initProgram?: 'spl-token' | 'token-2022' } {
  let sawCreateForMint = false;
  let initProgram: 'spl-token' | 'token-2022' | undefined;
  for (const ix of instructions) {
    const pid: string | undefined = ix.programId || ix.program || ix.parsed?.programId;
    const parsedType: string | undefined = ix.parsed?.type || ix.parsed?.instructionType;
    const accounts: string[] | undefined = ix.accounts || ix.parsed?.info?.accounts || ix.parsed?.accounts;
    if ((pid === SYSTEM_PROGRAM_ID || pid?.toLowerCase?.() === 'system') && parsedType === 'createAccount') {
      const newAccount = (ix.parsed?.info?.newAccount || (Array.isArray(accounts) ? accounts[0] : undefined)) as string | undefined;
      if (newAccount === candidateMint) {
        sawCreateForMint = true;
      }
    }
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


