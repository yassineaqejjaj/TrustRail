import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const ENV_PATH = path.join(ROOT, ".env");
export const ENV_EXAMPLE_PATH = path.join(ROOT, ".env.example");

export function parseEnvFile(contents: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

/**
 * Reads the existing .env (if any) and merges in defaults for any key that
 * is not already present -- "does not overwrite existing secrets"
 * (docs/PRODUCT_SPEC.md section 18). Returns the final merged map and
 * writes it back only if something changed.
 */
export function ensureEnvFile(defaults: Record<string, string>): Record<string, string> {
  const existing = existsSync(ENV_PATH) ? parseEnvFile(readFileSync(ENV_PATH, "utf8")) : {};
  const merged = { ...defaults, ...existing };
  const changed = Object.keys(merged).some((k) => existing[k] === undefined);

  if (changed || !existsSync(ENV_PATH)) {
    const lines = Object.entries(merged).map(([k, v]) => `${k}=${v}`);
    writeFileSync(ENV_PATH, lines.join("\n") + "\n", { mode: 0o600 });
  }
  return merged;
}

export function loadEnvIntoProcess(): Record<string, string> {
  if (!existsSync(ENV_PATH)) return {};
  const parsed = parseEnvFile(readFileSync(ENV_PATH, "utf8"));
  for (const [k, v] of Object.entries(parsed)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
  return parsed;
}

export { ROOT };
