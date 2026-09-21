# TrustRail V1 build status

Last updated: 2026-09-21 (session 1, in progress)

Legend: `done` = implemented and covered by a passing test that was actually run. `partial` = implemented but missing a required test or edge case, or a UI/doc surface not yet built. `todo` = not started.

## Environment notes

- No Docker / Homebrew / system Postgres on the build machine. Using `embedded-postgres` (real Postgres 18 binaries, no Docker) for a genuine local/test database. See `docs/DECISIONS.md`.
- Docker Compose files are written as deliverables but `docker compose up --build` has not been executed on this machine — flagged, not silently claimed.
- `pnpm run verify`/`pnpm test` currently means "run each package's vitest suite"; a single root aggregation script is not yet wired (see Phase 6 gate).

## Requirement checklist (V01–V15)

| ID | Capability | Status | Notes |
|---|---|---|---|
| V01 | Organization accounts, sessions, memberships and roles | partial | Register/login/logout, org creation, memberships+roles, tenant isolation all implemented and covered by integration tests (`apps/api/test/gateway.integration.test.ts`). Missing: CSRF header enforcement is designed but not implemented in code yet; login rate limiting is wired via `@fastify/rate-limit` on `/v1/auth/*` but not test-covered. |
| V02 | Agent registry and revocable credentials | done | Create/list/update agents, rotate/revoke credentials (256-bit, digest-only storage), revoked-credential rejection — all integration-tested. |
| V03 | Human-to-agent and agent-to-agent delegation | done | Root grants (Owner/Admin only) and agent-issued child grants, subset/attenuation re-validated via `@trustrail/policy-engine`, ancestor revocation blocking descendants — unit- and integration-tested. |
| V04 | Versioned deterministic policies | partial | Draft/version/publish with optimistic-locked revision CAS implemented; not yet integration-tested (only exercised indirectly via the auto-seeded default policy on org creation). |
| V05 | Enforcement gateway | done | Agent credentials never reach merchant-sandbox; it only accepts writes with the gateway's shared secret, on 127.0.0.1 in local dev (no Docker network segmentation available on this machine — see Decisions). Integration-tested. |
| V06 | Human approval queue | done | Bound approval (request hash + policy hash + grant chain), atomic compare-and-set approve/reject, self-approval rejection, stale-policy invalidation. Integration-tested end to end including independent-reviewer approval. |
| V07 | Transactional shared budgets and idempotency | done | Multi-target atomic reservation (root + child + policy-level daily budget), deterministic lock ordering, real Postgres row locks. Idempotency scoped to org+actor+key with payload-hash conflict detection. Concurrency-tested (exactly 3/6 and merchant-sandbox's own 3/8 concurrent-overrefund tests). |
| V08 | Signed decision and execution receipts | done | Ed25519 JWS via `jose`, RFC 8785 canonicalization (hand-rolled, see Decisions), explicit alg/typ allowlist, kid-based key lookup, tamper/unknown-issuer/rotation all unit- and integration-tested. |
| V09 | Dashboard and action detail | todo | No frontend yet. API supports everything the dashboard needs (actions list/detail, approvals, receipts, metrics). |
| V10 | Deterministic demo lab | done | All 12 scenarios from spec section 14 implemented (`apps/api/src/demo/scenarios.ts`) calling the real gateway functions, verified passing twice from a clean `pnpm demo:reset` via `pnpm demo:run <scenario>`. `POST/GET /v1/demo/runs`, `POST /v1/demo/reset` (403 outside local/demo mode) wired. No Demo Lab UI yet (frontend in progress). |
| V11 | TypeScript and Python SDKs | todo | Not started. |
| V12 | MCP tool adapter | todo | Not started. |
| V13 | Developer docs and local setup | partial | `docs/PRODUCT_SPEC.md`, `DECISIONS.md`, this file exist. `pnpm setup:local`/`dev`/`migrate` scripts not yet written — migrations currently run via each app's own `pnpm --filter run migrate` after manual role bootstrap. README/API/SDK/MCP/OPERATIONS docs not yet written. |
| V14 | YC demo materials and landing page | todo | Not started. |
| V15 | Observability and deployment package | partial | Health checks (`/health/live`, `/health/ready`) exist for both services. Structured logging via pino. `/v1/metrics/summary` computes real aggregates (counts, execution success rate, measured authorization latency p50/p95/p99) from `usage_events` — not yet exposed anywhere but the API. No Dockerfiles/compose/CI yet. |

## Phase gates (spec §17)

| Phase | Gate | Status |
|---|---|---|
| 1. Foundation | Clean setup, login, org isolation, merchant idempotency tests pass | **met**. `pnpm setup:local` + `pnpm dev` run for real (verified manually with curl end to end: register, create org, agent, credential, grant, refund). 23 passing tests across apps/api and apps/merchant-sandbox. |
| 2. Real protected action | Allowed/denied/concurrent/ambiguous-outcome integration tests pass | **met**. Ambiguous-outcome (connector timeout -> `unknown` -> reconciled) is exercised by the `connector_timeout_reconciled` demo scenario (deterministic fault injection, `apps/api/src/demo/faultInjectingConnector.ts`) and passes; not yet additionally covered by a vitest integration test (the demo scenario run *is* the verification so far). |
| 3. Review and evidence | Reviewer completes EUR 350 workflow; altered receipt fails; replay cannot duplicate execution | **met** — all three covered by `gateway.integration.test.ts`. |
| 4. Product interface | Required browser flows work with real persistent data, including failure states | todo — no frontend exists yet. |
| 5. Developer adoption | Both SDKs + MCP adapter work without private knowledge | todo. |
| 6. YC presentation | Clean checkout passes documented verification; demo repeatable | todo. |

## Known simplifications (honest limitations, not to be silently papered over)

- **Order ownership**: the merchant sandbox connector always reports `ownedByPrincipal: true` for any order that exists — it doesn't model separate customer identities distinct from the demo principal. A real connector would resolve this from the merchant's own account records.
- **Network isolation**: without Docker on this machine, the merchant sandbox's "private network, no published port" guarantee is only enforced by binding to `127.0.0.1` plus the gateway-secret header check, not by actual network segmentation. `infra/docker-compose.yml` (once written) will restore true network isolation on a machine that has Docker, but that path is untested here.
- **apps/worker is a thin wrapper**, not an independent codebase: the actual polling/dispatch logic lives in `apps/api/src/worker/poller.ts` and is reused via a relative/subpath import rather than a shared package, to avoid a costly package split mid-build. Documented in `docs/DECISIONS.md`.
- **SSE (`GET /v1/events`)** is implemented as tenant-scoped short-interval polling of `audit_events` rather than a push-based pub/sub bus. Functionally a live stream to the client; documented as a scaling simplification.
- **Worker has no elevated DB role**: it iterates the global `organizations` table and opens one tenant-scoped transaction per org per poll tick to find due jobs. Fine at demo scale; noted as an O(orgs) scaling limit.
- **CSRF**: SameSite=Lax cookies + strict CORS origin are in place; the double-submit/custom-header CSRF check described in the design (`CSRF_HEADER_NAME` in `src/auth/session.ts`) is defined but not yet enforced in `server.ts`.

## Continuation checklist (if this session ends mid-build)

1. Read this file and `docs/DECISIONS.md` top to bottom.
2. From repo root: `pnpm install`.
3. Build in dependency order: `pnpm --filter='./packages/*' --filter='./apps/*' run build`.
4. There is no `pnpm setup:local` yet — to run tests, nothing further is needed (each integration test suite bootstraps its own ephemeral Postgres via `@trustrail/test-support`). To run the API for real manual/browser testing, a local Postgres + role bootstrap + signing key + `.env` still needs to be scripted (`scripts/setup-local.ts` referenced in `package.json` does not exist yet — writing it is the next task).
5. Run tests package by package: `pnpm --filter @trustrail/policy-engine test`, `@trustrail/receipt-verifier test`, `@trustrail/contracts test`, `@trustrail/merchant-sandbox test`, `@trustrail/api test`.
6. Check the requirement table above for the first `todo`/`partial` row and resume there. As of this update, the highest-priority next steps in spec order are: `scripts/setup-local.ts` + `pnpm dev` (finishes Phase 1's clean-checkout gate), then the Demo Lab (`POST /v1/demo/runs`, seed/run/reset scripts) and the frontend (Phase 4), then SDKs + MCP adapter (Phase 5), then Docker/CI/docs polish (Phase 6).

## Session log

- 2026-09-21: Session started. Repository scaffolding (Phase 1) and the full gateway core (Phase 2/3) built and integration-tested in one continuous session: contracts, policy-engine, receipt-verifier, merchant-sandbox, and apps/api's auth/grants/policies/actions/approvals/receipts routes. 39 unit tests + 23 integration tests passing across 5 packages, all against real ephemeral PostgreSQL instances (no mocks) and a real HTTP merchant-sandbox server.
