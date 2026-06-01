# Phase 0a — Build Spec for Claude Code (YOLO-ready)

Project: Placetrace distributed micro data center — cloud software prototype
Phase: 0a (VPC-only simulation, but built to carry forward unchanged to Mac minis and GPU nodes)
Audience: Claude Code, running autonomously
Companion doc: `mini_dc_cloud_software_prototype_plan.md` (the full spec — this doc overrides it where they differ)

---

## 0. How to use this document

This is the authoritative build spec for the first working version. Build exactly this scope. Do not add features from the companion spec that aren't listed here — they are deliberately deferred (see §9). When in doubt, choose the simpler option and keep the abstraction seam clean rather than building the advanced version.

The guiding principle: **prove the distributed control loop works, on infrastructure that resembles the real thing, without optimizing for or hardcoding to the simulation.**

---

## 1. What I (the human) will provide

Before you start, I will set up accounts and give you credentials/tokens. Tell me clearly if you need any of these and they're missing. Here's what I'm planning to provide — flag if you'd recommend otherwise:

Three infrastructure partners total — kept deliberately minimal (KISS):

| Service | Purpose | What I provide | Notes |
|---|---|---|---|
| **Hetzner Cloud** | Both the control-plane API host AND the compute-fleet nodes | `HCLOUD_TOKEN`, scoped to a dedicated throwaway project | EU regions: Falkenstein, Nuremberg, Helsinki. Use the `hcloud` CLI / Terraform for repeatable provisioning. An MCP server is available for interactive ops. The API runs on its own always-on VPS (see below); the nodes are separate, disposable VPS instances. |
| **Supabase** | Managed Postgres for the control plane | Project URL + `service_role` key (server-side only) + anon key | This is the control-plane database. Don't put the service_role key anywhere client-side. |
| **Vercel** | Hosting the dashboard (Next.js) only | I'll connect the repo; you provide deployment config | Dashboard only — stateless Next.js frontend, a genuinely good Vercel fit. The API does NOT go here. |

**Hosting topology (decided — build to this):**
- **Dashboard** → Vercel (stateless Next.js).
- **API + background workers** → a small **always-on Hetzner VPS** (CPX22-class, ~2 vCPU / 4 GB, an EU region). Serverless is the wrong model for a control plane that must be polled every 5s by agents and run persistent background sweeps (offline detection, timeout/retry), so it lives on a normal long-running process. Use systemd (or pm2) to keep it alive and a reverse proxy (Caddy, for automatic TLS) in front. Same provider, tooling, and region as the nodes — one less partner to manage.
- **Postgres** → Supabase.

This keeps the whole compute footprint (control plane + nodes) on Hetzner, with only the DB and the static dashboard outsourced. Provider-neutral still holds: the API is a standard Node process that runs anywhere, so this choice stays portable.

I do NOT want to provide: AWS credentials (not using AWS this phase), any GPU cloud (deferred), any payment/billing provider (deferred).

---

## 2. Scope — what v1 must do

The demoable core loop, end to end:

1. I provision N nodes (start with 3) across at least two Hetzner regions.
2. Each node runs the agent, registers itself, and reports its capabilities and location.
3. The dashboard shows all nodes live, with status, capabilities, and location.
4. I submit a **mock request** from the dashboard, including an **origin location** (e.g. "Dresden") and a fan-out count.
5. The scheduler **decomposes** the request into child jobs and **places each** on a node using locality-aware soft scoring (nearer nodes preferred, but not exclusively).
6. Nodes execute their jobs and report results back.
7. The control plane **merges** the child results per the request's merge strategy and returns the combined result to the original caller.
8. The dashboard shows the request decomposing across nodes and the merged result on completion.
9. If a node dies mid-job, the system detects it and the job is retried or marked failed with a clear reason — without breaking the request.

Three mock workloads must exist:
- **echo/sleep** — proves routing + result return (configurable sleep to simulate work).
- **cpu_benchmark** — proves capability detection + comparable benchmark storage.
- **split_map_merge** — proves *real* scatter/gather: e.g. "embed 1,000 fake texts" → split into chunks → each node processes its chunk → merge into one ordered array. (Use a deterministic fake transform, e.g. hash each item; no real ML needed in 0a.)

---

## 3. Hard design principles (do not violate)

These exist so the 0a code carries forward to Mac minis (0b) and GPU nodes (2) **without a rewrite**. Violating them to make the VPC version easier is the main failure mode to avoid.

1. **Agent is outbound-only, from the first commit.** The agent initiates all connections (register, heartbeat, poll for jobs, post results). The control plane never connects *to* an agent. No inbound ports on nodes. This is non-negotiable even though VPCs would allow inbound — it's what makes Mac minis behind NAT work later.

2. **Capabilities and location are data, never assumptions.** No code path may assume x86, Linux, a core count, homogeneity, or low latency. Everything routing-related reads from the `NodeCapability` and `NodeLocation` records. A Mac mini must be able to join as "just another node" (`architecture: arm64`, `metalAvailable: true`) with zero control-plane changes.

3. **Provider-neutral.** Nothing in application code may hardcode Hetzner (no Hetzner API calls, region strings, or assumptions inside the control plane / agent / dashboard). Provisioning lives entirely in `infra/` (CLI scripts or Terraform). The app sees only generic nodes with generic location data. Adding AWS or a Mac mini later must require zero app-code change.

4. **Unreliable result delivery is the normal case.** Network drops mid-result are expected from 0b on, so model them now. The scatter/gather completion policy is real from day one, not bolted on.

5. **Build the seam, defer the policy.** Where an advanced feature is deferred (hedging, advanced placement), still build the abstraction it plugs into, so adding it later is a config/policy change, not a rebuild.

---

## 4. Architecture

Six conceptual layers from the companion spec, but v1 only fully builds four: control plane, node agent, orchestration (placement + scatter/gather), and operator dashboard. Telemetry is minimal (heartbeat metrics + structured logs). Billing/economics is a stub (record usage events; no real billing).

### 4.1 Stack

- **Language:** TypeScript end to end.
- **Shared types:** one `packages/shared-types` package imported by API, agent, and dashboard. Single source of truth for the domain model.
- **API:** Node.js + TypeScript. Use Fastify (or Hono) as a standalone always-on service on a Hetzner VPS (not serverless). REST + short-poll. No WebSockets/gRPC in v1.
- **DB:** Postgres via Supabase. Use migrations checked into the repo (`infra/migrations/`). Access via a typed query layer in `packages/db`.
- **Dashboard:** Next.js + Tailwind, deployed on Vercel.
- **Agent:** standalone TS process, single binary-ish (run via node). Modular per §6.
- **Queue:** none in v1. Use Postgres as the job store and poll it. Do not add Inngest/Temporal/BullMQ yet (deferred). The background loops (offline sweep, timeout sweep) are simple `setInterval` workers in the API process.

### 4.2 Control plane responsibilities

Node registry, auth (per-node tokens), heartbeat tracking, capability storage, benchmark storage, request intake, decomposition into jobs, placement scoring, dispatch (via the poll response), attempt tracking, result collection, **merge**, completion-policy enforcement, offline detection, timeout/retry sweeps, and the operator/customer APIs. Exposes everything the dashboard needs.

### 4.3 Orchestration: requests, jobs, attempts

This is the heart of v1 and the main delta from the companion spec, which doesn't model scatter/gather. The hierarchy:

```
Request (parent, what the caller submitted; has an origin + merge strategy + completion policy)
  └─ Job (child unit of work; one per fan-out shard)
       └─ JobAttempt (one execution on one node; retries create new attempts)
```

- A request decomposes into 1..N jobs depending on `fanOut` and workload.
- Each job is placed independently (so shards can run on different nodes — that's the point).
- Each job runs as an attempt on a node; failure/timeout spawns a retry attempt on a (possibly different) node, up to `maxRetries`.
- The request completes when its **completion policy** is satisfied, then results are merged and returned.

### 4.4 Completion policy (the seam that matters)

Implement completion policy as a first-class, pluggable concept on the request. v1 ships:
- `wait_for_all` (default) — all jobs must succeed (within timeout), else partial/failed per `onPartial`.
- `wait_for_quorum` — succeed when K of N jobs return; abandon the rest.

Each policy supports a request-level `timeoutSeconds` and an `onPartial` behavior (`return_partial` | `fail`). Design the interface so a future `first_valid_wins_cancel_siblings` policy (which is what **hedging** will use) drops in without touching orchestration internals. **Do not build hedging or racing in v1** — just leave the policy interface able to express it.

### 4.5 Placement: locality-aware soft scoring

Replace the companion spec's hard-filter-then-sort (§9.1) with filter-then-**score**. Hard filters first (these are pass/fail):

1. Node has required capabilities for the workload.
2. Node status is `online`.
3. Node is not `draining` / `maintenance` / `disabled`.

Then score the survivors; lowest score wins:

```
score(node, request) =
    w_distance  * normalizedDistance(node.location, request.originLocation)
  + w_queue     * normalizedQueueLength(node)
  + w_benchmark * (1 - normalizedBenchmarkScore(node, workloadType))
  + w_cost      * normalizedCost(node, request)
```

- All terms normalized to 0..1 so weights are comparable.
- Weights are **per workload type** (config, not hardcoded constants scattered in code). Batch workloads set `w_distance ≈ 0` (route on availability/cost); a future latency-sensitive class sets it high.
- **Locality is a soft preference, never a hard filter.** If the Dresden node is busy/full/down, a Dresden-origin request must still be servable by Potsdam. This is essential to the "one virtual pool" premise.
- Distance: great-circle (haversine) between node lat/long and request origin lat/long. If a request has no origin, `w_distance` term is treated as 0 for that request.

Record the chosen node AND the distance on the attempt, so the economics layer can later tell the "served locally" story (data point for real-estate partners).

---

## 5. Data model (deltas + full v1 set)

Use the companion spec's types as the base. Apply these **deltas**, then implement the full set below.

**Deltas from companion spec:**
- `NodeLocation`: add `latitude: number` and `longitude: number` (keep `city`/`state` for display).
- New parent entity **`Request`** sitting above `Job` (companion spec jumps straight to Job).
- `Request` carries `originLocation` (lat/long, optional), `mergeStrategy`, `completionPolicy`, `timeoutSeconds`, `onPartial`.
- `Job`: add `requestId` (FK to parent) and `shardIndex`.
- `JobAttempt`: add `placementDistanceKm?` and `placementScore?` for observability.

**v1 entities (Postgres tables + shared TS types):**
`nodes`, `node_locations`, `node_capabilities`, `node_heartbeats`, `node_benchmarks`, `requests`, `jobs`, `job_attempts`, `usage_events`, `operator_actions`.

Defer (do NOT create as full features): `customers` (stub a single internal customer is fine), `workloads` (hardcode the 3 mock types in v1), `billing_events`, `alerts`.

Key new type sketch:

```ts
type Request = {
  id: string;
  workloadType: 'echo_sleep' | 'cpu_benchmark' | 'split_map_merge';
  status: 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled';
  fanOut: number;                       // how many child jobs to split into
  originLocation?: { lat: number; lng: number; label?: string };
  mergeStrategy: 'concat' | 'ordered_array' | 'sum' | 'collect' | 'single';
  completionPolicy: 'wait_for_all' | 'wait_for_quorum';
  quorum?: number;                      // required if policy = wait_for_quorum
  onPartial: 'return_partial' | 'fail';
  timeoutSeconds: number;
  input: Record<string, unknown>;
  mergedResult?: unknown;
  createdAt: string;
  updatedAt: string;
};
```

---

## 6. Node agent

Modular, per the companion spec §10.1: config loader, registration client, token manager, heartbeat loop, capability scanner, benchmark runner, job poller, job executor, log shipper (structured JSON to stdout is fine in v1), metrics collector, local watchdog. Remote update manager: **stub in v1** (manual redeploy is acceptable for 0a; build the module boundary but a no-op implementation is fine).

Lifecycle: load config → register if no node id → store id+token locally → scan capabilities → first heartbeat → start heartbeat loop (15s) → start job poll loop (5s) → execute assigned jobs → report results → recover from errors.

Security (v1 minimum): unique per-node token, revocable; control plane authenticates every agent request; TLS for all control-plane comms; no secrets in logs; operator actions auditable; basic input validation on all endpoints.

The same agent binary must run on a Hetzner Linux VPS now and a Mac mini later with only config differences. Test the capability scanner returns sane values without assuming the platform.

---

## 7. API surface (v1)

Agent endpoints (token-authenticated):
- `POST /api/agent/register`
- `POST /api/agent/heartbeat`
- `POST /api/agent/capabilities`
- `POST /api/agent/jobs/poll`
- `POST /api/agent/jobs/:attemptId/start`
- `POST /api/agent/jobs/:attemptId/complete`
- `POST /api/agent/jobs/:attemptId/fail`
- `POST /api/agent/benchmarks`

Request/caller endpoints:
- `POST /api/requests` — submit a mock request (workloadType, fanOut, originLocation, mergeStrategy, completionPolicy, timeoutSeconds, input)
- `GET /api/requests/:id` — status + child job states
- `GET /api/requests/:id/result` — merged result

Operator endpoints:
- `GET /api/operator/nodes` (filters: status, region/location)
- `GET /api/operator/nodes/:id`
- `POST /api/operator/nodes/:id/benchmark`
- `POST /api/operator/nodes/:id/pause`
- `POST /api/operator/nodes/:id/drain`
- `GET /api/operator/requests`
- `GET /api/operator/jobs`
- `POST /api/operator/jobs/:id/retry`

---

## 8. Dashboard (v1)

Internal tool, function over polish. Views:
- **Node overview** — table: name, status, region/location (on a simple map or just labelled), capabilities summary, last heartbeat, queue length, jobs done today, failure rate.
- **Submit request** — form: workload type, fan-out count, **origin location** (dropdown of a few German cities with preset lat/long: Dresden, Potsdam, Berlin, Leipzig + a custom option), merge strategy, completion policy, timeout.
- **Request detail (the money view)** — show the request decomposing into child jobs, which node each landed on, the placement distance/score, live status per shard, and the merged result when complete. This is the demo artifact — make the scatter→gather visible.
- **Benchmark comparison** — compare nodes by CPU score and by network latency to control plane.
- Operator actions: trigger benchmark, pause node, drain node, retry job.

---

## 9. Explicitly deferred (do NOT build in v1)

Build the seams (noted), not these features:
- **Hedged / speculative / racing execution.** Seam: completion-policy interface must be able to express `first_valid_wins_cancel_siblings`. No racing logic, no utilization-aware suppression.
- Advanced placement inputs (energy cost, heat reuse value, solar, customer SLA, marketplace price signal, reliability score) — companion spec §9.2.
- GPU detection/benchmarks/isolation (Phase 2).
- Real billing, marketplace adapters, customer account model, usage metering as a product (Phase 1). Record raw `usage_events` only.
- Durable workflow engine / external queue. Postgres polling is the v1 mechanism.
- Remote auto-update (stub the module).
- Heat reuse modeling, location readiness module.
- WebSockets/SSE (short-poll is fine in v1).

---

## 10. Repo structure

```
mini-dc-prototype/
  apps/
    api/                # Fastify standalone service (always-on)
    dashboard/          # Next.js, Vercel
    node-agent/         # TS agent, runs on Hetzner VPS / Mac mini
  packages/
    shared-types/       # domain model, single source of truth
    db/                 # migrations + typed query layer
    orchestration/      # placement scoring + completion policies + merge strategies
    benchmark-suite/    # cpu / network benchmarks
  infra/
    terraform/          # OR scripts/ with hcloud CLI — provider-neutral provisioning
    migrations/
    scripts/            # spin-up / tear-down N nodes across regions
  docs/
    architecture.md
    api.md
    runbook.md          # how I provision, deploy, and run the demo
  README.md
```

Provisioning (Hetzner) lives ONLY in `infra/` — it provisions both the always-on API VPS and the disposable fleet nodes. Nothing Hetzner-specific anywhere else.

---

## 11. Build order (suggested for autonomous run)

1. Monorepo scaffold + `shared-types` (full domain model incl. `Request` + locality fields).
2. `packages/db` + migrations for the v1 tables on Supabase.
3. `apps/api`: register → heartbeat → capabilities → poll → start/complete/fail loop, with token auth and the background offline/timeout sweeps.
4. `packages/orchestration`: placement scoring (locality-aware) + completion policies + merge strategies, unit-tested in isolation.
5. `apps/api`: request intake → decomposition → placement → dispatch → collect → merge → return.
6. `apps/node-agent`: full lifecycle, 3 workload executors, capability scanner, benchmark runner.
7. `apps/dashboard`: node overview, submit-request form, request-detail scatter/gather view, benchmark comparison.
8. `infra/`: provider-neutral provisioning for both the always-on API VPS and 3 disposable fleet nodes across ≥2 Hetzner regions; deploy the API to its VPS (systemd/pm2 + Caddy for TLS); runbook.
9. A small **simulation harness**: optional artificial latency/jitter/failure knob in the agent (env-flag) so merge/timeout/partial-result logic is exercised before hardware exists. Also a script to register several fake nodes and submit batches.

---

## 12. Definition of done (v1)

- ≥3 real nodes registered across ≥2 Hetzner regions, all visible live on the dashboard.
- A node provisions and registers in under 15 minutes (ideally far less).
- A mock request with an origin and fan-out is submitted via the API/dashboard, split into child jobs, placed with locality preference (nearer node wins when free; falls back when busy/down), executed, merged, and returned.
- All three workloads work, including `split_map_merge` end to end.
- Killing a node mid-job is detected; the affected job retries or fails cleanly with a reason; the request does not hang forever (timeout fires).
- Completion policies `wait_for_all` and `wait_for_quorum` both demonstrably work; partial-result handling works.
- Benchmarks stored and comparable across nodes; network latency per node visible.
- Zero Hetzner-specific code outside `infra/`. The agent uses outbound connections only.
- `usage_events` recorded per attempt (raw data for later economics).
- Runbook lets me reproduce the full demo from scratch.

---

## 13. First response from Claude Code — answer before scaffolding

1. Confirm the exact env vars / secrets you need from me for each service, and where each goes (which live on the API VPS, which on Vercel, and which must never touch the client).
2. Confirm Terraform vs. `hcloud` shell scripts for `infra/` (your pick — optimize for repeatability and provider-neutrality). Note `infra/` must provision both the API VPS and the fleet nodes.
3. Tell me the exact Hetzner VPS size/region you want for the API host so I can provision it (default: CPX22-class, EU region matching where most nodes will run).
4. Flag anything in this spec you think is over-scoped for a first working version, per KISS.
