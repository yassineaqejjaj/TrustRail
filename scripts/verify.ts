import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { ROOT } from "./lib/env.js";

/**
 * "verify runs lint/type checks, relevant tests, production build, and SDK
 * validation, with a nonzero exit on failure" (docs/PRODUCT_SPEC.md section
 * 18). Runs each check as its own pnpm invocation so a failure anywhere
 * still reports every other result rather than stopping at the first
 * red light.
 */

interface StepResult {
  name: string;
  ok: boolean;
}

const results: StepResult[] = [];

function run(name: string, command: string, args: string[], cwd: string = ROOT): void {
  console.log(`\n=== ${name} ===`);
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  const ok = result.status === 0;
  results.push({ name, ok });
  if (!ok) console.error(`--- FAILED: ${name} (exit ${result.status}) ---`);
}

// TypeScript packages/apps, in dependency order (pnpm -r handles this automatically).
run("build (all TypeScript packages/apps)", "pnpm", ["-r", "--filter=./packages/*", "--filter=./apps/*", "run", "build"]);
run("typecheck (all TypeScript packages/apps)", "pnpm", ["-r", "--filter=./packages/*", "--filter=./apps/*", "run", "typecheck"]);
run("lint (all TypeScript packages/apps)", "pnpm", ["-r", "--filter=./packages/*", "--filter=./apps/*", "run", "lint"]);
run("test (all TypeScript packages/apps)", "pnpm", ["-r", "--filter=./packages/*", "--filter=./apps/*", "run", "test"]);

const pythonDir = path.join(ROOT, "sdk", "python");
const pythonVenvPython = path.join(pythonDir, ".venv", "bin", "python");
if (existsSync(pythonVenvPython)) {
  run("Python SDK tests", pythonVenvPython, ["-m", "pytest"], pythonDir);
} else {
  console.log("\n=== Python SDK tests ===");
  console.log(`No virtualenv found at ${pythonVenvPython}. Set it up first:`);
  console.log(`  cd sdk/python && python3 -m venv .venv && source .venv/bin/activate && pip install -e ".[dev]"`);
  results.push({ name: "Python SDK tests", ok: false });
}

console.log("\n\n=== verify summary ===");
for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}`);
}

const failed = results.filter((r) => !r.ok);
if (failed.length > 0) {
  console.error(`\n${failed.length} step(s) failed.`);
  process.exit(1);
}
console.log("\nAll steps passed.");
