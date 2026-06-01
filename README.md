# Cumulus

> Distributed micro data center — cloud control plane (Phase 0a prototype)

Cumulus pools small, distributed compute nodes — cloud VPSs now, Mac minis and
GPU boxes later — into **one virtual compute pool** for latency-relaxed
workloads (batch, async inference, embeddings, transcription).

**Phase 0a proves the distributed control loop on cloud VMs before any hardware
is bought**, on infrastructure that resembles the real thing without hardcoding
to the simulation. See [`phase_0a_build_spec.md`](./phase_0a_build_spec.md) for
the authoritative spec and [`mini_dc_cloud_software_prototype_plan.md`](./mini_dc_cloud_software_prototype_plan.md)
for the full multi-phase plan.

## The core loop

```
node registers → heartbeats → request submitted (with origin city + fan-out)
  → scheduler splits into child jobs → places each by locality-aware scoring
  → nodes run their shard → control plane merges results → dashboard shows
    the scatter→gather live → kill a node mid-job → it retries / fails cleanly
```

## Architecture

| Layer            | Tech                          | Hosted on                          |
|------------------|-------------------------------|------------------------------------|
| Dashboard        | Next.js + Tailwind            | **Vercel** (stateless)             |
| API + workers    | Fastify (TypeScript)          | **Always-on Hetzner VPS** (CPX22)  |
| Postgres         | Supabase                      | **Supabase**                       |
| Compute nodes    | Outbound-only TS agent        | Disposable Hetzner VPSs (≥2 EU regions) |

Four non-negotiable design seams (see spec §3):

1. **Agent is outbound-only** — no inbound ports on nodes (makes Mac-minis-behind-NAT work later).
2. **Capabilities & location are data, never assumptions** — a Mac mini joins as "just another node".
3. **Zero Hetzner-specific code outside `infra/`** — the app sees only generic nodes.
4. **Completion policy is pluggable** — hedging drops in later without an orchestration rewrite.

## Repo layout

```
apps/
  api/            Fastify standalone control plane (always-on)
  dashboard/      Next.js operator dashboard (Vercel)
  node-agent/     Outbound-only TS agent (Hetzner VPS / Mac mini)
packages/
  shared-types/   Domain model — single source of truth
  db/             Migrations + typed query layer
  orchestration/  Placement scoring + completion policies + merge strategies
  benchmark-suite/ CPU / network benchmarks
infra/
  terraform/      Hetzner provisioning (API VPS + fleet) — provider-specific code lives ONLY here
  migrations/     → symlink/source of packages/db migrations
  scripts/        spin-up / tear-down / simulation harness
docs/
  architecture.md, api.md, runbook.md
```

## Local development

Requires Node 20+ and pnpm 9+.

```bash
pnpm install
cp .env.example .env        # fill in values — see .env.example for what goes where

pnpm db:migrate             # apply migrations to your Supabase Postgres
pnpm dev:api                # start the control plane on :8080
pnpm dev:agent              # start a local node agent (register → heartbeat → poll)
pnpm dev:dashboard          # start the dashboard on :3000
```

To exercise scatter/gather, merge, timeout and partial-result logic **without
any hardware**, use the simulation harness:

```bash
pnpm --filter @cumulus/node-agent sim:nodes 5   # register 5 fake nodes
pnpm --filter @cumulus/api sim:submit 100       # submit a batch of 100 requests
```

## Provisioning & deployment

All Hetzner provisioning lives in [`infra/terraform`](./infra/terraform). See
[`docs/runbook.md`](./docs/runbook.md) to reproduce the full demo from scratch.

## Status

Phase 0a scaffold. See the task list and `docs/` for current state.
