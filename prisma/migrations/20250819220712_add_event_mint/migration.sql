-- CreateTable
CREATE TABLE "mint_event" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tx_signature" TEXT NOT NULL,
    "mint" TEXT NOT NULL,
    "timestamp" BIGINT NOT NULL,
    "decimals" INTEGER,
    "is_launch_initialization" BOOLEAN NOT NULL DEFAULT false,
    "is_first" BOOLEAN NOT NULL DEFAULT false,
    "first_mint_key" TEXT,
    "init_program" TEXT,
    "validated_by" TEXT,
    "source" TEXT NOT NULL,
    "raw_json" JSONB
);

-- CreateIndex
CREATE UNIQUE INDEX "mint_event_tx_signature_key" ON "mint_event"("tx_signature");

-- CreateIndex
CREATE UNIQUE INDEX "mint_event_first_mint_key_key" ON "mint_event"("first_mint_key");

-- CreateIndex
CREATE INDEX "mint_event_timestamp_idx" ON "mint_event"("timestamp");

-- CreateIndex
CREATE INDEX "mint_event_mint_timestamp_idx" ON "mint_event"("mint", "timestamp");
