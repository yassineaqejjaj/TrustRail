"use client";

import { useAuth } from "@/context/auth-context";
import { useApi } from "@/hooks/useApi";
import { agentsApi, grantsApi } from "@/lib/api";
import { API_BASE_URL } from "@/lib/api-client";
import { Card, CopyButton, LoadingBlock, Mono, PageHeader, Tag } from "@/components/ui";

const ENDPOINTS: { method: string; path: string; body: string }[] = [
  { method: "GET", path: "/v1/me", body: "Current account, memberships, and role per organization." },
  { method: "POST", path: "/v1/organizations", body: "Create an organization; caller becomes Owner. Auto-seeds a default sandbox policy." },
  { method: "GET/POST", path: "/v1/agents", body: "List or register agents (Operator+)." },
  { method: "POST", path: "/v1/agents/:id/credentials", body: "Create/rotate a credential. Secret shown once." },
  { method: "POST", path: "/v1/credentials/:id/revoke", body: "Revoke a credential immediately." },
  { method: "GET/POST", path: "/v1/grants", body: "List grants, or issue a root grant (session, Owner/Admin) or child grant (agent bearer)." },
  { method: "POST", path: "/v1/grants/:id/revoke", body: "Revoke a grant and its descendants' effective authority." },
  { method: "GET/POST", path: "/v1/policies", body: "List policy bundles, or create a draft (Admin+)." },
  { method: "POST", path: "/v1/policies/:id/versions", body: "Save an immutable draft version." },
  { method: "POST", path: "/v1/policies/:id/publish", body: "Publish a version with `expected_revision` optimistic locking." },
  { method: "POST", path: "/v1/simulations", body: "Predict an outcome. No writes, no reservation." },
  { method: "POST", path: "/v1/actions", body: "Authorize + execute a protected action (agent bearer + Idempotency-Key)." },
  { method: "GET", path: "/v1/actions", body: "Paginated, filterable action list." },
  { method: "GET", path: "/v1/actions/:id", body: "Full action detail: decision, execution state, chain, receipts." },
  { method: "GET", path: "/v1/approvals", body: "Reviewer's queue (Approver+)." },
  { method: "POST", path: "/v1/approvals/:id/approve", body: "Approve exactly one pending request." },
  { method: "POST", path: "/v1/approvals/:id/reject", body: "Reject exactly one pending request." },
  { method: "GET", path: "/v1/receipts/:id", body: "Authorized receipt retrieval (session + org header)." },
  { method: "POST", path: "/v1/receipts/verify", body: "Unauthenticated. Verify a JWS against TrustRail's own keys." },
  { method: "GET", path: "/.well-known/jwks.json", body: "Public signing keys." },
  { method: "GET", path: "/v1/metrics/summary", body: "Real operational aggregates for this organization." },
];

export default function DevelopersPage() {
  const { orgId } = useAuth();
  const agentsQuery = useApi(() => agentsApi.list(orgId!), [orgId], { skip: !orgId });
  const grantsQuery = useApi(() => grantsApi.list(orgId!), [orgId], { skip: !orgId });

  const agent = agentsQuery.data?.agents[0];
  const grant = grantsQuery.data?.grants.find((g) => (agent ? g.subject_agent_id === agent.agent_id : true));

  const curlSample = `curl -X POST ${API_BASE_URL}/v1/actions \\
  -H "Authorization: Bearer <AGENT_API_KEY>" \\
  -H "Idempotency-Key: demo-refund-001" \\
  -H "Content-Type: application/json" \\
  -d '{
    "grant_id": "${grant?.grant_id ?? "grant_xxx"}",
    "connector_id": "merchant_sandbox",
    "action": "refund.create",
    "resource_id": "order_demo_101",
    "arguments": { "amount_minor": 8000, "currency": "EUR", "reason": "Customer return" }
  }'`;

  const jsSample = `import { TrustRail } from "@trustrail/sdk"; // in development — see docs/SDK_QUICKSTART.md

const client = new TrustRail({ baseUrl: "${API_BASE_URL}", apiKey: process.env.TRUSTRAIL_AGENT_KEY });

const action = await client.actions.execute({
  grantId: "${grant?.grant_id ?? "grant_xxx"}",
  connectorId: "merchant_sandbox",
  action: "refund.create",
  resourceId: "order_demo_101",
  arguments: { amount_minor: 8000, currency: "EUR", reason: "Customer return" },
  idempotencyKey: "demo-refund-001",
});`;

  return (
    <div>
      <PageHeader title="Developers" description="REST reference, copyable samples, and MCP setup." />

      <Card className="mb-6 p-5">
        <h2 className="mb-2 text-sm font-semibold text-ink">Your sandbox context</h2>
        {agentsQuery.loading && !agentsQuery.data ? (
          <LoadingBlock />
        ) : agent ? (
          <p className="text-sm text-muted">
            Agent <Mono>{agent.agent_id}</Mono> ({agent.name}){" "}
            {grant ? (
              <>
                · grant <Mono>{grant.grant_id}</Mono>
              </>
            ) : (
              "· no grant yet"
            )}
            . The secret itself is never re-shown after creation — replace <Mono>&lt;AGENT_API_KEY&gt;</Mono> with a
            freshly rotated credential from the Agents page.
          </p>
        ) : (
          <p className="text-sm text-muted">Register an agent to see real, non-secret IDs substituted into these samples.</p>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">curl</h2>
            <CopyButton value={curlSample} />
          </div>
          <pre className="overflow-x-auto rounded-lg bg-sidebar p-4 text-[12px] text-slate-100 mono">{curlSample}</pre>
        </Card>
        <Card className="p-5">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">TypeScript</h2>
            <CopyButton value={jsSample} />
          </div>
          <pre className="overflow-x-auto rounded-lg bg-sidebar p-4 text-[12px] text-slate-100 mono">{jsSample}</pre>
        </Card>
      </div>

      <Card className="mt-6 p-5">
        <h2 className="mb-3 text-sm font-semibold text-ink">REST reference</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="py-2 pr-4 font-medium">Method</th>
                <th className="py-2 pr-4 font-medium">Path</th>
                <th className="py-2 font-medium">Behavior</th>
              </tr>
            </thead>
            <tbody>
              {ENDPOINTS.map((e) => (
                <tr key={e.path + e.method} className="border-b border-border last:border-0">
                  <td className="py-2 pr-4">
                    <Tag tone="accent">{e.method}</Tag>
                  </td>
                  <td className="py-2 pr-4">
                    <Mono>{e.path}</Mono>
                  </td>
                  <td className="py-2 text-muted">{e.body}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="mt-6 p-5">
        <h2 className="mb-2 text-sm font-semibold text-ink">MCP tool adapter</h2>
        <p className="text-sm text-muted">
          A local stdio MCP adapter exposing <Mono>get_order</Mono>, <Mono>request_refund</Mono>, and{" "}
          <Mono>get_action_status</Mono> tools — backed by a configured agent credential and grant — is planned but not
          yet built (see docs/BUILD_STATUS.md, V12). This page will carry real configuration instructions once it
          ships; no commands are fabricated here in the meantime.
        </p>
        <Tag tone="muted">Coming soon</Tag>
      </Card>
    </div>
  );
}
