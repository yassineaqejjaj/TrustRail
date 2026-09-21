export interface McpAdapterConfig {
  baseUrl: string;
  apiKey: string;
  grantId: string;
  connectorId: string;
}

/**
 * Stdio identity comes from the configured credential in these environment
 * variables -- this is NOT a remote OAuth implementation, and any future
 * HTTP MCP deployment must follow the current official MCP authorization
 * specification instead of reusing this pattern (docs/PRODUCT_SPEC.md
 * section 12).
 */
export function loadConfigFromEnv(env: NodeJS.ProcessEnv = process.env): McpAdapterConfig {
  const baseUrl = env.TRUSTRAIL_BASE_URL;
  const apiKey = env.TRUSTRAIL_API_KEY;
  const grantId = env.TRUSTRAIL_GRANT_ID;
  const connectorId = env.TRUSTRAIL_CONNECTOR_ID ?? "merchant_sandbox";

  const missing = [
    !baseUrl && "TRUSTRAIL_BASE_URL",
    !apiKey && "TRUSTRAIL_API_KEY",
    !grantId && "TRUSTRAIL_GRANT_ID",
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(`missing required environment variable(s): ${missing.join(", ")}. See docs/MCP_SETUP.md.`);
  }

  return { baseUrl: baseUrl!, apiKey: apiKey!, grantId: grantId!, connectorId };
}
