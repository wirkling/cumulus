import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { registerAgentRoutes } from './routes/agent.js';
import { registerRequestRoutes } from './routes/requests.js';
import { registerOperatorRoutes } from './routes/operator.js';

/** Build the Fastify app with all routes + hooks, but do not start listening. */
export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      // Structured JSON logs; redact anything token-shaped (spec §14.1).
      redact: ['req.headers.authorization', 'req.headers["x-operator-key"]', 'req.headers["x-bootstrap-token"]'],
    },
    trustProxy: true, // behind Caddy
  });

  await app.register(cors, { origin: true });

  app.get('/health', async () => ({ ok: true, service: 'cumulus-api' }));

  registerOperatorRoutes(app); // registers the /api/operator preHandler hook
  registerAgentRoutes(app);
  registerRequestRoutes(app);

  return app;
}
