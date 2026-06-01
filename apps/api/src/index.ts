/** Entry point — boot the always-on control plane (spec §1: not serverless). */
import { closeSql } from '@cumulus/db';
import { loadConfig } from './config.js';
import { buildServer } from './server.js';
import { startSweeps } from './services/sweeps.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildServer();

  await app.listen({ port: config.port, host: config.host });
  const stopSweeps = startSweeps(app);

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    stopSweeps();
    await app.close();
    await closeSql();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('Fatal boot error:', err);
  process.exit(1);
});
