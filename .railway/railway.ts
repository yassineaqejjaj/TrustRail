import { bucket, defineRailway, github, postgres, preserve, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  const Postgres = postgres("Postgres", { region: "sfo" });
  Postgres.networking = { privateNetworkEndpoint: "postgres" };
  const apiVolume = volume("api-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "sfo", sizeMB: 500 });
  const postgresVolume = volume("postgres-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "sfo", sizeMB: 500 });
  const PostgresPITR = bucket("Postgres-PITR", { region: "sjc" });
  const api = service("api", {
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "apps/api/Dockerfile" },
    start: "node dist/index.js",
    healthcheck: "/health/ready",
    healthcheckTimeout: 30,
    preDeploy: [],
    replicas: { "sfo": 1 },
    volumeMounts: { "/keys": apiVolume },
    env: { APP_DATABASE_URL: preserve(), APP_MODE: preserve(), CORS_ORIGIN: preserve(), GATEWAY_SHARED_SECRET: preserve(), HOST: preserve(), MERCHANT_SANDBOX_URL: preserve(), NODE_ENV: preserve(), PORT: preserve(), POSTGRES_HOST: preserve(), POSTGRES_PORT: preserve(), POSTGRES_SUPERUSER_PASSWORD: preserve(), RECEIPT_ISSUER: preserve(), SAAS_SANDBOX_URL: preserve(), SESSION_COOKIE_SECURE: preserve(), SIGNING_KEYS_DIR: preserve(), TRUSTRAIL_APP_PASSWORD: preserve(), TRUSTRAIL_MIGRATOR_PASSWORD: preserve() },
  });
  const merchantSandbox = service("merchant-sandbox", {
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "apps/merchant-sandbox/Dockerfile" },
    healthcheck: "/health/ready",
    healthcheckTimeout: 30,
    replicas: { "sfo": 1 },
    env: { GATEWAY_SHARED_SECRET: preserve(), HOST: preserve(), MERCHANT_DATABASE_URL: preserve(), NODE_ENV: preserve(), PORT: preserve() },
  });
  const saasSandbox = service("saas-sandbox", {
    source: github("yassineaqejjaj/trustrail", { checkSuites: false }),
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "apps/saas-sandbox/Dockerfile" },
    healthcheck: "/health/ready",
    healthcheckTimeout: 30,
    replicas: { "sfo": 1 },
    env: { GATEWAY_SHARED_SECRET: preserve(), HOST: preserve(), NODE_ENV: preserve(), PORT: preserve(), SAAS_DATABASE_URL: preserve() },
  });

  return project("trustrail", {
    resources: [Postgres, api, merchantSandbox, saasSandbox, apiVolume, postgresVolume, PostgresPITR],
  });
});
