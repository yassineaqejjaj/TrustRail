import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { loadEnvIntoProcess, ROOT } from "./lib/env.js";
import { isInitialised, startLocalPostgres, stopLocalPostgres } from "./lib/localPostgres.js";

async function main() {
  const env = loadEnvIntoProcess();
  if (!isInitialised()) {
    console.error("Local database is not set up yet. Run: pnpm setup:local");
    process.exit(1);
  }

  console.log("starting local PostgreSQL...");
  await startLocalPostgres();

  const children: ChildProcess[] = [];
  const spawnDev = (name: string, cwd: string, extraEnv: Record<string, string> = {}) => {
    const child = spawn("pnpm", ["run", "dev"], {
      cwd,
      env: { ...process.env, ...env, ...extraEnv },
      stdio: "inherit",
    });
    child.on("exit", (code) => {
      console.log(`[${name}] exited with code ${code}`);
    });
    children.push(child);
  };

  spawnDev("merchant-sandbox", path.join(ROOT, "apps", "merchant-sandbox"), { PORT: env.MERCHANT_SANDBOX_PORT ?? "4100" });
  spawnDev("api", path.join(ROOT, "apps", "api"));

  const webDir = path.join(ROOT, "apps", "web");
  if (existsSync(path.join(webDir, "package.json"))) {
    spawnDev("web", webDir, { PORT: env.WEB_PORT ?? "3000" });
  } else {
    console.log("apps/web not present yet -- skipping frontend dev server");
  }

  const shutdown = async () => {
    console.log("\nshutting down...");
    for (const child of children) child.kill("SIGTERM");
    await stopLocalPostgres();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
