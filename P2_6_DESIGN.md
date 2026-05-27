# P2.6 Design Scan - HTTP/SSE Serve Mode

Last updated: 2026-05-27

## Executive Summary
P2.6 adds `deepcode serve --http`: a localhost HTTP API for driving Deep Code.
Planned endpoints:
- `POST /sessions`
- `POST /sessions/:id/turns`
- `GET /sessions/:id`
- `GET /sessions/:id/turns/:turn_id`
- `DELETE /sessions/:id`
Required security model:
- Bearer token auth from `DEEPCODE_HTTP_TOKEN`
- default bind `127.0.0.1:8765`
- no remote exposure by default
- no token logging
Required streaming model:
- Server-Sent Events for turn output
- event payloads preserve internal stream/event structure
- text deltas, tool calls, tool results, status, and final result remain structured
Scan result:
- useful CLI, query, SDK stream, auth, and transcript primitives exist
- no `src/cli/serve/` implementation exists
- no server-side SSE writer exists
- a feature-gated direct-connect `server` command exists but is stale/incomplete
- recommended path is Path C, phased delivery
Framework recommendation:
- use Node built-in `node:http`
- do not add Express, Hono, Fastify, or another HTTP dependency
Why phased:
- HTTP, auth, sessions, turn execution, cancellation, and SSE backpressure are separate risk areas
- smaller PRs match P2.4 and P2.5 delivery style
- auth and localhost guarantees should land before turn execution

## Plan Anchors
Primary source:
- `PURE_DEEPSEEK_PLAN.md` lines 1037-1068
Plan requirements:
- `deepcode serve --http`
- `src/cli/serve/http.ts`
- `src/cli/serve/index.ts`
- `--acp` stub
- Bearer token from `DEEPCODE_HTTP_TOKEN`
- bind `127.0.0.1:8765` by default
- five HTTP endpoints
- SSE event shape same as internal event bus
- tests for server start, SSE turn, auth 401, and cancel mid-stream
Roadmap source:
- `P2_ROADMAP.md` marks P2.6 risk as medium
- mitigation: localhost bind, bearer token, integration tests
Phase context:
- P2.1-P2.5 are done
- Phase 2 progress is 5/9 features
- P2.4 rollback gives safety for HTTP-triggered edits
- P2.5 diagnostics gives post-edit correctness feedback
- baseline suite is 69/69
This scan PR:
- docs-only
- one file only
- no source, test, or dist mutation

## Phase A - Existing Infrastructure Inventory

### A1. CLI Entrypoint Structure
Audited files:
- `packages/deep-code/src/entrypoints/cli.tsx`
- `packages/deep-code/src/main.tsx`
- `packages/deep-code/src/cli/*`
- `packages/deep-code/src/deepcode/cli-args.mjs`
- `packages/deep-code/src/server/*`
Current startup:
- `src/entrypoints/cli.tsx` is the bootstrap entrypoint
- it handles fast paths before loading the full CLI
- `src/main.tsx` owns the Commander program
- `program.parseAsync(process.argv)` dispatches commands
Current parser:
- Commander via `@commander-js/extra-typings`
- command registration is centralized in `main.tsx`
- print mode has an early path that skips most subcommand registration
Existing relevant commands:
- `mcp serve`
- `doctor`
- `agents`
- `plugin`
- `update`
- `ssh`
- `open`
Missing:
- no top-level `serve`
- no `serve --http`
- no `serve --acp`
- no `packages/deep-code/src/cli/serve/`
Existing `mcp serve`:
- starts the Deep Code MCP server
- should remain separate from P2.6
- is not the HTTP agent API
Feature-gated direct-connect finding:
- `main.tsx` has a `server` command behind `feature('DIRECT_CONNECT')`
- it defaults `--host` to `0.0.0.0`
- it imports server files that do not exist in current source
- current `src/server/` only has direct-connect client/manager/type files
Missing imported files from that gated command:
- `./server/server.js`
- `./server/sessionManager.js`
- `./server/backends/dangerousBackend.js`
- `./server/serverBanner.js`
- `./server/serverLog.js`
- `./server/lockfile.js`
Current `src/server/` files:
- `createDirectConnectSession.ts`
- `directConnectManager.ts`
- `types.ts`
Recommendation:
- do not reuse stale direct-connect server code as P2.6 implementation
- reuse lessons only: session route precedent, Bearer header precedent, response types
- create `src/cli/serve/` for P2.6
- register top-level `serve` in `main.tsx`
- keep default bind at `127.0.0.1`
Suggested CLI shape: `deepcode serve --http [--host 127.0.0.1] [--port 8765]` and `deepcode serve --acp`.
Wrapper note:
- `src/deepcode/cli-args.mjs` maps some flags to env vars
- it does not know `serve`, `--http`, or `--acp`
- P2.6.a should audit whether the wrapper needs a narrow update

### A2. Event Bus and Streaming Infrastructure
Audited files:
- `packages/deep-code/src/services/runtime/messageSend.ts`
- `packages/deep-code/src/query.ts`
- `packages/deep-code/src/cli/print.ts`
- `packages/deep-code/src/cli/structuredIO.ts`
- `packages/deep-code/src/cli/transports/SSETransport.ts`
- `packages/deep-code/src/utils/sessionState.ts`
- `packages/deep-code/src/entrypoints/sdk/coreSchemas.ts`
Runtime stream events already exist.
`services/runtime/messageSend.ts` exports `RuntimeStreamEvent`.
Runtime event variants:
- `message_start`
- `content_block_start`
- `content_block_delta`
- `content_block_stop`
- `tool_use_delta`
- `message_delta`
- `message_stop`
Full agent loop:
- `query.ts` owns the main multi-turn query loop
- it yields stream events, request-start events, messages, tombstones, and summaries
- it passes abort signals into model and tool execution paths
Headless execution:
- `cli/print.ts` calls `runHeadlessStreaming`
- it writes SDK messages through `StructuredIO`
- stream-json verbose mode already produces structured output
- this is a useful precedent, not something the HTTP server should shell out to
SDK stream schemas include:
- `stream_event`
- `result`
- `system/status`
- `system/session_state_changed`
- `system/task_started`
- `system/task_progress`
- `system/task_notification`
- `system/post_turn_summary`
- `tool_progress`
Session state events:
- `idle`
- `running`
- `requires_action`
Existing SSE code:
- `cli/transports/SSETransport.ts` is a client-side SSE transport
- it has an incremental SSE parser
- it handles keepalive comments, reconnect state, and permanent HTTP statuses
- it is not a server-side SSE writer
Missing for P2.6:
- server-side SSE encoder
- keepalive writer
- backpressure helper
- disconnect-to-abort wiring
- HTTP event metadata wrapper
Recommended SSE payload:
- preserve the internal event object in JSON `data`
- add `session_id`
- add `turn_id`
- add `sequence`
- add timestamp
- do not flatten to text-only deltas
Example payload: `{ session_id, turn_id, sequence, type: "stream_event", event }`.

### A3. Session Lifecycle Hooks
Audited files:
- `packages/deep-code/src/utils/sessionStorage.ts`
- `packages/deep-code/src/utils/sessionStoragePortable.ts`
- `packages/deep-code/src/bootstrap/state.ts`
- `packages/deep-code/src/query.ts`
- `packages/deep-code/src/cli/print.ts`
- `packages/deep-code/src/server/types.ts`
Existing persistent session storage:
- transcript-oriented JSONL storage
- project directory resolution
- session file lookup
- resume/read helpers
- transcript append/flush helpers
Useful functions:
- `getTranscriptPath()`
- `getTranscriptPathForSession(sessionId)`
- `sessionIdExists(sessionId)`
- `recordTranscript(...)`
- `flushSessionStorage()`
- `validateUuid(...)`
- `resolveSessionFilePath(...)`
- `readTranscriptForLoad(...)`
Important distinction:
- transcript storage is not a live HTTP session registry
- HTTP sessions need active turn state, abort controllers, stream clients, and counters
- do not hide live server state in transcript helpers
Session ID generation:
- `crypto.randomUUID()` appears in direct-connect code
- `randomUUID()` appears in print/SDK paths
- UUID validation helpers already exist
Recommendation:
- HTTP session IDs: UUIDs
- HTTP turn IDs: monotonic integers per session
- internal transcript UUIDs: preserve current behavior
Abort/cancel support:
- query path uses `toolUseContext.abortController.signal`
- runtime path accepts `AbortSignal`
- print mode aborts on SIGINT
- P2.6 cancellation should reuse this
`DELETE /sessions/:id` should:
- mark session closing
- abort in-flight turn
- close SSE clients
- flush transcript storage where possible
- remove live registry entry
Concurrency scan:
- codebase has multiple historical transcript sessions
- foreground app state has process-global pieces
- permission mode, session state, and some env paths are global
- true concurrent active turns may need additional isolation
P2.6 recommendation:
- allow many created HTTP sessions
- allow one active turn per session
- reject same-session concurrent turns with `409`
- audit cross-session active-turn safety during P2.6.c

### A4. Auth and API Key Patterns
Audited files:
- `packages/deep-code/src/utils/envUtils.ts`
- `packages/deep-code/src/utils/sessionIngressAuth.ts`
- `packages/deep-code/src/server/createDirectConnectSession.ts`
- `packages/deep-code/src/server/directConnectManager.ts`
- `packages/deep-code/src/services/providers/deepseek.mjs`
Environment helpers:
- `getDeepCodeEnv(name)` reads `DEEPCODE_${name}` then `CLAUDE_CODE_${name}`
- P2.6 plan explicitly names `DEEPCODE_HTTP_TOKEN`
Bearer precedents:
- `createDirectConnectSession.ts` sends `authorization: Bearer <token>`
- `directConnectManager.ts` sends `authorization: Bearer <token>`
- provider code sends API keys as Bearer tokens
- `sessionIngressAuth.ts` builds Bearer headers for ingress JWTs
Server-side auth middleware does not exist.
P2.6 must add it.
Token validation requirements:
- missing configured token: protected routes return `401`
- missing request header: `401`
- wrong token: `401`
- token never appears in logs or response bodies
- comparison uses `crypto.timingSafeEqual`
Recommended helpers:
- `getHttpToken(env)`
- `readBearerToken(req)`
- `isAuthorizedRequest(req, expectedToken)`
Startup behavior recommendation:
- allow server to start without token for tests
- warn on stderr if no token is configured
- never accept unauthenticated protected requests

### A5. HTTP Server Framework Choice
Audited:
- `packages/deep-code/package.json`
- source HTTP references
Dependency state:
- `packages/deep-code/package.json` has no normal dependencies
- only optional sharp binaries are listed
- no Express/Hono/Fastify precedent exists
Available Node primitives:
- `node:http`
- `URL`
- global `fetch`
- `AbortController`
- `crypto.randomUUID`
- `crypto.timingSafeEqual`
Recommendation:
- use Node built-in `node:http`
- use small route helpers
- use explicit JSON body parser with size cap
- use explicit response helpers
- do not add an HTTP framework
Rationale:
- five endpoints
- easier security audit
- smaller bundle impact
- simpler CI and install surface
- enough for localhost API

### A6. Test Infrastructure
Audited files:
- `.github/workflows/ci.yml`
- `packages/deep-code/test/*.test.mjs`
- `packages/deep-code/src/cli/transports/SSETransport.ts`
Current CI:
- runs `node --test` for package tests
- includes P2.4 and P2.5 phase tests
- TUI harness remains separate and non-blocking
Recommended new test file:
- `packages/deep-code/test/p2-6-serve.test.mjs`
Test runner:
- `node:test`
- not `bun:test`
Test approach:
- bind test server to `127.0.0.1` and port `0`
- use global `fetch`
- inject fake session and fake turn runner where possible
- no real model calls
- no external network
Initial test matrix: start/close, localhost default, auth 401 cases, route 404/405, bad JSON 400, session create/read/delete, SSE content type and ordering, same-session 409, and cancel mid-stream.

## Phase B - Path Options

### Path A - Minimal: `serve --http` Only
Scope: five endpoints, Bearer auth, and SSE turn stream, without `--acp`.
Pros: fastest implementation and smallest product surface.
Cons: mixes auth, sessions, routes, SSE, and cancellation in one PR; misses the ACP stub.
Verdict: not recommended.

### Path B - Full Per Plan
Scope: `serve --http`, `--acp` stub, all endpoints, auth, session registry, turn runner, SSE, cancellation, and integration tests.
Pros: complete feature in one source phase.
Cons: too many concerns in one diff, high review risk, and easy file-count pressure.
Verdict: not recommended.

### Path C - Phased
Scope: scaffold/auth, session CRUD, turn SSE, ACP stub, optional integration hardening, dist refresh, and cite PR.
Pros: security lands first, CRUD and streaming are separate, cancellation gets focused tests, and the split matches P2.4/P2.5.
Cons: more PRs and temporary partial API during the phase.
Verdict: recommended.

## Phase C - Recommended Path and Rationale
Recommended path: Path C.
Reasons:
- HTTP API can drive agent turns and tool execution
- security controls should be reviewed before execution logic
- session lifecycle should be explicit before SSE streaming
- cancellation and backpressure deserve focused tests
- `--acp` should stay a stub, not expand P2.6 scope
HTTP framework decision:
- choose Node built-in `node:http`
- no new dependency
Session storage decision:
- live session registry in memory
- transcript storage remains persistence
Concurrency decision:
- same session active turn conflict returns `409`
- cross-session active turn safety is audited in P2.6.c
SSE format decision:
- structured JSON data
- internal event shape preserved
- HTTP metadata wrapper added

## Phase D - Sub-PR Breakdown for Path C

### P2.6.scan - This PR
Scope:
- create `P2_6_DESIGN.md`
- inventory CLI, server, stream, session, auth, and test surfaces
- recommend Path C
- record risks and decisions
Files:
- `P2_6_DESIGN.md`
Verification:
- `bun test`
- changed files exactly 1

### P2.6.a - Serve CLI Scaffold and Auth Middleware
Goal:
- add top-level `serve` command
- add `--http`
- add server bootstrap
- add auth middleware
- default to `127.0.0.1:8765`
Likely files:
- `packages/deep-code/src/main.tsx`
- `packages/deep-code/src/cli/serve/index.ts`
- `packages/deep-code/src/cli/serve/http.ts`
- `packages/deep-code/src/cli/serve/auth.ts`
- `packages/deep-code/test/p2-6-serve.test.mjs`
- `.github/workflows/ci.yml`
Tests: missing/wrong/correct auth, no token echo, localhost default, and clean close.
Out of scope: real sessions, real turns, SSE streaming, ACP, and dist.

### P2.6.b - Sessions CRUD Endpoints
Goal:
- add live session registry
- implement session CRUD routes
Endpoints:
- `POST /sessions`
- `GET /sessions/:id`
- `DELETE /sessions/:id`
Likely files: `cli/serve/sessions.ts`, `cli/serve/http.ts`, and `test/p2-6-serve.test.mjs`.
Session fields: `id`, `cwd`, `created_at`, `updated_at`, `state`, `turn_count`, `active_turn_id`.
Tests: create/get/delete session, deleted session `404`, bad JSON `400`, and auth wrapping.
Out of scope: turn execution, SSE, and ACP.

### P2.6.c - Turn SSE Streaming
Goal:
- implement turn submission
- stream turn events over SSE
- support cancellation
Endpoints:
- `POST /sessions/:id/turns`
- `GET /sessions/:id/turns/:turn_id`
Likely files: `cli/serve/turns.ts`, `sse.ts`, `turnRunner.ts`, `sessions.ts`, and the P2.6 test.
SSE requirements: immediate headers, `text/event-stream`, keepalives, sequence numbers, final result/error, disconnect handling, and backpressure.
Cancellation: store active turn abort controller, have DELETE abort it, test with fake runner, and return `409` for same-session concurrency.
Out of scope: browser UI, remote bind, ACP implementation, and persistent replay after restart.

### P2.6.d - `--acp` Stub
Goal:
- accept future protocol flag
- do not implement ACP
Likely files: `main.tsx`, `cli/serve/index.ts`, and the P2.6 test.
Behavior: accept `deepcode serve --acp`, print not implemented, exit with documented status, and do not start HTTP.
Out of scope: ACP protocol, schema negotiation, and remote agent registry.

### P2.6.test - Optional Integration Hardening
Use only if needed after P2.6.c.
Possible scope: route matrix, multiline SSE data, keepalive, graceful shutdown, slow-client backpressure, and signal smoke.
No new product behavior.

### P2.6.Z - Dist Refresh
Scope:
- rebuild `dist/deepcode-full.mjs`
- dist-only diff
Verification: `bun run build:full-cli`, second-build SHA-256 match, and `bun test`.

### P2.6.cite - Close P2.6
Scope: update `EXECUTION_LOG.md`, cite P2.6 PRs, mark P2.6 done, and advance to P2.7 session fork.
Estimated after scan:
- 5-7 PRs
- 15-25 source/test file touches total

## Phase E - Risk Assessment

### Localhost Bind Only
Risk:
- binding to `0.0.0.0` exposes agent control outside the machine
Mitigation:
- default `127.0.0.1`
- tests assert default host
- warn or defer any `--host` override
- do not copy stale direct-connect `0.0.0.0` default

### Bearer Token Security
Risk:
- token leak or accidental unauthenticated access
Mitigation:
- token from `DEEPCODE_HTTP_TOKEN`
- generic `401`
- timing-safe comparison
- no token in logs
- no token in response bodies

### Session Isolation
Risk:
- process-global state leaks across sessions
Mitigation:
- explicit in-memory registry
- per-session active-turn state
- avoid env mutation in handlers
- reject same-session concurrent turns
- document cross-session limits if found

### SSE Backpressure
Risk:
- slow clients fill buffers
- writes continue after disconnect
Mitigation:
- check `res.write()` return
- wait for `drain`
- listen for `req.close`
- keepalive interval
- abort or detach by explicit policy

### Cancel Mid-Stream
Risk:
- DELETE fails to stop in-flight work
Mitigation:
- store abort controller per active turn
- connect DELETE to `abort()`
- emit controlled final event
- test with fake runner

### HTTP Server Lifecycle
Risk:
- server keeps sockets or turns alive on shutdown
Mitigation:
- `startHttpServeMode()` returns close handle
- CLI layer owns SIGINT/SIGTERM
- route layer stays side-effect free
- tests close server deterministically

### Concurrent Turn Submission
Risk:
- overlapping turns corrupt session order
Mitigation:
- same-session `409 Conflict`
- no silent queue in P2.6
- no same-session parallel execution

### Permission Flow Over HTTP
Risk:
- destructive tool prompts cannot use TUI confirmation
Mitigation:
- preserve existing permission defaults
- stream `requires_action` events
- do not auto-approve
- defer extra permission response endpoint unless required

## Phase F - Key Decisions
Q1. Path A/B/C?
- choose Path C
- security, CRUD, streaming, and ACP are separate PRs
Q2. HTTP framework?
- use Node built-in `node:http`
- no new dependency
Q3. Session storage?
- live sessions in memory
- transcript storage remains persistence
Q4. `--acp` stub?
- CLI flag stub only
- no real ACP protocol in P2.6
Q5. Default bind?
- `127.0.0.1:8765`
- localhost-only by default
Q6. Token validation?
- `crypto.timingSafeEqual`
- generic `401`
- never log or echo tokens
Q7. Concurrent turns?
- same session returns `409`
- no queueing in initial implementation
Q8. SSE event format?
- structured JSON data
- preserve internal/SDK event shape
- add HTTP metadata wrapper

## Phase G - Reference Appendix

### CLI References
Primary files:
- `src/entrypoints/cli.tsx`
- `src/main.tsx`
- `src/deepcode/cli-args.mjs`
Missing target files:
- `src/cli/serve/index.ts`
- `src/cli/serve/http.ts`
- `src/cli/serve/auth.ts`
- `src/cli/serve/sessions.ts`
- `src/cli/serve/sse.ts`
- `src/cli/serve/turnRunner.ts`

### Server References
Existing direct-connect files:
- `src/server/createDirectConnectSession.ts`
- `src/server/directConnectManager.ts`
- `src/server/types.ts`
Reusable ideas:
- Bearer header shape
- session response schema idea
- explicit server config type
Do not reuse:
- stale gated server imports
- `0.0.0.0` default
- WebSocket-only direct-connect assumptions

### Event References
Runtime events:
- `message_start`
- `content_block_start`
- `content_block_delta`
- `content_block_stop`
- `tool_use_delta`
- `message_delta`
- `message_stop`
SDK stream messages:
- `stream_event`
- `result`
- `system/status`
- `system/session_state_changed`
- `system/task_started`
- `system/task_progress`
- `system/task_notification`
- `system/post_turn_summary`
- `tool_progress`

### Session References
Transcript functions:
- `getTranscriptPath()`
- `getTranscriptPathForSession(sessionId)`
- `sessionIdExists(sessionId)`
- `recordTranscript(...)`
- `flushSessionStorage()`
- `validateUuid(...)`
- `resolveSessionFilePath(...)`
- `readTranscriptForLoad(...)`
New live registry needs:
- session map
- turn map
- active abort controller
- active SSE clients
- turn counter

### SSE References
Existing:
- `cli/transports/SSETransport.ts`
- `parseSSEFrames(buffer)`
Needed:
- `encodeSseEvent(...)`
- keepalive writer
- disconnect handler
- backpressure helper

### Auth References
Existing:
- `getDeepCodeEnv(name)`
- direct-connect Bearer headers
- provider Bearer headers
- session ingress auth helper
Needed:
- `DEEPCODE_HTTP_TOKEN`
- route auth middleware
- timing-safe comparison

### Test References
Existing:
- `node --test` CI workflow
- P2.4/P2.5 phase tests
- local mock-heavy test style
Needed:
- `test/p2-6-serve.test.mjs`
- localhost fetch integration
- fake turn runner
- SSE parser assertions
- auth matrix

## Final Recommendation
Choose Path C.
Use Node built-in `node:http`.
Implement in this order:
- scaffold and auth
- sessions CRUD
- turn SSE streaming and cancellation
- `--acp` stub
- optional hardening
- dist refresh
- cite PR
Keep default bind on `127.0.0.1`.
Use `DEEPCODE_HTTP_TOKEN`.
Use timing-safe token comparison.
Preserve internal event structure in SSE data.
Reject same-session concurrent turns with `409`.
Keep this scan docs-only.
