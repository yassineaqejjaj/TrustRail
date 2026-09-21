/**
 * Low-level fetch wrapper for the TrustRail API. All requests use
 * `credentials: "include"` so the HttpOnly session cookie set by
 * /v1/auth/login|register is sent automatically. CORS on the API side
 * requires this origin be `http://localhost:3000` in local dev (see
 * apps/api's CORS_ORIGIN config) and requires credentials, so this must
 * never be switched to `credentials: "omit"`.
 */

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") || "http://localhost:4000";

export interface ApiErrorBody {
  code: string;
  message: string;
  request_id?: string;
  details?: Record<string, unknown>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;
  readonly details?: Record<string, unknown>;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message || `Request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.code = body.code || "UNKNOWN_ERROR";
    this.requestId = body.request_id;
    this.details = body.details;
  }
}

/** Thrown when `fetch` itself fails (network down, API not running, CORS block). */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super("Could not reach the TrustRail API. Is it running?");
    this.name = "NetworkError";
    this.cause = cause;
  }
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  orgId?: string | null;
  idempotencyKey?: string;
  bearerToken?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export async function apiFetch<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = opts.method ?? "GET";
  const headers: Record<string, string> = { Accept: "application/json", ...opts.headers };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.orgId) headers["X-Organization-Id"] = opts.orgId;
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
  if (opts.bearerToken) headers["Authorization"] = `Bearer ${opts.bearerToken}`;
  // Required by the API's CSRF check for any cookie-authenticated mutating
  // request (see apps/api/src/server.ts) -- a plain cross-site form
  // submission can't set a custom header, so this rules out that one case
  // strict CORS doesn't already cover. Harmless to send on every request.
  if (method !== "GET" && !opts.bearerToken) headers["X-TrustRail-CSRF"] = "1";

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      credentials: "include",
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
  } catch (err) {
    throw new NetworkError(err);
  }

  const text = await res.text();
  let json: unknown = null;
  if (text.length > 0) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }

  if (!res.ok) {
    const body: ApiErrorBody =
      json && typeof json === "object"
        ? (json as ApiErrorBody)
        : { code: "UNKNOWN_ERROR", message: res.statusText || "Request failed" };
    throw new ApiError(res.status, body);
  }

  return json as T;
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof NetworkError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}
