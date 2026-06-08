-- Inference serving: distinguish the two products over one control plane.
-- `hosted` (Model B) runs through the Request → Job pipeline; `rent` (Model A)
-- is a device_leases row (0008), never a Job. The column defaults to 'hosted'
-- so every existing request keeps its current behaviour.
alter table requests add column if not exists service_model text not null default 'hosted';
