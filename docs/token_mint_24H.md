## 24H Token Mint Report — Detailed Plan (Helius + DexScreener)

### Objective
Produce a daily report of all fungible tokens minted within the past 24 hours whose current market cap is within 200,000–1,500,000 USD. Delivery via Telegram, with optional CSV/JSON export.

### Data sources
- Helius Enhanced Webhooks: real-time `TOKEN_MINT` events (1 credit/event).
- Helius Enhanced Transactions (by address): backfill/outage recovery with `type=TOKEN_MINT` (100 credits/page).
- DexScreener API: price/liquidity/marketCap enrichment for Solana tokens.

### End-to-end flow
1) Webhook ingest → parse Enhanced payload → extract `txSignature`, `mint`, `decimals`, `timestamp` → dedupe gate by mint. [DONE]
2) If first time seeing this mint, run First-Mint Validation (below). If passes, persist a single `isFirst=true` row; otherwise drop. [DONE — Heuristic A]
3) Maintain a rolling 24h window at query time; no hard deletes. [DONE]
4) At report time, query `isFirst=true` within 24h, enrich via DexScreener, filter by market cap [200k, 1.5M], format, deliver via Telegram; optional CSV/JSON. [DONE — on-demand `/mints_24h`]
5) On startup or gaps, run backfill via Enhanced Transactions and reapply the same validation. [N/A]

### Helius configuration [DONE]
- Webhook type: `enhanced`
- `transactionTypes`: ["TOKEN_MINT"] (fungible). 
- `accountAddresses`: leave empty to receive all token mints chain-wide.
- Optional scoping knobs (volume reduction, not universal):
  - SPL Token: `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`
  - Token-2022: `TokenzQdBNbLqP5VEh9xnFJz5dG27K7ivozsQJ4xxQh`
  - Metaplex Metadata (only “mints with metadata”): `metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s`

Note: `TOKEN_MINT` fires on any MintTo, not only the first. Dedupe + validation is mandatory.

Example (create):
```json
POST https://api.helius.xyz/v0/webhooks?api-key=YOUR_KEY
{
  "webhookURL": "https://your-domain/webhooks/helius",
  "webhookType": "enhanced",
  "transactionTypes": ["TOKEN_MINT"],
  "accountAddresses": []
}
```

Backfill (Enhanced Tx by address):
```
GET https://api.helius.xyz/v0/addresses/{PROGRAM_OR_ACCOUNT}/transactions?api-key=YOUR_KEY&type=TOKEN_MINT&limit=100&before=<lastSig>
```
Iterate `before` until tx timestamp < now-24h.

Credits & cost control:
- Webhooks: ~1 credit per delivered event; create/update/delete = 100 credits.
- Enhanced Tx: 100 credits/page (≤100 tx per page). Use only for initial 24h and outage recovery.

### Database changes [DONE]
- Table `mint_event` (per event, minimal retention)
  - `id` PK
  - `txSignature` TEXT UNIQUE NOT NULL
  - `mint` TEXT NOT NULL
  - `timestamp` BIGINT NOT NULL
  - `decimals` INT NULL
  - `isLaunchInitialization` BOOL DEFAULT FALSE
  - `isFirst` BOOL DEFAULT FALSE
  - `initProgram` TEXT NULL CHECK (initProgram IN ('spl-token','token-2022'))
  - `validatedBy` TEXT NULL CHECK (validatedBy IN ('initHeuristic','dasCreated','lookbackTx'))
  - `source` TEXT NOT NULL CHECK (source IN ('webhook','backfill'))
  - `raw_json` JSONB NULL

Indexes:
- `IDX_mint_event_ts` ON (`timestamp`)
- `IDX_mint_event_mint_ts` ON (`mint`, `timestamp`)
- Partial unique: `UX_first_per_mint` UNIQUE ON (`mint`) WHERE `isFirst`

Migration tasks: [DONE]
- Add `mint_event` with the above columns and indexes.

### Services to implement
1) `src/services/heliusWebhook.ts` [DONE]
   - HTTP handler `POST /webhooks/helius`.
   - Verify Helius signature (header), parse Enhanced payload, extract `txSignature`, `mint`, `decimals`, `timestamp`. Dont forget about HELIUS_WEBHOOK_SECRET and to reject if not authorized. 
   - Dedupe gate by mint via in-memory/Redis set; drop early if seen.
   - Run First-Mint Validation (see section below). If accepted, persist a single row with `isFirst=true`; otherwise drop.
   - Return 200 quickly; async logging.

2) `src/services/mintBackfill.ts` [N/A]
   - Given a list of program addresses (or a single SPL Token program), page Enhanced Tx with `type=TOKEN_MINT`.
   - For each tx, extract same fields and upsert into `mint_event`.
   - Stop when oldest tx < now-24h.

3) `src/services/mintEnrichment.ts` [DONE — inline in report]
   - Always fetch fresh at report time. For the input list of `mint` addresses (Solana), call `DexScreenerService.batchGetTokens` (`chainId = "solana"`).
   - Pick best pair per token by highest liquidity, then 24h volume (matches current logic).
   - Do not persist enrichment as a cache; use in-memory results to build the report.

4) `src/services/mint24hReport.ts` [DONE — `/mints_24h`]
   - Query rows where `isFirst=true` and `timestamp >= now-24h` and (optional) `isLaunchInitialization = true` if configured.
   - Enrich now (fresh fetch) using `mintEnrichment` for all selected mints.
   - Filter by `marketCapOrFdv` in [200_000, 1_500_000].
   - Format rows: `Symbol | Mcap | Price | Liquidity | Mint Time | Mint Address`.
   - Send via existing `TelegramService` (single message or paginated). Optional CSV/JSON export.

5) `src/services/scheduler.ts` updates [N/A]
   - Add daily cron for report (configurable local time).
   - Prefer query-time filtering for the 24h window (no hard delete required). Optionally, add a weekly housekeeping job to purge very old rows (e.g., >30 days) if disk growth matters.
   - On boot: run `mintBackfill` once for coverage.

### Mint creation confirmation (initializeMint detection) [DONE — Heuristic A]

Targets:
- Program IDs:
  - SPL Token: `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`
  - Token-2022: `TokenzQdBNbLqP5VEh9xnFJz5dG27K7ivozsQJ4xxQh`
- Instruction names: `initializeMint` or `initializeMint2` (treat as equivalent initializers).

Where to look:
- In the Helius Enhanced webhook payload for the same transaction that emitted `TOKEN_MINT`, scan both `instructions` and `innerInstructions` for those program IDs with `parsed.type` in {`initializeMint`,`initializeMint2`}.
- Match `accounts[0]` (the mint) to the mint used by the `MintTo` in the same transaction.

Confirmation heuristic (canonical pattern):
- The transaction should also contain a System Program `createAccount` for the same mint before the `initializeMint*` call.
- The presence of `createAccount → initializeMint*` for the same mint strongly indicates on-chain mint creation (launch-initialization) and the subsequent `MintTo` is the first issuance.

Minimal check (logic):
1) Collect all instructions = `instructions ∪ innerInstructions`.
2) Find `MintTo` → extract `mint`.
3) Verify there exists:
   - `initializeMint*` where `accounts[0] == mint`, and
   - `systemProgram.createAccount` where `newAccount == mint`, earlier in the tx.
4) If yes, classify this `TOKEN_MINT` as `isLaunchInitialization = true` and record `initProgram`.

Reporting toggle:
- Add config `REPORT_ONLY_LAUNCH_INITIALIZATION=true|false` to include only classified first mints in the daily report when enabled.

### Report specification [DONE]
- Time window: strict last 24h from report generation time.
- Filters: market cap within 200k–1.5M USD at report time; exclude missing cap unless a toggle `INCLUDE_FDV_WHEN_NO_MCAP=true` is enabled. If `REPORT_ONLY_LAUNCH_INITIALIZATION=true`, include only `isLaunchInitialization = true`.
- Sort: by market cap desc, then liquidity desc, then mint time desc.
- Output:
  - Telegram text summary with top N (e.g., 50). If overflow, send multiple messages or attach CSV.
  - Optional attachment: CSV/JSON with all rows.

- ### Configuration
- `.env` additions: `HELIUS_API_KEY`, `HELIUS_WEBHOOK_SECRET`, `REPORT_LOCAL_TIME=08:00`, `MINT_CAP_MIN=200000`, `MINT_CAP_MAX=1500000`, `INCLUDE_FDV_WHEN_NO_MCAP=true|false`, `REPORT_ONLY_LAUNCH_INITIALIZATION=true|false`.
- DB `schedule_cfg` can hold report time and toggles if we prefer runtime mutability.

### Reliability & observability [DONE]
- Idempotency: unique `(txSignature)`; ignore duplicates.
- Gaps: detect by webhook downtime or clock drift → trigger backfill.
- Metrics: counts for received events, backfill pages, tokens enriched, tokens reported; last success timestamps.
- Logging: structured, with sampling for high-volume periods.

### Security [DONE]
- Verify webhook signatures; reject if invalid.
- Do not log secrets or full payloads containing PII.
- Rate-limit the webhook endpoint to avoid abuse.

### Testing plan [PENDING]
- Unit: parse Enhanced webhook payload → `mint_event` rows; initializeMint* detection and classification; enrichment mapping from DexScreener to internal shape; filter logic for cap range.
- Integration: simulate webhook + on-demand report end-to-end in a local DB.
- Load: feed N synthetic mint events; ensure performance and no spam.

### Milestones (execution checklist)
1) DB migration for `mint_event` with invariants. [DONE]
2) Webhook endpoint + signature verification + initializeMint* detection. [DONE]
3) Backfill service (single program first), stop at 24h. [N/A]
4) Enrichment service (fresh fetch at report time). [DONE]
5) Report generator + Telegram integration (on-demand `/mints_24h`). [DONE]
6) Scheduler entries (daily report + housekeeping). [N/A]
7) Config + env wiring + docs. [DONE]
8) Tests (unit + integration); dry run in staging. [PENDING]
9) Production enablement: create webhook in Helius dashboard/API; verify delivery. [DONE]

### Notes & constraints
- Prefer webhook-first to keep costs predictable; use Enhanced Tx only on demand.
- DAS global scans are intentionally avoided due to cost and lack of server-side time filters for broad queries.
- Market cap can be absent for very new tokens; we default to excluding unless configured to use FDV.
