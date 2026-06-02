-- QA runs become customer-owned: a test user runs the suite through the public
-- /v1 API (the real customer mechanism), and the run is attributed to them so
-- results come back scoped to that customer. Operator-launched runs may set the
-- owner explicitly (the review UI runs "as" a selected test user).

alter table qa_runs add column if not exists customer_id text;
create index if not exists qa_runs_customer_idx on qa_runs(customer_id);
