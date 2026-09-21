#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildMcpServer } from "./server.js";
import { loadConfigFromEnv } from "./config.js";

async function main() {
  const config = loadConfigFromEnv();
  const server = buildMcpServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("trustrail-mcp-adapter connected over stdio");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
