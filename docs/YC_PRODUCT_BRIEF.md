# TrustRail — one-page product brief

## Problem

Companies want AI agents to take real actions (starting with financial
operations like refunds) on their behalf, but have no enforceable way to
bound what an agent can actually do, require human review above a
threshold, or produce evidence of what happened after the fact. Today's
options are informal prompt-level guardrails (advisory only, easily
bypassed by a bug or a compromised model) or building custom authorization
plumbing per integration.

## Buyer and users

Buyer: engineering leader or head of AI at a company shipping a
customer-facing or internal agent. Daily users: the application engineer
wiring the integration, the support manager who owns the refund policy, and
the security/compliance reviewer who needs an audit trail.

## First use case

A customer-support agent that can issue refunds through a synthetic
merchant sandbox, constrained by a delegated grant (amount cap, daily
budget, approval threshold) and producing signed receipts of every decision
and execution. Money is not real in V1 — this validates the control and
evidence model before touching a live payment processor.

## Product (what actually exists today)

An enforcement gateway that owns the downstream (merchant) credential so an
agent cannot bypass it; a delegation model supporting human-to-agent and
agent-to-agent grants with strict subset/attenuation rules; versioned,
deterministic policies (no LLM judgment in the authorization path);
transactional shared budgets and idempotency safe under real concurrency;
signed decision and execution receipts (Ed25519, independently verifiable,
tamper-evident); a dashboard, TypeScript and Python SDKs, and an MCP
adapter, all calling the same API. Full status, including what is not yet
built: `docs/BUILD_STATUS.md`.

## What works (verified, not claimed)

All of the above is covered by automated tests run against a real
(non-mocked) PostgreSQL instance and a real HTTP merchant sandbox — see
`docs/TEST_REPORT.md` for actual commands and actual results, and the 12
scenarios in `docs/PRODUCT_SPEC.md` section 14, each passing via
`pnpm demo:run`.

## Alternatives

General identity/access platforms (Okta, Auth0-style) authenticate agents
but do not natively model per-action financial limits, shared delegated
budgets, or execution receipts. OAuth 2.0 Token Exchange (RFC 8693)
addresses delegation at the token layer; TrustRail's server-side grant
model is informed by it but does not claim conformance. Emerging
"agent control plane" companies (e.g. category peers surfaced in YC's own
company directory) overlap in problem space; no claim is made that this
space is unaddressed or that TrustRail is first.

## Differentiation hypothesis

The combination — delegation constraints *and* action-level enforcement
*and* human approval *and* shared budget accounting *and* portable signed
receipts, in one system with one API — rather than any single piece in
isolation. This is a hypothesis to validate with customers, not a
established claim.

## Business model (unvalidated)

Hypothesis: platform subscription plus usage-based pricing on protected
actions, enterprise deployment later. No price has been tested. No revenue.
`[revenue not provided]` `[pricing not validated]` `[market size not
estimated]`.

## Next validation steps

`[customer interviews not yet conducted]` — specifically: do target buyers
already have a workaround they consider adequate; who actually owns the
refund-limit decision inside a support org; is "TrustRail sits between our
agent and our payment processor" an acceptable integration shape, or does
it need to be a library instead of a gateway; what would make a security
reviewer trust a receipt over their own audit log.

## Founder

Yassine Aqejjaj, Head of AI at Devoteam Creative Tech, as provided by the
founder. TrustRail is built independently; no Devoteam sponsorship,
ownership transfer, or license to Devoteam internal code is implied or
granted.
