import type { FastifyReply, FastifyRequest } from "fastify";
import type { Db } from "../db/client.js";
import { authenticateUserWithOrg, authenticateAgent, authenticateUserSession, AuthError, type UserAuthContext, type AgentAuthContext } from "../auth/context.js";
import { ApiError, sendApiError } from "./errors.js";

/** Wraps a route handler that requires an authenticated user + selected organization. */
export function userRoute(db: Db, handler: (ctx: UserAuthContext, req: FastifyRequest, reply: FastifyReply) => Promise<unknown>) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const ctx = await authenticateUserWithOrg(db, req);
      return await handler(ctx, req, reply);
    } catch (err) {
      return handleRouteError(err, req, reply);
    }
  };
}

/** Wraps a route handler that requires only a valid session, no organization selected yet. */
export function sessionRoute(db: Db, handler: (ctx: { userId: string; email: string }, req: FastifyRequest, reply: FastifyReply) => Promise<unknown>) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const { userId, email } = await authenticateUserSession(db, req);
      return await handler({ userId, email }, req, reply);
    } catch (err) {
      return handleRouteError(err, req, reply);
    }
  };
}

/** Wraps a route handler that requires an authenticated agent credential. */
export function agentRoute(db: Db, handler: (ctx: AgentAuthContext, req: FastifyRequest, reply: FastifyReply) => Promise<unknown>) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const ctx = await authenticateAgent(db, req);
      return await handler(ctx, req, reply);
    } catch (err) {
      return handleRouteError(err, req, reply);
    }
  };
}

export function handleRouteError(err: unknown, req: FastifyRequest, reply: FastifyReply) {
  if (err instanceof AuthError) {
    return sendApiError(reply, req, new ApiError(err.statusCode, err.code, err.message));
  }
  if (err instanceof ApiError) {
    return sendApiError(reply, req, err);
  }
  req.log.error(err);
  return sendApiError(reply, req, new ApiError(500, "INTERNAL_ERROR", "an internal error occurred"));
}
