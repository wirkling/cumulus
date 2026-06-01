-- Seed the cloud-region locations the fleet registers into. The agent may also
-- self-declare a location at registration; these give the dashboard sane labels
-- and lat/long for the locality demo even before any agent reports in.
-- Idempotent: skip if a location with the same name already exists.

insert into node_locations (name, location_type, latitude, longitude, city, state, country, internet_type)
select * from (values
  ('hetzner-fsn1', 'cloud_region', 50.4779, 12.3713, 'Falkenstein', 'Saxony',  'DE', 'cloud_internal'),
  ('hetzner-nbg1', 'cloud_region', 49.4521, 11.0767, 'Nuremberg',   'Bavaria', 'DE', 'cloud_internal'),
  ('hetzner-hel1', 'cloud_region', 60.1699, 24.9384, 'Helsinki',    null,      'FI', 'cloud_internal')
) as v(name, location_type, latitude, longitude, city, state, country, internet_type)
where not exists (select 1 from node_locations nl where nl.name = v.name);
