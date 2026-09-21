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
2. **A real connector-to-principal ownership model.** The merchant sandbox
   connector currently reports `ownedByPrincipal: true` unconditionally
   (`apps/api/src/gateway/merchantSandboxConnector.ts`) because the sandbox
   doesn't model distinct customer identities. A second, intentionally
   mismatched fixture plus real ownership resolution would let
   `require_order_ownership` actually deny something in the demo.
3. **A push-based event bus for `GET /v1/events`.** Currently short-interval
   polling of `audit_events`, tenant-scoped and correct, but not push-based
   and not horizontally cheap at scale.
4. **A dedicated reconciliation report/tool** for actions left in `unknown`
   after a restore or extended outage, beyond relying on the next normal
   dispatch retry to resolve them.
5. **OpenAPI generation** from the zod schemas in `packages/contracts`, so
   `docs/API.md` stops being hand-maintained.
6. **Anomaly/abuse detection** on agent behavior (e.g. a sudden burst of
   requests from one credential) — currently, a stolen *active* credential
   can use its existing grants until a human revokes it; there is no
   automated detection layer (`docs/THREAT_MODEL.md`).
7. **KMS-backed signing keys.** `apps/api/src/gateway/keys.ts` already
   isolates key access behind `getActiveSigningKey`/`getTrustedKeys`; a real
   KMS integration is a swap behind that seam, not a redesign.
8. **Docker Compose actually run and iterated on.** Written
   (`infra/docker-compose.yml`) but not exercised on this build machine
   (no Docker available here) — first real deployment attempt should treat
   it as a draft to debug, not a finished artifact.
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
