-- Stage 2: nodes advertise which model executors they can run, so the scheduler
-- routes a workload only to capable nodes (and, later, GPU jobs to GPU nodes
-- with overflow to the CPU pool).
alter table node_capabilities add column if not exists executors jsonb;
