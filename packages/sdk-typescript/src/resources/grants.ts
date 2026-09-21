import type { HttpClient } from "../http.js";
import type { DelegateGrantInput } from "../types.js";

export interface GrantResult {
  grant_id: string;
}

export class GrantsResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Issues a grant. When `parentGrantId` is set, this must be called with
   * the parent grant's own agent credential (the SDK client must be
   * constructed with that agent's API key) -- "the authenticated parent
   * subject must issue the child" (docs/PRODUCT_SPEC.md section 5). Root
   * grants require a user session, which this API-key-based SDK does not
   * carry; issuing a root grant is an Owner/Admin dashboard action, not an
   * SDK one, and calling this for a root grant will fail with 403.
   *
   * Not idempotent -- there is no idempotency key on this endpoint, so
   * this method is never automatically retried on a network error. Retry
   * only after confirming (e.g. via a grants list) that the first attempt
   * did not already succeed.
   */
  async delegate(input: DelegateGrantInput): Promise<GrantResult> {
    return this.http.request<GrantResult>({
      method: "POST",
      path: "/v1/grants",
      body: {
        environment: input.environment,
        principal_id: input.principalId,
        subject_agent_id: input.subjectAgentId,
        parent_grant_id: input.parentGrantId,
        allowed_actions: input.allowedActions,
        allowed_resource_ids: input.allowedResourceIds,
        unrestricted_resources: input.unrestrictedResources ?? false,
        allowed_connector_ids: input.allowedConnectorIds,
        currency: input.currency,
        max_amount_minor: input.maxAmountMinor,
        root_budget_limit_minor: input.rootBudgetLimitMinor ?? null,
        child_budget_limit_minor: input.childBudgetLimitMinor ?? null,
        valid_from: input.validFrom ?? null,
        expires_at: input.expiresAt,
        delegation_allowed: input.delegationAllowed ?? false,
        max_remaining_depth: input.maxRemainingDepth,
      },
    });
  }
}
