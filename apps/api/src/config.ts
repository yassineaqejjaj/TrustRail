import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_MODE: z.enum(["local", "demo", "production"]).default("local"),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default("127.0.0.1"),
  APP_DATABASE_URL: z.string().min(1),
  SESSION_COOKIE_SECURE: z.coerce.boolean().default(false),
  MERCHANT_SANDBOX_URL: z.string().url().default("http://127.0.0.1:4100"),
  GATEWAY_SHARED_SECRET: z.string().min(16),
  RECEIPT_ISSUER: z.string().default("trustrail-local"),
  SIGNING_KEYS_DIR: z.string().default("./infra/keys"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
});

export type AppConfig = z.infer<typeof envSchema> & { isProduction: boolean; allowDemoEndpoints: boolean };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env);
  return {
    ...parsed,
    isProduction: parsed.APP_MODE === "production",
    allowDemoEndpoints: parsed.APP_MODE !== "production",
  };
}
