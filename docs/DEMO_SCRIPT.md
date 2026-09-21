# 90-second demo script

All amounts are synthetic (a fictional merchant sandbox). This script maps
directly onto real, working scenarios — see `pnpm demo:run <scenario>` for
the exact underlying calls, all of which are covered by automated tests.

## Setup (before recording)

```bash
pnpm setup:local && pnpm dev
pnpm demo:seed
```

Sign in to the dashboard as `owner@northstar.demo` (password printed by
`demo:seed`). Have a second browser/incognito window signed in as
`approver@northstar.demo` ready for the approval step.

## Script

| Time | Action | Narration | Underlying scenario |
|---|---|---|---|
| 0–15s | Show the Support Agent's grant and the published refund policy | "AI support agents can resolve refunds. Companies need to control what those agents can actually spend." | — |
| 15–30s | `pnpm demo:run eur80_auto_refund` (or trigger from the Demo Lab page) | "This agent acts through a delegated permission. The refund succeeds and we record its result." | `eur80_auto_refund` |
| 30–45s | `pnpm demo:run eur700_denied` | "Even when the agent requests more, the gateway blocks the operation before the merchant receives it." | `eur700_denied` |
| 45–65s | `pnpm demo:run eur350_approval`, then approve as the second reviewer | "This amount needs a human. Approval applies only to this exact action." | `eur350_approval` |
| 65–80s | Open the action detail page; show the delegation chain; verify the receipt (paste it into the Receipts page, or `POST /v1/receipts/verify`) | "We can trace who authorized the agent and verify the recorded execution." | `receipt_tamper_detected` (verify the *un*tampered half live; tampering is the automated-test half) |
| 80–90s | Show an SDK snippet (`docs/SDK_QUICKSTART.md`); revoke the grant from the dashboard | "Teams integrate once. They can then change limits or stop future delegated actions centrally." | `root_revoked_denied` |

## Honesty notes for whoever presents this

- Say "synthetic sandbox" or "fictional merchant" out loud at least once.
  Do not let "refund" alone imply real money.
- Do not claim this prevents all prompt injection — say specifically that
  the policy engine ignores free text structurally, and that the
  `prompt_injection_deny` scenario demonstrates one form of that, not a
  general injection-defense claim.
- Do not claim customers, revenue, or YC endorsement anywhere in the
  delivery. See `docs/YC_PRODUCT_BRIEF.md`'s placeholders for what's
  genuinely unvalidated.
- If asked "does this stop a compromised agent," answer with the actual
  boundary from `docs/THREAT_MODEL.md`: it stops a compromised agent from
  *exceeding* its granted authority; it cannot stop misuse *within* that
  authority until a human revokes it.

## Timing rehearsal (2026-09-21)

The five underlying scenarios were run for real, in the order the script uses
them, against a freshly seeded stack (`pnpm demo:seed` then `pnpm demo:run
<scenario>`), to confirm the 90-second budget is realistic and not aspirational:

| Scenario | Wall time | Result |
|---|---|---|
| `eur80_auto_refund` | 1.60s | PASS (ALLOW, succeeded) |
| `eur700_denied` | 1.20s | PASS (denied before reaching the merchant) |
| `eur350_approval` | 0.87s | PASS (submitted + approved by an independent reviewer) |
| `receipt_tamper_detected` | 1.57s | PASS (original verifies, tampered copy fails) |
| `root_revoked_denied` | 1.33s | PASS (revoke, denied dispatch, grant restored) |

Total CLI execution time across all five: ~6.6 seconds, against a 65-second
on-script budget (15s–80s) — the script's pacing is dominated by narration
and dashboard clicks, not computation, so the timing in the table above is
achievable live. This was **not** yet done as an actual recorded take with a
presenter narrating out loud; that remains the one open item for V14.

## Backup footage

If recording live demo runs is impractical for a given audience, prerecorded
footage of the exact commands above is acceptable **only if clearly labeled
as prerecorded** — never presented as a live system when it isn't.
