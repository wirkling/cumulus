# Distributed Micro Data Center Prototype, Cloud Software Planning Spec

Prepared for: Claude Code planning and implementation
Project context: Placetrace distributed micro data center concept
Focus: cloud software components for prototype phases, starting with VPC-based simulation and moving toward Mac mini / edge-node testing, then GPU nodes

---

## 1. Executive Summary

We want to build a cloud software prototype for a distributed micro data center network.

The physical concept is a network of small compute nodes installed in real estate assets, for example unused ground-floor shops, technical rooms, or commercial spaces in multi-family buildings. The initial commercial angle is to use underutilized real estate and local building infrastructure to host small compute clusters. The long-term angle is to combine compute revenue with heat reuse, solar integration, and building-level infrastructure synergies.

The prototype should not start with expensive GPU hardware. The first software milestone should prove whether we can manage, benchmark, route, monitor, and operate distributed compute nodes as one virtual pool.

The recommended starting point is:

1. Phase 0a, VPC-only simulation: use cloud VMs to test orchestration, node registration, job scheduling, benchmarking, observability, pricing logic, and failure management.
2. Phase 0b, Mac mini / local hardware proof: run the same node agent on two to three Mac minis in different network setups, for example DSL/fiber, fiber/fiber, and different physical distances.
3. Phase 1, small paid inference/batch workload prototype: add real revenue-generating workloads via marketplaces or direct B2B workloads where latency is not critical.
4. Phase 2, GPU node prototype: introduce GPU hardware and begin testing real inference economics, cooling, uptime, remote management, security, and capacity planning.
5. Phase 3, real estate integrated node: test a location with commercial power, fiber, building integration, and possibly heat reuse.

The software built in Phase 0a should be reusable. It should not be treated as throwaway code. The node agent, control plane, job abstraction, telemetry pipeline, benchmark framework, and failure-management logic can carry forward from VPCs to Mac minis and then to GPU nodes.

---

## 2. Core Product Hypothesis

A distributed set of small compute locations can be operated as one virtual compute pool for workloads where latency is less critical than price, locality, resilience, sustainability, or availability.

Target workloads for early phases:

- Batch jobs
- Async inference
- Queue-based AI workloads
- Embeddings
- Transcription
- Image generation jobs with relaxed latency requirements
- Fine-tuning experiments, later only if economics and thermal constraints support it
- Internal workloads for proof of software efficiency
- Marketplace workloads, for utilization in early revenue testing
- Direct B2B workloads, as the preferred mid-term revenue source

Workloads to avoid in the first prototype:

- Latency-critical end-user chat serving
- Large-model training
- High-availability enterprise workloads with strict SLAs
- Regulated data workloads before compliance is mature
- Any workload requiring physical data residency guarantees before location attestation is built

---

## 3. Prototype Goals

### 3.1 Technical Goals

The prototype should prove that we can:

- Register distributed nodes into one cloud control plane.
- Detect node capabilities automatically.
- Run benchmarks and store comparable results.
- Assign jobs to suitable nodes.
- Route jobs based on capability, availability, latency, cost, and location.
- Track node health, uptime, temperature, power draw, bandwidth, and job success rates.
- Handle node failure and retry jobs safely.
- Run the same basic software stack across VPCs, Mac minis, and later GPU nodes.
- Compare network setups, for example DSL/fiber vs fiber/fiber.
- Compare physical distance effects on latency and job completion times.
- Simulate revenue, utilization, and cost per node.
- Support an operator dashboard for monitoring and manual intervention.

### 3.2 Business Goals

The prototype should help answer:

- Can we aggregate small compute locations into a commercially usable virtual node?
- Which workloads are realistic for early revenue?
- What utilization is needed for positive contribution margin?
- Which stakeholder receives which value, Placetrace, real estate owner, energy partner, and possibly tenants?
- How much does bandwidth, power, water, cooling, and maintenance affect the economics?
- Can heat reuse become a revenue stream or cost offset?
- Does a ground-floor shop or commercial unit materially simplify rollout compared with residential technical rooms?
- Can the model scale across locations in Brandenburg and Sachsen-Anhalt without being operationally messy?

### 3.3 Investor / Real Estate Developer Goals

The prototype should generate proof points that are easy to explain to a real estate developer:

- Compute node fits into a small amount of space.
- It can monetize otherwise unused commercial space.
- It can use existing or upgraded building infrastructure.
- It may improve building economics through heat reuse.
- The software can pool multiple buildings into one virtual compute asset.
- Nodes can be monitored and operated remotely.
- The first locations do not need to be in one city, if the workloads are async or batch-oriented.

---

## 4. Recommended Phase Structure

## Phase 0a, VPC-Only Software Simulation

### Goal

Build the core cloud control plane and node agent using cloud VMs instead of physical hardware.

This phase should answer whether the software architecture works before buying hardware.

### Environment

- 3 to 5 VPC instances across one or more cloud providers or regions.
- Start with CPU-only workloads.
- Optional: include one GPU cloud instance for later compatibility testing.
- All instances run the same node agent.

### What Phase 0a Can Test

- Node registration
- Heartbeats
- Capability detection for CPU, RAM, disk, network, and optional GPU metadata
- CPU benchmarks
- Memory benchmarks
- Disk benchmarks
- Network benchmarks between nodes and to the control plane
- Job dispatch
- Queue handling
- Worker lifecycle
- Logs and telemetry
- Failure handling
- Node offline detection
- Retry logic
- Basic utilization tracking
- Simulated pricing and margin tracking
- Security model for node authentication

### What Phase 0a Cannot Fully Test

- Real consumer or commercial internet instability
- Physical heat
- Power draw
- Cooling behavior
- Noise
- Real hardware failure
- Local network router issues
- Building-level constraints
- GPU thermals
- Smart meter integration
- Real heat reuse

### Success Criteria

- A new node can be provisioned and registered in less than 15 minutes.
- The control plane can see all nodes and their capabilities.
- Benchmark results are stored and visible.
- A job can be submitted through an API and executed on a selected node.
- Failed jobs are retried or marked failed with clear reasons.
- A node disappearing mid-job does not break the system.
- Basic dashboard shows node status, job status, benchmark results, and utilization.
- Software abstractions are hardware-neutral enough to carry into Phase 0b.

---

## Phase 0b, Mac mini / Local Hardware Proof

### Goal

Run the same node agent on real local hardware to test network variability, physical deployment, remote management, and edge-node behavior.

### Hardware

Recommended: 3 Mac minis rather than 2.

Reason:

- 2 nodes are enough to prove basic dispatch.
- 3 nodes are much better for failure testing, quorum-like scenarios, routing, degraded operation, and comparing network paths.

The Mac minis should run headless. Screens are not needed after setup.

### Setup Variants

Test different connection scenarios:

- Fiber / fiber
- DSL / fiber
- DSL / DSL
- Same physical site vs different sites
- Same city vs different region
- Consumer router vs business router
- Wired Ethernet only, no Wi-Fi for baseline tests

### What Phase 0b Tests

- Node agent portability from VPC to physical machine
- NAT traversal or outbound-only connection model
- Remote updates
- Remote restart
- Local job execution
- Local log collection
- Real-world latency
- Bandwidth consistency
- Node downtime
- Manual unplug / failure testing
- Headless operation
- Security of unattended nodes
- Local disk behavior
- Operator workflows

### Success Criteria

- Mac minis can register without inbound firewall rules.
- Nodes can run headless and recover after restart.
- Jobs can be dispatched reliably across variable connections.
- Failed or disconnected nodes are detected quickly.
- Remote update path works.
- Benchmarking clearly shows difference between network setups.
- The dashboard makes these differences visible.

---

## Phase 1, Early Revenue Prototype

### Goal

Start running real paid or semi-paid workloads while keeping operational risk low.

### Workload Strategy

Use two channels:

1. Marketplace workloads for utilization
2. Direct B2B workloads for strategic revenue

Marketplace workloads are useful to keep utilization high and validate demand, but they should not define the full business model. Direct B2B workloads are more strategic because they allow better margins, clearer requirements, and stronger customer relationships.

### Suitable Phase 1 Workloads

- Batch inference
- Embedding generation
- Video/audio transcription
- OCR
- Document conversion
- AI image generation jobs with relaxed latency
- Data processing jobs
- Non-sensitive internal workloads
- Synthetic benchmark workloads that mimic revenue jobs

### Required Additional Capabilities

- Customer/job account model
- Usage metering
- Basic billing export
- Per-job cost estimate
- Node-level revenue attribution
- Stakeholder revenue split simulation
- Marketplace adapter, if used
- Direct API for B2B job submission
- More robust security isolation

### Success Criteria

- At least one workload type can generate revenue or a realistic proxy for revenue.
- System can calculate revenue per node and margin per job.
- Operator can see utilization by node, workload type, and customer.
- Failed jobs do not create billing confusion.
- System can distinguish between internal, marketplace, and direct customer workloads.

---

## Phase 2, GPU Node Prototype

### Goal

Introduce actual GPU hardware and test economics, cooling, remote operations, and workload compatibility.

### Technical Focus

- GPU detection
- GPU benchmark suite
- CUDA / ROCm compatibility, depending on hardware
- Driver management
- Containerized GPU workloads
- Model runtime support
- GPU temperature and utilization monitoring
- Power draw monitoring
- Job placement by GPU type and VRAM
- Marketplace compatibility
- Direct workload API compatibility

### Success Criteria

- GPU node registers and reports detailed capabilities.
- GPU benchmarks are stored and comparable.
- System can route GPU jobs only to compatible nodes.
- Thermal and power metrics are visible.
- Jobs can be isolated from each other.
- Remote recovery is possible after driver or runtime failure.
- Basic unit economics are visible per GPU type.

---

## Phase 3, Real Estate Integrated Node

### Goal

Deploy a small real compute node into a candidate real estate location.

### Candidate Locations

Unused ground-floor shops are attractive because:

- They may already be commercially zoned.
- They often have easier physical access.
- They are less sensitive than residential spaces.
- Empty space already has an opportunity cost.
- They may be easier to upgrade with commercial power and fiber.
- They make the business case easier for the real estate owner.

### Building Requirements to Track

- 3-phase commercial power
- Target support around 50 kW for post-prototype small node, subject to actual hardware design
- Ideally 63A to 125A+ depending on voltage and electrical setup
- Fiber internet preferred
- DSL not suitable as primary connection for real GPU operations, except as test input or backup
- Cooling path
- Heat exhaust path
- Noise control
- Physical security
- Fire safety
- Insurance
- Remote access
- Water loop feasibility, only if heat reuse is part of the test
- Separation of cooling loop and domestic water
- Regulatory watchlist: German Energy Efficiency Act and EU Energy Efficiency Directive

### Success Criteria

- Location can host a stable node for several weeks.
- Power and internet are sufficient for the chosen hardware.
- Noise and heat are manageable.
- Physical security is acceptable.
- Remote monitoring works.
- Unit economics can be calculated from real usage.
- Real estate owner can understand space value vs compute value.

---

## 5. High-Level Architecture

The software should be split into six layers:

1. Control Plane
2. Node Agent
3. Job Orchestration Layer
4. Telemetry and Observability Layer
5. Billing and Economics Layer
6. Operator Dashboard

### 5.1 Control Plane

The control plane is the central cloud system that knows all nodes, jobs, users, capabilities, benchmarks, and operational status.

Responsibilities:

- Register nodes
- Authenticate nodes
- Track heartbeats
- Store capabilities
- Store benchmark results
- Accept job submissions
- Decide job placement
- Dispatch jobs
- Track job lifecycle
- Store job results or result metadata
- Coordinate retries
- Trigger alerts
- Expose APIs to dashboard and external customers

### 5.2 Node Agent

The node agent runs on every compute node.

It should be written to run across:

- VPC Linux instances
- Mac minis
- Future Linux GPU servers
- Possibly small edge appliances later

Responsibilities:

- Register with control plane
- Maintain secure outbound connection
- Send heartbeats
- Report capabilities
- Run benchmarks
- Pull or receive jobs
- Execute jobs
- Stream logs
- Report resource usage
- Report job results
- Watch local health
- Restart local workers
- Apply remote configuration
- Support safe remote updates

Important design principle: the node should initiate outbound connections to the control plane. Avoid requiring inbound ports at early stages because real-world locations may sit behind NAT, consumer routers, or restrictive firewalls.

### 5.3 Job Orchestration Layer

The orchestration layer decides where work should run.

Inputs:

- Workload type
- Required CPU/GPU/RAM/disk
- Required model/runtime
- Expected duration
- Customer priority
- Max price
- Latency tolerance
- Data residency needs
- Node health
- Node queue depth
- Node benchmark score
- Node cost estimate
- Node location

Outputs:

- Selected node
- Job execution plan
- Retry policy
- Timeout policy
- Billing/metering policy

### 5.4 Telemetry and Observability Layer

This layer gives the operator confidence that distributed nodes are working.

Metrics:

- Node online/offline
- CPU usage
- GPU usage
- RAM usage
- Disk usage
- Network latency
- Bandwidth
- Job queue length
- Job success rate
- Job failure reason
- Temperature, where available
- Power draw, where available
- Estimated cost
- Estimated revenue
- Utilization

Logs:

- Node agent logs
- Job execution logs
- System errors
- Benchmark logs
- Update logs
- Security events

Traces:

- Job accepted
- Job assigned
- Job started
- Job completed
- Job failed
- Job retried
- Result delivered

### 5.5 Billing and Economics Layer

The prototype should not overbuild billing, but it must capture enough data to model economics.

Track:

- Job revenue
- Node revenue
- Customer revenue
- Marketplace revenue
- Direct B2B revenue
- Compute time
- GPU time
- CPU time
- Data transfer
- Storage usage
- Power cost estimate
- Internet cost estimate
- Cooling cost estimate
- Maintenance cost estimate
- Stakeholder split
- Heat reuse credit, if applicable

### 5.6 Operator Dashboard

The operator dashboard should be built for internal use first.

Views:

- Node overview
- Node detail
- Job queue
- Job detail
- Benchmark comparison
- Network test comparison
- Failure events
- Revenue and utilization
- Location view
- Hardware inventory
- Alerts
- Manual controls

Manual controls:

- Pause node
- Drain node
- Restart node agent
- Trigger benchmark
- Re-run failed job
- Mark node under maintenance
- Change node weight
- Disable job type on node
- Trigger remote update

---

## 6. Suggested Tech Stack

This is a pragmatic stack for fast prototyping. Claude Code can adjust based on the existing Placetrace environment.

### 6.1 Frontend

Recommended:

- Next.js or comparable React stack
- Tailwind or simple component library
- Deployed on Vercel or Netlify

Reason:

- Fast internal dashboard development
- Easy API integration
- Good fit for Claude Code iteration

### 6.2 Backend API

Recommended:

- Node.js / TypeScript
- Fastify, Hono, NestJS, or Next.js API routes
- REST first, WebSocket/SSE where useful

Reason:

- TypeScript end-to-end reduces mismatch
- Easy to share types between dashboard, API, and agent
- Good developer speed

### 6.3 Database

Recommended:

- Postgres
- Supabase or managed Postgres

Core tables:

- nodes
- node_locations
- node_capabilities
- node_heartbeats
- node_benchmarks
- jobs
- job_attempts
- job_logs
- customers
- workloads
- usage_events
- billing_events
- alerts
- operator_actions

### 6.4 Queue / Workflow Orchestration

Recommended:

- Inngest, Temporal, BullMQ, or managed queue plus workers

For prototype simplicity:

- Use a durable workflow tool if already familiar.
- Avoid building fragile custom retry logic too early.

Workflow examples:

- node.heartbeat.received
- node.offline.detected
- benchmark.requested
- benchmark.completed
- job.submitted
- job.assigned
- job.started
- job.completed
- job.failed
- job.retry_scheduled
- node.update_requested

### 6.5 Node Agent Runtime

Recommended options:

Option A, TypeScript / Node.js agent:

- Fast to build
- Shared types with backend
- Good for VPC and Mac mini
- May need helper scripts for system metrics and GPU metrics

Option B, Go agent:

- Better single-binary deployment
- Strong for system-level tasks
- Good long-term edge agent candidate
- Slightly slower for fast product iteration

Recommendation:

Start with TypeScript if speed matters most. Keep the agent modular enough to rewrite or harden later.

### 6.6 Job Runtime

Early phase:

- Shell command jobs
- Docker jobs on Linux VPCs
- Local process jobs on Mac minis
- Later containerized GPU jobs

Long-term:

- Container runtime with resource limits
- Workload templates
- Model runtime templates
- GPU isolation

### 6.7 Observability

Recommended:

- Structured logs
- OpenTelemetry-compatible traces if possible
- Metrics in Postgres first, then Prometheus/Grafana later if needed
- Langfuse only if LLM-specific workloads are part of early testing

Prototype should prioritize clarity over enterprise observability.

---

## 7. Core Domain Model

## 7.1 Node

A node is a physical or virtual compute machine that can execute jobs.

Fields:

```ts
type Node = {
  id: string;
  name: string;
  status: 'provisioning' | 'online' | 'offline' | 'draining' | 'maintenance' | 'disabled';
  phase: '0a_vpc' | '0b_macmini' | '1_revenue' | '2_gpu' | '3_real_estate';
  nodeType: 'vpc' | 'mac_mini' | 'gpu_server' | 'edge_appliance';
  locationId?: string;
  agentVersion: string;
  lastHeartbeatAt?: string;
  createdAt: string;
  updatedAt: string;
};
```

## 7.2 Node Location

A location is a real or simulated place where one or more nodes are hosted.

```ts
type NodeLocation = {
  id: string;
  name: string;
  locationType: 'cloud_region' | 'home' | 'office' | 'ground_floor_shop' | 'technical_room' | 'commercial_unit';
  city?: string;
  state?: string;
  country?: string;
  internetType?: 'fiber' | 'dsl' | 'cable' | 'mobile' | 'cloud_internal';
  powerProfile?: 'unknown' | 'single_phase' | 'three_phase' | 'commercial_63a' | 'commercial_125a_plus';
  maxPowerKw?: number;
  notes?: string;
};
```

## 7.3 Node Capability

Capabilities are detected automatically and refreshed regularly.

```ts
type NodeCapability = {
  nodeId: string;
  cpuModel?: string;
  cpuCores?: number;
  cpuThreads?: number;
  ramGb?: number;
  diskGb?: number;
  gpuCount?: number;
  gpuModels?: string[];
  gpuVramGb?: number[];
  os?: string;
  architecture?: 'x64' | 'arm64';
  dockerAvailable?: boolean;
  cudaAvailable?: boolean;
  rocmAvailable?: boolean;
  metalAvailable?: boolean;
  updatedAt: string;
};
```

## 7.4 Benchmark

Benchmarks should be repeatable and comparable.

```ts
type NodeBenchmark = {
  id: string;
  nodeId: string;
  benchmarkType: 'cpu' | 'memory' | 'disk' | 'network' | 'gpu' | 'llm_inference' | 'embedding' | 'custom';
  score?: number;
  unit?: string;
  rawResult: Record<string, unknown>;
  startedAt: string;
  completedAt?: string;
  status: 'running' | 'completed' | 'failed';
  errorMessage?: string;
};
```

## 7.5 Job

A job is a unit of work submitted to the platform.

```ts
type Job = {
  id: string;
  customerId?: string;
  workloadId: string;
  status: 'queued' | 'assigned' | 'running' | 'completed' | 'failed' | 'cancelled' | 'retrying';
  priority: 'low' | 'normal' | 'high';
  inputUri?: string;
  outputUri?: string;
  requiredCapabilities: Record<string, unknown>;
  maxRetries: number;
  timeoutSeconds: number;
  createdAt: string;
  updatedAt: string;
};
```

## 7.6 Job Attempt

A job attempt represents one execution attempt on one node.

```ts
type JobAttempt = {
  id: string;
  jobId: string;
  nodeId: string;
  status: 'assigned' | 'started' | 'completed' | 'failed' | 'timed_out';
  startedAt?: string;
  completedAt?: string;
  exitCode?: number;
  errorMessage?: string;
  resourceUsage?: {
    cpuSeconds?: number;
    gpuSeconds?: number;
    maxRamMb?: number;
    networkInMb?: number;
    networkOutMb?: number;
  };
};
```

## 7.7 Usage Event

Usage events support billing and economics.

```ts
type UsageEvent = {
  id: string;
  jobId?: string;
  nodeId: string;
  customerId?: string;
  eventType: 'cpu_seconds' | 'gpu_seconds' | 'gb_transfer' | 'storage_gb_hours' | 'job_completed' | 'heat_kwh_recovered';
  quantity: number;
  unit: string;
  occurredAt: string;
  metadata?: Record<string, unknown>;
};
```

---

## 8. API Surface

## 8.1 Node Agent APIs

### Register Node

`POST /api/agent/register`

Request:

```json
{
  "nodeName": "mac-mini-caputh-01",
  "nodeType": "mac_mini",
  "agentVersion": "0.1.0",
  "capabilities": {}
}
```

Response:

```json
{
  "nodeId": "node_123",
  "agentToken": "secret_or_rotating_token",
  "config": {
    "heartbeatIntervalSeconds": 15,
    "jobPollIntervalSeconds": 5,
    "benchmarksEnabled": true
  }
}
```

### Heartbeat

`POST /api/agent/heartbeat`

Request:

```json
{
  "nodeId": "node_123",
  "status": "online",
  "metrics": {
    "cpuUsagePct": 24.2,
    "ramUsagePct": 61.1,
    "diskUsagePct": 42.0,
    "temperatureC": 68.2
  }
}
```

### Update Capabilities

`POST /api/agent/capabilities`

### Poll for Job

`POST /api/agent/jobs/poll`

Response:

```json
{
  "jobAvailable": true,
  "job": {
    "jobId": "job_123",
    "attemptId": "attempt_456",
    "workloadType": "cpu_benchmark",
    "input": {},
    "timeoutSeconds": 300
  }
}
```

### Report Job Started

`POST /api/agent/jobs/:attemptId/start`

### Report Job Completed

`POST /api/agent/jobs/:attemptId/complete`

### Report Job Failed

`POST /api/agent/jobs/:attemptId/fail`

### Submit Benchmark Result

`POST /api/agent/benchmarks`

---

## 8.2 Operator APIs

### List Nodes

`GET /api/operator/nodes`

Filters:

- status
- phase
- nodeType
- locationId

### Get Node Detail

`GET /api/operator/nodes/:nodeId`

### Trigger Benchmark

`POST /api/operator/nodes/:nodeId/benchmarks`

### Pause Node

`POST /api/operator/nodes/:nodeId/pause`

### Drain Node

`POST /api/operator/nodes/:nodeId/drain`

### Disable Node

`POST /api/operator/nodes/:nodeId/disable`

### List Jobs

`GET /api/operator/jobs`

### Retry Job

`POST /api/operator/jobs/:jobId/retry`

### Cancel Job

`POST /api/operator/jobs/:jobId/cancel`

---

## 8.3 Customer / Workload APIs

For Phase 0a, this can remain internal.

### Submit Job

`POST /api/jobs`

Request:

```json
{
  "workloadId": "workload_embedding_test",
  "priority": "normal",
  "input": {
    "text": "example"
  },
  "constraints": {
    "maxPriceEur": 0.05,
    "latencyTolerance": "relaxed",
    "region": "DE"
  }
}
```

### Get Job Status

`GET /api/jobs/:jobId`

### Get Job Result

`GET /api/jobs/:jobId/result`

---

## 9. Job Placement Logic

Start simple, then improve.

## 9.1 Phase 0a Placement Logic

Basic decision order:

1. Job requires capability X.
2. Filter nodes that have capability X.
3. Filter online nodes.
4. Filter nodes not in maintenance or draining.
5. Pick node with lowest queue length.
6. If tie, pick node with best recent benchmark score.
7. If tie, pick cheapest estimated node.

Pseudo-code:

```ts
function selectNode(job, nodes) {
  const eligible = nodes
    .filter(node => node.status === 'online')
    .filter(node => !node.draining)
    .filter(node => nodeMatchesRequiredCapabilities(node, job.requiredCapabilities));

  if (eligible.length === 0) return null;

  return eligible.sort((a, b) => {
    return queueLength(a) - queueLength(b)
      || benchmarkScore(b, job.workloadType) - benchmarkScore(a, job.workloadType)
      || estimatedCost(a, job) - estimatedCost(b, job);
  })[0];
}
```

## 9.2 Later Placement Logic

Add:

- Latency class
- Customer priority
- Data locality
- Energy cost
- Heat reuse value
- Solar availability
- Hardware depreciation
- GPU availability
- Node reliability score
- Marketplace price signal
- Direct B2B customer SLA

---

## 10. Node Agent Design

## 10.1 Agent Modules

The node agent should be modular.

Suggested modules:

- config loader
- registration client
- auth/token manager
- heartbeat loop
- capability scanner
- benchmark runner
- job poller
- job executor
- log shipper
- metrics collector
- update manager
- local watchdog

## 10.2 Agent Process Lifecycle

1. Load local config.
2. If no node ID exists, register.
3. Store node ID and token securely.
4. Scan capabilities.
5. Send first heartbeat.
6. Start heartbeat loop.
7. Start job polling loop.
8. Start metrics collection loop.
9. Execute jobs as assigned.
10. Report results.
11. Recover from errors.

## 10.3 Agent Security Requirements

- Node token should be unique per node.
- Token should be revocable.
- Agent should not expose inbound unauthenticated HTTP endpoints in early phases.
- Control plane should authenticate all agent requests.
- Control plane should validate job result signatures or token identity.
- Secrets should not be written into logs.
- Agent should use TLS for all control-plane communication.
- Operator-triggered commands should be auditable.

## 10.4 Remote Update Strategy

For Phase 0a:

- Manual redeploy is acceptable.

For Phase 0b:

- Add remote update command.
- Agent checks for approved version.
- Agent downloads release artifact.
- Agent validates checksum.
- Agent restarts safely.
- Agent reports updated version.

For Mac minis:

- Use launchd service or equivalent to keep agent alive.
- Ensure restart after reboot.
- Keep rollback path.

---

## 11. Benchmarking Plan

## 11.1 CPU Benchmark

Purpose:

- Compare VPCs, Mac minis, and future CPU capacity.

Metrics:

- Single-core score
- Multi-core score
- Sustained performance
- Thermal throttling indicator, where available

## 11.2 Memory Benchmark

Metrics:

- Available RAM
- Memory bandwidth proxy
- Peak memory during job

## 11.3 Disk Benchmark

Metrics:

- Read throughput
- Write throughput
- Random I/O proxy
- Free disk

## 11.4 Network Benchmark

Metrics:

- Latency to control plane
- Latency between nodes, if possible
- Download throughput
- Upload throughput
- Packet loss proxy
- Jitter proxy

Network test scenarios:

- Fiber/fiber
- DSL/fiber
- DSL/DSL
- Same location
- Different location
- Brandenburg to Brandenburg
- Brandenburg to Sachsen-Anhalt
- Cloud region to local node

## 11.5 GPU Benchmark, Phase 2

Metrics:

- GPU model
- VRAM
- CUDA/ROCm availability
- Inference throughput
- Tokens per second for selected model
- Images per hour for selected image workload
- Power draw estimate
- Temperature under load
- Thermal throttling

## 11.6 LLM / AI Workload Benchmark

Use a few standard workload templates:

- Embedding batch of 1,000 short texts
- Small LLM inference batch
- OCR batch
- Transcription batch
- Image generation job, later only if hardware supports it

The goal is not academic benchmark precision. The goal is commercial comparability across nodes.

---

## 12. QA Test Plan

## 12.1 Functional Tests

- Node can register.
- Node can send heartbeat.
- Node capabilities are detected.
- Node receives job.
- Node runs job.
- Node reports completion.
- Node reports failure.
- Job result is stored.
- Operator can retry failed job.
- Operator can pause node.
- Operator can drain node.
- Operator can trigger benchmark.

## 12.2 Load Tests

- Submit 10 jobs at once.
- Submit 100 jobs at once.
- Submit long-running jobs and short-running jobs together.
- Fill one node queue and check routing to others.
- Run continuous workload for 24 hours.
- Simulate marketplace-style burst traffic.

## 12.3 Failure Tests

- Kill node agent mid-job.
- Shut down node mid-job.
- Disconnect internet mid-job.
- Restart router.
- Fill disk.
- Exhaust RAM.
- Return malformed job result.
- Fail benchmark.
- Send delayed heartbeat.
- Simulate control plane outage.
- Simulate database outage.

## 12.4 Network Tests

- DSL/fiber latency test.
- Fiber/fiber latency test.
- DSL/DSL latency test.
- Upload-heavy workload.
- Download-heavy workload.
- Small payload / many jobs.
- Large payload / few jobs.
- Cross-region VPC test.
- Local node to cloud control plane test.

## 12.5 Security Tests

- Invalid node token rejected.
- Revoked node token rejected.
- Node cannot impersonate another node.
- Customer cannot access another customer job.
- Operator actions are logged.
- Secrets are not in logs.
- Job payload validation works.
- Agent rejects unapproved commands.

## 12.6 Economic Tests

- Calculate revenue per job.
- Calculate estimated cost per job.
- Calculate utilization per node.
- Compare marketplace vs direct B2B revenue.
- Simulate stakeholder revenue split.
- Simulate power cost changes.
- Simulate heat reuse credit.
- Simulate solar contribution.

---

## 13. Dashboard Requirements

## 13.1 Node Overview

Columns:

- Node name
- Status
- Phase
- Type
- Location
- Last heartbeat
- CPU usage
- RAM usage
- GPU usage, if available
- Queue length
- Jobs completed today
- Failure rate
- Estimated revenue today

## 13.2 Node Detail

Sections:

- Identity
- Location
- Capabilities
- Current metrics
- Benchmark history
- Job history
- Failure events
- Logs
- Operator actions
- Revenue / utilization

## 13.3 Job Queue

Columns:

- Job ID
- Customer
- Workload
- Status
- Priority
- Assigned node
- Created at
- Started at
- Duration
- Retry count
- Estimated revenue

## 13.4 Benchmark View

Views:

- Compare nodes by CPU score
- Compare nodes by network latency
- Compare nodes by upload/download speed
- Compare nodes by GPU score, later
- Show benchmark trends over time

## 13.5 Economics View

Views:

- Revenue by node
- Revenue by workload
- Revenue by customer
- Utilization by node
- Estimated margin by node
- Power cost sensitivity
- Heat reuse sensitivity
- Stakeholder split simulation

---

## 14. Security and Isolation

Security should be good enough from the start, even if not enterprise-grade yet.

## 14.1 Phase 0a Minimum

- Authenticated API requests
- Unique node tokens
- Operator auth
- Customer/job access separation
- Audit log for operator actions
- No secrets in logs
- Basic input validation

## 14.2 Phase 0b Minimum

- Secure local config storage
- Revocable node tokens
- Agent auto-update integrity check
- No inbound public ports required
- Device theft risk considered
- Local disk encryption where possible

## 14.3 Phase 1 Minimum

- Workload isolation
- Customer data separation
- Job result access control
- Basic abuse prevention
- Billing event integrity
- More formal logging and retention

## 14.4 Phase 2 Minimum

- Container isolation
- GPU job isolation
- Driver/runtime hardening
- Secure model/artifact handling
- Per-customer workload boundaries

---

## 15. Economics Model in the Software

The software should capture data for a P&L cube.

Dimensions:

- Phase
- Node
- Location
- Stakeholder
- Workload type
- Customer type
- Month

Stakeholders:

- Placetrace
- Real estate owner
- Energy / solar partner, if applicable
- Hardware financing partner, if applicable
- Tenant/building community, if heat reuse creates savings

Revenue categories:

- Marketplace compute revenue
- Direct B2B compute revenue
- Internal workload avoided cost
- Heat reuse revenue or credit
- Optional solar arbitrage benefit

Cost categories:

- Hardware depreciation
- Cloud control plane
- Internet
- Power
- Cooling
- Water, if applicable
- Maintenance
- Insurance
- Rent or space revenue share
- Staff cost
- Payment fees
- Marketplace fees

Minimum software output:

- Revenue per node per day
- Cost estimate per node per day
- Utilization per node per day
- Gross margin proxy per node per day
- Revenue split simulation per stakeholder

---

## 16. Heat Reuse and Building Integration, Software Perspective

Heat reuse is not required for Phase 0a or 0b, but the software should be ready to model it.

Future data inputs:

- Compute power draw
- Heat output estimate
- Water inlet temperature
- Water outlet temperature
- Flow rate
- Heat exchanger status
- Building heat demand
- Recovered kWh
- Tenant/building credit

Important principle:

Cooling water and domestic water should be treated as separate loops. The software can track both conceptually, but the engineering design should not assume that grey water or domestic water can simply be used as the cooling loop.

Software model:

```ts
type HeatReuseEvent = {
  nodeId: string;
  locationId: string;
  powerDrawKw: number;
  estimatedHeatOutputKw: number;
  recoveredHeatKwh?: number;
  inletTempC?: number;
  outletTempC?: number;
  flowRateLpm?: number;
  occurredAt: string;
};
```

---

## 17. Power, Internet, and Location Readiness Checklist

The software should include a location readiness object to compare candidate sites.

```ts
type LocationReadiness = {
  locationId: string;
  hasFiber: boolean;
  internetNotes?: string;
  hasThreePhasePower: boolean;
  estimatedAvailablePowerKw?: number;
  upgradeRequired: boolean;
  coolingPathAvailable: boolean;
  heatReusePotential: 'none' | 'low' | 'medium' | 'high' | 'unknown';
  noiseRisk: 'low' | 'medium' | 'high' | 'unknown';
  physicalSecurity: 'low' | 'medium' | 'high' | 'unknown';
  fireSafetyReviewNeeded: boolean;
  insuranceReviewNeeded: boolean;
  landlordApprovalStatus: 'not_started' | 'in_discussion' | 'approved' | 'rejected';
};
```

Candidate location questions:

- Is the space residential, commercial, or mixed-use?
- Is the ground-floor shop empty?
- Is fiber available?
- What is the current electrical connection?
- What upgrade would be needed for 50 kW?
- Who is the Netzbetreiber / Stadtwerke contact?
- Is there room for cooling equipment?
- Is there a path for heat exhaust or heat reuse?
- What is the noise sensitivity?
- Can the location be accessed for maintenance?
- Can hardware be physically secured?
- Is there a fire safety constraint?
- Is insurance coverage possible?

---

## 18. Implementation Plan for Claude Code

## 18.1 Suggested Repository Structure

```txt
mini-dc-prototype/
  apps/
    dashboard/
    api/
    node-agent/
  packages/
    shared-types/
    db/
    job-runtime/
    benchmark-suite/
    economics/
  infra/
    migrations/
    docker/
    scripts/
  docs/
    architecture.md
    api.md
    qa-plan.md
    economics.md
```

## 18.2 First Sprint Scope

Build the smallest version that proves the core loop.

### Sprint 1 Deliverables

- Postgres schema
- API server
- Node registration endpoint
- Heartbeat endpoint
- Node agent prototype
- Job submission endpoint
- Simple job polling endpoint
- Job completion endpoint
- Basic dashboard with node list and job list
- One benchmark job type
- One shell-command job type

### Sprint 1 Demo

1. Start API.
2. Start database.
3. Start two local or VPC node agents.
4. Agents register.
5. Dashboard shows both nodes online.
6. Submit benchmark job.
7. Job is assigned to one node.
8. Node completes job.
9. Dashboard shows result.
10. Kill one node.
11. Dashboard shows node offline.

## 18.3 Sprint 2 Scope

- Add capability scanner
- Add multiple benchmark types
- Add job retry logic
- Add node drain/pause
- Add logs
- Add network test
- Add basic economics events
- Add operator actions audit log

## 18.4 Sprint 3 Scope

- Add Mac mini support
- Add launchd service setup script
- Add remote update mechanism
- Add network scenario comparison dashboard
- Add failure test harness
- Add customer/workload model
- Add usage metering

## 18.5 Sprint 4 Scope

- Add marketplace or direct workload adapter
- Add billing export
- Add workload templates
- Add stronger job isolation
- Add GPU compatibility placeholders
- Add location readiness module

---

## 19. Concrete Claude Code Prompts

## Prompt 1, Create the Monorepo and Core Types

```txt
Create a TypeScript monorepo for a distributed micro data center prototype.

Use this structure:
- apps/api
- apps/dashboard
- apps/node-agent
- packages/shared-types
- packages/db
- packages/benchmark-suite
- packages/economics

Implement shared domain types for Node, NodeLocation, NodeCapability, NodeBenchmark, Job, JobAttempt, UsageEvent, Alert, and OperatorAction.

Add a README explaining how to run the local dev environment.
Do not overbuild. Prioritize a working prototype skeleton.
```

## Prompt 2, Build API and Database Schema

```txt
Implement the first version of the API and Postgres schema.

Required endpoints:
- POST /api/agent/register
- POST /api/agent/heartbeat
- POST /api/agent/capabilities
- POST /api/agent/jobs/poll
- POST /api/agent/jobs/:attemptId/start
- POST /api/agent/jobs/:attemptId/complete
- POST /api/agent/jobs/:attemptId/fail
- POST /api/jobs
- GET /api/jobs/:jobId
- GET /api/operator/nodes
- GET /api/operator/jobs

Use TypeScript and shared types.
Add basic validation.
Add simple token authentication for node-agent endpoints.
```

## Prompt 3, Build the Node Agent

```txt
Build a node-agent app that can run on a VPC Linux instance or Mac mini.

The agent should:
- load config from env/local file
- register if no node id exists
- store node id and token locally
- scan basic capabilities
- send heartbeat every 15 seconds
- poll for jobs every 5 seconds
- execute a safe test job type
- execute a benchmark job type
- report job start/completion/failure
- log structured JSON

Use outbound HTTP only. Do not require inbound ports.
```

## Prompt 4, Build the Operator Dashboard

```txt
Build a simple internal operator dashboard.

Views:
- Node overview
- Node detail
- Job queue
- Benchmark results

Actions:
- trigger benchmark
- pause node
- drain node
- retry job

Make the UI functional and clear. This is an internal prototype, not a marketing site.
```

## Prompt 5, Add QA Test Harness

```txt
Add a QA test harness for the distributed micro data center prototype.

It should support:
- registering multiple fake nodes
- sending heartbeats
- submitting batches of jobs
- simulating node failure
- simulating delayed heartbeat
- simulating job failure
- measuring job completion time
- producing a markdown test report

Include tests for 10 jobs, 100 jobs, node disconnect mid-job, and retry behavior.
```

---

## 20. Open Decisions

## 20.1 Tech Stack Decisions

- TypeScript agent now vs Go agent now?
- Supabase vs plain managed Postgres?
- Inngest vs simple queue for prototype?
- Next.js API routes vs separate backend service?
- Dashboard in same app as API or separate app?

Recommended default:

- TypeScript everywhere for Phase 0a
- Postgres/Supabase
- Simple queue first, durable workflow next if needed
- Separate API and dashboard if the repo structure stays clean

## 20.2 Workload Decisions

- Which first workload should represent revenue?
- Marketplace integration first or direct B2B API first?
- Should embeddings be the first AI workload?
- Should transcription be tested early?
- Should we include a GPU cloud instance already in Phase 0a?

Recommended default:

- Start with synthetic CPU and network jobs.
- Add embeddings as first AI-like workload.
- Add GPU cloud only after the core control loop works.

## 20.3 Hardware Decisions

- Buy 2 or 3 Mac minis?
- Which locations are used for Phase 0b?
- Which connection combinations are tested?
- What remote management setup is acceptable?

Recommended default:

- Use 3 Mac minis if budget allows.
- Test at least one fiber and one DSL location.
- Use headless operation.

## 20.4 Business Model Decisions

- How much revenue share goes to the real estate owner?
- Does the real estate owner receive fixed rent, revenue share, or hybrid?
- Does Placetrace own the hardware?
- Could Placetrace co-own solar panels?
- How should heat reuse be priced?
- How should maintenance responsibility be allocated?

Recommended default:

- Model all stakeholder economics in software before committing.
- Use scenario tables rather than one fixed model in early phase.

---

## 21. Risks and Mitigations

## 21.1 Technical Risks

### Risk: Network instability

Mitigation:

- Use async workloads.
- Build retry logic.
- Track network quality by node.
- Avoid latency-critical jobs early.

### Risk: Node failure

Mitigation:

- Heartbeats.
- Job attempts.
- Retry policy.
- Node drain mode.
- Operator alerts.

### Risk: Hardware-specific refactoring later

Mitigation:

- Keep node agent hardware abstraction clean.
- Use capability detection.
- Use workload templates.
- Avoid hardcoding VPC assumptions.

### Risk: Security too weak for customer data

Mitigation:

- Start with non-sensitive workloads.
- Add customer isolation before real customer data.
- Use secure tokens and audit logs from the start.

## 21.2 Business Risks

### Risk: Marketplace revenue too low

Mitigation:

- Use marketplace mainly for utilization proof.
- Prioritize direct B2B workloads mid-term.

### Risk: Power upgrades are expensive

Mitigation:

- Track available power per location.
- Start with smaller nodes.
- Model upgrade cost separately.

### Risk: Real estate owner economics unclear

Mitigation:

- Build stakeholder P&L view early.
- Show space value vs compute value.

### Risk: Heat reuse is overcomplicated

Mitigation:

- Do not depend on heat reuse for Phase 0a to Phase 2.
- Model it as upside first.
- Treat real heat reuse as Phase 3+ engineering project.

---

## 22. Definition of Done for the Prototype Software

The prototype software is successful when:

- At least three nodes can be registered.
- Nodes can run in VPCs and at least one local physical machine.
- Jobs can be submitted, assigned, executed, completed, failed, and retried.
- Benchmarks can be run and compared across nodes.
- Network scenarios can be measured.
- Operator dashboard shows live node and job status.
- Failure testing is documented.
- Economics events are captured.
- A simple P&L view can be produced per node and phase.
- The system can be extended to GPU nodes without redesigning the core architecture.

---

## 23. Immediate Next Steps

1. Create repo skeleton.
2. Define shared types.
3. Create database migrations.
4. Build register/heartbeat/job API loop.
5. Build basic node agent.
6. Build minimal dashboard.
7. Run with two VPC nodes.
8. Add third node.
9. Run QA failure tests.
10. Add Mac mini setup.
11. Compare network scenarios.
12. Add economics tracking.
13. Prepare Phase 1 revenue workload selection.

---

## 24. Notes for Claude Code

Prioritize working software over perfect architecture.

Avoid premature enterprise features, but keep the core abstractions clean:

- node
- location
- capability
- benchmark
- job
- job attempt
- usage event
- billing event
- operator action

The most important prototype loop is:

```txt
node registers -> node sends heartbeat -> job is submitted -> scheduler selects node -> node runs job -> node reports result -> dashboard shows status -> economics event is recorded
```

Everything else can be layered on top.

