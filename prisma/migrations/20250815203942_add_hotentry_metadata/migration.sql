-- CreateTable
CREATE TABLE "coin" (
    "coin_id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "chain" TEXT NOT NULL,
    "pair_address" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT,
    "decimals" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "long_watch" (
    "coin_id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "added_at_utc" INTEGER NOT NULL,
    "retrace_on" BOOLEAN NOT NULL DEFAULT true,
    "stall_on" BOOLEAN NOT NULL DEFAULT true,
    "breakout_on" BOOLEAN NOT NULL DEFAULT true,
    "mcap_on" BOOLEAN NOT NULL DEFAULT false,
    "retrace_pct" REAL NOT NULL DEFAULT 15.0,
    "stall_vol_pct" REAL NOT NULL DEFAULT 30.0,
    "stall_band_pct" REAL NOT NULL DEFAULT 5.0,
    "breakout_pct" REAL NOT NULL DEFAULT 12.0,
    "breakout_vol_x" REAL NOT NULL DEFAULT 1.5,
    "mcap_levels" TEXT,
    "notes" TEXT,
    CONSTRAINT "long_watch_coin_id_fkey" FOREIGN KEY ("coin_id") REFERENCES "coin" ("coin_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "long_state" (
    "coin_id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "h12_high" REAL,
    "h24_high" REAL,
    "h72_high" REAL,
    "h12_low" REAL,
    "h24_low" REAL,
    "h72_low" REAL,
    "v12_sum" REAL,
    "v24_sum" REAL,
    "last_price" REAL,
    "last_mcap" REAL,
    "last_updated_utc" INTEGER NOT NULL,
    "last_retrace_fire_utc" INTEGER,
    "last_stall_fire_utc" INTEGER,
    "last_breakout_fire_utc" INTEGER,
    "last_mcap_fire_utc" INTEGER,
    CONSTRAINT "long_state_coin_id_fkey" FOREIGN KEY ("coin_id") REFERENCES "coin" ("coin_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "hot_entry" (
    "hot_id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "contract_address" TEXT NOT NULL,
    "chain_id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT,
    "image_url" TEXT,
    "websites_json" TEXT,
    "socials_json" TEXT,
    "added_at_utc" INTEGER NOT NULL,
    "anchor_price" REAL NOT NULL,
    "anchor_mcap" REAL,
    "pct_target" REAL,
    "mcap_targets" TEXT,
    "failsafe_fired" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "hot_trigger_state" (
    "hot_id" INTEGER NOT NULL,
    "trig_kind" TEXT NOT NULL,
    "trig_value" REAL NOT NULL,
    "fired" BOOLEAN NOT NULL DEFAULT false,

    PRIMARY KEY ("hot_id", "trig_kind", "trig_value"),
    CONSTRAINT "hot_trigger_state_hot_id_fkey" FOREIGN KEY ("hot_id") REFERENCES "hot_entry" ("hot_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "alert_history" (
    "alert_id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "hot_id" INTEGER,
    "coin_id" INTEGER NOT NULL,
    "ts_utc" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "payload_json" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    CONSTRAINT "alert_history_coin_id_fkey" FOREIGN KEY ("coin_id") REFERENCES "coin" ("coin_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "alert_history_hot_id_fkey" FOREIGN KEY ("hot_id") REFERENCES "hot_entry" ("hot_id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "schedule_cfg" (
    "cfg_id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "anchor_times_local" TEXT NOT NULL,
    "anchor_period_hours" INTEGER NOT NULL DEFAULT 12,
    "long_checkpoint_hours" INTEGER NOT NULL DEFAULT 6,
    "hot_interval_minutes" INTEGER NOT NULL DEFAULT 5,
    "cooldown_hours" REAL NOT NULL DEFAULT 2.0,
    "hysteresis_pct" REAL NOT NULL DEFAULT 30.0
);

-- CreateTable
CREATE TABLE "symbol_alias" (
    "alias" TEXT NOT NULL PRIMARY KEY,
    "coin_id" INTEGER NOT NULL,
    CONSTRAINT "symbol_alias_coin_id_fkey" FOREIGN KEY ("coin_id") REFERENCES "coin" ("coin_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "outbox" (
    "outbox_id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "ts_utc" INTEGER NOT NULL,
    "chat_id" TEXT NOT NULL,
    "message_text" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "sent_ok" BOOLEAN NOT NULL DEFAULT false,
    "sent_ts_utc" INTEGER
);

-- CreateTable
CREATE TABLE "rolling_data_points" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "coin_id" INTEGER NOT NULL,
    "timestamp" INTEGER NOT NULL,
    "price" REAL NOT NULL,
    "volume" REAL NOT NULL,
    "market_cap" REAL,
    CONSTRAINT "rolling_data_points_coin_id_fkey" FOREIGN KEY ("coin_id") REFERENCES "coin" ("coin_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "migrations" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "executed_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "coin_symbol_idx" ON "coin"("symbol");

-- CreateIndex
CREATE INDEX "coin_is_active_idx" ON "coin"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "coin_chain_pair_address_key" ON "coin"("chain", "pair_address");

-- CreateIndex
CREATE INDEX "long_state_last_updated_utc_idx" ON "long_state"("last_updated_utc");

-- CreateIndex
CREATE UNIQUE INDEX "hot_entry_contract_address_key" ON "hot_entry"("contract_address");

-- CreateIndex
CREATE INDEX "hot_entry_symbol_idx" ON "hot_entry"("symbol");

-- CreateIndex
CREATE UNIQUE INDEX "alert_history_fingerprint_key" ON "alert_history"("fingerprint");

-- CreateIndex
CREATE INDEX "alert_history_coin_id_ts_utc_idx" ON "alert_history"("coin_id", "ts_utc");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_fingerprint_key" ON "outbox"("fingerprint");

-- CreateIndex
CREATE INDEX "outbox_sent_ok_ts_utc_idx" ON "outbox"("sent_ok", "ts_utc");

-- CreateIndex
CREATE INDEX "rolling_data_points_coin_id_timestamp_idx" ON "rolling_data_points"("coin_id", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "migrations_name_key" ON "migrations"("name");
