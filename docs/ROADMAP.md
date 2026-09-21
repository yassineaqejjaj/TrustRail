# Roadmap

## Explicitly out of scope for V1 (spec section 2)

Cross-company federation; verified human presence; legal identity
verification; global agent reputation; enterprise SAML/SCIM; SOC 2
certification; hardware-backed keys; production payment connectors;
automatic billing; marketplace; blockchain; universal remote MCP proxy;
guaranteed prevention of prompt injection; autonomous policy generation;
multi-region consistency. None of these are displayed as active features
anywhere in the product; this file is where they're tracked instead.

## Expansion sequence (business hypothesis, spec section 19)

Refunds -> other bounded financial operations -> internal administrative
writes -> cross-organization delegation. The long-term "trust network"
across organizations is a hypothesis, not an implemented moat, and each
step should be gated on actual customer validation, not built ahead of
demand.

## Concrete engineering follow-ups identified during this build

Roughly ordered by leverage, not urgency:

1. **Extract `packages/gateway-core`.** `apps/worker` currently re-imports
   `apps/api/src/worker/poller.ts` and its dependencies directly rather than
   through a proper shared package (`docs/DECISIONS.md`). Low risk today,
   but blocks `apps/worker` from ever being deployed as a truly independent
   process/container.
2. **(Done 2026-09-21)** A second, intentionally mismatched fixture
   (`order_demo_not_owned`, `MISMATCHED_OWNER_CUSTOMER_REF` in
   `packages/contracts/src/demoFixtures.ts`) now makes
   `require_order_ownership` a real, demonstrable gate (`order_not_owned_denied`
   demo scenario) instead of a permanently-true stub. This is a sandbox-only
   sentinel, not a real per-customer identity mapping — the sandbox still
   has no data model for that, so every other order remains
   unconditionally owned. A real connector integration would still need to
   resolve ownership from the merchant's own customer/account records.
3. **A push-based event bus for `GET /v1/events`.** Currently short-interval
   polling of `audit_events`, tenant-scoped and correct, but not push-based
   and not horizontally cheap at scale.
4. **(Done 2026-09-21)** A dedicated reconciliation report/tool
   (`GET /v1/reconciliation`, `POST /v1/reconciliation/:actionId/resolve`,
   `apps/web`'s Reconciliation page) for actions left in `unknown`. The
   worker's auto-retry now backs off exponentially and gives up after
   `MAX_AUTO_RETRY_ATTEMPTS` (8), flagging the job `stuck` instead of
   retrying forever against a dead connector — a human then resolves the
   real outcome (confirmed with the merchant directly), which commits or
   releases the held budget and issues a receipt exactly like an automated
   resolution would. Covered by `apps/api/test/reconciliation.test.ts`.
5. **(Done 2026-09-21)** OpenAPI generation from the zod schemas that
   actually validate each route (`packages/contracts` and
   `apps/api/src/routes/*.ts`), so `docs/API.md` stops hand-maintaining
   request/response shapes. `scripts/generate-openapi.ts` (`pnpm
   generate:openapi`) writes `docs/openapi.json`; `docs/API.md` now points
   readers there for exact shapes and keeps only the higher-level prose.
   `GET /v1/events` (Server-Sent Events) isn't representable as a normal
   JSON request/response pair, so it's documented there in prose only.
6. **(Done 2026-09-21)** Anomaly detection for a sudden burst of requests
   from one agent credential (`GET /v1/security/anomalies`, `apps/web`'s
   Security page). Deliberately a simple fixed-threshold velocity check
   computed on read, not persisted and not wired into the request path --
   it can never change whether an action is allowed/denied/held, only
   surface volume for a human to review. A stolen *active* credential can
   still use its existing grants until someone revokes it; this doesn't
   change that, it only makes the volume visible. Covered by
   `apps/api/test/anomalyDetection.test.ts`. A real follow-up would
   persist flags and notify a human instead of requiring someone to check
   this report.
7. **KMS-backed signing keys.** `apps/api/src/gateway/keys.ts` already
   isolates key access behind `getActiveSigningKey`/`getTrustedKeys`; a real
   KMS integration is a swap behind that seam, not a redesign.
8. **(Done 2026-09-21)** Both Docker Compose and `.github/workflows/ci.yml`
   have now been run end-to-end for real, on `yassineaqejjaj/trustrail`,
   with their real bugs found and fixed (`docs/DECISIONS.md`,
   `docs/BUILD_STATUS.md`). Kept here only as a record that this used to
   be open.
9. **Broader Playwright coverage.** `tests/e2e` covers exactly the five
   flows spec section 16 names (onboarding, first refund, denial,
   approval, receipt verification); it does not yet cover every page
   (Delegations, Policies, Demo Lab's other 11 scenarios, Settings) or
   responsive/mobile layouts. Extend it as the dashboard gains more
   business-critical flows worth regression-testing.

## What would change the roadmap

Any of: a real customer conversation that says "we need X before we'll
pilot this," a security review that finds a gap not already listed in
`docs/THREAT_MODEL.md`, or a decision to target a second action type beyond
refunds (which would pressure-test how connector-agnostic the current
design really is, versus how much of it quietly assumes "refund.create").
