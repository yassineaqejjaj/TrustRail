import { HttpClient, type HttpClientOptions } from "./http.js";
import { ActionsResource } from "./resources/actions.js";
import { GrantsResource } from "./resources/grants.js";
import { ReceiptsResource } from "./resources/receipts.js";
import { ConnectorsResource } from "./resources/connectors.js";

export interface TrustRailOptions {
  baseUrl: string;
  /** An agent credential (secret), e.g. "trsk_sandbox_...". Never log this value. */
  apiKey: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * TypeScript client for the TrustRail API (docs/PRODUCT_SPEC.md section
 * 12). Mirrors the Python SDK (sdk/python) method for method against the
 * same live API -- see docs/SDK_QUICKSTART.md.
 */
export class TrustRail {
  readonly actions: ActionsResource;
  readonly grants: GrantsResource;
  readonly receipts: ReceiptsResource;
  readonly connectors: ConnectorsResource;

  constructor(options: TrustRailOptions) {
    const httpOptions: HttpClientOptions = { baseUrl: options.baseUrl, apiKey: options.apiKey, timeoutMs: options.timeoutMs, fetchImpl: options.fetchImpl };
    const http = new HttpClient(httpOptions);
    this.actions = new ActionsResource(http);
    this.grants = new GrantsResource(http);
    this.receipts = new ReceiptsResource(http);
    this.connectors = new ConnectorsResource(http);
  }
}
