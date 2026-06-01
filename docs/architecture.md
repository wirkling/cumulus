# Architecture (Phase 0a)

Cumulus pools distributed compute nodes into one virtual pool. Phase 0a proves
the control loop on cloud VMs, built so the same code carries forward to Mac
minis (0b) and GPU nodes (2) **without a rewrite**.

## Layers

| Layer | Package / app | Notes |
|---|---|---|
| Control plane | `apps/api` (Fastify) | Always-on host; agent + caller + operator APIs; background sweeps |
| Node agent | `apps/node-agent` | Outbound-only; runs on any platform |
| Orchestration | `packages/orchestration` | Pure logic: placement, completion policy, merge, decompose |
| Persistence | `packages/db` + Supabase Postgres | Migrations + typed repos |
| Domain model | `packages/shared-types` | Single source of truth, imported everywhere |
| Dashboard | `apps/dashboard` (Next.js) | Operator UI on Vercel |

## The four seams that must not be violated (spec §3)

1. **Agent is outbound-only.** Register, heartbeat, poll, and result reporting
   are all agent-initiated (`apps/node-agent/src/client.ts`). The control plane
   never dials a node. Operator commands ride back on the heartbeat ack via the
   in-memory directive queue (`apps/api/src/services/directives.ts`).
2. **Capabilities & location are data.** Routing reads `NodeCapability` /
   `NodeLocation` records; no code assumes arch, core count, or low latency. A
   Mac mini joins as `arm64` / `metalAvailable: true` with zero control-plane
   change.
3. **Zero Hetzner code outside `infra/`.** The app sees generic nodes with
   lat/long. All provisioning is Terraform in `infra/terraform`.
4. **Completion policy is pluggable.** `evaluateCompletion` returns
   `cancelJobIds`, so `first_valid_wins_cancel_siblings` (hedging) drops in
   later without touching orchestration internals. It is intentionally
   unimplemented in v1 and throws if requested.

## Orchestration hierarchy

```
Request (what the caller submitted; origin + merge strategy + completion policy)
  └─ Job (one per fan-out shard; placed independently)
       └─ JobAttempt (one execution on one node; a retry is a new attempt)
```

## The core loop

```
register → heartbeat → POST /api/requests
   → decomposeRequest()            (packages/orchestration/decompose.ts)
   → dispatchPlaceableJobs()       (apps/api/src/services/placement.ts)
        → scoreNodes()             locality-aware soft scoring
        → placeJobOnNode()         atomic: create attempt + flip job assigned
   → agent polls → claims attempt → executes → complete/fail
   → finalizeRequest()             (apps/api/src/services/completion.ts)
        → evaluateCompletion()     policy decision
        → mergeResults()           gather
```

## Placement scoring (spec §4.5)

Hard filters first (online, not draining/maintenance/disabled, has required
capabilities), then lowest weighted score wins:

```
score = w_distance·norm(distanceKm) + w_queue·norm(queue)
      + w_benchmark·(1−norm(benchmark)) + w_cost·norm(cost)
```

Weights are per-workload config in `packages/shared-types/workloads.ts`. Distance
is haversine from node lat/long to request origin. **Locality is a soft
preference, never a hard filter** — a busy/offline near node falls back to a far
one. With no origin, the distance term is 0.

## Background sweeps (`apps/api/src/services/sweeps.ts`)

- **offline** — flips nodes with stale heartbeats to `offline`, fails their
  in-flight attempts, re-places, finalizes affected requests.
- **timeout** — fails attempts past their deadline; finalizes requests past
  their timeout (so nothing hangs even if a shard never got placed).
- **dispatch** — places any queued/retrying jobs (covers all-busy + retries).

Each sweep is defensive: a thrown error is logged, never fatal. No external
queue in v1 — Postgres is the job store (spec §4.1).

## Data model

10 v1 tables: `node_locations`, `nodes`, `node_capabilities`, `node_heartbeats`,
`node_benchmarks`, `requests`, `jobs`, `job_attempts`, `usage_events`,
`operator_actions`. Deferred to later phases: `customers` (a single `internal`
customer is stubbed), `workloads` (3 hardcoded), `billing_events`, `alerts`.
