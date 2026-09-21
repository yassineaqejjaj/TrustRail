# Threat model

Scope: TrustRail V1 as built (`docs/BUILD_STATUS.md`), protecting a single
action type (`refund.create`) against a synthetic merchant sandbox. This is
not an independent security audit and does not claim to be one.

## Actors and what they can and cannot do

### A malicious or compromised agent (holds a valid, active credential)

**Can:** submit actions using every grant it currently holds, up to their
exact limits, until a human revokes the credential or the grant. Attempt
arbitrary free-text "reason" fields (prompt-injection style overrides) —
`packages/policy-engine` never reads free text, structurally; see the
`prompt_injection_deny` test in `packages/policy-engine/test/evaluate.test.ts`
and the same-named demo scenario. Attempt to widen its own authority by
proposing a child grant that exceeds its parent's scope — rejected server-side
by `packages/policy-engine/src/chain.ts#validateChain`, re-checked at
creation time (`apps/api/src/routes/grants.ts`) independent of anything the
UI would have prevented.

**Cannot:** reach the merchant sandbox's write endpoint directly (it only
accepts the gateway's shared secret, which the agent never receives — see
`apps/api/src/gateway/merchantSandboxConnector.ts`); read or affect another
organization's data (RLS, see `docs/ARCHITECTURE.md`); supply its own
`actor_id`/`principal_id`/`role`/`allowed`/destination fields (the action
request schema is `.strict()` and rejects unknown fields —
`packages/contracts/src/actions.ts`); reuse an idempotency key with a
different payload to get a second effect (409, `apps/api/src/gateway/
idempotency.ts`).

**Residual risk:** a stolen *active* credential can do everything the
legitimate agent could do until someone revokes it. Detection of anomalous
usage (e.g. sudden burst of refund requests) is not implemented in V1 — see
`docs/ROADMAP.md`.

### Forged identity fields in a request

Every action request is authenticated by a bearer credential resolved
server-side to exactly one agent/organization; nothing about "who is
acting" is trusted from the request body (spec section 11). The
policy-engine test suite includes an explicit check
(`packages/contracts/test/schemas.test.ts`) that a request carrying
`actor_id`, `principal_id`, `allowed`, `role`, or `policy_version` is
rejected outright, not silently stripped.

### Stolen bearer credentials

Agent credentials are 256-bit random values; only a SHA-256 digest is
stored (`apps/api/src/auth/apiKeys.ts`), so a database leak alone does not
expose usable secrets. Session cookies are HttpOnly and hashed the same way.
**Residual risk:** SHA-256 (not a slow hash) is used for credential/session
digests because these are high-entropy random values, not
low-entropy passwords — a stolen digest cannot be brute-forced back to the
secret, unlike a stolen password hash. If this assumption is ever wrong for
a given credential format, that credential's security depends entirely on
transport confidentiality (TLS) and prompt revocation.

### Prompt injection

Explicitly not "solved." `docs/PRODUCT_SPEC.md` requires only that free text
never *alters policy evaluation* — verified structurally (the evaluator has
no code path that reads any string field except IDs it validates against
known values) and behaviorally (the `prompt_injection_deny` scenario). An
agent that is itself compromised into deciding to *submit* a disallowed
request still gets a real DENY; TrustRail does not and cannot prevent a
compromised agent from making the attempt, only from having it succeed.

### Broader child grants

Covered above under "malicious agent." The same check applies whether the
issuer is malicious or simply buggy.

### Cross-tenant object access

Covered under RLS in `docs/ARCHITECTURE.md`. Verified by
`apps/api/test/gateway.integration.test.ts`'s "tenant isolation" tests
(cannot read another org's agents, including by guessed ID — 404, not 403,
so existence isn't leaked either).

### Request substitution after approval

An approval is bound to the exact canonical request hash, the grant chain,
and the policy version/hash at request time (spec section 8). If the
underlying action, amount, resource, or the active policy changes before a
reviewer decides, the resume path re-evaluates from scratch
(`apps/api/src/gateway/approvalResume.ts`) rather than trusting the stale
approval; a policy version mismatch is treated as an expired approval,
requiring resubmission rather than silently reusing an old decision.

### Replay

An idempotency key scoped to (organization, actor, key) with a payload-hash
check makes replaying the exact same request a no-op that returns the
original result, never a second effect. Replaying with a *different*
payload under the same key is a 409, not a silent overwrite. See the
`idempotent_replay` and `idempotency_conflict` demo scenarios and
integration tests.

### Concurrency / overspend

Verified with real concurrent requests against a real Postgres instance
(not mocked) at three different layers: the merchant sandbox's own
row-locked remaining-balance check
(`apps/merchant-sandbox/src/refund-logic.ts`, its own test: exactly 3 of 8
concurrent requests succeed against a fixed order balance), TrustRail's own
grant/policy budget reservation (`apps/api/src/gateway/budget.ts`, its own
integration test: exactly 3 of 6 succeed against a fixed daily budget), and
the demo lab's `concurrent_budget_limit` scenario, which exercises both
through the full stack.

### Connector timeout / ambiguous outcome

An action whose dispatch call times out is marked `unknown`, and its budget
reservation is deliberately **not** released — spec section 7: "Never free
uncertain spending just because a worker lease expires." Reconciliation
retries the same connector idempotency key until the merchant's own
idempotency guarantee resolves the ambiguity one way or the other. Verified
by the `connector_timeout_reconciled` demo scenario using a deterministic
fault-injection wrapper (`apps/api/src/demo/faultInjectingConnector.ts`)
that only ever fakes the connector's *response*, never the gateway's
handling of it.

### Key compromise

If a signing key's private material is compromised, mark it `revoked` in
the `signing_keys` table (not deleted, so historical receipts can still be
inspected) and rotate to a new key (`docs/OPERATIONS.md`). Verification
reports `key_status` independent of `signature_valid` — a revoked key's
past signatures still cryptographically verify (the math doesn't change),
but the caller is told not to treat them as currently trustworthy evidence
of an *ongoing* guarantee. **Residual risk:** revocation only affects future
trust decisions made by verifiers that re-check key status; it cannot
retroactively invalidate a receipt's cryptographic validity, because that
is mathematically what "signature" means. Offline historical verification
of an old receipt cannot prove the key was safe *at the time* it signed
that receipt, only that whoever held the key then produced this exact bytes.

### A privileged database operator

Documented, not defended against: receipts and audit events are stored
"append-only" only in the sense that the running application never issues
UPDATE/DELETE against them. A superuser or a database administrator with
direct access could still alter or delete rows. TrustRail does not claim
database immutability and does not claim to detect such tampering — an
independent, exported copy of a receipt (`GET /v1/receipts/:id`, downloaded
and kept by the recipient) is the actual tamper-evidence mechanism: it can
be verified independently of TrustRail's own database at any later point.

## What a receipt does and does not prove

A receipt proves that TrustRail recorded a specific decision/outcome, with a
signature that would break if that record were altered, and that the
signature was made with a key TrustRail's issuer configuration recognizes.
It does **not** prove: that the recorded outcome corresponds to objective
reality outside TrustRail's own records (TrustRail trusts its connector's
report of what happened); that a human was present or consented (a
receipt's `principal_id` names an accountable principal, not a proof of
that person's real-world action); that the signing key was never
compromised at any point in its history; or that any future action will be
handled consistently with a past one (each decision is evaluated fresh
against the state at that time).

## Out of scope for V1 (see docs/ROADMAP.md for why)

Cross-company federation, verified human presence, legal identity
verification, global agent reputation, hardware-backed keys, guaranteed
prevention of prompt injection, autonomous policy generation, multi-region
consistency, and anomaly/abuse detection on agent behavior.
