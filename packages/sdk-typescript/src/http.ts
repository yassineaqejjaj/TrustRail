import { TrustRailApiError, TrustRailNetworkError, TrustRailTimeoutError, type ApiErrorBody } from "./errors.js";

export interface HttpClientOptions {
  baseUrl: string;
  apiKey?: string;
  /** Default per-request timeout. Individual calls may override it. */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface RequestOptions {
  method: "GET" | "POST" | "PATCH";
  path: string;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /**
   * Number of additional attempts after a network error or timeout (never
   * after a definitive HTTP error response). Only safe to set > 0 for
   * requests that carry a stable idempotency key server-side --
   * `actions.execute` is the only SDK method that does.
   */
  retries?: number;
}

/**
 * Thin fetch wrapper: bounded timeouts (AbortController), typed errors, and
 * bounded retries that only ever apply to network/timeout failures, never
 * to a definitive server response -- "Provide ... bounded timeouts and safe
 * retry behavior" (docs/PRODUCT_SPEC.md section 12).
 */
export class HttpClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: HttpClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async request<T>(options: RequestOptions): Promise<T> {
    const url = new URL(options.path, this.opts.baseUrl);
    if (options.query) {
      for (const [k, v] of Object.entries(options.query)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }

    const maxAttempts = 1 + (options.retries ?? 0);
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const controller = new AbortController();
      const timeoutMs = options.timeoutMs ?? this.opts.timeoutMs ?? 10_000;
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const headers: Record<string, string> = { "content-type": "application/json", ...options.headers };
        if (this.opts.apiKey) headers.authorization = `Bearer ${this.opts.apiKey}`;

        const res = await this.fetchImpl(url.toString(), {
          method: options.method,
          headers,
          body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
          signal: controller.signal,
        });

        const text = await res.text();
        const json = text.length > 0 ? JSON.parse(text) : undefined;

        if (!res.ok) {
          // A definitive error response -- never retried, regardless of
          // remaining attempts. Credentials are never logged here.
          throw new TrustRailApiError(res.status, json as ApiErrorBody);
        }
        return json as T;
      } catch (err) {
        clearTimeout(timer);
        if (err instanceof TrustRailApiError) throw err;

        const isAbort = err instanceof Error && err.name === "AbortError";
        lastError = isAbort ? new TrustRailTimeoutError(`request to ${options.path} timed out after ${timeoutMs}ms`) : new TrustRailNetworkError(`request to ${options.path} failed`, err);

        if (attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, Math.min(250 * 2 ** (attempt - 1), 2000)));
          continue;
        }
        throw lastError;
      } finally {
        clearTimeout(timer);
      }
    }

    throw lastError;
  }
}
