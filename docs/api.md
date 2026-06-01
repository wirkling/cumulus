# API reference (v1)

Base URL: the control plane host (e.g. `https://<dashed-ip>.sslip.io`). DTOs are
defined in `packages/shared-types/src/api.ts`.

## Auth

| Group | Mechanism |
|---|---|
| `POST /api/agent/register` | `Authorization: Bearer <AGENT_BOOTSTRAP_TOKEN>` (or `x-bootstrap-token`) |
| Other `/api/agent/*` | `Authorization: Bearer <per-node token>` + `nodeId` in body |
| `/api/operator/*` | `x-operator-key: <OPERATOR_API_KEY>` (or Bearer) |
| `/api/requests*` | none in v1 (internal); proxied server-side by the dashboard |

Per-node tokens are random, stored only as a sha256 hash, and revocable.

## Agent endpoints

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/agent/register` | `RegisterRequest` | `RegisterResponse` (nodeId, agentToken, config) |
| POST | `/api/agent/heartbeat` | `HeartbeatRequest` | `HeartbeatResponse` (+ directives) |
| POST | `/api/agent/capabilities` | `CapabilitiesRequest` | `{ ok }` |
| POST | `/api/agent/jobs/poll` | `{ nodeId }` | `PollResponse` (claims + returns one attempt) |
| POST | `/api/agent/jobs/:attemptId/start` | `{ nodeId }` | `{ ok }` |
| POST | `/api/agent/jobs/:attemptId/complete` | `JobCompleteRequest` | `{ ok }` |
| POST | `/api/agent/jobs/:attemptId/fail` | `JobFailRequest` | `{ ok }` |
| POST | `/api/agent/benchmarks` | `BenchmarkSubmitRequest` | `{ ok }` |

`poll` claims the next `assigned` attempt for the node (flips it to `started`,
job to `running`) so a crashed agent's work is recovered by the timeout sweep.

## Caller / request endpoints

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/requests` | `SubmitRequestBody` | `RequestDetail` (201) |
| GET | `/api/requests/:id` | — | `RequestDetail` (request + child jobs + latest attempts) |
| GET | `/api/requests/:id/result` | — | `{ requestId, status, mergedResult }` |

`SubmitRequestBody`: `workloadType`, `fanOut`, `originLocation?`,
`mergeStrategy?`, `completionPolicy?`, `quorum?`, `onPartial?`, `timeoutSeconds?`,
`priority?`, `input`. Defaults come from `WORKLOADS[workloadType]`.

### Example

```bash
curl -X POST https://HOST/api/requests -H 'content-type: application/json' -d '{
  "workloadType": "split_map_merge",
  "fanOut": 4,
  "originLocation": { "lat": 51.0504, "lng": 13.7373, "label": "Dresden" },
  "input": { "items": ["a","b","c","d","e","f","g","h"] }
}'
```

## Operator endpoints

| Method | Path | Notes |
|---|---|---|
| GET | `/api/operator/nodes?status=&locationId=` | `NodeSummary[]` |
| GET | `/api/operator/nodes/:id` | `NodeDetail` (+ benchmarks, recent attempts) |
| POST | `/api/operator/nodes/:id/pause` | → `maintenance`, audited |
| POST | `/api/operator/nodes/:id/drain` | → `draining`, audited |
| POST | `/api/operator/nodes/:id/disable` | → `disabled`, audited |
| POST | `/api/operator/nodes/:id/benchmark` | enqueues a benchmark directive |
| GET | `/api/operator/requests` | recent requests |
| GET | `/api/operator/jobs` | recent jobs (+ latest attempt + node name) |
| POST | `/api/operator/jobs/:id/retry` | re-queue a job for placement |

## Workloads (v1)

| Type | Fan-out | Merge default | What it proves |
|---|---|---|---|
| `echo_sleep` | yes | `collect` | routing + result return |
| `cpu_benchmark` | no | `collect` | capability detection + comparable benchmark |
| `split_map_merge` | yes | `ordered_array` | real scatter/gather (hash each item per shard) |

## Completion policies

- `wait_for_all` — all jobs must succeed (or `onPartial` decides).
- `wait_for_quorum` — succeed at K of N; abandon the rest (`quorum` required).
- `first_valid_wins_cancel_siblings` — **seam only**, throws in v1 (hedging).
