# Support agent example (Python)

Mirrors `examples/support-agent-ts`. Uses `sdk/python`'s package directly
by relative path rather than requiring a separate install step.

```bash
cd sdk/python && python3 -m venv .venv && source .venv/bin/activate && pip install -e . && cd -

# From the repo root, with pnpm setup:local && pnpm dev already running,
# and pnpm demo:seed run at least once:
TRUSTRAIL_API_KEY=<Support Agent secret from pnpm demo:seed> \
TRUSTRAIL_GRANT_ID=<root grant id from pnpm demo:seed> \
sdk/python/.venv/bin/python examples/support-agent-python/support_agent.py
```
