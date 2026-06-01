/** Remote update manager — STUB in v1 (spec §6, §9). The module boundary
 * exists so 0b can add: check approved version → download artifact → verify
 * checksum → restart safely → report version. For 0a, manual redeploy is fine,
 * so this is a no-op that simply records the running version. */
import { agentConfig } from './config.js';
import { log } from './log.js';

export function currentVersion(): string {
  return agentConfig.agentVersion;
}

export async function checkForUpdate(): Promise<void> {
  // Deferred: no auto-update in 0a. Present for the seam only.
  log.debug('update check skipped (no-op in v1)', { version: currentVersion() });
}
