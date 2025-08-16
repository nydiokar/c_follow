/*
  Warnings:

  - You are about to drop the column `pct_target` on the `hot_entry` table. All the data in the column will be lost.

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
    "anchor_price" REAL NOT NULL,
    "anchor_mcap" REAL,
    "pct_targets" TEXT,
    "mcap_targets" TEXT,
    "failsafe_fired" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "coin_id" INTEGER,
    CONSTRAINT "hot_entry_coin_id_fkey" FOREIGN KEY ("coin_id") REFERENCES "coin" ("coin_id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_hot_entry" ("added_at_utc", "anchor_mcap", "anchor_price", "chain_id", "coin_id", "contract_address", "failsafe_fired", "hot_id", "image_url", "is_active", "mcap_targets", "name", "socials_json", "symbol", "websites_json") SELECT "added_at_utc", "anchor_mcap", "anchor_price", "chain_id", "coin_id", "contract_address", "failsafe_fired", "hot_id", "image_url", "is_active", "mcap_targets", "name", "socials_json", "symbol", "websites_json" FROM "hot_entry";
DROP TABLE "hot_entry";
ALTER TABLE "new_hot_entry" RENAME TO "hot_entry";
CREATE UNIQUE INDEX "hot_entry_contract_address_key" ON "hot_entry"("contract_address");
CREATE INDEX "hot_entry_symbol_idx" ON "hot_entry"("symbol");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
