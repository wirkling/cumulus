/** Node agent entry point. Runs unchanged on a Hetzner VPS now and a Mac mini
 * later (spec §6). Outbound-only; keeps itself alive under launchd/systemd. */
import { Agent } from './agent.js';
import { log } from './log.js';

const agent = new Agent();

agent.start().catch((err) => {
  log.error('agent failed to start', { err: String(err) });
  process.exit(1);
});

const shutdown = (signal: string): void => {
  log.info('shutting down', { signal });
  agent.stop();
  process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
