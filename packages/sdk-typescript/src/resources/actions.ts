import type { HttpClient } from "../http.js";
import { TrustRailTimeoutError } from "../errors.js";
import { TERMINAL_EXECUTION_STATES, type ExecuteActionInput, type TrustRailAction } from "../types.js";

export interface WaitOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export class ActionsResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Executes a protected action. Retries once on a network error or
   * timeout, always with the same idempotency key the caller supplied --
   * "never generate a new key after an ambiguous timeout"
   * (docs/PRODUCT_SPEC.md section 12). If this call itself times out, the
   * request may or may not have reached the server; call `get`/`wait` with
   * the same idempotency key's resulting action ID once you have it, or
   * resubmit with the SAME idempotencyKey (never a new one) to find out.
   */
  async execute(input: ExecuteActionInput): Promise<TrustRailAction> {
    return this.http.request<TrustRailAction>({
      method: "POST",
      path: "/v1/actions",
      body: {
        grant_id: input.grantId,
        connector_id: input.connectorId,
        action: input.action,
        resource_id: input.resourceId,
        arguments: input.arguments,
      },
      headers: { "idempotency-key": input.idempotencyKey },
      retries: 1,
      timeoutMs: 15_000,
    });
  }

  async get(actionId: string): Promise<TrustRailAction> {
    return this.http.request<TrustRailAction>({ method: "GET", path: `/v1/actions/${encodeURIComponent(actionId)}` });
  }

  /**
   * Polls until the action reaches a terminal execution state
   * (succeeded/failed/denied/cancelled/expired) or `timeoutMs` elapses.
   * Callers must handle every terminal state explicitly -- there is no
   * single "success" boolean, because ALLOW+succeeded, DENY, and
   * REQUIRE_APPROVAL are all valid, different outcomes.
   */
  async wait(actionId: string, options: WaitOptions = {}): Promise<TrustRailAction> {
    const timeoutMs = options.timeoutMs ?? 30_000;
    const pollIntervalMs = options.pollIntervalMs ?? 1_000;
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      const action = await this.get(actionId);
      if (TERMINAL_EXECUTION_STATES.includes(action.execution_state)) {
        return action;
      }
      if (Date.now() >= deadline) {
        throw new TrustRailTimeoutError(`action ${actionId} did not reach a terminal state within ${timeoutMs}ms (last state: ${action.execution_state})`);
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }
}
