export interface ApiErrorBody {
  code: string;
  message: string;
  request_id: string;
  details?: Record<string, unknown>;
}

/** Thrown for any non-2xx response from the TrustRail API. */
export class TrustRailApiError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly requestId: string;
  readonly details?: Record<string, unknown>;

  constructor(statusCode: number, body: ApiErrorBody) {
    super(body.message);
    this.name = "TrustRailApiError";
    this.code = body.code;
    this.statusCode = statusCode;
    this.requestId = body.request_id;
    this.details = body.details;
  }
}

/** Thrown when a request could not be completed at all (network error, timeout). */
export class TrustRailNetworkError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "TrustRailNetworkError";
  }
}

export class TrustRailTimeoutError extends Error {
  constructor(message = "request timed out") {
    super(message);
    this.name = "TrustRailTimeoutError";
  }
}
