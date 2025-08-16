Unified Telegram bot spec. Long List + hot List. DexScreener fit check included.

Scope

Chains: Solana-first; extensible to others.

Data source: poll DEX Screener API for price, mcap, volume, pair info. Use “pairs by chain/pair,” and “search pairs” for discovery. Respect rate limits. 
docs.dexscreener.com

Scheduling

AnchorReport: user-defined 12h or 24h at fixed local times.

Checkpoint: evaluate Long List every 6h (optionally 4h). hot List every 5m.

Lists
Long List (persistent watch 50–200)

Operation

Always send AnchorReport at scheduled times.

Between anchors, send a Triggered Update only if ≥1 enabled trigger fires at a checkpoint.

Triggers (user-selectable; defaults ON except MCAP)

Retracement from 72h high: drop ≥ 15% (configurable).

Momentum stall: 24h volume −30% vs prior 24h AND price in ±5% band over last 12h.

Breakout: +12% vs 12h baseline AND 24h volume ×1.5 vs prior 12h.

Threshold cross (price/mcap): user-defined levels. Default OFF.

Sorting

Retracement % from 72h high (desc), tie-breakers: 24h volume (desc), then liquidity.

Anti-spam

Cooldown per coin per trigger: 2h.

Hysteresis: 30% reversal before opposite-side retrigger.

No “top-N” cap. Dedup same coin same cycle.

Reports

Anchor: Long List — {12h|24h} Snapshot (HH:MM) with table: Ticker | Price | 24h Δ% | From 72h High Δ% | 24h Vol.

Triggered: grouped bullets by trigger type.

Controls

long add <symbol> / long rm <symbol>

long anchor 08:00,20:00

long checkpoint 6h

long trigger retrace on|off | stall on|off | breakout on|off | mcap on|off

long thresholds default retrace=15 breakout=12 stall_vol=30

long thresholds custom on|off

long set <symbol> retrace=18 breakout=10 mcap=300k

report now

hot List (one-shot user alerts + built-in death warning)

State at add

Capture anchor price and anchor mcap.

Built-in failsafe (always ON)

Fire if drawdown ≥ 60% from anchor price OR anchor mcap. Emits once; does not deactivate coin or user triggers.

User triggers (any combination)

Percent from anchor price: pct=±N (one-shot; removes that trigger on fire).

Market cap target(s): mcap=levels (one-shot per level; removes coin if no triggers remain and failsafe has already fired).

Cadence

Evaluate every 5m.

Deactivation

If a user trigger fires → remove that trigger. If no user triggers remain AND failsafe has fired → remove coin.

If only failsafe fires → keep coin active.

Alerts

Pct: HOT | TICKER | Δ since add −5.1% | Price X.XXXX | Hit: pct −5%

Mcap: HOT | TICKER | Mcap 300k touched | Δ since add +11.2%

Failsafe: HOT | TICKER | FAILSAFE | −60% from anchor (price/mcap) | Review

Controls

hot add <symbol> [pct=±N] [mcap=levels]

hot rm <symbol>

hot list

hot check 5m

History

alerts returns Hot List alerts only.

Data model (conceptual, not schema)

Coin: symbol, chain, pair address, status.

Long List state: rolling highs/lows (12h/24h/72h), rolling volumes (12h/24h), last alert per trigger, custom thresholds.

Hot List state: anchor price, anchor mcap, active user triggers, failsafe-fired flag, last-fired timestamps.

DexScreener suitability

API endpoints provide search, pair fetch, and token profiles; usable for polling-based triggers. Rate limits: up to 300 req/min on pair/search; 60 req/min on some endpoints. No server-side push; implement your own scheduler and caching. Complies with their API T&Cs. 
docs.dexscreener.com
+1

Alternative data taps exist (wrappers/scrapers), but native API is sufficient for this bot’s polling model. 
GitHub
Apify

Command summary

Long: add/rm, trigger toggles, thresholds, anchor times, checkpoint interval, force report now.

hot: add/rm, list, check interval.

Global: alerts (hot-list history only).

Proceed with this blueprint; DexScreener API is adequate for discovery and trigger evaluation via polling.



Pitfalls first. Then a lean SQL schema.

Pitfalls / gotchas

Pair identity drift. Tokens can migrate liquidity or pairs. Track by pair address (chain+pair_id), not symbol. Keep a mapping table for symbol → active pair.

Decimals / reverse pairs. Some pairs invert (USDC/COIN vs COIN/USDC). Normalize to a single “price in USD” pipeline before triggers.

Rolling baselines. Retracement and stall need 12h/24h/72h highs/volumes. If you don’t keep minimal OHLCV snapshots, you’ll misfire after restarts. Persist rolling windows.

Cold starts/backfill. On first add, you lack history. Mark coin as warming until you accumulate enough samples (e.g., 72h) or backfill via API if available.

API anomalies. DEX feeds can spike/flatline. Add sanity checks: ignore ticks with |Δprice| > 95% unless corroborated by mcap/LP/volume.

Alert storms. One market event can trip dozens. Implement per-coin/per-trigger idempotency (don’t re-send within the same checkpoint) and a global per-minute cap with overflow summary.

Timezone vs schedule. Anchor reports must use Europe/Sofia consistently. Record times in UTC; schedule in local; show both if needed.

Exactly-once delivery. Telegram can be flaky. Store an alert_fingerprint and only mark “sent” after API 200; on retry, dedupe by fingerprint.

SQLite on Pi. Use WAL mode, proper indexes, and avoid long write transactions. One writer, many readers. Rotate logs; don’t fill disk.

Process reliability. Run under systemd, restart=always, health pings; graceful shutdown to flush pending alerts.

Secrets. Bot token in root-readable .env with strict permissions; never in logs. Rotate if leaked.

Config drift. Triggers change over time. Version config; store per-user overrides with effective-at timestamps.

Rug failsafe sensitivity. Your 60% drawdown trigger will also fire on legit flash crashes. Label as “failsafe”; do not auto-act downstream.

Minimal SQL schema (SQLite-friendly)
-- Core coins / pairs
CREATE TABLE coin (
  coin_id        INTEGER PRIMARY KEY,
  chain          TEXT NOT NULL,
  pair_address   TEXT NOT NULL,          -- canonical pair id from source
  symbol         TEXT NOT NULL,
  name           TEXT,
  decimals       INTEGER,
  is_active      INTEGER NOT NULL DEFAULT 1,
  UNIQUE(chain, pair_address)
);

CREATE INDEX idx_coin_symbol ON coin(symbol);
CREATE INDEX idx_coin_active ON coin(is_active);

-- Long List membership + per-coin config
CREATE TABLE long_watch (
  coin_id        INTEGER PRIMARY KEY REFERENCES coin(coin_id) ON DELETE CASCADE,
  added_at_utc   INTEGER NOT NULL,       -- epoch seconds
  retrace_on     INTEGER NOT NULL DEFAULT 1,
  stall_on       INTEGER NOT NULL DEFAULT 1,
  breakout_on    INTEGER NOT NULL DEFAULT 1,
  mcap_on        INTEGER NOT NULL DEFAULT 0,
  retrace_pct    REAL    NOT NULL DEFAULT 15.0,   -- %
  stall_vol_pct  REAL    NOT NULL DEFAULT 30.0,   -- %
  stall_band_pct REAL    NOT NULL DEFAULT 5.0,    -- %
  breakout_pct   REAL    NOT NULL DEFAULT 12.0,   -- %
  breakout_vol_x REAL    NOT NULL DEFAULT 1.5,    -- multiplier
  mcap_levels    TEXT,                    -- CSV like "300000,1000000"
  notes          TEXT
);

-- Long List rolling state for triggers
CREATE TABLE long_state (
  coin_id        INTEGER PRIMARY KEY REFERENCES coin(coin_id) ON DELETE CASCADE,
  h12_high       REAL,  h24_high REAL,  h72_high REAL,
  h12_low        REAL,  h24_low  REAL,  h72_low  REAL,
  v12_sum        REAL,  v24_sum  REAL,
  last_price     REAL,
  last_mcap      REAL,
  last_updated_utc INTEGER NOT NULL,
  -- last fire times per trigger to enforce cooldown
  last_retrace_fire_utc INTEGER,
  last_stall_fire_utc   INTEGER,
  last_breakout_fire_utc INTEGER,
  last_mcap_fire_utc    INTEGER
);

-- Short List entries
CREATE TABLE hot_entry (
  hot_id         INTEGER PRIMARY KEY,
  coin_id        INTEGER NOT NULL REFERENCES coin(coin_id) ON DELETE CASCADE,
  added_at_utc   INTEGER NOT NULL,
  anchor_price   REAL NOT NULL,
  anchor_mcap    REAL,
  pct_target     REAL,            -- signed %, nullable
  mcap_targets   TEXT,            -- CSV levels, nullable
  failsafe_fired INTEGER NOT NULL DEFAULT 0
);

-- Fired user triggers for a hot_entry (one-shot)
CREATE TABLE hot_trigger_state (
  hot_id         INTEGER NOT NULL REFERENCES hot_entry(hot_id) ON DELETE CASCADE,
  trig_kind      TEXT NOT NULL,   -- 'pct' or 'mcap'
  trig_value     REAL NOT NULL,   -- pct value or mcap level
  fired          INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (hot_id, trig_kind, trig_value)
);

-- Alerts history (Short List only, as requested)
CREATE TABLE alert_history (
  alert_id       INTEGER PRIMARY KEY,
  hot_id         INTEGER REFERENCES hot_entry(hot_id) ON DELETE SET NULL,
  coin_id        INTEGER NOT NULL REFERENCES coin(coin_id) ON DELETE CASCADE,
  ts_utc         INTEGER NOT NULL,
  kind           TEXT NOT NULL,   -- 'pct','mcap','failsafe'
  payload_json   TEXT NOT NULL,   -- snapshot used to render message
  fingerprint    TEXT NOT NULL,   -- for idempotency with Telegram
  UNIQUE(fingerprint)
);

-- Scheduling settings (global)
CREATE TABLE schedule_cfg (
  cfg_id         INTEGER PRIMARY KEY CHECK (cfg_id=1),
  anchor_times_local TEXT NOT NULL,  -- "08:00,20:00"
  anchor_period_hours INTEGER NOT NULL DEFAULT 12,
  long_checkpoint_hours INTEGER NOT NULL DEFAULT 6,
  hot_interval_minutes INTEGER NOT NULL DEFAULT 5,
  cooldown_hours  REAL NOT NULL DEFAULT 2.0,      -- long triggers cooldown
  hysteresis_pct  REAL NOT NULL DEFAULT 30.0
);
INSERT INTO schedule_cfg(cfg_id, anchor_times_local) VALUES (1, '08:00,20:00');

-- Optional: map symbol aliases → coin_id (renames, wrappers)
CREATE TABLE symbol_alias (
  alias          TEXT PRIMARY KEY,
  coin_id        INTEGER NOT NULL REFERENCES coin(coin_id) ON DELETE CASCADE
);

-- Idempotent delivery bookkeeping
CREATE TABLE outbox (
  outbox_id      INTEGER PRIMARY KEY,
  ts_utc         INTEGER NOT NULL,
  chat_id        TEXT NOT NULL,
  message_text   TEXT NOT NULL,
  fingerprint    TEXT NOT NULL,
  sent_ok        INTEGER NOT NULL DEFAULT 0,
  sent_ts_utc    INTEGER,
  UNIQUE(fingerprint)
);

-- Indices for runtime
CREATE INDEX idx_long_state_update ON long_state(last_updated_utc);
CREATE INDEX idx_hot_entry_coin ON hot_entry(coin_id);
CREATE INDEX idx_alert_hist_coin ON alert_history(coin_id, ts_utc);
CREATE INDEX idx_outbox_unsent ON outbox(sent_ok, ts_utc);

Trigger logic mapping (from spec → data)

Retracement: last_price <= h72_high * (1 - retrace_pct/100) and now - last_retrace_fire_utc >= cooldown.

Stall: (v24_sum <= prev_v24_sum * (1 - stall_vol_pct/100)) AND (h12_high <= last_price*(1+stall_band_pct/100)) AND (h12_low >= last_price*(1-stall_band_pct/100)).

Breakout: last_price >= baseline12h*(1+breakout_pct/100) AND v24_sum >= prev_v12_sum*breakout_vol_x.

MCAP levels: first-touch logic; keep a “level→fired” map per coin if using Long List levels.

Hot pct: compare to anchor_price * (1 + pct_target/100).

Hot mcap: first-touch of any configured level.

Failsafe: drawdown ≥ 60% vs anchor_price OR anchor_mcap.

Runtime guidance on Pi 5

SQLite: PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA temp_store=MEMORY;

Batching: fetch API → compute → single transaction update → stage alerts in outbox.

Worker split:

fetcher (API),

evaluator-long (every 6h),

evaluator-hot (every 5m),

sender (Telegram).

Backups: hourly .backup to a second disk; compress daily.

Observability: counters per cycle (polled pairs, alerts generated, dropped duplicates), last success timestamps; expose /healthz.

Config: keep schedule and thresholds in DB only; mutate via bot commands; never hardcode.

What you still must decide

Backfill policy for Long List (warm-up vs API history).

Liquidity/LP data usage: you removed LP-trigger; still store liquidity for tie-breaker sorting.

Cutoffs for “anomaly discard” (e.g., ignore if volume=0 but price jumps 50%).