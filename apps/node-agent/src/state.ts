/** Persist node id + token locally so a restart re-attaches as the same node
 * rather than registering a duplicate (spec §10.2). File-local in v1; secure
 * local config storage is a 0b concern (spec §14.2). */
import { readFile, writeFile, chmod } from 'node:fs/promises';

export interface AgentState {
  nodeId: string;
  agentToken: string;
}

export async function loadState(file: string): Promise<AgentState | null> {
  try {
    const raw = await readFile(file, 'utf8');
    const parsed = JSON.parse(raw) as Partial<AgentState>;
    if (parsed.nodeId && parsed.agentToken) {
      return { nodeId: parsed.nodeId, agentToken: parsed.agentToken };
    }
    return null;
  } catch {
    return null;
  }
}

export async function saveState(file: string, state: AgentState): Promise<void> {
  await writeFile(file, JSON.stringify(state, null, 2), 'utf8');
  // Owner-only — the token is a secret.
  await chmod(file, 0o600).catch(() => {});
}
