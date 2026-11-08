-- PayFlow row-level security (second layer of tenant isolation).
-- Apply after the Drizzle migrations:  npm run db:rls
-- Application code calls withTenant(orgId, fn), which runs
--   select set_config('app.current_org', '<uuid>', true)
-- inside a transaction. Policies below compare organization_id to that setting.
-- NOTE: RLS does not apply to table owners / superusers. Run the app with a dedicated
-- non-owner role (see docker/postgres-init.sql) and keep migrations on the owner role.

create or replace function app_current_org() returns uuid
language sql stable as $$
  select nullif(current_setting('app.current_org', true), '')::uuid
$$;

do $$
declare
  t text;
  tenant_tables text[] := array[
    'departments','designations','holidays',
    'audit_logs','notifications','idempotency_keys',
    'employees','employee_documents','checklist_items','salary_components',
    'salary_structures','employee_salaries',
    'payroll_runs','payroll_items','payslips','payments',
    'loans','loan_repayments','settlements',
    'shifts','roster','attendance_records','attendance_locks',
    'leave_types','leave_balances','leave_requests',
    'expense_claims','tax_declarations','compliance_items','announcements',
    'chat_sessions','chat_messages','ai_usage','anomaly_dismissals','ai_actions','policy_documents','policy_chunks','document_extractions','workflows','workflow_runs','workflow_tasks','api_keys','webhook_endpoints','webhook_deliveries','payroll_pipelines','pipeline_steps','ewa_settings','ewa_requests','recognitions','surveys','survey_participation','survey_responses','feature_flags','fx_rates','privacy_requests','salary_benchmarks'
  ];
begin
  foreach t in array tenant_tables loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists tenant_isolation on %I', t);
    execute format(
      'create policy tenant_isolation on %I using (organization_id = app_current_org()) with check (organization_id = app_current_org())',
      t
    );
  end loop;
end $$;

-- A signed-in user must be able to list THEIR OWN memberships (and those companies) before any
-- tenant is selected. The app sets app.current_user from the verified session; it is never taken
-- from client input. Writes remain strictly tenant-scoped.
create or replace function app_current_user() returns text
language sql stable as $$
  select nullif(current_setting('app.current_user', true), '')
$$;

alter table memberships enable row level security;
alter table memberships force row level security;
drop policy if exists tenant_isolation on memberships;
create policy tenant_isolation on memberships
  using (organization_id = app_current_org() or user_id = app_current_user())
  with check (organization_id = app_current_org());

alter table organizations enable row level security;
alter table organizations force row level security;
drop policy if exists tenant_isolation on organizations;
create policy tenant_isolation on organizations
  using (
    id = app_current_org()
    or exists (
      select 1 from memberships m
      where m.organization_id = organizations.id and m.user_id = app_current_user()
    )
  )
  with check (id = app_current_org());
-- Creating a company: the app generates the UUID first, sets app.current_org to it via
-- withTenant(), then inserts, so the new row satisfies the policy.

-- Audit log is append-only: block UPDATE and DELETE for everyone, including the owner.
create or replace function audit_logs_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_logs is append-only';
end $$;

drop trigger if exists audit_logs_no_update on audit_logs;
create trigger audit_logs_no_update before update on audit_logs
  for each row execute function audit_logs_immutable();

drop trigger if exists audit_logs_no_delete on audit_logs;
create trigger audit_logs_no_delete before delete on audit_logs
  for each row execute function audit_logs_immutable();

-- invitations: visible to the tenant, OR to someone who presents the token (the app sets
-- app.invite_hash to sha256(token) while accepting). Knowing the token is the authorisation.
alter table invitations enable row level security;
alter table invitations force row level security;
drop policy if exists tenant_isolation on invitations;
create policy tenant_isolation on invitations
  using (
    organization_id = app_current_org()
    or token_hash = nullif(current_setting('app.invite_hash', true), '')
  )
  with check (
    organization_id = app_current_org()
    or token_hash = nullif(current_setting('app.invite_hash', true), '')
  );

-- Payroll runs: once approved, the figures are frozen. Items of a non-draft run cannot be changed.
create or replace function payroll_items_frozen() returns trigger
language plpgsql as $$
declare st payroll_status;
begin
  select status into st from payroll_runs where id = coalesce(new.run_id, old.run_id);
  if st is not null and st <> 'draft' and tg_op <> 'DELETE' and
     (st not in ('processing') or new.net is distinct from old.net) then
    raise exception 'payroll items are locked once the run leaves draft';
  end if;
  if tg_op = 'DELETE' and st is not null and st <> 'draft' then
    raise exception 'payroll items are locked once the run leaves draft';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists payroll_items_lock on payroll_items;
create trigger payroll_items_lock before update or delete on payroll_items
  for each row execute function payroll_items_frozen();

-- Provider webhooks arrive without a tenant. This resolves a payment reference to its company so the
-- handler can then open a normal tenant transaction. It exposes only the organization id.
create or replace function payment_org_by_ref(ref text) returns uuid
language sql stable security definer set search_path = public as $$
  select organization_id from payments where provider_ref = ref limit 1
$$;

-- Attendance is frozen for a month once HR locks it for payroll.
create or replace function attendance_locked_guard() returns trigger
language plpgsql as $$
declare d date; org uuid;
begin
  d := coalesce(new.date, old.date);
  org := coalesce(new.organization_id, old.organization_id);
  if exists (select 1 from attendance_locks l where l.organization_id = org and l.month = to_char(d, 'YYYY-MM')) then
    raise exception 'attendance for % is locked for payroll', to_char(d, 'YYYY-MM');
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists attendance_lock_guard on attendance_records;
create trigger attendance_lock_guard before insert or update or delete on attendance_records
  for each row execute function attendance_locked_guard();


-- Policy search. Full-text search always works; semantic search needs pgvector (optional).
create index if not exists policy_chunks_fts_idx
  on policy_chunks using gin (to_tsvector('english', content));

do $$
begin
  create extension if not exists vector;
  alter table policy_chunks add column if not exists embedding vector(768);
  create index if not exists policy_chunks_embedding_idx
    on policy_chunks using hnsw (embedding vector_cosine_ops);
exception when others then
  raise notice 'pgvector not available (%); policy search will use full-text only', sqlerrm;
end
$$;

-- API keys are looked up by hash before any tenant is known. This exposes only what the API needs
-- (never the hash) and only for a key that is active and unexpired.
create or replace function resolve_api_key(h text)
returns table (key_id uuid, organization_id uuid, scopes text[], rate_limit_per_min int)
language sql stable security definer set search_path = public as $$
  select k.id, k.organization_id, k.scopes, k.rate_limit_per_min
    from api_keys k
   where k.key_hash = h and k.revoked_at is null and (k.expires_at is null or k.expires_at > now())
   limit 1
$$;

-- Background jobs (cron) sweep companies without a tenant context. Only ids are exposed.
create or replace function automation_org_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select id from organizations
$$;

-- Deliveries that are due, across companies, for the retry worker. Ids only.
create or replace function due_webhook_deliveries(max_rows int)
returns table (id uuid, organization_id uuid)
language sql stable security definer set search_path = public as $$
  select d.id, d.organization_id from webhook_deliveries d
   where d.status = 'pending' and d.next_attempt_at <= now()
   order by d.next_attempt_at limit max_rows
$$;

-- Sign-in runs before any company is known. This answers one yes/no question: does any company
-- require single sign-on for this email domain? Nothing else is exposed.
create or replace function sso_domain_enforced(d text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from organizations where deleted_at is null and lower(d) = any (sso_domains))
$$;
