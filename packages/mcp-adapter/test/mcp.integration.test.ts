import { afterAll, beforeAll, describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startEphemeralPostgres, type EphemeralPostgres } from "@trustrail/test-support";
import { generateSigningKeyPair } from "@trustrail/receipt-verifier";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

import { bootstrapRolesAndDatabase } from "../../../apps/api/src/db/roles.js";
import { runMigrations } from "../../../apps/api/src/db/migrate.js";
import * as apiSchema from "../../../apps/api/src/db/schema.js";
import { buildApp } from "../../../apps/api/src/server.js";
import { createMerchantSandboxConnector } from "../../../apps/api/src/gateway/merchantSandboxConnector.js";
import { newId } from "../../../apps/api/src/db/ids.js";
import { runMerchantMigrations } from "../../../apps/merchant-sandbox/src/db/migrate.js";
import * as merchantSchema from "../../../apps/merchant-sandbox/src/db/schema.js";
import { buildMerchantSandboxApp } from "../../../apps/merchant-sandbox/src/server.js";
import { seedMerchantSandbox } from "../../../apps/merchant-sandbox/src/seed.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

let pgInstance: EphemeralPostgres;
let apiApp: import("fastify").FastifyInstance;
let merchantApp: import("fastify").FastifyInstance;
let mcpClient: McpClient;
let apiPool: pg.Pool;
let merchantPool: pg.Pool;

beforeAll(async () => {
  pgInstance = await startEphemeralPostgres();
  const gatewaySecret = randomBytes(16).toString("hex");

  const migratorPassword = randomBytes(12).toString("hex");
  const appPassword = randomBytes(12).toString("hex");
  await bootstrapRolesAndDatabase(
    { host: pgInstance.host, port: pgInstance.port, adminUser: pgInstance.adminUser, adminPassword: pgInstance.adminPassword, database: "trustrail_mcp_it" },
    { migratorPassword, appPassword }
  );
  const migratorUrl = `postgres://trustrail_migrator:${migratorPassword}@${pgInstance.host}:${pgInstance.port}/trustrail_mcp_it`;
  const appUrl = `postgres://trustrail_app:${appPassword}@${pgInstance.host}:${pgInstance.port}/trustrail_mcp_it`;
  await runMigrations(migratorUrl);

  apiPool = new pg.Pool({ connectionString: appUrl, max: 5 });
  const apiDb = drizzle(apiPool, { schema: apiSchema });

  const keys = await generateSigningKeyPair();
  const keyDir = mkdtempSync(path.join(tmpdir(), "trustrail-mcp-keys-"));
  const keyPath = path.join(keyDir, `${keys.kid}.json`);
  writeFileSync(keyPath, JSON.stringify(keys.privateJwk));
  await apiDb.insert(apiSchema.signingKeys).values({ id: newId("signingKey"), kid: keys.kid, publicKeyJwk: keys.publicJwk, privateKeyRef: `file:${keyPath}`, status: "active" });

  const merchantMigratorUrl = await pgInstance.createDatabase("merchant_mcp_it");
  await runMerchantMigrations(merchantMigratorUrl);

  merchantPool = new pg.Pool({ connectionString: merchantMigratorUrl, max: 5 });
  const merchantDb = drizzle(merchantPool, { schema: merchantSchema });
  merchantApp = buildMerchantSandboxApp({ db: merchantDb, gatewaySecret });
  await merchantApp.listen({ port: 0, host: "127.0.0.1" });
  const merchantAddr = merchantApp.server.address();
  const merchantBaseUrl = `http://127.0.0.1:${typeof merchantAddr === "object" && merchantAddr ? merchantAddr.port : 0}`;

  const connector = createMerchantSandboxConnector({ baseUrl: merchantBaseUrl, gatewaySecret, timeoutMs: 2000 });
  const config = {
    NODE_ENV: "test",
    APP_MODE: "demo",
    PORT: 0,
    HOST: "127.0.0.1",
    APP_DATABASE_URL: appUrl,
    SESSION_COOKIE_SECURE: false,
    MERCHANT_SANDBOX_URL: merchantBaseUrl,
    GATEWAY_SHARED_SECRET: gatewaySecret,
    RECEIPT_ISSUER: "trustrail-mcp-test",
    SIGNING_KEYS_DIR: keyDir,
    CORS_ORIGIN: "http://localhost:3000",
    isProduction: false,
    allowDemoEndpoints: true,
  };
  const gatewayDeps = { connector, signingKey: { kid: keys.kid, privateJwk: keys.privateJwk }, issuer: config.RECEIPT_ISSUER };
  apiApp = buildApp({ db: apiDb, config: config as never, connector, gatewayDeps });
  await apiApp.listen({ port: 0, host: "127.0.0.1" });
  const apiAddr = apiApp.server.address();
  const apiBaseUrl = `http://127.0.0.1:${typeof apiAddr === "object" && apiAddr ? apiAddr.port : 0}`;

  // Onboard an organization, agent, credential, and root grant via the real HTTP API.
  const register = await fetch(`${apiBaseUrl}/v1/auth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "mcp-owner@example.com", password: "correct horse battery staple" }) });
  const setCookie = register.headers.get("set-cookie")!;
  const cookie = setCookie.split(";")[0]!;
  const { user_id: userId } = await register.json();

  const orgRes = await fetch(`${apiBaseUrl}/v1/organizations`, { method: "POST", headers: { "x-trustrail-csrf": "1", "content-type": "application/json", cookie  }, body: JSON.stringify({ name: "MCP Test Org" }) });
  const { organization_id: organizationId } = await orgRes.json();
  await seedMerchantSandbox(merchantDb, organizationId);

  const agentRes = await fetch(`${apiBaseUrl}/v1/agents`, { method: "POST", headers: { "x-trustrail-csrf": "1", "content-type": "application/json", cookie, "x-organization-id": organizationId  }, body: JSON.stringify({ name: "MCP Agent", description: "", environment: "sandbox" }) });
  const { agent_id: agentId } = await agentRes.json();
  const credRes = await fetch(`${apiBaseUrl}/v1/agents/${agentId}/credentials`, { method: "POST", headers: { "x-trustrail-csrf": "1", cookie, "x-organization-id": organizationId  } });
  const { secret } = await credRes.json();

  const grantRes = await fetch(`${apiBaseUrl}/v1/grants`, {
    method: "POST",
    headers: { "x-trustrail-csrf": "1", "content-type": "application/json", cookie, "x-organization-id": organizationId  },
    body: JSON.stringify({
      environment: "sandbox",
      principal_id: userId,
      subject_agent_id: agentId,
      parent_grant_id: null,
      allowed_actions: ["refund.create"],
      allowed_resource_ids: [],
      unrestricted_resources: true,
      allowed_connector_ids: ["merchant_sandbox"],
      currency: "EUR",
      max_amount_minor: 50_000,
      root_budget_limit_minor: 100_000,
      child_budget_limit_minor: null,
      valid_from: null,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      delegation_allowed: false,
      max_remaining_depth: 0,
    }),
  });
  const { grant_id: grantId } = await grantRes.json();

  // Spawn the real, built MCP adapter as a child process and speak MCP to it.
  const transport = new StdioClientTransport({
    command: "node",
    args: [path.join(REPO_ROOT, "packages", "mcp-adapter", "dist", "index.js")],
    env: { TRUSTRAIL_BASE_URL: apiBaseUrl, TRUSTRAIL_API_KEY: secret, TRUSTRAIL_GRANT_ID: grantId, TRUSTRAIL_CONNECTOR_ID: "merchant_sandbox" },
  });
  mcpClient = new McpClient({ name: "test-client", version: "0.0.1" });
  await mcpClient.connect(transport);
}, 60_000);

afterAll(async () => {
  await mcpClient?.close();
  await apiApp?.close();
  await merchantApp?.close();
  await apiPool?.end();
  await merchantPool?.end();
  await pgInstance?.stop();
});

describe("MCP adapter, driven by a real MCP client", () => {
  it("lists exactly the three documented tools", async () => {
    const { tools } = await mcpClient.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["get_action_status", "get_order", "request_refund"]);
  });

  it("get_order returns real order facts through the gateway", async () => {
    const result = await mcpClient.callTool({ name: "get_order", arguments: { order_id: "order_demo_101" } });
    const text = (result.content as Array<{ type: string; text: string }>)[0]!.text;
    const parsed = JSON.parse(text);
    expect(parsed.remaining_amount_minor).toBe(20_000);
    expect(parsed.currency).toBe("EUR");
  });

  it("request_refund executes a real refund through the deterministic gateway", async () => {
    const result = await mcpClient.callTool({
      name: "request_refund",
      arguments: { order_id: "order_demo_101", amount_minor: 8_000, currency: "EUR", reason: "Return", idempotency_key: "mcp-test-refund-1" },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0]!.text;
    const parsed = JSON.parse(text);
    expect(parsed.decision).toBe("ALLOW");
    expect(parsed.execution_state).toBe("succeeded");
    expect(parsed.connector_reference).toBeTruthy();
  });

  it("request_refund for an amount above the hard cap is denied, not silently allowed by the model", async () => {
    const result = await mcpClient.callTool({
      name: "request_refund",
      arguments: { order_id: "order_demo_103", amount_minor: 70_000, currency: "EUR", reason: "large refund", idempotency_key: "mcp-test-refund-deny-1" },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0]!.text;
    const parsed = JSON.parse(text);
    expect(parsed.decision).toBe("DENY");
  });

  it("get_action_status reports the same outcome as request_refund did", async () => {
    const refund = await mcpClient.callTool({
      name: "request_refund",
      arguments: { order_id: "order_demo_107", amount_minor: 3_000, currency: "EUR", reason: "x", idempotency_key: "mcp-test-refund-status-1" },
    });
    const refundParsed = JSON.parse((refund.content as Array<{ type: string; text: string }>)[0]!.text);

    const status = await mcpClient.callTool({ name: "get_action_status", arguments: { action_id: refundParsed.action_id } });
    const statusParsed = JSON.parse((status.content as Array<{ type: string; text: string }>)[0]!.text);
    expect(statusParsed.execution_state).toBe(refundParsed.execution_state);
  });
});
