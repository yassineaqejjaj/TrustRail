-- Row-level security policies for every tenant-scoped table.
-- Idempotent: safe to re-run. Applied by src/db/migrate.ts after the
-- drizzle-generated table migrations, using the trustrail_migrator role
-- (table owner). The runtime role (trustrail_app) is NOT the table owner
-- and has no BYPASSRLS attribute, so it is always subject to these
-- policies -- see docs/DECISIONS.md and docs/PRODUCT_SPEC.md section 4.

do $$
declare
  tbl text;
  tenant_tables text[] := array[
    'agents', 'agent_credentials', 'grants', 'policy_bundles', 'policy_versions',
    'connectors', 'actions', 'idempotency_records', 'approvals',
    'budget_windows', 'budget_reservations', 'execution_jobs', 'receipts',
    'audit_events', 'usage_events', 'demo_runs'
  ];
begin
  foreach tbl in array tenant_tables loop
    execute format('alter table %I enable row level security', tbl);
    execute format('drop policy if exists tenant_isolation on %I', tbl);
    execute format(
      'create policy tenant_isolation on %I using (organization_id = current_setting(''app.current_org_id'', true)) with check (organization_id = current_setting(''app.current_org_id'', true))',
      tbl
    );
  end loop;
end $$;
