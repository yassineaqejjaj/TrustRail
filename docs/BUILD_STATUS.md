# TrustRail V1 build status

Last updated: 2026-09-21 (session 1)

Legend: `done` = implemented and covered by a passing test that was actually run. `partial` = implemented but missing a required test/edge case or polish. `todo` = not started.

## Environment notes

- No Docker / Homebrew / system Postgres on the build machine. Using `embedded-postgres` (real Postgres 18 binaries, no Docker) for both local dev (`pnpm setup:local`/`pnpm dev`, persistent) and every test suite (ephemeral, one instance per run). See `docs/DECISIONS.md`.
- Docker Compose files are **not yet written** — `docker compose up --build` cannot be exercised on this machine regardless (no Docker here). Tracked in `docs/ROADMAP.md`.
- `pnpm verify` (build+typecheck+lint+test across every package, plus Python) is wired (`scripts/verify.ts`) and passes end to end — see `docs/TEST_REPORT.md`.

## Requirement checklist (V01–V15)

| ID | Capability | Status | Notes |
|---|---|---|---|
| V01 | Organization accounts, sessions, memberships and roles | done | Register/login/logout, org creation (auto-seeds default policy), memberships+roles, tenant isolation (RLS + integration tests). CSRF: SameSite=Lax + strict CORS in place; the custom-header double-submit check is designed (`CSRF_HEADER_NAME`) but not enforced in `server.ts` — see limitations below. |
| V02 | Agent registry and revocable credentials | done | Create/list/update agents, rotate/revoke credentials (256-bit, digest-only storage), revoked-credential rejection — integration-tested, and exercised live through the dashboard (reveal-once UI). |
| V03 | Human-to-agent and agent-to-agent delegation | done | Root grants (Owner/Admin) and agent-issued child grants, subset/attenuation re-validated via `@trustrail/policy-engine`, ancestor revocation blocking descendants — unit-, integration-, and demo-scenario-tested. Dashboard: Delegations page (tree + table). |
| V04 | Versioned deterministic policies | done | Draft/version/publish with optimistic-locked revision CAS. Exercised by org auto-seed, the dashboard's Policies page (form/JSON tabs, simulate panel), and manual live testing. Not yet covered by a dedicated vitest integration test for the publish-conflict path specifically (only unit-level + manual). |
| V05 | Enforcement gateway | done | Agent credentials never reach merchant-sandbox; it only accepts writes with the gateway's shared secret. Network isolation is header-based, not network-segmented, on this Docker-less machine (see limitations). Integration- and demo-scenario-tested (`direct_merchant_write_rejected`). |
| V06 | Human approval queue | done | Bound approval (request hash + policy hash + grant chain), atomic compare-and-set approve/reject, self-approval rejection, stale-policy invalidation. Integration-, demo-scenario-, and live-browser-tested (independent reviewer approves a real EUR 350 request, verified in the Approvals page). |
| V07 | Transactional shared budgets and idempotency | done | Multi-target atomic reservation (root + child + policy-level daily budget), deterministic lock ordering, real Postgres row locks. Idempotency scoped to org+actor+key with payload-hash conflict detection. Concurrency-tested at three layers: merchant-sandbox's own row lock (3/8), TrustRail's grant budget (3/6), and the `concurrent_budget_limit` demo scenario. |
| V08 | Signed decision and execution receipts | done | Ed25519 JWS, RFC 8785 canonicalization (hand-rolled, see Decisions), explicit alg/typ allowlist, kid-based key lookup. Tamper/unknown-issuer/rotation/revoked-key all unit-, integration-, demo-scenario-, and live-browser-tested (pasted a tampered JWS into the Receipts page and confirmed `signature_valid: false`). Cross-language agreement proven: a receipt signed by the TS signer verifies correctly in the Python SDK (`sdk/python/tests/test_cross_language_receipt.py`). |
| V09 | Dashboard and action detail | done | All 13 pages from spec section 13 built (`apps/web`, Next.js/Tailwind), calling the real API, verified by production build/lint/typecheck, live manual click-through, and a real Playwright suite (`tests/e2e`, 4 specs / 5 flows, all passing against a real backend). Two minor gaps found live: `agents.last_activity_at` never updates after an action executes; no `GET /v1/receipts` list endpoint (Receipts page derives its list from recent actions' embedded receipt refs). |
| V10 | Deterministic demo lab | done | All 12 scenarios from spec section 14 (`apps/api/src/demo/scenarios.ts`), verified passing via CLI (`pnpm demo:run`) from a clean `pnpm demo:reset`, and live through the dashboard's Demo Lab page ("Run scenario" button hits the real endpoint and updates Overview/Approvals/Receipts in real time). |
| V11 | TypeScript and Python SDKs | done | Both expose `actions.execute/get/wait`, `grants.delegate`, `receipts.get/verify` against the same live API. TypeScript: 6 unit tests (mocked fetch) covering idempotency-key retry semantics. Python: 9 tests — 3 canonicalization, 3 cross-language receipt verification, 3 against a real spawned live API instance (not mocked). |
| V12 | MCP tool adapter | done | `get_order`, `request_refund`, `get_action_status` over stdio, built on `@modelcontextprotocol/sdk`. Verified with a **real MCP client** driving the actual built binary as a subprocess against a real running stack (5/5 tests): tool listing, real order lookup, real EUR 80 refund, EUR 700 denial, cross-checked action status. |
| V13 | Developer docs and local setup | done | README, ARCHITECTURE, THREAT_MODEL, API, SDK_QUICKSTART, MCP_SETUP, OPERATIONS, TEST_REPORT, DEMO_SCRIPT, YC_PRODUCT_BRIEF, ROADMAP, DECISIONS all written from what was actually built. `pnpm setup:local`/`dev`/`demo:seed`/`demo:run`/`demo:reset`/`verify`/`benchmark` all implemented and run for real (see `docs/TEST_REPORT.md`). No generated OpenAPI file yet — `docs/API.md` is hand-maintained. |
| V14 | YC demo materials and landing page | partial | `docs/DEMO_SCRIPT.md` and `docs/YC_PRODUCT_BRIEF.md` written. Landing page built and verified live (no fake logos/testimonials, honest sandbox disclaimer). Materials not yet rehearsed as an actual timed recording. |
| V15 | Observability and deployment package | partial | Health checks, structured logging (pino), and `/v1/metrics/summary` (real measured aggregates, including authorization latency p50/p95/p99) all implemented and shown in the dashboard's Overview page. `docs/OPERATIONS.md` written (runbook, key rotation, restore guidance). Dockerfiles (`apps/api`, `apps/merchant-sandbox`, `apps/web`), `infra/docker-compose.yml`, and `.github/workflows/ci.yml` are now written — reviewed for architectural correctness (no published merchant-sandbox port, one-shot migrate service gating `api`'s startup, shared signing-key volume) but **not executed**, since this machine has no Docker/CI runner access. Treat them as a reviewed starting point to debug on first real use, not a finished artifact. |

## Phase gates (spec §17)

| Phase | Gate | Status |
|---|---|---|
| 1. Foundation | Clean setup, login, org isolation, merchant idempotency tests pass | **met**. `pnpm setup:local` run twice (idempotent), `pnpm dev` started all three services for real, exercised live via curl and via the browser. |
| 2. Real protected action | Allowed/denied/concurrent/ambiguous-outcome integration tests pass | **met**. Ambiguous-outcome (`unknown` -> reconciled) covered by `connector_timeout_reconciled`, verified twice via `pnpm demo:run`. |
| 3. Review and evidence | Reviewer completes EUR 350 workflow; altered receipt fails; replay cannot duplicate execution | **met** — covered by `gateway.integration.test.ts`, the demo scenario suite, and live browser verification (see V06/V08 above). |
| 4. Product interface | Required browser flows work with real persistent data, including failure states | **met**. All 13 pages built, production build/lint/typecheck clean, a real manual click-through session, and a real automated Playwright suite (`tests/e2e`, spec section 16's exact five flows: onboarding, first refund, denial explanation, independent reviewer approval, receipt verification) -- 4/4 specs passing, each against a freshly-provisioned real backend (own ephemeral Postgres, own merchant sandbox, own `next dev` instance). |
| 5. Developer adoption | Both SDKs + MCP adapter work without private knowledge | **met**. Both SDKs and the MCP adapter tested against a real running API (not mocks for the integration-level checks); `docs/SDK_QUICKSTART.md` and `docs/MCP_SETUP.md` document the exact steps. |
| 6. YC presentation | Clean checkout passes documented verification; demo repeatable | **substantially met**. `pnpm verify` passes; `pnpm demo:run` is repeatable (verified twice from clean state); demo script and product brief written. Not yet done: an actual timed dry run of the 90-second script, Docker/CI. |

## Known simplifications (honest limitations, not to be silently papered over)

- **Order ownership**: the merchant sandbox connector always reports `ownedByPrincipal: true` for any order that exists — it doesn't model separate customer identities distinct from the demo principal.
- **Network isolation**: without Docker, the merchant sandbox's "private network" guarantee is enforced by binding to `127.0.0.1` plus the gateway-secret header check, not by actual network segmentation. `infra/docker-compose.yml` would restore true isolation but does not exist yet.
- **apps/worker is a thin wrapper**: the actual polling/dispatch logic lives in `apps/api/src/worker/poller.ts`, imported via a relative path rather than a shared package. Documented in `docs/DECISIONS.md`.
- **SSE (`GET /v1/events`)** is tenant-scoped short-interval polling of `audit_events`, not a push-based bus.
- **Worker has no elevated DB role**: it iterates the global `organizations` table and opens one tenant-scoped transaction per org per poll tick. Fine at demo scale; an O(orgs) scaling limit.
- **CSRF**: SameSite=Lax + strict CORS in place; the custom-header double-submit check is designed but not enforced yet.
- **Dockerfiles/docker-compose/CI are written but unexecuted** — this machine has no Docker or CI runner access, so none of `apps/*/Dockerfile`, `infra/docker-compose.yml`, or `.github/workflows/ci.yml` have actually been run. They were written carefully (multi-stage builds, a one-shot migration service, no published port for merchant-sandbox) and reviewed, but the first real run on a machine with Docker should be treated as a debugging session, not a formality.
- **Two minor frontend/backend seams found during integration** (not blocking): `agents.last_activity_at` never updates after an action executes; no `GET /v1/receipts` list endpoint.

## Continuation checklist (if a future session resumes this build)

1. Read this file and `docs/DECISIONS.md` top to bottom, then `docs/TEST_REPORT.md` for exact last-known-good test results.
2. `pnpm install`, then `pnpm --filter='./packages/*' --filter='./apps/*' run build`.
3. `pnpm setup:local && pnpm dev` to run the full stack locally; `pnpm demo:seed` then `pnpm demo:run <scenario>` to exercise it.
4. `pnpm verify` should pass in full (96+ tests across 8 packages as of this writing) before making changes, to confirm the baseline still holds.
5. Highest-leverage remaining work, in order: (a) Dockerfiles + `docker-compose.yml`, actually run once Docker is available; (b) a CI workflow (GitHub Actions) running `pnpm verify`; (c) a Playwright suite for `apps/web`'s flows; (d) the two minor gaps listed above; (e) the rest of `docs/ROADMAP.md`'s engineering follow-ups.

## Session log

- 2026-09-21: Full session. Built and integration-tested, in order: repo scaffolding + contracts/policy-engine/receipt-verifier (Phase 1); merchant-sandbox with real concurrency-safe refunds; apps/api's complete gateway (auth, grants, policies, actions, approvals, receipts, RLS-based tenant isolation) with 25 passing integration tests (Phase 2/3); `pnpm setup:local`/`pnpm dev` scripts, verified live via curl; the full 12-scenario deterministic demo lab, verified twice from clean state (Phase 3/6); the TypeScript SDK, a read-only order-lookup route it needed, the MCP adapter (verified with a real MCP client), and the Python SDK (verified against a real live API and cross-language against the TS signer) (Phase 5); the complete documentation set and `pnpm verify`/`pnpm benchmark` scripts; the Next.js dashboard (built in a parallel isolated agent session, merged, then verified live in-browser end to end, fixing a stale/broken demo-scenario-id mismatch and an HTML-entity-in-JS-string rendering bug found during that verification) (Phase 4). 96+ automated tests passing across 8 packages, plus live manual verification of every major user-facing flow.
