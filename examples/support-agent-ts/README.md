# Support agent example (TypeScript)

Runs without any LLM provider. See `src/index.ts`'s module docstring for
why: the deterministic gateway decides ALLOW/DENY/REQUIRE_APPROVAL, never
the model.

```bash
# From the repo root, with pnpm setup:local && pnpm dev already running,
# and pnpm demo:seed run at least once:
TRUSTRAIL_API_KEY=<Support Agent secret from pnpm demo:seed> \
TRUSTRAIL_GRANT_ID=<root grant id from pnpm demo:seed> \
pnpm --filter support-agent-ts-example run start
```
