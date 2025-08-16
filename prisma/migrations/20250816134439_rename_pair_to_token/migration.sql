/*
  Warnings:

  - You are about to drop the column `pair_address` on the `coin` table. All the data in the column will be lost.
  - Added the required column `token_address` to the `coin` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_coin" (
    "coin_id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "chain" TEXT NOT NULL,
    "token_address" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT,
    "decimals" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true
);
INSERT INTO "new_coin" ("chain", "coin_id", "decimals", "is_active", "name", "symbol") SELECT "chain", "coin_id", "decimals", "is_active", "name", "symbol" FROM "coin";
DROP TABLE "coin";
ALTER TABLE "new_coin" RENAME TO "coin";
CREATE INDEX "coin_symbol_idx" ON "coin"("symbol");
CREATE INDEX "coin_is_active_idx" ON "coin"("is_active");
CREATE UNIQUE INDEX "coin_chain_token_address_key" ON "coin"("chain", "token_address");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
