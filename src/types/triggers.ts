export interface TriggerConfig {
  retraceOn: boolean;
  stallOn: boolean;
  breakoutOn: boolean;
  mcapOn: boolean;
  retracePct: number;
  stallVolPct: number;
  stallBandPct: number;
  breakoutPct: number;
  breakoutVolX: number;
  mcapLevels?: number[] | undefined;
}

export interface LongListState {
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

export interface TriggerResult {
  coinId: number;
  symbol: string;
  triggerType: 'retrace' | 'stall' | 'breakout' | 'mcap';
  message: string;
  price: number;
  marketCap?: number | undefined;
  volume24h: number;
  priceChange24h: number;
  retraceFromHigh?: number | undefined;
  targetLevel?: number | undefined;
}

export interface AnchorReportData {
  symbol: string;
  price: number;
  change24h: number;
  retraceFrom72hHigh: number;
  volume24h: number;
}

export interface TriggerEvaluator {
  evaluateRetrace(state: LongListState, config: TriggerConfig, currentPrice: number, cooldownHours: number): boolean;
  evaluateStall(state: LongListState, config: TriggerConfig, currentVolume: number, currentPrice: number, cooldownHours: number): boolean;
  evaluateBreakout(state: LongListState, config: TriggerConfig, currentPrice: number, currentVolume: number, cooldownHours: number): boolean;
  evaluateMcap(state: LongListState, config: TriggerConfig, currentMcap: number, cooldownHours: number): { triggered: boolean; level?: number };
}