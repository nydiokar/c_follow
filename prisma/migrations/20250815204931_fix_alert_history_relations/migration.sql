-- CreateIndex
CREATE INDEX "alert_history_hot_id_ts_utc_idx" ON "alert_history"("hot_id", "ts_utc");
