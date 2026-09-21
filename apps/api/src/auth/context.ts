import type { FastifyRequest } from "fastify";
import { eq, and, isNull } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { agentCredentials, agents, memberships, sessions, users } from "../db/schema.js";
import { digestApiKey } from "./apiKeys.js";
import { hashSessionToken, SESSION_COOKIE_NAME } from "./session.js";
import type { Role } from "@trustrail/contracts";

export interface UserAuthContext {
  kind: "user";
  userId: string;
  email: string;
  sessionId: string;
  organizationId: string;
  role: Role;
  membershipId: string;
}

export interface AgentAuthContext {
  kind: "agent";
  agentId: string;
  organizationId: string;
  environment: string;
  credentialId: string;
}

export type AuthContext = UserAuthContext | AgentAuthContext;

export class AuthError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

/**
 * Resolves the authenticated agent credential from the Authorization
 * header. Does NOT resolve an organization for a user session -- that
 * requires a separate, explicit org-selection step (see
 * resolveUserOrganization) because "selecting an organization does not
 * change authorization" and "never trust a supplied organization ID
 * alone" (docs/PRODUCT_SPEC.md sections 4 and 10).
 */
export async function authenticateAgent(db: Db, req: FastifyRequest): Promise<AgentAuthContext> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw new AuthError(401, "UNAUTHORIZED", "missing bearer credential");
  }
  const secret = header.slice("Bearer ".length).trim();
  const digest = digestApiKey(secret);

  const rows = await db
    .select({
      credentialId: agentCredentials.id,
      status: agentCredentials.status,
      expiresAt: agentCredentials.expiresAt,
      agentId: agents.id,
      agentStatus: agents.status,
      organizationId: agents.organizationId,
      environment: agentCredentials.environment,
    })
    .from(agentCredentials)
    .innerJoin(agents, eq(agentCredentials.agentId, agents.id))
    .where(eq(agentCredentials.secretDigest, digest))
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new AuthError(401, "UNAUTHORIZED", "invalid credential");
  }
  if (row.status !== "active") {
    throw new AuthError(401, "CREDENTIAL_REVOKED", "credential is no longer active");
  }
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
    throw new AuthError(401, "CREDENTIAL_REVOKED", "credential has expired");
  }
  if (row.agentStatus !== "active") {
    throw new AuthError(401, "CREDENTIAL_REVOKED", "agent is not active");
  }

  return {
    kind: "agent",
    agentId: row.agentId,
    organizationId: row.organizationId,
    environment: row.environment,
    credentialId: row.credentialId,
  };
}

/** Resolves the authenticated human session from the session cookie, without any org context. */
export async function authenticateUserSession(
  db: Db,
  req: FastifyRequest
): Promise<{ userId: string; email: string; sessionId: string }> {
  const token = (req as unknown as { cookies?: Record<string, string> }).cookies?.[SESSION_COOKIE_NAME];
  if (!token) {
    throw new AuthError(401, "UNAUTHORIZED", "missing session cookie");
  }
  const digest = hashSessionToken(token);
  const rows = await db
    .select({ sessionId: sessions.id, userId: sessions.userId, expiresAt: sessions.expiresAt, revokedAt: sessions.revokedAt, email: users.email })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.tokenDigest, digest))
    .limit(1);
  const row = rows[0];
  if (!row || row.revokedAt || row.expiresAt.getTime() <= Date.now()) {
    throw new AuthError(401, "UNAUTHORIZED", "session is invalid or expired");
  }
  return { userId: row.userId, email: row.email, sessionId: row.sessionId };
}

/**
 * Verifies the caller is actually a member of the requested organization
 * before ever setting tenant context -- the organization ID a client
 * supplies (header/param) is never trusted by itself.
 */
export async function resolveUserOrganization(
  db: Db,
  userId: string,
  organizationId: string
): Promise<{ membershipId: string; role: Role }> {
  const rows = await db
    .select({ id: memberships.id, role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.organizationId, organizationId)))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new AuthError(403, "FORBIDDEN", "not a member of this organization");
  }
  return { membershipId: row.id, role: row.role as Role };
}

export async function authenticateUserWithOrg(db: Db, req: FastifyRequest): Promise<UserAuthContext> {
  const { userId, email, sessionId } = await authenticateUserSession(db, req);
  const organizationId = req.headers["x-organization-id"];
  if (typeof organizationId !== "string" || organizationId.length === 0) {
    throw new AuthError(400, "BAD_REQUEST", "X-Organization-Id header is required");
  }
  const { membershipId, role } = await resolveUserOrganization(db, userId, organizationId);
  return { kind: "user", userId, email, sessionId, organizationId, role, membershipId };
}

const ROLE_RANK: Record<Role, number> = { viewer: 0, approver: 1, operator: 2, admin: 3, owner: 4 };

export function requireRole(ctx: UserAuthContext, minimum: Role): void {
  if (ROLE_RANK[ctx.role] < ROLE_RANK[minimum]) {
    throw new AuthError(403, "FORBIDDEN", `requires role >= ${minimum}`);
  }
}

export function requireExactRoleOneOf(ctx: UserAuthContext, roles: Role[]): void {
  if (!roles.includes(ctx.role)) {
    throw new AuthError(403, "FORBIDDEN", `requires one of roles: ${roles.join(", ")}`);
  }
}
