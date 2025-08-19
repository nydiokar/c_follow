-- Recreate mint_event with SQLite-friendly types and invariants

PRAGMA foreign_keys=OFF;

CREATE TABLE IF NOT EXISTS mint_event_new (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  tx_signature          TEXT    NOT NULL UNIQUE,
  mint                  TEXT    NOT NULL,
  "timestamp"           INTEGER NOT NULL,
  decimals              INTEGER,
  is_launch_initialization INTEGER NOT NULL DEFAULT 0,
  is_first              INTEGER NOT NULL DEFAULT 0,
  first_mint_key        TEXT,
  init_program          TEXT,
  validated_by          TEXT,
  source                TEXT    NOT NULL,
  raw_json              TEXT,
  CHECK (is_first IN (0,1) AND is_launch_initialization IN (0,1)),
  CHECK (
    (is_first = 0 AND first_mint_key IS NULL)
    OR
    (is_first = 1 AND first_mint_key = mint)
  )
);

INSERT OR IGNORE INTO mint_event_new (
  id, tx_signature, mint, "timestamp", decimals, is_launch_initialization, is_first, first_mint_key, init_program, validated_by, source, raw_json
) 
SELECT 
  id,
  tx_signature,
  mint,
  CAST("timestamp" AS INTEGER),
  decimals,
  CASE WHEN is_launch_initialization THEN 1 ELSE 0 END,
  CASE WHEN is_first THEN 1 ELSE 0 END,
  CASE WHEN is_first THEN mint ELSE NULL END,
  init_program,
  validated_by,
  source,
  CAST(raw_json AS TEXT)
FROM mint_event;

DROP TABLE IF EXISTS mint_event;
ALTER TABLE mint_event_new RENAME TO mint_event;

CREATE UNIQUE INDEX IF NOT EXISTS mint_event_tx_signature_key ON mint_event(tx_signature);
CREATE UNIQUE INDEX IF NOT EXISTS mint_event_first_mint_key_key ON mint_event(first_mint_key);
CREATE INDEX IF NOT EXISTS mint_event_timestamp_idx ON mint_event("timestamp");
CREATE INDEX IF NOT EXISTS mint_event_mint_timestamp_idx ON mint_event(mint, "timestamp");

PRAGMA foreign_keys=ON;


