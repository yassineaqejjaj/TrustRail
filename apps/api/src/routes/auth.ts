import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import type { AppConfig } from "../config.js";
import { users, sessions } from "../db/schema.js";
import { newId } from "../db/ids.js";
import { hashPassword, verifyPassword } from "../auth/passwords.js";
import { generateSessionToken, SESSION_COOKIE_NAME, SESSION_TTL_MS } from "../auth/session.js";
import { authenticateUserSession, AuthError } from "../auth/context.js";
import { sendApiError, ApiError } from "../http/errors.js";

const registerSchema = z.object({ email: z.string().email(), password: z.string().min(10).max(200) }).strict();
const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1).max(200) }).strict();

const LOGIN_RATE_LIMIT = { max: 10, timeWindow: "1 minute" };

export function registerAuthRoutes(app: FastifyInstance, db: Db, config: AppConfig) {
  app.post(
    "/v1/auth/register",
    { config: { rateLimit: LOGIN_RATE_LIMIT } },
    async (req, reply) => {
      if (!config.allowDemoEndpoints) {
        return sendApiError(reply, req, new ApiError(403, "REGISTRATION_DISABLED", "open registration is disabled in production mode; use the admin bootstrap command"));
      }
      const body = registerSchema.safeParse(req.body);
      if (!body.success) return sendApiError(reply, req, new ApiError(400, "BAD_REQUEST", "invalid registration payload"));

      const existing = await db.select().from(users).where(eq(users.email, body.data.email.toLowerCase())).limit(1);
      if (existing.length > 0) {
        return sendApiError(reply, req, new ApiError(409, "EMAIL_TAKEN", "an account with this email already exists"));
      }

      const passwordHash = await hashPassword(body.data.password);
      const userId = newId("user");
      await db.insert(users).values({ id: userId, email: body.data.email.toLowerCase(), passwordHash });

      await createSessionAndSetCookie(db, config, reply, userId);
      return reply.code(201).send({ user_id: userId, email: body.data.email.toLowerCase() });
    }
  );

  app.post(
    "/v1/auth/login",
    { config: { rateLimit: LOGIN_RATE_LIMIT } },
    async (req, reply) => {
      const body = loginSchema.safeParse(req.body);
      if (!body.success) return sendApiError(reply, req, new ApiError(400, "BAD_REQUEST", "invalid login payload"));

      const rows = await db.select().from(users).where(eq(users.email, body.data.email.toLowerCase())).limit(1);
      const user = rows[0];
      // Constant-shape response whether or not the account exists, to avoid
      // trivially confirming email addresses via response differences.
      const dummyHash = "$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
      const ok = await verifyPassword(user?.passwordHash ?? dummyHash, body.data.password);
      if (!user || !ok) {
        return sendApiError(reply, req, new ApiError(401, "INVALID_CREDENTIALS", "invalid email or password"));
      }

      await createSessionAndSetCookie(db, config, reply, user.id);
      return reply.send({ user_id: user.id, email: user.email });
    }
  );

  app.post("/v1/auth/logout", async (req, reply) => {
    try {
      const { sessionId } = await authenticateUserSession(db, req);
      await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId));
    } catch {
      // already logged out / invalid session -- logout is idempotent
    }
    reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
    return reply.send({ status: "ok" });
  });
}

async function createSessionAndSetCookie(db: Db, config: AppConfig, reply: import("fastify").FastifyReply, userId: string) {
  const { token, digest } = generateSessionToken();
  await db.insert(sessions).values({
    id: newId("session"),
    userId,
    tokenDigest: digest,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  reply.setCookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: config.SESSION_COOKIE_SECURE,
    // "none" is required once the frontend and API are on different
    // registrable domains (e.g. a Vercel-hosted web app calling a
    // Railway-hosted API) -- browsers won't attach a "lax" cookie to a
    // cross-site fetch/XHR. "none" requires `secure`, which
    // SESSION_COOKIE_SECURE already guarantees whenever this branch runs.
    sameSite: config.SESSION_COOKIE_SECURE ? "none" : "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export function mapAuthErrorToApiError(err: unknown): ApiError {
  if (err instanceof AuthError) return new ApiError(err.statusCode, err.code, err.message);
  throw err;
}
