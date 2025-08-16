import { PrismaClient, Prisma } from '@prisma/client';

export type PrismaTransactionClient = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

export interface CoinData {
  coinId: number;
  chain: string;
  pairAddress: string;
  symbol: string;
  name?: string;
  config: {
    retraceOn: boolean;
    stallOn: boolean;
    breakoutOn: boolean;
    mcapOn: boolean;
    retracePct: number;
    stallVolPct: number;
    stallBandPct: number;
    breakoutPct: number;
    breakoutVolX: number;
    mcapLevels?: string;
  };
}

export interface LongStateData {
  coinId: number;
  h12High?: number;
  h24High?: number;
  h72High?: number;
  h12Low?: number;
  h24Low?: number;
  h72Low?: number;
  v12Sum?: number;
  v24Sum?: number;
  lastPrice?: number;
  lastMcap?: number;
  lastUpdatedUtc: number;
  lastRetraceFireUtc?: number;
  lastStallFireUtc?: number;
  lastBreakoutFireUtc?: number;
  lastMcapFireUtc?: number;
}

export interface ScheduleConfigData {
  anchorTimesLocal: string;
  anchorPeriodHours: number;
  longCheckpointHours: number;
  hotIntervalMinutes: number;
  cooldownHours: number;
  hysteresisPct: number;
}

export interface UpdateLongStateData {
  price: number;
  marketCap?: number;
  volume24h: number;
  h12High?: number;
  h24High?: number;
  h72High?: number;
  h12Low?: number;
  h24Low?: number;
  h72Low?: number;
  v12Sum?: number;
  v24Sum?: number;
}