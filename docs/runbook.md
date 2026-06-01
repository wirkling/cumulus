# Runbook

How to reproduce the full demo — locally first, then on Hetzner.

## Prerequisites

- Node 20+, pnpm 9+ (`corepack enable`)
- A Supabase project (or any Postgres) for the cloud path
- For provisioning: `terraform`, a Hetzner Cloud token, an SSH public key

```bash
pnpm install
```

## A. Local demo (no cloud, ~2 min)

Proves the whole loop against a throwaway Postgres. This is exactly what was used
to verify v1.

```bash
# 1. Postgres
docker run -d --name cumulus-pg -e POSTGRES_PASSWORD=cumulus -e POSTGRES_DB=cumulus \
  -p 55432:5432 postgres:16-alpine
export DATABASE_URL="postgresql://postgres:cumulus@localhost:55432/cumulus"

# 2. Migrate
pnpm --filter @cumulus/db migrate

# 3. API (new shell, keep DATABASE_URL exported)
AGENT_BOOTSTRAP_TOKEN=boot OPERATOR_API_KEY=opkey PORT=8080 \
  pnpm --filter @cumulus/api start

# 4. Fake fleet (new shell) — 4 nodes across EU locations
CONTROL_PLANE_URL=http://localhost:8080 AGENT_BOOTSTRAP_TOKEN=boot \
  pnpm --filter @cumulus/node-agent sim:nodes 4

# 5. Dashboard (new shell)
API_BASE_URL=http://localhost:8080 OPERATOR_API_KEY=opkey \
  pnpm --filter @cumulus/dashboard dev
# open http://localhost:3000

# 6. Submit a scatter/gather request
curl -X POST http://localhost:8080/api/requests -H 'content-type: application/json' -d '{
  "workloadType":"split_map_merge","fanOut":4,
  "originLocation":{"lat":51.0504,"lng":13.7373,"label":"Dresden"},
  "input":{"items":["a","b","c","d","e","f","g","h"]}}'
# …or a batch:  API_BASE_URL=http://localhost:8080 pnpm --filter @cumulus/api sim:submit 50
```

Watch the request decompose across nodes (nearer-first) and the merged result
appear on the request-detail page. Kill a fake node mid-flight to see retry /
clean timeout.

Teardown: `docker rm -f cumulus-pg`.

## B. Cloud deploy (Hetzner + Supabase + Vercel)

### 1. Database
Create a Supabase project. Grab the **direct** Postgres connection string, the
project URL, and the `service_role` key.

### 2. Provision the fleet + API host (Terraform)

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars   # fill in (gitignored)
#   - hcloud_token, ssh_public_key
#   - database_url, supabase_url, supabase_service_role_key
#   - agent_bootstrap_token, operator_api_key  (openssl rand -hex 32)
#   - node_locations = ["fsn1","hel1","fsn1"]   (≥2 regions)
terraform init
terraform apply
```

This stands up:
- **API host** (CPX22, fsn1): clones the repo, installs deps, runs migrations,
  starts the control plane under systemd, and fronts it with Caddy on
  `https://<dashed-ip>.sslip.io` (automatic TLS).
- **3 fleet nodes** across fsn1 + hel1: each runs the outbound-only agent under
  systemd, self-declaring its region's lat/long.

Outputs give you `api_url` and `node_ips`. Within a few minutes the nodes
register and appear in the dashboard.

> Private repo? Set `repo_clone_url` to embed a GitHub token (see tfvars example).

### 3. Dashboard (Vercel)
- Import `wirkling/cumulus`, set **Root Directory = `apps/dashboard`** (Vercel
  detects pnpm workspaces and installs from the repo root).
- Env vars (both server-side, **not** `NEXT_PUBLIC`):
  - `API_BASE_URL` = the Terraform `api_url`
  - `OPERATOR_API_KEY` = the same value you set in tfvars
- Deploy. The dashboard proxies operator calls server-side, so the key never
  reaches the browser.

### 4. Verify
```bash
curl https://<dashed-ip>.sslip.io/health      # {"ok":true,...}
```
Open the Vercel URL → Nodes shows the fleet online → Submit a request → watch
scatter/gather.

## Operating notes

- **Logs:** `journalctl -u cumulus-api -f` (API host), `journalctl -u cumulus-agent -f` (nodes).
- **Restart:** `systemctl restart cumulus-api` / `cumulus-agent`.
- **Redeploy code (0a is manual):** `cd /opt/cumulus && git pull && pnpm install && systemctl restart cumulus-api`.
- **Pause/drain a node:** use the dashboard, or POST `/api/operator/nodes/:id/{pause,drain}`.
- **Teardown:** `terraform destroy`.
