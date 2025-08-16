-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_schedule_cfg" (
    "cfg_id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "anchor_times_local" TEXT NOT NULL,
    "anchor_period_hours" INTEGER NOT NULL DEFAULT 12,
    "long_checkpoint_hours" INTEGER NOT NULL DEFAULT 6,
    "hot_interval_minutes" INTEGER NOT NULL DEFAULT 5,
    "cooldown_hours" REAL NOT NULL DEFAULT 2.0,
    "hysteresis_pct" REAL NOT NULL DEFAULT 30.0
);
INSERT INTO "new_schedule_cfg" ("anchor_period_hours", "anchor_times_local", "cfg_id", "cooldown_hours", "hot_interval_minutes", "hysteresis_pct", "long_checkpoint_hours") SELECT "anchor_period_hours", "anchor_times_local", "cfg_id", "cooldown_hours", "hot_interval_minutes", "hysteresis_pct", "long_checkpoint_hours" FROM "schedule_cfg";
DROP TABLE "schedule_cfg";
ALTER TABLE "new_schedule_cfg" RENAME TO "schedule_cfg";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
