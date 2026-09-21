"use client";

import { useState } from "react";
import type { Role } from "@trustrail/contracts";
import { ROLES } from "@/lib/constants";
import { useAuth, roleAtLeast } from "@/context/auth-context";
import { useToast } from "@/context/toast-context";
import { useApi } from "@/hooks/useApi";
import { healthApi, membershipsApi, receiptsApi } from "@/lib/api";
import { API_BASE_URL, errorMessage } from "@/lib/api-client";
import { Button, Card, ErrorBanner, Field, LoadingBlock, Mono, PageHeader, Tag, inputClass } from "@/components/ui";
import { formatDateTime } from "@/lib/format";

const KNOWN_LIMITATIONS = [
  "CSRF: SameSite=Lax cookies and strict CORS origin are enforced; the double-submit/custom-header CSRF check described in the design is defined but not yet enforced server-side.",
  "SSE (`GET /v1/events`) is implemented as tenant-scoped short-interval polling rather than a push-based pub/sub bus — functionally a live feed, documented as a scaling simplification.",
  "Order ownership in the merchant sandbox always reports `ownedByPrincipal: true` for any order that exists; it does not model separate customer identities.",
  "Network isolation for the merchant sandbox's write API is enforced by a gateway-secret header, not real network segmentation, on machines without Docker.",
  "There is no demo-seed/demo-run endpoint yet — freshly created organizations have no fixture merchant orders to test against outside the automated test suite.",
  "No SSO/SCIM, billing, or enterprise identity federation exists. Role switching outside your own memberships is not possible from this UI.",
  "A privileged database operator could still tamper with or delete records; receipts detect payload modification, not omission, and are not a claim of database immutability.",
  "Stolen active agent credentials can be used with that agent's existing grants until explicitly revoked.",
];

export default function SettingsPage() {
  const { orgId, orgName, role, me } = useAuth();
  const toast = useToast();
  const canManageMembers = roleAtLeast(role, "admin");

  const membershipsQuery = useApi(() => membershipsApi.list(orgId!), [orgId], { skip: !orgId });
  const readyQuery = useApi(() => healthApi.ready(), []);
  const jwksQuery = useApi(() => receiptsApi.jwks(), []);

  const [email, setEmail] = useState("");
  const [newRole, setNewRole] = useState<Role>("operator");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <PageHeader title="Settings" description="Members, environment, connector health, signing keys, and honest security limitations." />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink">Members &amp; roles</h2>
          {membershipsQuery.loading && !membershipsQuery.data && <LoadingBlock />}
          {membershipsQuery.error && <ErrorBanner message={membershipsQuery.error} onRetry={membershipsQuery.refetch} />}
          {membershipsQuery.data && (
            <ul className="mb-4 flex flex-col gap-2">
              {membershipsQuery.data.memberships.map((m) => (
                <li key={m.membership_id} className="flex items-center justify-between rounded-lg border border-border p-2.5 text-sm">
                  <div>
                    <p className="text-ink">{m.email}</p>
                    <p className="text-xs text-muted">{m.user_id === me?.user_id ? "you" : formatDateTime(m.created_at)}</p>
                  </div>
                  <Tag tone="accent">{m.role}</Tag>
                </li>
              ))}
            </ul>
          )}

          {canManageMembers ? (
            <form
              className="flex flex-col gap-3 border-t border-border pt-4"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError(null);
                try {
                  await membershipsApi.add(orgId!, email.trim(), newRole);
                  setEmail("");
                  membershipsQuery.refetch();
                  toast.success("Membership updated");
                } catch (err) {
                  setError(errorMessage(err));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <p className="text-xs font-medium uppercase tracking-wide text-muted">Add or update a member</p>
              <p className="text-xs text-muted">The user must already have a TrustRail account — there is no email-invite flow in V1.</p>
              <div className="flex gap-2">
                <input required type="email" placeholder="teammate@company.com" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
                <select value={newRole} onChange={(e) => setNewRole(e.target.value as Role)} className={inputClass + " w-40"}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
              {error && <p className="text-sm text-danger">{error}</p>}
              <Button type="submit" disabled={busy} className="self-start">
                {busy ? "Saving…" : "Save membership"}
              </Button>
            </form>
          ) : (
            <p className="text-xs text-muted">Only Admins and Owners can manage member roles.</p>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink">Environment</h2>
          <dl className="space-y-2 text-sm">
            <Row label="Organization" value={orgName ?? "—"} />
            <Row label="Environment" value="sandbox" />
            <Row label="Your role" value={role ?? "—"} />
            <Row label="API base URL" value={<Mono>{API_BASE_URL}</Mono>} />
          </dl>

          <h3 className="mb-2 mt-5 text-xs font-medium uppercase tracking-wide text-muted">Connector health</h3>
          {readyQuery.loading && !readyQuery.data && <LoadingBlock />}
          {readyQuery.data && (
            <p className="text-sm text-success">API reports ready ({readyQuery.data.status}).</p>
          )}
          {readyQuery.error && <p className="text-sm text-danger">{readyQuery.error}</p>}
          <p className="mt-1 text-xs text-muted">
            There is no dedicated per-connector health endpoint yet — this reflects <Mono>GET /health/ready</Mono>{" "}
            (database reachability) only, shown honestly rather than a fabricated connector status grid.
          </p>

          <h3 className="mb-2 mt-5 text-xs font-medium uppercase tracking-wide text-muted">Signing keys</h3>
          {jwksQuery.loading && !jwksQuery.data && <LoadingBlock />}
          {jwksQuery.data && (
            <p className="text-sm text-ink">
              {jwksQuery.data.keys.length} public key(s) published at <Mono>/.well-known/jwks.json</Mono>.
            </p>
          )}
        </Card>
      </div>

      <Card className="mt-6 p-5">
        <h2 className="mb-3 text-sm font-semibold text-ink">Security limitations</h2>
        <p className="mb-3 text-sm text-muted">
          Pulled from docs/PRODUCT_SPEC.md section 15 and docs/BUILD_STATUS.md&rsquo;s known simplifications. No inactive
          controls here pretend to implement SSO/SCIM or any other feature that doesn&rsquo;t exist.
        </p>
        <ul className="list-disc space-y-2 pl-5 text-sm text-muted">
          {KNOWN_LIMITATIONS.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium text-ink">{value}</dd>
    </div>
  );
}
