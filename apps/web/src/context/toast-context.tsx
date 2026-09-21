"use client";

import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

type ToastKind = "success" | "error" | "info";

interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  description?: string;
}

interface ToastContextValue {
  push: (kind: ToastKind, title: string, description?: string) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let idCounter = 0;

const KIND_STYLES: Record<ToastKind, { border: string; icon: ReactNode }> = {
  success: { border: "border-l-success", icon: <CheckCircle2 className="h-5 w-5 text-success shrink-0" /> },
  error: { border: "border-l-danger", icon: <AlertTriangle className="h-5 w-5 text-danger shrink-0" /> },
  info: { border: "border-l-accent", icon: <Info className="h-5 w-5 text-accent shrink-0" /> },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, title: string, description?: string) => {
      const id = ++idCounter;
      setToasts((prev) => [...prev, { id, kind, title, description }]);
      setTimeout(() => dismiss(id), 6000);
    },
    [dismiss]
  );

  const value: ToastContextValue = {
    push,
    success: (title, description) => push("success", title, description),
    error: (title, description) => push("error", title, description),
    info: (title, description) => push("info", title, description),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2"
        role="region"
        aria-label="Notifications"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`flex items-start gap-3 rounded-lg border border-border border-l-4 ${KIND_STYLES[t.kind].border} bg-surface p-3 shadow-lg`}
          >
            {KIND_STYLES[t.kind].icon}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">{t.title}</p>
              {t.description && <p className="mt-0.5 text-sm text-muted break-words">{t.description}</p>}
            </div>
            <button
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss notification"
              className="shrink-0 rounded p-0.5 text-muted hover:bg-bg hover:text-ink"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
