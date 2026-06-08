-- Tensor-parallel capability: which NVLink-connected card-index sets a node can
-- use as ONE logical worker. Each element is an array of card indices, e.g.
-- [[0,1,2,3]] = a 4-card TP group. The flat gpu_vram_gb[] array cannot express
-- grouping, so placement needs this to know a node can host an N-card model.
-- Detected by the agent via `nvidia-smi topo -m`; null off-NVIDIA.
alter table node_capabilities add column if not exists tp_groups jsonb;
