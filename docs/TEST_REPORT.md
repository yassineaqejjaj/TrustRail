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

**Total: 96/96 tests passed**, none skipped, across 8 packages, none against
mocked databases or mocked HTTP servers for the integration-level tests.

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

## Manual live verification (not automated, done once by hand)

- `pnpm setup:local` run twice consecutively — second run correctly detected
  existing roles/database/signing key and made no changes (idempotent).
- `pnpm dev` started both `apps/api` (:4000) and `apps/merchant-sandbox`
  (:4100) for real; exercised with `curl`: health checks, register, create
  organization, create agent, create credential, issue a root grant, submit
  a real EUR 80.00 refund — received `decision: ALLOW`, `execution_state:
  succeeded`, a real `connector_reference`, and two receipts.
- Frontend (`apps/web`) manual click-through: see the frontend build
  agent's own report for what was clicked through live versus only
  typechecked, once merged — not yet reflected in this file as of this
  writing (see `docs/BUILD_STATUS.md`).

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

- No Playwright browser-test suite yet for `apps/web`'s flows.
- `pnpm verify` (a single aggregate command running lint+typecheck+test+build
  across every package) is not yet wired as one script — each package's
  checks were run individually, as shown above.
- `docker compose up --build` has not been executed (no Docker on this
  build machine).
