# YC demo script (~2 minutes, two use cases)

All amounts and accounts are synthetic (a fictional merchant and a
fictional SaaS sandbox — no real money, no real customers). This script
maps directly onto real, working scenarios — see `pnpm demo:run <scenario>`
for the exact underlying calls, every one of which is covered by automated
tests (`apps/api/test/`, `packages/policy-engine/test/`).

The script covers **both** use cases on purpose: refunds alone would show
a working product, but showing the *same* grant/policy/receipt engine
enforce a second, structurally different domain (SaaS account management)
is the actual differentiated claim — that this is a general control plane
for delegated agent actions, not a refund tool. See
`docs/ROADMAP.md` item 10 for why this second use case was built.

## Setup (before recording)

```bash
pnpm setup:local && pnpm dev
pnpm demo:seed
```

Sign in to the dashboard as `owner@northstar.demo` (password printed by
`demo:seed`). Have a second browser/incognito window signed in as
`approver@northstar.demo` ready for the approval step. Both the merchant
and SaaS sandboxes start automatically with `pnpm dev`.

## Script

| Time | Action | Narration | Underlying scenario |
|---|---|---|---|
| 0–10s | Cold open on the dashboard, no scenario running yet | "Companies want AI agents to take real actions — refunds, account changes, purchases. Today they either trust the agent blindly or hand-build authorization plumbing per integration. TrustRail is the control plane in between." | — |
| 10–22s | `pnpm demo:run eur80_auto_refund` (or trigger from the Demo Lab page) | "First use case: a support agent issuing refunds through a synthetic merchant. This request is within its delegated limit — allowed, executed, and a signed receipt is recorded." | `eur80_auto_refund` |
| 22–32s | `pnpm demo:run eur700_denied` | "Ask for more than the grant allows, and it's blocked before the merchant ever sees the request — no merchant credential is ever exposed to the agent." | `eur700_denied` |
| 32–48s | Cut to a static slide/text of the mandate; no scenario run | "Here's the actual test: does the same engine generalize past refunds? Take a real mandate — 'prepare a new hire's arrival: create her access for 30 days, no admin rights, and buy at most €150 of licenses. Ask a human for any exception.' Refunds and this have nothing in common structurally." | — |
| 48–63s | `pnpm demo:run lea_onboarding_completed` | "One grant, two different action types — granting license credit and inviting a team member — both inside the mandate's limits. Same decision engine, same receipt format, a completely different downstream system." | `lea_onboarding_completed` |
| 63–75s | `pnpm demo:run lea_admin_invite_blocked` | "Now the agent tries to invite that same person as an admin — outside the mandate. Hard blocked, same as the refund cap was — no approval tier, no judgment call, just the limit a human already set." | `lea_admin_invite_blocked` |
| 75–90s | `pnpm demo:run subscription_plan_downgrade_approval`, then approve as the second reviewer | "And the human-approval flow generalizes too — downgrading a plan is allowed in principle, but always needs a person to confirm. Bound to this exact request; nothing rubber-stamps a different one later." | `subscription_plan_downgrade_approval` |
| 90–105s | Open either action's detail page; show the delegation chain; verify the receipt (Receipts page or `POST /v1/receipts/verify`) | "Every decision and execution — on either connector — is an independently verifiable, signed receipt. Anyone holding it can check it without trusting our dashboard." | `receipt_tamper_detected` (verify the *un*tampered half live; tampering is the automated-test half) |
| 105–115s | Show the SDK snippet (`docs/SDK_QUICKSTART.md`) | "Teams integrate once against one API. The dashboard, the SDKs, and the MCP adapter all call the same enforcement path — there's no separate 'trusted' surface to bypass." | — |
| 115–120s | Close on the product page's "Two use cases, one control model" section | "One control plane. Bounded, reviewable, provable — for whatever an agent needs to do next." | — |

## Honesty notes for whoever presents this

- Say "synthetic sandbox" / "fictional merchant" / "fictional SaaS account"
  out loud at least once each. Do not let "refund" or "account" alone imply
  a real payment processor or a real customer's data.
- Do not claim this prevents all prompt injection — say specifically that
  the policy engine ignores free text structurally, and that the
  `prompt_injection_deny` scenario (refund side) demonstrates one form of
  that, not a general injection-defense claim.
- Do not claim customers, revenue, or YC endorsement anywhere in the
  delivery. See `docs/YC_PRODUCT_BRIEF.md`'s placeholders for what's
  genuinely unvalidated.
- Do not claim TrustRail judges *whether* a plan change, a purchase, or a
  message is a good idea — say explicitly that it enforces limits a human
  already set, and escalates what falls outside them. This is the
  disclosed boundary from the product brief itself, not an oversight.
- If asked "does this stop a compromised agent," answer with the actual
  boundary from `docs/THREAT_MODEL.md`: it stops a compromised agent from
  *exceeding* its granted authority; it cannot stop misuse *within* that
  authority until a human revokes it.
- If time is short, the 32–90s block (the SaaS mandate) is the part to cut
  first for a shorter room, and the part to keep first for an audience
  that already trusts refunds are solvable — it's the generalization claim
  that differentiates.

## Timing rehearsal (2026-09-22)

The five scripted scenarios were run for real, in the order the script
uses them, against a freshly seeded local stack (`pnpm demo:seed` then
`pnpm demo:run <scenario>`), to confirm the ~120-second budget is
realistic and not aspirational:

| Scenario | Wall time | Result |
|---|---|---|
| `eur80_auto_refund` | 2.00s | PASS (ALLOW, succeeded) |
| `eur700_denied` | 1.94s | PASS (denied before reaching the merchant) |
| `lea_onboarding_completed` | 2.00s | PASS (grant_credit ALLOW, invite_user ALLOW) |
| `lea_admin_invite_blocked` | 1.72s | PASS (DENY, ROLE_NOT_ALLOWED) |
| `subscription_plan_downgrade_approval` | 1.53s | PASS (submitted + approved by an independent reviewer) |

Total CLI execution time across all five: ~9.2 seconds, against an
80-second on-script budget (10s–90s) — each `pnpm demo:run` invocation
here pays a few hundred milliseconds of process/sandbox-startup overhead
that a warm, already-running dev stack (as the live recording would use)
does not; the individual scenario steps themselves complete in
low-hundreds-of-milliseconds each, so the pacing above is dominated by
narration and dashboard clicks, not computation. This was **not** yet done
as an actual recorded take with a presenter narrating out loud; that
remains the one open item for V14.

## Appendix: short refund-only cut (~90 seconds)

For a shorter slot, or an audience where the SaaS generalization story is
out of scope, the original single-use-case script still works as-is:

| Time | Action | Narration | Underlying scenario |
|---|---|---|---|
| 0–15s | Show the Support Agent's grant and the published refund policy | "AI support agents can resolve refunds. Companies need to control what those agents can actually spend." | — |
| 15–30s | `pnpm demo:run eur80_auto_refund` | "This agent acts through a delegated permission. The refund succeeds and we record its result." | `eur80_auto_refund` |
| 30–45s | `pnpm demo:run eur700_denied` | "Even when the agent requests more, the gateway blocks the operation before the merchant receives it." | `eur700_denied` |
| 45–65s | `pnpm demo:run eur350_approval`, then approve as the second reviewer | "This amount needs a human. Approval applies only to this exact action." | `eur350_approval` |
| 65–80s | Open the action detail page; show the delegation chain; verify the receipt | "We can trace who authorized the agent and verify the recorded execution." | `receipt_tamper_detected` (verify the *un*tampered half live) |
| 80–90s | Show an SDK snippet; revoke the grant from the dashboard | "Teams integrate once. They can then change limits or stop future delegated actions centrally." | `root_revoked_denied` |

Timed for real on 2026-09-21: `eur80_auto_refund` 1.60s, `eur700_denied`
1.20s, `eur350_approval` 0.87s, `receipt_tamper_detected` 1.57s,
`root_revoked_denied` 1.33s — ~6.6s total against a 65-second budget.

## Backup footage

If recording live demo runs is impractical for a given audience,
prerecorded footage of the exact commands above is acceptable **only if
clearly labeled as prerecorded** — never presented as a live system when
it isn't.
