# TrustRail V1 build status

Last updated: 2026-09-21 (session 4)

Legend: `done` = implemented and covered by a passing test that was actually run. `partial` = implemented but missing a required test/edge case or polish. `todo` = not started.

## Environment notes

- No Homebrew / system Postgres on the build machine. Using `embedded-postgres` (real Postgres 18 binaries, no Docker needed) for both local dev (`pnpm setup:local`/`pnpm dev`, persistent) and every test suite (ephemeral, one instance per run). See `docs/DECISIONS.md`.
- Docker Desktop became available partway through the build (2026-09-21, session 3). `docker compose -f infra/docker-compose.yml up --build` has now actually been run end-to-end — see V15 above and `docs/DECISIONS.md` for the three real bugs it surfaced and fixed. The repository was then pushed to `yassineaqejjaj/trustrail` on GitHub (private), giving `.github/workflows/ci.yml` a real Actions run too — see the session 4 log entry below.
- `pnpm verify` (build+typecheck+lint+test across every package, plus Python) is wired (`scripts/verify.ts`) and passes end to end — see `docs/TEST_REPORT.md`.

## Requirement checklist (V01–V15)

| ID | Capability | Status | Notes |
|---|---|---|---|
| V01 | Organization accounts, sessions, memberships and roles | done | Register/login/logout, org creation (auto-seeds default policy), memberships+roles, tenant isolation (RLS + integration tests). CSRF: a double-submit-style header check (`X-TrustRail-CSRF`) is now enforced server-side for every cookie-authenticated mutating request, skipped for bearer(agent)-authenticated ones even when a stray session cookie is also attached. Verified by two dedicated tests (missing header rejected with 403, bearer auth unaffected) plus incidentally by every other cookie-based integration test still passing with the header now required. |
| V02 | Agent registry and revocable credentials | done | Create/list/update agents, rotate/revoke credentials (256-bit, digest-only storage), revoked-credential rejection — integration-tested, and exercised live through the dashboard (reveal-once UI). |
| V03 | Human-to-agent and agent-to-agent delegation | done | Root grants (Owner/Admin) and agent-issued child grants, subset/attenuation re-validated via `@trustrail/policy-engine`, ancestor revocation blocking descendants — unit-, integration-, and demo-scenario-tested. Dashboard: Delegations page (tree + table). |
| V04 | Versioned deterministic policies | done | Draft/version/publish with optimistic-locked revision CAS. Exercised by org auto-seed, the dashboard's Policies page (form/JSON tabs, simulate panel), and manual live testing. Not yet covered by a dedicated vitest integration test for the publish-conflict path specifically (only unit-level + manual). |
| V05 | Enforcement gateway | done | Agent credentials never reach merchant-sandbox; it only accepts writes with the gateway's shared secret. Network isolation is header-based, not network-segmented, on this Docker-less machine (see limitations). Integration- and demo-scenario-tested (`direct_merchant_write_rejected`). |
| V06 | Human approval queue | done | Bound approval (request hash + policy hash + grant chain), atomic compare-and-set approve/reject, self-approval rejection, stale-policy invalidation. Integration-, demo-scenario-, and live-browser-tested (independent reviewer approves a real EUR 350 request, verified in the Approvals page). |
| V07 | Transactional shared budgets and idempotency | done | Multi-target atomic reservation (root + child + policy-level daily budget), deterministic lock ordering, real Postgres row locks. Idempotency scoped to org+actor+key with payload-hash conflict detection. Concurrency-tested at three layers: merchant-sandbox's own row lock (3/8), TrustRail's grant budget (3/6), and the `concurrent_budget_limit` demo scenario. |
| V08 | Signed decision and execution receipts | done | Ed25519 JWS, RFC 8785 canonicalization (hand-rolled, see Decisions), explicit alg/typ allowlist, kid-based key lookup. Tamper/unknown-issuer/rotation/revoked-key all unit-, integration-, demo-scenario-, and live-browser-tested (pasted a tampered JWS into the Receipts page and confirmed `signature_valid: false`). Cross-language agreement proven: a receipt signed by the TS signer verifies correctly in the Python SDK (`sdk/python/tests/test_cross_language_receipt.py`). |
| V09 | Dashboard and action detail | done | All 13 pages from spec section 13 built (`apps/web`, Next.js/Tailwind), calling the real API, verified by production build/lint/typecheck, live manual click-through, and a real Playwright suite (`tests/e2e`, 4 specs / 5 flows, all passing against a real backend). `agents.last_activity_at` now updates on every agent authentication (fixed, test-covered). One remaining minor gap: no `GET /v1/receipts` list endpoint (Receipts page derives its list from recent actions' embedded receipt refs). |
| V10 | Deterministic demo lab | done | All 12 scenarios from spec section 14 (`apps/api/src/demo/scenarios.ts`), verified passing via CLI (`pnpm demo:run`) from a clean `pnpm demo:reset`, and live through the dashboard's Demo Lab page ("Run scenario" button hits the real endpoint and updates Overview/Approvals/Receipts in real time). |
| V11 | TypeScript and Python SDKs | done | Both expose `actions.execute/get/wait`, `grants.delegate`, `receipts.get/verify` against the same live API. TypeScript: 6 unit tests (mocked fetch) covering idempotency-key retry semantics. Python: 9 tests — 3 canonicalization, 3 cross-language receipt verification, 3 against a real spawned live API instance (not mocked). |
| V12 | MCP tool adapter | done | `get_order`, `request_refund`, `get_action_status` over stdio, built on `@modelcontextprotocol/sdk`. Verified with a **real MCP client** driving the actual built binary as a subprocess against a real running stack (5/5 tests): tool listing, real order lookup, real EUR 80 refund, EUR 700 denial, cross-checked action status. |
| V13 | Developer docs and local setup | done | README, ARCHITECTURE, THREAT_MODEL, API, SDK_QUICKSTART, MCP_SETUP, OPERATIONS, TEST_REPORT, DEMO_SCRIPT, YC_PRODUCT_BRIEF, ROADMAP, DECISIONS all written from what was actually built. `pnpm setup:local`/`dev`/`demo:seed`/`demo:run`/`demo:reset`/`verify`/`benchmark` all implemented and run for real (see `docs/TEST_REPORT.md`). `docs/openapi.json` is now generated from the routes' actual zod schemas (`pnpm generate:openapi`); `docs/API.md` points there for exact shapes and keeps only prose. |
| V14 | YC demo materials and landing page | partial | `docs/DEMO_SCRIPT.md` and `docs/YC_PRODUCT_BRIEF.md` written. Landing page built and verified live (no fake logos/testimonials, honest sandbox disclaimer). The script's five underlying scenarios were run live, in order, against a freshly-seeded stack and timed for real (~6.6s of CLI execution against a 65s on-script budget) — see `docs/DEMO_SCRIPT.md`'s "Timing rehearsal" section. Still not done: an actual recorded take with a human presenter narrating live. |
| V15 | Observability and deployment package | done | Health checks, structured logging (pino), and `/v1/metrics/summary` (real measured aggregates, including authorization latency p50/p95/p99) all implemented and shown in the dashboard's Overview page. `docs/OPERATIONS.md` written (runbook, key rotation, restore guidance). `docker compose -f infra/docker-compose.yml up --build` was actually run end-to-end on 2026-09-21 once Docker Desktop became available on this machine: `postgres`, `migrate`, `api`, `merchant-sandbox`, and `web` all started healthy, and a full live flow (register, create org, create agent + credential, issue a grant, run `eur80_auto_refund`/`eur700_denied`/`receipt_tamper_detected`/`direct_merchant_write_rejected`) succeeded against the real containers, including an independently-verified signed receipt (`signature_valid: true`, `issuer_trusted: true`). `merchant-sandbox`'s network isolation was verified directly, not just reviewed: a connection attempt from the host to its port is refused outright (no published port at all). Three real bugs were found and fixed by this run (see `docs/DECISIONS.md`): a `postgres:18-alpine` volume-layout incompatibility, a missing `tsconfig.base.json` in each Dockerfile's build context, and a signing-key file-permission mismatch between the root-run `migrate` service and the non-root `api` service. The repository was then pushed to `yassineaqejjaj/trustrail` on GitHub, which gave `.github/workflows/ci.yml` its first real execution on an actual Actions runner — it failed once (`pnpm/action-setup@v4` vs. `package.json`'s `packageManager` field, see `docs/DECISIONS.md`), was fixed, and the `verify` job then passed in full (build/typecheck/lint/test, Python SDK tests, and the 4-spec Playwright suite) in 3m29s on a real `ubuntu-latest` runner. Nothing in the deployment package remains unexecuted. |

## Phase gates (spec §17)

| Phase | Gate | Status |
|---|---|---|
| 1. Foundation | Clean setup, login, org isolation, merchant idempotency tests pass | **met**. `pnpm setup:local` run twice (idempotent), `pnpm dev` started all three services for real, exercised live via curl and via the browser. |
| 2. Real protected action | Allowed/denied/concurrent/ambiguous-outcome integration tests pass | **met**. Ambiguous-outcome (`unknown` -> reconciled) covered by `connector_timeout_reconciled`, verified twice via `pnpm demo:run`. |
| 3. Review and evidence | Reviewer completes EUR 350 workflow; altered receipt fails; replay cannot duplicate execution | **met** — covered by `gateway.integration.test.ts`, the demo scenario suite, and live browser verification (see V06/V08 above). |
| 4. Product interface | Required browser flows work with real persistent data, including failure states | **met**. All 13 pages built, production build/lint/typecheck clean, a real manual click-through session, and a real automated Playwright suite (`tests/e2e`, spec section 16's exact five flows: onboarding, first refund, denial explanation, independent reviewer approval, receipt verification) -- 4/4 specs passing, each against a freshly-provisioned real backend (own ephemeral Postgres, own merchant sandbox, own `next dev` instance). |
| 5. Developer adoption | Both SDKs + MCP adapter work without private knowledge | **met**. Both SDKs and the MCP adapter tested against a real running API (not mocks for the integration-level checks); `docs/SDK_QUICKSTART.md` and `docs/MCP_SETUP.md` document the exact steps. |
| 6. YC presentation | Clean checkout passes documented verification; demo repeatable | **met**. `pnpm verify` passes locally; a real GitHub Actions run of the same checks plus the Playwright suite passes on a clean checkout (`yassineaqejjaj/trustrail`, run 35592712208); `pnpm demo:run` is repeatable (verified from clean state, and again inside the Docker Compose stack); demo script timed for real and product brief written. Not yet done: an actual recorded take of the 90-second script with a human presenter narrating live -- the one item in the whole spec that requires a human, not more engineering. |

## Known simplifications (honest limitations, not to be silently papered over)

- **Order ownership**: the merchant sandbox connector always reports `ownedByPrincipal: true` for any order that exists — it doesn't model separate customer identities distinct from the demo principal.
- **Network isolation**: without Docker, the merchant sandbox's "private network" guarantee is enforced by binding to `127.0.0.1` plus the gateway-secret header check, not by actual network segmentation. `infra/docker-compose.yml` would restore true isolation but does not exist yet.
- **apps/worker is a thin wrapper**: the actual polling/dispatch logic lives in `apps/api/src/worker/poller.ts`, imported via a relative path rather than a shared package. Documented in `docs/DECISIONS.md`.
- **SSE (`GET /v1/events`)** is tenant-scoped short-interval polling of `audit_events`, not a push-based bus.
- **Worker has no elevated DB role**: it iterates the global `organizations` table and opens one tenant-scoped transaction per org per poll tick. Fine at demo scale; an O(orgs) scaling limit.
- **(Resolved 2026-09-21)** `.github/workflows/ci.yml` has now been run for real on `yassineaqejjaj/trustrail` and passes. It was not a formality the first time either — it failed once on a `pnpm/action-setup@v4` version-conflict check, fixed in the same session (`docs/DECISIONS.md`).
- **One minor frontend/backend seam found during integration, not fixed**: no `GET /v1/receipts` list endpoint (Receipts page works around this by deriving its list from recent actions' embedded receipt refs). `agents.last_activity_at` was the other one found; it's fixed now (`apps/api/src/auth/context.ts#authenticateAgent`, test-covered).
- **Non-money actions share the money budget mechanism, not a parallel one**: `root_daily_limit_minor` holds minor currency units for `refund.create`/`subscription.grant_credit` but a plain daily *count* for the other three subscription actions (`isMoneyAction()` in `packages/contracts/src/enums.ts` gates which). Reuses `packages/gateway-core/src/budget.ts`'s existing reservation ledger (already integer-based) instead of a second quota system — deliberate, but means a grant's `maxAmountMinor`/`currency` fields stay required-but-nominal for grants scoped to non-money actions only (e.g. the demo's "IT Onboarding Agent" grant). Grants schema itself is not polymorphic; a grant mixing money and non-money actions would have ambiguous budget semantics. Mitigated by convention (demo/seed data keeps subscription grants separate from refund grants), not schema-level enforcement.
- **`subscription.change_plan`/`activate_feature`/`invite_user` are second use case, not yet e2e-tested**: covered by real integration tests (`apps/api/test/subscriptionActions.test.ts`) and by real `pnpm demo:run` executions against a live local stack, but not yet by Playwright (`docs/ROADMAP.md` item 9).

## Continuation checklist (if a future session resumes this build)

1. Read this file and `docs/DECISIONS.md` top to bottom, then `docs/TEST_REPORT.md` for exact last-known-good test results.
2. `pnpm install`, then `pnpm --filter='./packages/*' --filter='./apps/*' run build`.
3. `pnpm setup:local && pnpm dev` to run the full stack locally; `pnpm demo:seed` then `pnpm demo:run <scenario>` to exercise it.
4. `pnpm verify` should pass in full (96+ tests across 8 packages as of this writing) before making changes, to confirm the baseline still holds.
5. Highest-leverage remaining work, in order: (a) an actual recorded take of the 90-second demo script with a human presenter narrating -- the one remaining item that isn't an engineering task; (b) the rest of `docs/ROADMAP.md`'s engineering follow-ups.

## Session log

- 2026-09-21 (session 6): Built a second use case beyond refunds, with a
  real backend, per a product-vision discussion about generalizing
  TrustRail beyond payments to any significant delegated agent action.
  Chose SaaS B2B account/subscription management (the discussion's own
  recommendation): a new `apps/saas-sandbox` service (fixture SaaS
  accounts/plans/features/users, an internal write API mirroring
  `apps/merchant-sandbox`'s shape) and a matching
  `apps/api/src/gateway/saasSandboxConnector.ts`, registered alongside
  `merchant_sandbox` in a new `ConnectorRegistry` (`packages/gateway-core`)
  that replaced the previous single-hardcoded-connector design end to end
  (`Connector`, `ResourceFacts`, `EvaluationRequest`, `dispatchAction`,
  every route and test harness that touched a connector). Added four
  action types (`subscription.grant_credit`, `subscription.change_plan`,
  `subscription.activate_feature`, `subscription.invite_user`), each with
  its own zod policy-bundle schema and its own branch in
  `packages/policy-engine/src/evaluate.ts` -- deliberately not uniform:
  `grant_credit` reuses the automatic/approval amount tiering (the one
  action with real money), `change_plan` hard-denies an ineligible plan
  but escalates a downgrade to approval, `activate_feature` is a pure
  allow/deny gate with no approval tier at all, and `invite_user` hard-blocks
  an admin-role invite while treating any other disallowed role as an
  "exception" sent to a human -- matching the discussion's own worked
  example ("prepare Lea's arrival: create her access for 30 days, no admin
  rights, and purchase at most EUR 150 of licenses; request validation for
  any exception") field for field. Seeded that exact example into the demo
  org (a new "IT Onboarding Agent" grant covering all four actions) and
  added four Demo Lab scenarios recreating it, run for real against a live
  local stack (`lea_onboarding_completed`, `lea_admin_invite_blocked`,
  `subscription_plan_downgrade_approval`, `subscription_feature_activation_denied`
  -- all four verified passing via `pnpm demo:run`, not just unit-tested).
  Extended the Policies and Demo Lab pages (`apps/web`) to handle five
  action types instead of one hardcoded shape, including a real bug found
  and fixed along the way: the simulate panel always submitted
  `refund.create` regardless of which policy bundle was selected. Extended
  the Docker/Railway deployment path (a third database `trustrail_saas`,
  a third sandbox service, `apps/api`'s self-migration boot sequence) and
  `pnpm setup:local`/`pnpm demo:seed`/`pnpm demo:run` for local dev --
  found and fixed a real bug in that work too: `SAAS_DATABASE_URL`'s
  default embedded a freshly-generated, throwaway migrator password
  instead of the one already persisted in an existing `.env`, which broke
  migrations on any re-run of `pnpm setup:local` against a pre-existing
  local install. 136 unit/integration tests passing (up from 97; 45 new:
  10 subscription integration tests, 13 policy-engine unit tests, plus the
  saas-sandbox app's own 16), 11/11 e2e tests still passing (no e2e
  coverage added yet for the 4 new scenarios -- a disclosed gap, see
  `docs/ROADMAP.md` item 9). Not yet deployed to Railway/Vercel as of this
  entry.
- 2026-09-21 (session 5): Deployed the backend for real (Railway: Postgres
  + api + merchant-sandbox, self-migrating on boot) and the frontend
  (Vercel), then worked through `docs/ROADMAP.md`'s concrete engineering
  follow-ups end to end: extracted `packages/db`/`packages/gateway-core`
  out of `apps/api`; built a reconciliation tool for actions stuck in
  `unknown` (worker backoff + give-up, `GET/POST /v1/reconciliation`,
  a dashboard page); gave `require_order_ownership` a real deny case;
  added fixed-threshold anomaly detection for a burst of requests from one
  credential (`GET /v1/security/anomalies`, a dashboard page); generated
  `docs/openapi.json` from the same zod schemas that validate each route;
  broadened Playwright coverage to Delegations/Policies/Settings/8 Demo
  Lab scenarios/mobile layouts (11/11 passing). Found and fixed a real
  production incident along the way: neither Postgres pool had an `error`
  listener, so a dead idle connection crashed the whole process -- found
  because enabling Railway's point-in-time-recovery backups restarted
  Postgres and did exactly that to the live API. Added the admin-bootstrap
  command `docs/PRODUCT_SPEC.md` requires for `APP_MODE=production`
  (`scripts/bootstrap-admin.ts`), CI Docker image publishing to GHCR
  (verified: both images built successfully on the first real run), and
  seeded the live Railway database with the Northstar Commerce demo org.
  97 unit/integration tests + 11 e2e tests passing at the end, all real,
  all run. One partial gap: a Railway staging environment was created
  with a working `api` instance, but `merchant-sandbox` could not be
  added to it -- every deploy attempt failed with an upload error the CLI
  and API gave no further detail on, unlike its identical production
  deploy which works fine. Left as a known gap rather than force-fixed.
- 2026-09-21 (session 4): Created `yassineaqejjaj/trustrail` (private) on
  GitHub and pushed `main` (20 commits at push time). This gave
  `.github/workflows/ci.yml` its first execution on a real Actions
  runner, which failed immediately on `pnpm/action-setup@v4` (a version
  specified both there and in `package.json`'s `packageManager` field,
  which a newer release of that action now rejects even when the two
  agree). Fixed and re-pushed; the `verify` job then passed in full
  (build, typecheck, lint, unit/integration tests, Python SDK tests, and
  the 4-spec Playwright e2e suite) in 3m29s on `ubuntu-latest` (run
  35592712208). This closes the one item in the entire V01-V15 checklist
  that had remained genuinely unexecuted rather than just reviewed --
  every mandatory capability now has real, executed evidence. The only
  thing left in `docs/ROADMAP.md`/this file that isn't done is a human
  presenter actually recording the 90-second demo script live, which by
  its nature isn't something to automate.
- 2026-09-21 (session 3): Docker Desktop became available on this machine.
  Ran `docker compose -f infra/docker-compose.yml --env-file infra/.env up
  --build` for the first time and treated it as the debugging session
  `docs/ROADMAP.md` predicted, not a formality. Found and fixed three real
  bugs (see `docs/DECISIONS.md`): a `postgres:18-alpine` volume-mount
  layout incompatibility, a missing `tsconfig.base.json` in each
  Dockerfile's build context (also silently missing from
  `apps/api/dist/db/rls.sql` at runtime -- `tsc` doesn't copy non-`.ts`
  files, so `apps/api/package.json`'s `build` script now copies it
  explicitly), and a file-permission mismatch on the shared signing-key
  volume between the root-run `migrate` service and the non-root `api`
  service. After the fixes, ran a full live flow through the real
  containers end to end (register, org, agent, credential, grant, four
  demo scenarios including `direct_merchant_write_rejected`) and
  independently verified a receipt signed inside the container (`jwks`
  round-trip, `signature_valid: true`). Confirmed merchant-sandbox's
  network isolation for real: a direct connection from the host is
  refused outright, since no port is published for it at all. Tore the
  stack down and removed the scratch verification scripts afterward.
  `.github/workflows/ci.yml` still could not be run (no CI runner access).
- 2026-09-21 (session 2): Re-verified the full baseline (`git status` clean,
  `pnpm verify` all green). Confirmed no Docker/CI runner is available on
  this machine (`docker`/`docker compose` not installed), so V15's
  Docker/CI gap remains genuinely blocked by the environment, not by
  missing code. Closed the other open V14 item that was actually
  achievable here: started a fresh local stack, seeded it, and ran the
  demo script's five named scenarios in order for real, timing each one
  (see `docs/DEMO_SCRIPT.md`'s "Timing rehearsal" section) to confirm the
  90-second script's pacing is realistic. Shut the rehearsal stack down
  cleanly afterward. Also found and cleaned up an orphaned `pnpm dev`
  process left running from the already-merged and removed frontend-agent
  git worktree (harmless — it held no listening ports — but tidied up).
- 2026-09-21 (session 1): Full session. Built and integration-tested, in order: repo scaffolding + contracts/policy-engine/receipt-verifier (Phase 1); merchant-sandbox with real concurrency-safe refunds; apps/api's complete gateway (auth, grants, policies, actions, approvals, receipts, RLS-based tenant isolation) with 25 passing integration tests (Phase 2/3); `pnpm setup:local`/`pnpm dev` scripts, verified live via curl; the full 12-scenario deterministic demo lab, verified twice from clean state (Phase 3/6); the TypeScript SDK, a read-only order-lookup route it needed, the MCP adapter (verified with a real MCP client), and the Python SDK (verified against a real live API and cross-language against the TS signer) (Phase 5); the complete documentation set and `pnpm verify`/`pnpm benchmark` scripts; the Next.js dashboard (built in a parallel isolated agent session, merged, then verified live in-browser end to end, fixing a stale/broken demo-scenario-id mismatch and an HTML-entity-in-JS-string rendering bug found during that verification) (Phase 4). 96+ automated tests passing across 8 packages, plus live manual verification of every major user-facing flow.
