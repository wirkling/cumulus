# infra/scripts

Convenience wrappers around Terraform. Run from anywhere; they `cd` into
`infra/terraform` and use your `terraform.tfvars`.

| Script | What it does | Cost effect |
|---|---|---|
| `./sleep.sh` | Destroys the **fleet nodes**, keeps the **API host** up | Drops to ~€5.5/mo (API only) |
| `./wake.sh` | Recreates the fleet; nodes re-register in ~2-3 min | Back to full ~€17/mo |
| `./status.sh` | Shows running servers, API URL, health, and node count | — |

Why fleet-only sleep: the API host keeps a **stable sslip.io URL**, so the
dashboard keeps working (showing 0 nodes) and you never have to update Vercel's
`API_BASE_URL`. All durable state is in Supabase, so destroying/recreating nodes
loses nothing — they just re-register on wake.

> Note: Hetzner bills a server as long as it *exists*, even powered off — so
> deleting (what these scripts do) is the only way to actually stop the meter.

## Full stop (€0)

To tear down **everything** including the API host:

```bash
cd infra/terraform && terraform destroy
```

Wake from a full stop with `terraform apply`. Caveat: the API host gets a new IP,
so its sslip.io hostname changes — update `API_BASE_URL` in Vercel after.

```bash
chmod +x infra/scripts/*.sh   # first time only
```
