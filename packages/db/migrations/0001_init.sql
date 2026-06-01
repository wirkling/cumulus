-- Cumulus Phase 0a — initial schema.
-- Authoritative migration source. Applied via `pnpm db:migrate`.
-- Targets Postgres (Supabase). All app code is provider-neutral; nothing here
-- assumes Hetzner or any node platform.

create extension if not exists "pgcrypto";  -- gen_random_uuid()

-- ─── node_locations ──────────────────────────────────────────────────────────
create table if not exists node_locations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  location_type text not null,
  latitude      double precision not null,
  longitude     double precision not null,
  city          text,
  state         text,
  country       text,
  internet_type text,
  power_profile text,
  max_power_kw  double precision,
  notes         text
);

-- ─── nodes ───────────────────────────────────────────────────────────────────
create table if not exists nodes (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  status            text not null default 'provisioning',
  phase             text not null default '0a_vpc',
  node_type         text not null,
  location_id       uuid references node_locations(id),
  agent_version     text not null default '0.0.0',
  -- Auth: per-node token stored only as a sha256 hash; revocable via flag.
  token_hash        text,
  token_revoked     boolean not null default false,
  last_heartbeat_at timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists nodes_status_idx on nodes(status);
create index if not exists nodes_location_idx on nodes(location_id);

-- ─── node_capabilities (one row per node) ────────────────────────────────────
create table if not exists node_capabilities (
  node_id          uuid primary key references nodes(id) on delete cascade,
  cpu_model        text,
  cpu_cores        integer,
  cpu_threads      integer,
  ram_gb           double precision,
  disk_gb          double precision,
  gpu_count        integer,
  gpu_models       jsonb,
  gpu_vram_gb      jsonb,
  os               text,
  architecture     text,
  docker_available boolean,
  cuda_available   boolean,
  rocm_available   boolean,
  metal_available  boolean,
  updated_at       timestamptz not null default now()
);

-- ─── node_heartbeats ─────────────────────────────────────────────────────────
create table if not exists node_heartbeats (
  id          uuid primary key default gen_random_uuid(),
  node_id     uuid not null references nodes(id) on delete cascade,
  status      text not null,
  metrics     jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now()
);
create index if not exists heartbeats_node_time_idx on node_heartbeats(node_id, received_at desc);

-- ─── node_benchmarks ─────────────────────────────────────────────────────────
create table if not exists node_benchmarks (
  id             uuid primary key default gen_random_uuid(),
  node_id        uuid not null references nodes(id) on delete cascade,
  benchmark_type text not null,
  score          double precision,
  unit           text,
  raw_result     jsonb not null default '{}'::jsonb,
  started_at     timestamptz not null default now(),
  completed_at   timestamptz,
  status         text not null default 'running',
  error_message  text
);
create index if not exists benchmarks_node_idx on node_benchmarks(node_id, benchmark_type);

-- ─── requests (parent) ───────────────────────────────────────────────────────
create table if not exists requests (
  id                uuid primary key default gen_random_uuid(),
  workload_type     text not null,
  status            text not null default 'queued',
  fan_out           integer not null default 1,
  origin_lat        double precision,
  origin_lng        double precision,
  origin_label      text,
  merge_strategy    text not null,
  completion_policy text not null,
  quorum            integer,
  on_partial        text not null default 'fail',
  timeout_seconds   integer not null default 60,
  input             jsonb not null default '{}'::jsonb,
  merged_result     jsonb,
  customer_id       text,
  priority          text not null default 'normal',
  deadline_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists requests_status_idx on requests(status);

-- ─── jobs (child) ────────────────────────────────────────────────────────────
create table if not exists jobs (
  id                    uuid primary key default gen_random_uuid(),
  request_id            uuid not null references requests(id) on delete cascade,
  shard_index           integer not null,
  workload_type         text not null,
  status                text not null default 'queued',
  required_capabilities jsonb not null default '{}'::jsonb,
  input                 jsonb not null default '{}'::jsonb,
  result                jsonb,
  max_retries           integer not null default 2,
  timeout_seconds       integer not null default 60,
  attempt_count         integer not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists jobs_request_idx on jobs(request_id);
create index if not exists jobs_status_idx on jobs(status);

-- ─── job_attempts ────────────────────────────────────────────────────────────
create table if not exists job_attempts (
  id                   uuid primary key default gen_random_uuid(),
  job_id               uuid not null references jobs(id) on delete cascade,
  node_id              uuid not null references nodes(id),
  status               text not null default 'assigned',
  started_at           timestamptz,
  completed_at         timestamptz,
  deadline_at          timestamptz,
  exit_code            integer,
  error_message        text,
  resource_usage       jsonb,
  placement_distance_km double precision,
  placement_score      double precision,
  created_at           timestamptz not null default now()
);
create index if not exists attempts_job_idx on job_attempts(job_id);
create index if not exists attempts_node_status_idx on job_attempts(node_id, status);
-- The offline/timeout sweeps scan active attempts by deadline.
create index if not exists attempts_active_deadline_idx
  on job_attempts(deadline_at)
  where status in ('assigned', 'started');

-- ─── usage_events (raw economics data; no billing in v1) ─────────────────────
create table if not exists usage_events (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid references jobs(id) on delete set null,
  request_id  uuid references requests(id) on delete set null,
  node_id     uuid not null references nodes(id),
  customer_id text,
  event_type  text not null,
  quantity    double precision not null,
  unit        text not null,
  occurred_at timestamptz not null default now(),
  metadata    jsonb
);
create index if not exists usage_node_time_idx on usage_events(node_id, occurred_at desc);

-- ─── operator_actions (audit log) ────────────────────────────────────────────
create table if not exists operator_actions (
  id          uuid primary key default gen_random_uuid(),
  action_type text not null,
  target_type text not null,
  target_id   text not null,
  actor       text not null,
  metadata    jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists operator_actions_target_idx on operator_actions(target_type, target_id);
