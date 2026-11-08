-- Runs once on first container start. The app connects as `payflow_app`, a NON-owner role, so
-- row-level security is enforced. Migrations run as the owner (`payflow`).
create role payflow_app login password 'payflow_app' nosuperuser nobypassrls;
grant connect on database payflow to payflow_app;
grant usage on schema public to payflow_app;
alter default privileges for role payflow in schema public
  grant select, insert, update, delete on tables to payflow_app;
alter default privileges for role payflow in schema public
  grant usage, select on sequences to payflow_app;
