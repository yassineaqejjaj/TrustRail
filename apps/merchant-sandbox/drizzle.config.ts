import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./migrations",
  schemaFilter: ["merchant_sandbox"],
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://trustrail_migrator:trustrail@127.0.0.1:55432/trustrail",
  },
});
