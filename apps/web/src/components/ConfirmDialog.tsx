"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "./ui";

interface ConfirmDialogProps {
  trigger: ReactNode;
  title: string;
  description: string;
  confirmLabel?: string;
  requireReason?: boolean;
  danger?: boolean;
  onConfirm: (reason: string) => Promise<void> | void;
}

export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel = "Confirm",
  requireReason = false,
  danger = true,
  onConfirm,
}: ConfirmDialogProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setReason("");
          setError(null);
        }
      }}
    >
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ink/40 data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-surface p-5 shadow-lg">
          <div className="flex items-start gap-3">
            {danger && (
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-danger/10 text-danger">
                <AlertTriangle className="h-5 w-5" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-base font-semibold text-ink">{title}</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted">{description}</Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button aria-label="Close" className="rounded p-1 text-muted hover:bg-bg">
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          {requireReason && (
            <div className="mt-4">
              <label htmlFor="confirm-reason" className="text-sm font-medium text-ink">
                Reason
              </label>
              <textarea
                id="confirm-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink focus:border-accent"
                placeholder="Why is this happening? (recorded in the audit log)"
              />
            </div>
          )}

          {error && <p className="mt-3 text-sm text-danger">{error}</p>}

          <div className="mt-5 flex justify-end gap-2">
            <Dialog.Close asChild>
              <Button variant="secondary" disabled={busy}>
                Cancel
              </Button>
            </Dialog.Close>
            <Button
              variant={danger ? "danger" : "primary"}
              disabled={busy || (requireReason && reason.trim().length === 0)}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await onConfirm(reason.trim());
                  setOpen(false);
                  setReason("");
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Something went wrong.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Working…" : confirmLabel}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
