/** Agent config from env / local file. The same binary runs on a Hetzner VPS
 * now and a Mac mini later with ONLY config differences (spec §6). */
import { hostname } from 'node:os';
import { join } from 'node:path';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

const num = (name: string): number | undefined =>
  process.env[name] != null ? Number(process.env[name]) : undefined;

export interface AgentLocation {
  name?: string;
  latitude: number;
  longitude: number;
  city?: string;
}

export const agentConfig = {
  controlPlaneUrl: required('CONTROL_PLANE_URL').replace(/\/$/, ''),
  bootstrapToken: required('AGENT_BOOTSTRAP_TOKEN'),
  nodeName: process.env.NODE_NAME ?? `node-${hostname()}`,
  nodeType: (process.env.NODE_TYPE ?? 'vpc') as
    | 'vpc'
    | 'mac_mini'
    | 'gpu_server'
    | 'edge_appliance',
  agentVersion: process.env.AGENT_VERSION ?? '0.1.0',
  stateFile: process.env.AGENT_STATE_FILE ?? join(process.cwd(), '.agent-state.json'),

  // Optional self-declared location (lat/long). Provider-neutral — the control
  // plane just stores it (spec §3.2/§3.3). Set per-region at provision time.
  location:
    num('AGENT_LAT') != null && num('AGENT_LNG') != null
      ? ({
          name: process.env.AGENT_REGION,
          latitude: num('AGENT_LAT')!,
          longitude: num('AGENT_LNG')!,
          city: process.env.AGENT_CITY,
        } satisfies AgentLocation)
      : undefined,

  // Simulation knobs — exercise merge/timeout/partial logic before hardware
  // exists (spec §11). All default to off.
  sim: {
    latencyMs: Number(process.env.SIM_LATENCY_MS ?? 0),
    jitterMs: Number(process.env.SIM_JITTER_MS ?? 0),
    failureRate: Number(process.env.SIM_FAILURE_RATE ?? 0), // 0..1
  },
} as const;
