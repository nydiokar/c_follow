export interface Website {
  url: string;
}

export interface Social {
  platform: string;
  handle: string;
}

export interface HotListEntry {
  hotId: number;
  contractAddress: string;
  chainId: string;
  symbol: string;
  name?: string | null;
  imageUrl?: string | null;
  websites?: Website[];
  socials?: Social[];
  addedAtUtc: number;
  anchorPrice: number;
  anchorMcap?: number | null;
  pctTarget?: number | null;
  mcapTargets?: number[];
  failsafeFired: boolean;
  activeTriggers: HotTrigger[];
}

export interface HotTrigger {
  kind: 'pct' | 'mcap';
  value: number;
  fired: boolean;
}

export interface HotAlert {
  hotId: number;
  symbol: string;
  alertType: 'pct' | 'mcap' | 'failsafe' | 'entry_added';
  message: string;
  currentPrice: number;
  currentMcap?: number | undefined;
  deltaFromAnchor: number;
  targetValue?: number | undefined;
  timestamp: number;
}

export interface HotListConfig {
  checkIntervalMinutes: number;
  failsafeThresholdPct: number;
}

export interface HotListEvaluator {
  evaluateEntry(entry: HotListEntry, currentPrice: number, currentMcap?: number): HotAlert[];
  shouldRemoveEntry(entry: HotListEntry): boolean;
}