import type { FastifyReply } from 'fastify';
import type { z } from 'zod';

/**
 * Parse `data` against `schema`. On failure, sends a 400 and returns undefined
 * so the caller can `return`. Keeps validation noise out of route bodies.
 */
export function parseOr400<T>(
  schema: z.ZodType<T>,
  data: unknown,
  reply: FastifyReply,
): T | undefined {
  const result = schema.safeParse(data);
  if (!result.success) {
    void reply.code(400).send({
      error: 'bad_request',
      message: 'validation failed',
      details: result.error.flatten(),
    });
    return undefined;
  }
  return result.data;
}
