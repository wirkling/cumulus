-- Model A — a customer's exclusive, time-bounded hold over GPU cards on one
-- node. A lease lives ALONGSIDE the Request → Job pipeline; it is NOT a job (a
-- lease has duration, exclusivity, and teardown that the job lifecycle does not
-- model). Placement excludes a node with an active lease from hosted (Model B)
-- work. Execution of the customer's own container is deferred (Phase 2); this
-- table is the Sprint-1 abstraction + the placement-exclusion source.
create table if not exists device_leases (
  id          uuid primary key default gen_random_uuid(),
  node_id     uuid not null references nodes(id) on delete cascade,
  -- Leases are customer-exclusive, so the FK to customers is real (unlike the
  -- requests.customer_id text column, which stays a single internal customer).
  customer_id uuid not null references customers(id) on delete cascade,
  -- Which cards are held. '[]' = whole node (Sprint 1 leases the whole box).
  gpu_indices jsonb not null default '[]'::jsonb,
  status      text not null default 'active',  -- active | released | expired
  started_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  released_at timestamptz,
  metadata    jsonb,
  created_at  timestamptz not null default now()
);
-- Placement queries active, unexpired leases per node on every dispatch pass.
create index if not exists device_leases_active_idx
  on device_leases(node_id)
  where status = 'active';
create index if not exists device_leases_customer_idx on device_leases(customer_id);
