import type { FastifyReply, FastifyRequest } from "fastify";

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
  }
}

export function sendApiError(reply: FastifyReply, req: FastifyRequest, err: ApiError) {
  return reply.code(err.statusCode).send({
    code: err.code,
    message: err.message,
    request_id: req.id,
    ...(err.details ? { details: err.details } : {}),
  });
}
