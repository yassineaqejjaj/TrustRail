# Test report

Generated during the build session, from commands actually run on the build
machine (Apple M5, 10 cores, 17GB RAM, macOS, arm64 — see `docs/DECISIONS.md`
for why this machine has no Docker/Homebrew/system Postgres and how tests
still run against a real, non-mocked PostgreSQL instance regardless).

## Unit and integration tests (`vitest`)

Run individually per package with:

```bash
pnpm --filter <package> run build   # for packages depended on by others
pnpm --filter <package> run test
```

| Package | Command | Result | What it actually exercises |
|---|---|---|---|
| `@trustrail/contracts` | `pnpm --filter @trustrail/contracts run test` | **15/15 passed** | Money/policy/action schema validation (rejects zero/negative/decimal amounts, unknown currency, caller-injected `actor_id`/`role`/etc.), canonical JSON determinism and hashing. |
| `@trustrail/policy-engine` | `pnpm --filter @trustrail/policy-engine run test` | **22/22 passed** | Amount-tier boundaries (EUR 100/100.01/500/500.01 exactly, per spec section 16), delegation attenuation and widening rejection, ancestor revocation/expiry blocking descendants, fail-closed on missing policy/order state, approval resumption (approved/rejected/expired), free-text injection has no evaluation effect. Pure/no I/O — runs in ~5ms. |
| `@trustrail/receipt-verifier` | `pnpm --filter @trustrail/receipt-verifier run test` | **6/6 passed** | Real Ed25519 sign+verify round trip, tamper detection, unknown-issuer rejection, rotated-key historical verification, revoked-key signature-still-valid/trust-flag-separate, malformed JWS rejection. |
| `@trustrail/merchant-sandbox` | `pnpm --filter @trustrail/merchant-sandbox run test` | **8/8 passed** | Gateway-secret enforcement (401 without/with wrong secret), idempotent refund replay, insufficient-balance rejection, **8 concurrent refund requests against a fixed order balance — exactly 3 succeed, 5 correctly rejected**, against a real ephemeral PostgreSQL 18 instance with row-level locking. |
| `@trustrail/api` | `pnpm --filter @trustrail/api run test` | **25/25 passed** | Full gateway integration suite (18 tests) against a real ephemeral Postgres + real HTTP merchant sandbox: registration/tenant isolation, EUR 80 auto-allow with verified signed receipt, EUR 700 denial (including a prompt-injection-style override attempt), EUR 350 approval with self-approval rejection and independent-reviewer approval, idempotent replay and conflict, revoked-grant/revoked-credential blocking, child-grant delegation (rejected wide cap + valid narrowed execution), **6 concurrent requests against a fixed daily budget — exactly 3 succeed**, receipt tamper detection, direct-merchant-write rejection, read-only order lookup. Plus 7 strict-JSON-parser tests (duplicate-key rejection). |
| `@trustrail/sdk` (TypeScript) | `pnpm --filter @trustrail/sdk run test` | **6/6 passed** | Idempotency-key header presence, retry-on-network-error (same key preserved), no-retry-on-4xx, network error wrapping, `actions.wait` polling to a terminal state, unauthenticated `receipts.verify` call shape. |
| `@trustrail/mcp-adapter` | `pnpm --filter @trustrail/mcp-adapter run test` | **5/5 passed** | A **real MCP client** (`@modelcontextprotocol/sdk`'s `Client`) driving the actual built adapter binary as a subprocess against a real running API + merchant sandbox: tool listing, real order lookup, real EUR 80 refund execution, EUR 700 denial (the model cannot make itself the authority), and `get_action_status` cross-checked against `request_refund`'s own result. |
| `trustrail` (Python) | `cd sdk/python && source .venv/bin/activate && pytest` | **9/9 passed** | 3 canonicalization tests; 3 cross-language receipt tests verifying a fixture actually signed by the TypeScript signer (`tests/integration/fixtures/cross-language-receipt.json`) — proves byte-for-byte RFC 8785 + Ed25519 agreement between the two implementations, including tamper detection on that same fixture; 3 live-API tests against a real running stack spawned as a subprocess (ALLOW+succeeded, DENY, receipt get+verify). |

**Total: 96/96 unit/integration tests passed** (plus 4/4 Playwright specs
covering 5 mandatory flows, see below), none skipped, across 8 packages, none against
mocked databases or mocked HTTP servers for the integration-level tests.

## Browser tests (`pnpm test:e2e`, real Playwright + real Chromium)

`tests/e2e` covers exactly the five flows spec section 16 names, each
against a freshly-provisioned real backend (its own ephemeral Postgres, its
own merchant-sandbox instance, its own `next dev` process on a private
port) rather than `pnpm dev`'s shared one, so this suite can run
standalone or in CI without colliding with a developer's running stack:

```
Running 4 tests using 1 worker
  ✓ approval.spec.ts: an independent reviewer approves a EUR 350 request through the dashboard (2.8s)
  ✓ denial.spec.ts: a denied action shows a clear reason in the dashboard (0.9s)
  ✓ onboarding.spec.ts: register, create an organization, register an agent, reveal a credential, issue a grant, and run a real EUR 80 refund (0.8s)
  ✓ receipt-verification.spec.ts: the Receipts page verifies a real receipt and catches a tampered one (1.2s)
  4 passed (16.0s)
```

Every one of these bugs was a real one found and fixed during this run, not
a hypothetical:
- Two ambiguous-selector bugs in the test code itself (the auth form's mode
  toggle and submit buttons share a label; the Receipts page has an
  icon-only per-row "Verify" button with the same accessible name as the
  main submit button) — fixed by scoping locators more precisely.
- A genuine content bug in the onboarding test's own assertion: "Deny" is
  not a substring of "Denied" (`/Deny/i` never matches "Denied" — different
  words), so the first denial-page assertion was silently unreachable
  until corrected to match the actual rendered text.
- Confirmed the onboarding page's fail-closed design is real, not
  accidental: a brand-new organization created live through the browser
  has no merchant orders, and running the first-action step against it
  correctly returns `STATE_UNAVAILABLE` until orders are seeded -- the
  onboarding test seeds them explicitly via a direct DB call (mirroring
  what `pnpm demo:seed` does) rather than working around the fail-closed
  behavior.

## Deterministic demo scenarios (`pnpm demo:run`)

All 12 scenarios from `docs/PRODUCT_SPEC.md` section 14, run from a clean
`pnpm demo:reset`:

```
eur80_auto_refund            PASS
eur350_approval               PASS
eur700_denied                 PASS
prompt_injection_deny         PASS
child_cap_rejected            PASS
root_revoked_denied           PASS
idempotent_replay             PASS
idempotency_conflict          PASS
receipt_tamper_detected       PASS
concurrent_budget_limit       PASS
connector_timeout_reconciled  PASS
direct_merchant_write_rejected PASS
```

Run twice from clean state during this session; both runs 12/12. (An
earlier run in a tight loop of 12 back-to-back script invocations showed one
transient anomaly in `concurrent_budget_limit`, traced to rapid embedded-
Postgres/merchant-sandbox process churn in that ad hoc test methodology, not
a correctness bug — see `docs/BUILD_STATUS.md`'s decision log for the
investigation. Every clean, isolated run has been consistent.)

## Example agents (`examples/support-agent-ts`, `examples/support-agent-python`)

Both run without any LLM provider (see each one's module docstring). Ran
both for real against the live local stack:

```
$ pnpm --filter support-agent-ts-example run start
Requesting a EUR 80.00 refund on order_demo_101...
Execution state: succeeded, connector reference: refund_miq8EkHx5RDexT87q3huCJob

$ sdk/python/.venv/bin/python examples/support-agent-python/support_agent.py
Requesting a EUR 80.00 refund on order_demo_106...
Execution state: succeeded, connector reference: refund_RtHTkfq3zLsm4CVCGnJtUvqi
```

This run surfaced a real gap: `pnpm demo:seed` seeded TrustRail-side
fixtures (org/users/agents/grants/policy) but not merchant-sandbox orders,
so a fresh example run correctly failed closed with `STATE_UNAVAILABLE`
until `demo:seed` was fixed to also seed merchant orders (matching what a
user would actually expect from a single "seed the demo" command).

## Manual live verification (not automated, done once by hand)

- `pnpm setup:local` run twice consecutively — second run correctly detected
  existing roles/database/signing key and made no changes (idempotent).
- `pnpm dev` started both `apps/api` (:4000) and `apps/merchant-sandbox`
  (:4100) for real; exercised with `curl`: health checks, register, create
  organization, create agent, create credential, issue a root grant, submit
  a real EUR 80.00 refund — received `decision: ALLOW`, `execution_state:
  succeeded`, a real `connector_reference`, and two receipts.
- Frontend (`apps/web`): built in a parallel isolated session, then
  merged and independently re-verified live in-browser after merging:
  production build (all 15 routes), lint (0 warnings/errors after fixing
  several found on the first real lint run -- ESLint wasn't configured
  yet, so this was the first time `next lint` had actually run against
  this code), and a live click-through covering sign-in, the onboarding
  checklist reflecting real seeded state, the Overview page showing real
  measured metrics after running a demo scenario via CLI, the Demo Lab
  page successfully running a scenario through its "Run scenario" button
  (which required fixing a scenario-ID mismatch and an HTML-entity
  rendering bug between the two independently-built halves), the
  Approvals page showing that scenario's real approval history, and the
  Receipts page's paste-to-verify tool.

## Benchmark (`pnpm benchmark`)

The documented `pnpm benchmark` script (`scripts/benchmark.ts`) targets the
locally-provisioned persistent Postgres instance. During this session it
could not be executed against that instance because a concurrently-running
background task (the frontend build, in an isolated git worktree) held the
same default port (55432) with its own local Postgres. The exact same code
path was instead run once via an equivalent temporary harness using an
ephemeral Postgres instance on a free port — real numbers, same
`submitAction()` call, same machine, just a different Postgres process:

```
Benchmark: 200 requests, concurrency 4
Hardware: Apple M5 x10, 17GB RAM, darwin/arm64

Full submitAction() latency (includes connector dispatch + receipt signing):
  p50: 13.9ms  p95: 23.0ms  p99: 120.4ms
  min: 8.4ms   max: 127.5ms
  error rate: 0.00%
  throughput: 237.3 req/s (wall clock, concurrency=4)
```

This is a measured local run, not a published performance claim. The
p50/p95 figures are comfortably under the spec's suggested ~100ms
evaluation-latency target even though this number includes full downstream
dispatch and receipt signing (a strictly harder bar than "evaluation
alone, excluding downstream execution"); p99 is higher, consistent with
occasional connection-pool/lock-wait tail latency under concurrent load —
worth a dedicated look before treating p99 as production-ready.
`pnpm benchmark` itself was confirmed to load and correctly detect an
unprovisioned database (its guard-clause path), but not run end-to-end
against the persistent instance in this session — that's a genuine gap,
not a rounding error, and is recorded as such rather than silently
substituted.

## Known gaps in coverage (see docs/BUILD_STATUS.md for the full list)

- `docker compose up --build` has not been executed (no Docker on this
  build machine) -- see the Dockerfiles/compose section of
  `docs/BUILD_STATUS.md`.
- Playwright covers exactly the five flows spec section 16 names, not
  every page or every responsive breakpoint (see `docs/ROADMAP.md`).
