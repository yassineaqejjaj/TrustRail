import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import type { Db } from "./db/client.js";
import type { AppConfig } from "./config.js";
import { parseJsonStrict, StrictJsonError } from "./http/strictJson.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerOrganizationRoutes } from "./routes/organizations.js";
import { registerMeRoutes } from "./routes/me.js";
import { registerMembershipRoutes } from "./routes/memberships.js";
import { registerAgentRoutes } from "./routes/agents.js";
import { registerGrantRoutes } from "./routes/grants.js";
import { registerPolicyRoutes } from "./routes/policies.js";
import { registerActionRoutes } from "./routes/actions.js";
import { registerApprovalRoutes } from "./routes/approvals.js";
import { registerReceiptRoutes } from "./routes/receipts.js";
import { registerSimulationRoutes } from "./routes/simulations.js";
import { registerMetricsRoutes } from "./routes/metrics.js";
import { registerEventRoutes } from "./routes/events.js";
import { registerDemoRoutes, type DemoRouteDeps } from "./routes/demo.js";
import type { SubmitActionDeps } from "./gateway/submitAction.js";
import type { ApprovalDecisionDeps } from "./gateway/approvalResume.js";
import type { Connector } from "./gateway/connector.js";
import { CSRF_HEADER_NAME, SESSION_COOKIE_NAME } from "./auth/session.js";

export interface BuildAppOptions {
  db: Db;
  config: AppConfig;
  connector: Connector;
  gatewayDeps: SubmitActionDeps & ApprovalDecisionDeps;
  demoDeps?: DemoRouteDeps;
}

const BODY_LIMIT_BYTES = 256 * 1024;

export function buildApp(opts: BuildAppOptions): FastifyInstance {
  const app = Fastify({
    logger: opts.config.NODE_ENV !== "test",
    bodyLimit: BODY_LIMIT_BYTES,
    genReqId: () => `req_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`,
  });

  void app.register(sensible);
  void app.register(cookie);
  void app.register(cors, {
    origin: opts.config.CORS_ORIGIN,
    credentials: true,
  });
  void app.register(rateLimit, { global: false });

  // Custom strict JSON parser: rejects duplicate keys (spec section 6) and
  // caps payload size explicitly rather than relying only on bodyLimit's
  // generic error shape.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    try {
      const parsed = body.length > 0 ? parseJsonStrict(body as string) : undefined;
      done(null, parsed);
    } catch (err) {
      if (err instanceof StrictJsonError) {
        const wrapped = new Error(err.message) as Error & { statusCode: number };
        wrapped.statusCode = 400;
        done(wrapped, undefined);
        return;
      }
      done(err as Error, undefined);
    }
  });

  const MUTATING_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);
  /**
   * Double-submit-style CSRF defense for cookie-authenticated requests
   * (spec section 4 / docs/BUILD_STATUS.md's previously-open CSRF gap).
   * Only applies when a session cookie is present -- agent bearer requests
   * carry no cookie, so a cross-site request could never forge one (the
   * browser won't attach an Authorization header a page doesn't set
   * itself). A plain cross-site form POST also can't set this custom
   * header, and the strict CORS origin already blocks a cross-site
   * `fetch` from reading the response, so this header's only job is to
   * rule out the no-JS form-submission case that CORS doesn't cover.
   */
  app.addHook("onRequest", async (req, reply) => {
    if (!MUTATING_METHODS.has(req.method)) return;
    // A request carrying its own Authorization header authenticates as an
    // agent, regardless of whether the browser also attached a session
    // cookie alongside it (credentialed fetches send cookies for the
    // target origin automatically) -- CSRF only applies to requests that
    // rely on the cookie for authentication.
    if (req.headers.authorization) return;
    const hasSessionCookie = typeof (req as unknown as { cookies?: Record<string, string> }).cookies?.[SESSION_COOKIE_NAME] === "string";
    if (!hasSessionCookie) return;
    if (req.headers[CSRF_HEADER_NAME] !== "1") {
      return reply.code(403).send({ code: "CSRF_CHECK_FAILED", message: `missing or invalid ${CSRF_HEADER_NAME} header`, request_id: req.id });
    }
  });

  app.setErrorHandler((err, req, reply) => {
    if ((err as { statusCode?: number }).statusCode === 400) {
      return reply.code(400).send({ code: "BAD_REQUEST", message: (err as Error).message, request_id: req.id });
    }
    req.log.error(err);
    return reply.code(500).send({ code: "INTERNAL_ERROR", message: "an internal error occurred", request_id: req.id });
  });

  registerHealthRoutes(app, opts.db);
  registerAuthRoutes(app, opts.db, opts.config);
  registerOrganizationRoutes(app, opts.db);
  registerMeRoutes(app, opts.db);
  registerMembershipRoutes(app, opts.db);
  registerAgentRoutes(app, opts.db);
  registerGrantRoutes(app, opts.db);
  registerPolicyRoutes(app, opts.db);
  registerActionRoutes(app, opts.db, opts.gatewayDeps);
  registerApprovalRoutes(app, opts.db, opts.gatewayDeps);
  registerReceiptRoutes(app, opts.db);
  registerSimulationRoutes(app, opts.db, opts.connector);
  registerMetricsRoutes(app, opts.db);
  registerEventRoutes(app, opts.db);
  if (opts.demoDeps) {
    registerDemoRoutes(app, opts.db, opts.config, opts.demoDeps);
  }

  return app;
}
