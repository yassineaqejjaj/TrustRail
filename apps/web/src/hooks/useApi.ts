"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage, isApiError } from "@/lib/api-client";

interface UseApiOptions {
  /** Re-fetch every N ms (e.g. for a lightweight "live" feed via polling instead of SSE/EventSource — see Activity/Approvals pages). */
  pollMs?: number;
  /** Skip the fetch entirely (e.g. until an orgId is known). */
  skip?: boolean;
}

interface UseApiResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  requestId: string | undefined;
  refetch: () => void;
  /** True once at least one fetch attempt has completed, success or failure. */
  settled: boolean;
}

/**
 * Fetches `fn()` on mount and whenever `deps` change, with optional
 * polling. Keeps the previous `data` visible across polls/refetches so the
 * UI doesn't flash back to a loading state — only the very first load
 * shows the loading indicator.
 */
export function useApi<T>(fn: () => Promise<T>, deps: React.DependencyList, options: UseApiOptions = {}): UseApiResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(!options.skip);
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | undefined>(undefined);
  const [settled, setSettled] = useState(false);
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (options.skip) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading((prevLoading) => prevLoading || data === null);
    fnRef
      .current()
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
        setRequestId(undefined);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(errorMessage(err));
        setRequestId(isApiError(err) ? err.requestId : undefined);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
        setSettled(true);
      });

    if (!options.pollMs) {
      return () => {
        cancelled = true;
      };
    }
    const interval = setInterval(() => {
      fnRef
        .current()
        .then((result) => {
          if (cancelled) return;
          setData(result);
          setError(null);
        })
        .catch((err) => {
          if (cancelled) return;
          setError(errorMessage(err));
        });
    }, options.pollMs);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, options.skip]);

  return { data, loading, error, requestId, refetch, settled };
}
