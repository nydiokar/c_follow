/*
  Warnings:

  - You are about to drop the column `anchor_mcap` on the `hot_entry` table. All the data in the column will be lost.
  - You are about to drop the column `anchor_price` on the `hot_entry` table. All the data in the column will be lost.
  - You are about to drop the column `mcap_targets` on the `hot_entry` table. All the data in the column will be lost.
  - You are about to drop the column `pct_targets` on the `hot_entry` table. All the data in the column will be lost.
  - Added the required column `anchor_price` to the `hot_trigger_state` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_hot_entry" (
    "hot_id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "contract_address" TEXT NOT NULL,
    "chain_id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT,
    "image_url" TEXT,
    "websites_json" TEXT,
    "socials_json" TEXT,
    "added_at_utc" INTEGER NOT NULL,
    "failsafe_fired" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "coin_id" INTEGER,
    CONSTRAINT "hot_entry_coin_id_fkey" FOREIGN KEY ("coin_id") REFERENCES "coin" ("coin_id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_hot_entry" ("added_at_utc", "chain_id", "coin_id", "contract_address", "failsafe_fired", "hot_id", "image_url", "is_active", "name", "socials_json", "symbol", "websites_json") SELECT "added_at_utc", "chain_id", "coin_id", "contract_address", "failsafe_fired", "hot_id", "image_url", "is_active", "name", "socials_json", "symbol", "websites_json" FROM "hot_entry";
DROP TABLE "hot_entry";
ALTER TABLE "new_hot_entry" RENAME TO "hot_entry";
CREATE UNIQUE INDEX "hot_entry_contract_address_key" ON "hot_entry"("contract_address");
CREATE INDEX "hot_entry_symbol_idx" ON "hot_entry"("symbol");
CREATE TABLE "new_hot_trigger_state" (
    "hot_id" INTEGER NOT NULL,
    "trig_kind" TEXT NOT NULL,
    "trig_value" REAL NOT NULL,
    "fired" BOOLEAN NOT NULL DEFAULT false,
    "anchor_price" REAL NOT NULL,
    "anchor_mcap" REAL,

    PRIMARY KEY ("hot_id", "trig_kind", "trig_value"),
    CONSTRAINT "hot_trigger_state_hot_id_fkey" FOREIGN KEY ("hot_id") REFERENCES "hot_entry" ("hot_id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_hot_trigger_state" ("fired", "hot_id", "trig_kind", "trig_value") SELECT "fired", "hot_id", "trig_kind", "trig_value" FROM "hot_trigger_state";
DROP TABLE "hot_trigger_state";
ALTER TABLE "new_hot_trigger_state" RENAME TO "hot_trigger_state";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
