-- Stage 1 of the QA / Test Center program + the customer front door.
-- Customers authenticate to the public /v1 API with an API key (stored hashed).
-- QA runs are versioned + snapshot the fleet so results stay comparable as the
-- hardware evolves (CPU → virtual GPU → Mac mini → real GPU racks).

-- ─── customers (the product front door) ──────────────────────────────────────
create table if not exists customers (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  -- API key stored only as a sha256 hash; prefix kept for display.
  api_key_hash text not null unique,
  key_prefix   text not null,
  status       text not null default 'active',
  created_at   timestamptz not null default now()
);

-- ─── qa_runs (one standardized QA execution) ─────────────────────────────────
create table if not exists qa_runs (
  id             uuid primary key default gen_random_uuid(),
  suite_version  text not null,
  -- Operator label for the hardware generation, e.g. 'cpu-cx23-3node'.
  env_label      text not null,
  status         text not null default 'running', -- running | completed | failed
  -- Snapshot of the fleet at run time (node types, locations, cpu benchmark).
  fleet_snapshot jsonb not null default '[]'::jsonb,
  -- Roll-up summary across scenarios (counts, overall latency, etc.).
  summary        jsonb,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz
);
create index if not exists qa_runs_started_idx on qa_runs(started_at desc);

-- ─── qa_results (one scenario within a run) ──────────────────────────────────
create table if not exists qa_results (
  id                 uuid primary key default gen_random_uuid(),
  run_id             uuid not null references qa_runs(id) on delete cascade,
  scenario_key       text not null,
  use_case           text not null,
  request_count      integer not null default 0,
  succeeded          integer not null default 0,
  failed             integer not null default 0,
  latency_p50_ms     double precision,
  latency_p95_ms     double precision,
  latency_max_ms     double precision,
  throughput_per_sec double precision,
  -- Extra detail: per-node distribution, wall-clock, overflow ratio, etc.
  metrics            jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);
create index if not exists qa_results_run_idx on qa_results(run_id);

-- ─── attribute requests to a QA run ──────────────────────────────────────────
alter table requests add column if not exists qa_run_id uuid references qa_runs(id) on delete set null;
create index if not exists requests_qa_run_idx on requests(qa_run_id);
