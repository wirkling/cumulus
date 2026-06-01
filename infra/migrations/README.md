# Migrations

The authoritative SQL migrations live in [`packages/db/migrations`](../../packages/db/migrations)
and are applied with the typed runner:

```bash
DATABASE_URL=... pnpm --filter @cumulus/db migrate
```

The API host runs this automatically on first boot (see
`infra/terraform/cloud-init/api.yaml.tftpl`). This file exists only as a pointer
so the spec's `infra/migrations/` location resolves to one source of truth.
