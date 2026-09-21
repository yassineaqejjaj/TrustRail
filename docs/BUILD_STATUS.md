# TrustRail V1 build status

Last updated: 2026-09-21 (session 1, in progress)

Legend: `done` = implemented and covered by a passing test that was actually run. `partial` = implemented but missing a required test or edge case. `todo` = not started.

## Environment notes

- No Docker / Homebrew / system Postgres on the build machine. Using `embedded-postgres` (real Postgres 18 binaries, no Docker) for a genuine local/test database. See `docs/DECISIONS.md`.
- Docker Compose files are written as deliverables but `docker compose up --build` has not been executed on this machine — flagged, not silently claimed.

## Requirement checklist (V01–V15)

| ID | Capability | Status | Notes |
|---|---|---|---|
| V01 | Organization accounts, sessions, memberships, roles | todo | |
| V02 | Agent registry and revocable credentials | todo | |
| V03 | Human-to-agent and agent-to-agent delegation | todo | |
| V04 | Versioned deterministic policies | todo | |
| V05 | Enforcement gateway | todo | |
| V06 | Human approval queue | todo | |
| V07 | Transactional shared budgets and idempotency | todo | |
| V08 | Signed decision and execution receipts | todo | |
| V09 | Dashboard and action detail | todo | |
| V10 | Deterministic demo lab | todo | |
| V11 | TypeScript and Python SDKs | todo | |
| V12 | MCP tool adapter | todo | |
| V13 | Developer docs and local setup | todo | |
| V14 | YC demo materials and landing page | todo | |
| V15 | Observability and deployment package | todo | |

## Phase gates (spec §17)

| Phase | Gate | Status |
|---|---|---|
| 1. Foundation | Clean setup, login, org isolation, merchant idempotency tests pass | in progress |
| 2. Real protected action | Allowed/denied/concurrent/ambiguous-outcome integration tests pass | todo |
| 3. Review and evidence | Reviewer completes EUR 350 flow; altered receipt fails; replay blocked | todo |
| 4. Product interface | Required browser flows work with real persistent data | todo |
| 5. Developer adoption | Both SDKs + MCP adapter work without private knowledge | todo |
| 6. YC presentation | Clean checkout passes documented verification; demo repeatable | todo |

## Continuation checklist (if this session ends mid-build)

1. Read this file and `docs/DECISIONS.md` top to bottom.
2. Run `pnpm install` then `pnpm setup:local` to regenerate local env/keys if missing (idempotent, will not overwrite existing secrets).
3. Check the requirement table above for the first `todo`/`partial` row and resume there.
4. Re-run `pnpm verify` before continuing to confirm the last known-good state still holds.

## Session log

- 2026-09-21: Session started. Repository scaffolding in progress (Phase 1).
