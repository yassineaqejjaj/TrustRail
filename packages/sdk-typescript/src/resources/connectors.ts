import type { HttpClient } from "../http.js";

export interface ConnectorResource {
  resource_id: string;
  remaining_amount_minor: number;
  currency: string;
  age_days: number;
  disputed: boolean;
}

export class ConnectorsResource {
  constructor(private readonly http: HttpClient) {}

  /** Read-only lookup through the gateway -- the agent never talks to the connector directly. */
  async getResource(connectorId: string, resourceId: string): Promise<ConnectorResource> {
    return this.http.request<ConnectorResource>({ method: "GET", path: `/v1/connectors/${encodeURIComponent(connectorId)}/resources/${encodeURIComponent(resourceId)}` });
  }
}
