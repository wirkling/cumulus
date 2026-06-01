/** Centralised config. Fails fast on missing required secrets at boot. */

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const config = {
  port: Number(optional('PORT', '8080')),
  host: optional('HOST', '0.0.0.0'),
  nodeEnv: optional('NODE_ENV', 'development'),

  // Gate on /api/agent/register — agents present this to be issued a per-node token.
  agentBootstrapToken: required('AGENT_BOOTSTRAP_TOKEN'),
  // Guards /api/operator/* (held server-side by the dashboard, never client).
  operatorApiKey: required('OPERATOR_API_KEY'),

  // Agent loop cadence handed back at registration.
  heartbeatIntervalSeconds: Number(optional('HEARTBEAT_INTERVAL_S', '15')),
  jobPollIntervalSeconds: Number(optional('JOB_POLL_INTERVAL_S', '5')),

  // Background sweep cadences + thresholds.
  offlineSweepSeconds: Number(optional('OFFLINE_SWEEP_S', '10')),
  // A node is offline if no heartbeat within 3× the heartbeat interval.
  offlineThresholdSeconds: Number(optional('OFFLINE_THRESHOLD_S', '45')),
  timeoutSweepSeconds: Number(optional('TIMEOUT_SWEEP_S', '5')),
  dispatchSweepSeconds: Number(optional('DISPATCH_SWEEP_S', '3')),
} as const;

export function loadConfig(): typeof config {
  // Touch every required field so boot fails loudly if any are missing.
  void config.agentBootstrapToken;
  void config.operatorApiKey;
  return config;
}
