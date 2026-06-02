import type {
  Node,
  NodeLocation,
  NodeCapability,
  NodeBenchmark,
  NodeStatus,
  HeartbeatMetrics,
  CapabilityReport,
} from '@cumulus/shared-types';
import type { PlacementCandidate } from '@cumulus/orchestration';
import { getSql, toJson } from '../client.js';
import {
  mapNode,
  mapLocation,
  mapCapability,
  mapBenchmark,
} from '../mappers.js';

// ─── Locations ───────────────────────────────────────────────────────────────

export async function listLocations(): Promise<NodeLocation[]> {
  const sql = getSql();
  const rows = await sql`select * from node_locations order by name`;
  return rows.map(mapLocation);
}

export async function getLocation(id: string): Promise<NodeLocation | null> {
  const sql = getSql();
  const rows = await sql`select * from node_locations where id = ${id}`;
  return rows[0] ? mapLocation(rows[0]) : null;
}

export async function findLocationByName(name: string): Promise<NodeLocation | null> {
  const sql = getSql();
  const rows = await sql`select * from node_locations where name = ${name} limit 1`;
  return rows[0] ? mapLocation(rows[0]) : null;
}

export async function createLocation(
  loc: Omit<NodeLocation, 'id'>,
): Promise<NodeLocation> {
  const sql = getSql();
  const rows = await sql`
    insert into node_locations
      (name, location_type, latitude, longitude, city, state, country, internet_type, power_profile, max_power_kw, notes)
    values
      (${loc.name}, ${loc.locationType}, ${loc.latitude}, ${loc.longitude}, ${loc.city ?? null},
       ${loc.state ?? null}, ${loc.country ?? null}, ${loc.internetType ?? null},
       ${loc.powerProfile ?? null}, ${loc.maxPowerKw ?? null}, ${loc.notes ?? null})
    returning *`;
  return mapLocation(rows[0]!);
}

// ─── Nodes ───────────────────────────────────────────────────────────────────

export async function createNode(params: {
  name: string;
  nodeType: Node['nodeType'];
  agentVersion: string;
  locationId?: string;
  tokenHash: string;
}): Promise<Node> {
  const sql = getSql();
  const rows = await sql`
    insert into nodes (name, node_type, agent_version, location_id, token_hash, status)
    values (${params.name}, ${params.nodeType}, ${params.agentVersion},
            ${params.locationId ?? null}, ${params.tokenHash}, 'online')
    returning *`;
  return mapNode(rows[0]!);
}

export async function getNode(id: string): Promise<Node | null> {
  const sql = getSql();
  const rows = await sql`select * from nodes where id = ${id}`;
  return rows[0] ? mapNode(rows[0]) : null;
}

/** For auth: returns the stored token hash + revocation flag, or null. */
export async function getNodeAuth(
  id: string,
): Promise<{ tokenHash: string | null; revoked: boolean } | null> {
  const sql = getSql();
  const rows = await sql<{ token_hash: string | null; token_revoked: boolean }[]>`
    select token_hash, token_revoked from nodes where id = ${id}`;
  if (!rows[0]) return null;
  return { tokenHash: rows[0].token_hash, revoked: rows[0].token_revoked };
}

export async function revokeNodeToken(id: string): Promise<void> {
  const sql = getSql();
  await sql`update nodes set token_revoked = true, updated_at = now() where id = ${id}`;
}

export async function setNodeStatus(id: string, status: NodeStatus): Promise<void> {
  const sql = getSql();
  await sql`update nodes set status = ${status}, updated_at = now() where id = ${id}`;
}

export async function recordHeartbeat(
  nodeId: string,
  status: NodeStatus,
  metrics: HeartbeatMetrics,
): Promise<void> {
  const sql = getSql();
  await sql.begin(async (tx) => {
    await tx`
      insert into node_heartbeats (node_id, status, metrics)
      values (${nodeId}, ${status}, ${tx.json(toJson(metrics))})`;
    // Don't override an operator-set state (draining/maintenance/disabled) with
    // the agent's self-reported 'online'.
    await tx`
      update nodes
      set last_heartbeat_at = now(),
          status = case
            when status in ('draining','maintenance','disabled') then status
            else ${status}
          end,
          updated_at = now()
      where id = ${nodeId}`;
  });
}

export async function latestMetrics(nodeId: string): Promise<HeartbeatMetrics | undefined> {
  const sql = getSql();
  const rows = await sql<{ metrics: HeartbeatMetrics }[]>`
    select metrics from node_heartbeats
    where node_id = ${nodeId} order by received_at desc limit 1`;
  return rows[0]?.metrics;
}

export interface NodeListFilters {
  status?: NodeStatus;
  locationId?: string;
}

export async function listNodes(filters: NodeListFilters = {}): Promise<Node[]> {
  const sql = getSql();
  const rows = await sql`
    select * from nodes
    where (${filters.status ?? null}::text is null or status = ${filters.status ?? null})
      and (${filters.locationId ?? null}::uuid is null or location_id = ${filters.locationId ?? null})
    order by created_at desc`;
  return rows.map(mapNode);
}

/**
 * Offline sweep: mark online nodes whose last heartbeat is older than the
 * threshold as offline. Returns the ids that flipped (so the API can re-place
 * their in-flight jobs). Operator states are left untouched.
 */
export async function markStaleNodesOffline(thresholdSeconds: number): Promise<string[]> {
  const sql = getSql();
  const rows = await sql<{ id: string }[]>`
    update nodes
    set status = 'offline', updated_at = now()
    where status = 'online'
      and (last_heartbeat_at is null or last_heartbeat_at < now() - (${thresholdSeconds} * interval '1 second'))
    returning id`;
  return rows.map((r) => r.id);
}

// ─── Capabilities ────────────────────────────────────────────────────────────

export async function upsertCapabilities(
  nodeId: string,
  c: CapabilityReport,
): Promise<void> {
  const sql = getSql();
  await sql`
    insert into node_capabilities
      (node_id, cpu_model, cpu_cores, cpu_threads, ram_gb, disk_gb, gpu_count,
       gpu_models, gpu_vram_gb, os, architecture, docker_available, cuda_available,
       rocm_available, metal_available, executors, updated_at)
    values
      (${nodeId}, ${c.cpuModel ?? null}, ${c.cpuCores ?? null}, ${c.cpuThreads ?? null},
       ${c.ramGb ?? null}, ${c.diskGb ?? null}, ${c.gpuCount ?? null},
       ${c.gpuModels ? sql.json(toJson(c.gpuModels)) : null}, ${c.gpuVramGb ? sql.json(toJson(c.gpuVramGb)) : null},
       ${c.os ?? null}, ${c.architecture ?? null}, ${c.dockerAvailable ?? null},
       ${c.cudaAvailable ?? null}, ${c.rocmAvailable ?? null}, ${c.metalAvailable ?? null},
       ${c.executors ? sql.json(toJson(c.executors)) : null}, now())
    on conflict (node_id) do update set
      cpu_model = excluded.cpu_model, cpu_cores = excluded.cpu_cores,
      cpu_threads = excluded.cpu_threads, ram_gb = excluded.ram_gb,
      disk_gb = excluded.disk_gb, gpu_count = excluded.gpu_count,
      gpu_models = excluded.gpu_models, gpu_vram_gb = excluded.gpu_vram_gb,
      os = excluded.os, architecture = excluded.architecture,
      docker_available = excluded.docker_available, cuda_available = excluded.cuda_available,
      rocm_available = excluded.rocm_available, metal_available = excluded.metal_available,
      executors = excluded.executors, updated_at = now()`;
}

export async function getCapabilities(nodeId: string): Promise<NodeCapability | null> {
  const sql = getSql();
  const rows = await sql`select * from node_capabilities where node_id = ${nodeId}`;
  return rows[0] ? mapCapability(rows[0]) : null;
}

// ─── Benchmarks ──────────────────────────────────────────────────────────────

export async function insertBenchmark(params: {
  nodeId: string;
  benchmarkType: NodeBenchmark['benchmarkType'];
  score?: number;
  unit?: string;
  rawResult: Record<string, unknown>;
  status: 'completed' | 'failed';
  errorMessage?: string;
}): Promise<NodeBenchmark> {
  const sql = getSql();
  const rows = await sql`
    insert into node_benchmarks (node_id, benchmark_type, score, unit, raw_result, status, completed_at, error_message)
    values (${params.nodeId}, ${params.benchmarkType}, ${params.score ?? null}, ${params.unit ?? null},
            ${sql.json(toJson(params.rawResult))}, ${params.status}, now(), ${params.errorMessage ?? null})
    returning *`;
  return mapBenchmark(rows[0]!);
}

export async function listBenchmarksForNode(nodeId: string): Promise<NodeBenchmark[]> {
  const sql = getSql();
  const rows = await sql`
    select * from node_benchmarks where node_id = ${nodeId}
    order by started_at desc limit 50`;
  return rows.map(mapBenchmark);
}

// ─── Placement candidates ────────────────────────────────────────────────────

/**
 * Assemble placement candidates: every node joined with its location, queue
 * length (active attempts), and a generic recent benchmark score. The scorer
 * (packages/orchestration) applies hard filters + soft scoring on this set.
 */
export async function getPlacementCandidates(): Promise<PlacementCandidate[]> {
  const sql = getSql();
  const rows = await sql`
    select
      n.id            as node_id,
      n.status        as status,
      l.latitude      as lat,
      l.longitude     as lng,
      l.name          as location_name,
      c.ram_gb, c.cpu_cores, c.cpu_threads, c.architecture,
      c.docker_available, c.cuda_available, c.rocm_available, c.metal_available, c.gpu_count, c.executors,
      coalesce(q.queue_length, 0) as queue_length,
      b.score         as benchmark_score
    from nodes n
    left join node_locations l on l.id = n.location_id
    left join node_capabilities c on c.node_id = n.id
    left join (
      select node_id, count(*)::int as queue_length
      from job_attempts where status in ('assigned','started')
      group by node_id
    ) q on q.node_id = n.id
    left join lateral (
      select score from node_benchmarks
      where node_id = n.id and benchmark_type = 'cpu' and status = 'completed' and score is not null
      order by started_at desc limit 1
    ) b on true`;

  return rows.map((r): PlacementCandidate => {
    const status = r.status as NodeStatus;
    return {
      nodeId: String(r.node_id),
      status,
      unavailable: status === 'draining' || status === 'maintenance' || status === 'disabled',
      location:
        r.lat != null && r.lng != null
          ? { lat: Number(r.lat), lng: Number(r.lng), label: r.location_name as string }
          : undefined,
      capabilities: {
        ramGb: r.ram_gb != null ? Number(r.ram_gb) : undefined,
        cpuCores: r.cpu_cores != null ? Number(r.cpu_cores) : undefined,
        cpuThreads: r.cpu_threads != null ? Number(r.cpu_threads) : undefined,
        architecture: r.architecture ?? undefined,
        dockerAvailable: r.docker_available ?? undefined,
        cudaAvailable: r.cuda_available ?? undefined,
        rocmAvailable: r.rocm_available ?? undefined,
        metalAvailable: r.metal_available ?? undefined,
        gpuCount: r.gpu_count != null ? Number(r.gpu_count) : undefined,
        executors: (r.executors as string[]) ?? [],
      },
      queueLength: Number(r.queue_length),
      benchmarkScore: r.benchmark_score != null ? Number(r.benchmark_score) : undefined,
    };
  });
}
