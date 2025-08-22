## Real-time WebSocket Subscriptions Plan (DEX program- and mint-focused)

Goal: reduce noise by subscribing to specific DEX programs via WebSockets and derive token mints/pool-creation events, then fetch full transaction data with getTransaction for downstream processing and alerts.

References:
- Helius WebSocket methods overview: `https://www.helius.dev/docs/api-reference/rpc/websocket-methods`
- accountSubscribe spec: `https://www.helius.dev/docs/api-reference/rpc/websocket/accountsubscribe`
- Standard WebSockets guide (pings, reconnection, subscriptions): `https://www.helius.dev/docs/rpc/websocket`

### Scope
- Start with Pump.fun; keep design generic so adding Raydium/Orca/Meteora/etc. is config-only.
- Use logsSubscribe for DEX program logs, and programSubscribe/accountSubscribe for Token Program mints (SPL and Token-2022).
- For candidate events, call HTTP getTransaction to obtain parsed instructions and enrich.

---

## Architecture and Components

### 1) WebSocketConnection (functional module)
- Single connection to Helius WS: `wss://mainnet.helius-rpc.com/?api-key=<API_KEY>`
- Responsibilities:
  - Open/close connection; exponential backoff reconnect.
  - Heartbeat: send ping every 50–60s to avoid the 10-min inactivity timer.
  - Track subscription ids and re-subscribe after reconnect.
  - Emit normalized events: `{ type: 'log' | 'program-account', payload, slot, context }`.

Inputs
- API key from `HELIUS_API_KEY`.

Outputs
- Event stream to downstream dispatcher.

Notes
- Commitment: `"confirmed"` for low latency; can switch to `"finalized"` if needed.
- Encoding: `"jsonParsed"` when available per docs.

### 2) SubscriptionRegistry (functional module)
- Declarative list of subscriptions to maintain, derived from config.
- Subscriptions:
  - logsSubscribe for DEX programs (e.g., Pump.fun):
    - Params example:
      ```json
      {"jsonrpc":"2.0","id":1,"method":"logsSubscribe","params":[{"mentions":["<PROGRAM_ID>"]},{"commitment":"confirmed"}]}
      ```
  - programSubscribe (aka accountSubscribe on program-owned accounts) for SPL Token programs to detect new mints:
    - Program: `Tokenkeg...` (SPL) and `TokenzQd...` (Token-2022)
    - Params example:
      ```json
      {"jsonrpc":"2.0","id":2,"method":"programSubscribe","params":["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",{"encoding":"jsonParsed","commitment":"confirmed"}]}
      ```
- Re-establish subscriptions on reconnect.

### 3) EventDispatcher (functional module)
- Accepts normalized WS events and applies program-specific filters:
  - For logsSubscribe events: identify candidate pool-creation or launch txs based on program id and (optionally) log patterns.
  - For programSubscribe events: distinguish Mint vs Token Account by data layout/size.
    - SPL token Mint account size: 82 bytes; token account: 165 bytes. Treat size < 165 as Mint.
- Emits `CandidateTx(signature, slot, programId, reason)` to the fetcher.

### 4) TransactionFetcher (functional module)
- For each `CandidateTx`, call HTTP `getTransaction(signature, { maxSupportedTransactionVersion: 0 | 1, commitment: "confirmed" })` against Helius RPC.
- Parse outer and inner instructions to extract:
  - Token mint address (from MintTo/InitializeMint*),
  - DEX pool identifiers (program-specific fields),
  - Creator authority and relevant accounts,
  - Timestamps, slot, log messages.
- Apply light rate limiting and retries (HTTP) to respect quotas.

### 5) Deduplication & Idempotency (functional module)
- Use in-memory LRU/TTL for recent signatures and mints (similar to existing webhook cache).
- Database unique keys on signature to ensure idempotent writes.

### 6) Persistence Adapter (functional module)
- Reuse Prisma via `DatabaseManager`.
- Store minimal event record for downstream analysis (aligns with existing `mintEvent` usage):
  - `txSignature`, `mint`, `timestamp`, `initProgram` (spl-token | token-2022 | unknown), `eventType` (e.g., `logs:pumpfun` or `program:spl-token`), `source` = `ws`, `rawJson` (optional payload and selected tx parts).

### 7) Integration with existing system
- Adapter publishes structured events to:
  - Existing hotlist/longlist enrichment flow (optional follow-up),
  - Alert bus if/when criteria met.
- Keep this stage OFF by default; first validate capture correctness and volume.

### 8) Configuration
- `.env`/config values:
  - `HELIUS_API_KEY`
  - `WS_ENABLED=true|false`
  - `WS_PING_INTERVAL_MS=55000`
  - `WS_LOGS_PROGRAMS=6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P` (comma-separated; start with Pump.fun)
  - `WS_MONITOR_SPL_TOKEN=true`
  - `WS_MONITOR_TOKEN_2022=true`
  - `WS_HTTP_GETTX_CONCURRENCY=2`

---

## Wiring Diagram (logical)

WebSocketConnection → SubscriptionRegistry → EventDispatcher → TransactionFetcher → Persistence → (optional) Alert/Hotlist

---

## Message Shapes (by the book)

### logsSubscribe (DEX program)
- Outgoing frame (example):
```json
{"jsonrpc":"2.0","id":1001,"method":"logsSubscribe","params":[{"mentions":["6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"]},{"commitment":"confirmed"}]}
```
- Incoming notifications contain `value.signature`, `value.err`, `value.logs`, `context.slot`.

Action
- Treat every notification as `CandidateTx` for the mentioned program; rely on getTransaction for precise classification (pool creation vs others).

### programSubscribe (SPL Token programs)
- Outgoing frame (example):
```json
{"jsonrpc":"2.0","id":1002,"method":"programSubscribe","params":["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",{"encoding":"jsonParsed","commitment":"confirmed"}]}
```
- Incoming `account` updates:
  - If `account.data.length < 165`, treat as Mint account (82 bytes expected for SPL).
  - Else ignore (token accounts and others).

Action
- On first-seen mint pubkey, enqueue a synthetic `CandidateTx` if signature is present in the notification; if not, keep the mint for correlation when a `logsSubscribe` event brings the related signature.

---

## Implementation Steps (minimal-change, incremental)

1) Add config parsing (no behavior yet)
- Read env vars under a new `ws` section.

2) Implement `ws/WebSocketConnection.ts` (functional)
- Connect, heartbeat pings, reconnection, and basic send/receive JSON-RPC.

3) Implement `ws/SubscriptionRegistry.ts`
- Build and send `logsSubscribe` for `WS_LOGS_PROGRAMS` and `programSubscribe` for Token programs based on config.
- Track subscription ids; re-subscribe on reconnect.

4) Implement `ws/EventDispatcher.ts`
- Normalize events; size-based Mint discrimination; emit `CandidateTx`.

5) Implement `ws/TransactionFetcher.ts`
- HTTP getTransaction with concurrency control and retries; parse mint/pool creation hints.

6) Persist via existing Prisma adapter
- Reuse/create write function that mirrors `mintEvent` shape used by webhooks with `source = 'ws'`.

7) Add lightweight metrics/logging
- Counts for received logs, candidate txs, successful getTransaction, stored events.

8) Rollout plan
- Start with Pump.fun only; monitor volume and correctness.
- Add more programs by config (Raydium, Orca, etc.).

---

## Operational Considerations

Connection health
- Ping every ~55s; auto-reconnect with jittered backoff; re-subscribe on reconnect. See Helius guidance on inactivity timer and health checks.

Backfill on reconnect
- Capture the last seen slot; on reconnect, optionally fetch a small window of recent signatures for the program id to mitigate gaps.

Noise vs. latency trade-off
- `confirmed` provides faster notifications; switch to `finalized` if duplicates or reorg sensitivity is an issue.

Rate limits
- Throttle getTransaction; batch when bursts occur.

Testing
- Unit: dispatcher size-checks (82 vs 165), logs-based candidate extraction.
- Integration: live WS in devnet/mainnet with a test API key; snapshot a few tx samples and assert parsing.

---

## Why this reduces noise
- Instead of a broad transaction feed with many unrelated UNKNOWN events, we:
  - Subscribe only to DEX program logs (logsSubscribe),
  - Optionally subscribe to the Token Program for new mint accounts (programSubscribe),
  - Fetch complete details only for these candidates.

This follows Helius’ recommended WebSocket usage patterns and commitment/encoding settings per docs.


