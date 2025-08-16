-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_alert_history" (
    "alert_id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "hot_id" INTEGER,
    "coin_id" INTEGER,
    "ts_utc" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "payload_json" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    CONSTRAINT "alert_history_coin_id_fkey" FOREIGN KEY ("coin_id") REFERENCES "coin" ("coin_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "alert_history_hot_id_fkey" FOREIGN KEY ("hot_id") REFERENCES "hot_entry" ("hot_id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_alert_history" ("alert_id", "coin_id", "fingerprint", "hot_id", "kind", "payload_json", "ts_utc") SELECT "alert_id", "coin_id", "fingerprint", "hot_id", "kind", "payload_json", "ts_utc" FROM "alert_history";
DROP TABLE "alert_history";
ALTER TABLE "new_alert_history" RENAME TO "alert_history";
CREATE UNIQUE INDEX "alert_history_fingerprint_key" ON "alert_history"("fingerprint");
CREATE INDEX "alert_history_coin_id_ts_utc_idx" ON "alert_history"("coin_id", "ts_utc");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
