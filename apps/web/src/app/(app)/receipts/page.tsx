"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Download, FileCheck2, ShieldAlert, ShieldCheck, XCircle } from "lucide-react";
import { useAuth } from "@/context/auth-context";
import { useApi } from "@/hooks/useApi";
import { actionsApi, receiptsApi } from "@/lib/api";
import { errorMessage } from "@/lib/api-client";
import { Button, Card, EmptyState, ErrorBanner, LoadingBlock, Mono, PageHeader, Tag } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import type { ReceiptVerificationResult } from "@/lib/types";

function TrafficLight({ ok, label }: { ok: boolean | null; label: string }) {
  return (
    <div className={`flex items-center gap-2 rounded-lg border p-3 ${ok === null ? "border-border bg-bg" : ok ? "border-success/30 bg-success/5" : "border-danger/30 bg-danger/5"}`}>
      {ok === null ? (
        <ShieldAlert className="h-5 w-5 text-muted" />
      ) : ok ? (
        <CheckCircle2 className="h-5 w-5 text-success" />
      ) : (
        <XCircle className="h-5 w-5 text-danger" />
      )}
      <div>
        <p className={`text-sm font-medium ${ok === null ? "text-muted" : ok ? "text-success" : "text-danger"}`}>{label}</p>
        <p className="text-xs text-muted">{ok === null ? "not checked yet" : ok ? "passed" : "failed"}</p>
      </div>
    </div>
  );
}

export default function ReceiptsPage() {
  const { orgId } = useAuth();
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    setOpenId(new URLSearchParams(window.location.search).get("open"));
  }, []);

  const [jws, setJws] = useState("");
  const [result, setResult] = useState<ReceiptVerificationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const recentActions = useApi(() => actionsApi.list(orgId!, { limit: 50 }), [orgId], { skip: !orgId, pollMs: 10000 });

  async function runVerify(value: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await receiptsApi.verify(value);
      setResult(res);
    } catch (err) {
      setError(errorMessage(err));
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!openId || !orgId) return;
    receiptsApi
      .get(orgId, openId)
      .then((r) => {
        setJws(r.jws);
        void runVerify(r.jws);
      })
      .catch(() => {
        /* ignore — receipt may belong to a different action than expected */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId, orgId]);

  return (
    <div>
      <PageHeader
        title="Receipts"
        description="Paste or upload a receipt's JWS to verify it independently. Signature validity, issuer trust, and recorded outcome are reported separately — never collapsed into a single checkmark."
      />

      <Card className="p-5">
        <div className="flex flex-col gap-3">
          <textarea
            value={jws}
            onChange={(e) => setJws(e.target.value)}
            placeholder="eyJhbGciOiJFZERTQSIs..."
            rows={4}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs mono focus:border-accent"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={busy || !jws.trim()} onClick={() => runVerify(jws.trim())}>
              {busy ? "Verifying…" : "Verify"}
            </Button>
            <Button variant="secondary" type="button" onClick={() => fileRef.current?.click()}>
              Upload file
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".jws,.json,.txt"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const text = (await file.text()).trim();
                setJws(text);
                void runVerify(text);
              }}
            />
            <Button
              variant="ghost"
              type="button"
              onClick={() => {
                setJws("");
                setResult(null);
                setError(null);
              }}
            >
              Clear
            </Button>
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-danger">{error}</p>}

        {result && (
          <div className="mt-5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <TrafficLight ok={result.signature_valid} label="Signature valid" />
              <TrafficLight ok={result.issuer_trusted} label="Issuer trusted" />
              <TrafficLight ok={result.payload ? result.payload.outcome !== null : null} label="Recorded outcome" />
            </div>
            {result.errors.length > 0 && (
              <div className="mt-3 rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
                {result.errors.join("; ")}
              </div>
            )}
            {result.payload && (
              <details className="mt-3" open>
                <summary className="cursor-pointer text-xs font-medium text-muted">Decoded payload</summary>
                <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-sidebar p-3 text-[11px] text-slate-100 mono">
                  {JSON.stringify(result.payload, null, 2)}
                </pre>
              </details>
            )}
            <p className="mt-2 text-xs text-muted">
              Key status: {result.key_status} {result.key_id ? <>· <Mono>{result.key_id}</Mono></> : null}
            </p>
          </div>
        )}
      </Card>

      <div className="mt-8">
        <h2 className="mb-3 text-sm font-semibold text-ink">Recent actions with receipts</h2>
        {recentActions.loading && !recentActions.data && <LoadingBlock />}
        {recentActions.error && <ErrorBanner message={recentActions.error} onRetry={recentActions.refetch} />}
        {recentActions.data && recentActions.data.actions.length === 0 && (
          <EmptyState icon={<FileCheck2 className="h-6 w-6" />} title="No actions recorded yet" />
        )}
        {recentActions.data && recentActions.data.actions.length > 0 && (
          <div className="flex flex-col gap-2">
            {recentActions.data.actions.map((a) => (
              <ReceiptRow key={a.action_id} orgId={orgId!} actionId={a.action_id} resourceId={a.resource_id} onVerify={(jwsValue) => { setJws(jwsValue); void runVerify(jwsValue); window.scrollTo({ top: 0, behavior: "smooth" }); }} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ReceiptRow({
  orgId,
  actionId,
  resourceId,
  onVerify,
}: {
  orgId: string;
  actionId: string;
  resourceId: string;
  onVerify: (jws: string) => void;
}) {
  const detail = useApi(() => actionsApi.get(orgId, actionId), [orgId, actionId]);
  const receipts = detail.data?.receipts ?? [];
  if (detail.data && receipts.length === 0) return null;

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link href={`/actions/${actionId}`} className="font-medium text-ink hover:text-accent">
            <Mono>{resourceId}</Mono>
          </Link>
          <p className="text-xs text-muted">{actionId}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {receipts.map((r) => (
            <ReceiptAction key={r.receipt_id} orgId={orgId} receiptId={r.receipt_id} type={r.receipt_type} createdAt={r.created_at} onVerify={onVerify} />
          ))}
        </div>
      </div>
    </Card>
  );
}

function ReceiptAction({
  orgId,
  receiptId,
  type,
  createdAt,
  onVerify,
}: {
  orgId: string;
  receiptId: string;
  type: string;
  createdAt: string;
  onVerify: (jws: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-border px-2 py-1.5">
      <Tag>{type}</Tag>
      <span className="text-xs text-muted">{formatDateTime(createdAt)}</span>
      <button
        disabled={busy}
        className="rounded p-1 text-muted hover:bg-bg hover:text-accent"
        aria-label="Verify"
        onClick={async () => {
          setBusy(true);
          try {
            const r = await receiptsApi.get(orgId, receiptId);
            onVerify(r.jws);
          } finally {
            setBusy(false);
          }
        }}
      >
        <ShieldCheck className="h-4 w-4" />
      </button>
      <button
        disabled={busy}
        className="rounded p-1 text-muted hover:bg-bg hover:text-accent"
        aria-label="Download"
        onClick={async () => {
          setBusy(true);
          try {
            const r = await receiptsApi.get(orgId, receiptId);
            const blob = new Blob([JSON.stringify({ jws: r.jws, payload: r.payload }, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${receiptId}.json`;
            a.click();
            URL.revokeObjectURL(url);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Download className="h-4 w-4" />
      </button>
    </div>
  );
}
