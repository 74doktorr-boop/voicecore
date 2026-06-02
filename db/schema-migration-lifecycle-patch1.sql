-- ============================================================
-- NodeFlow Lifecycle — Patch 1: increment_call_count RPC
-- Run manually in Supabase SQL Editor after schema-migration-lifecycle.sql
-- ============================================================

create or replace function increment_call_count(
  p_contact_id uuid,
  p_org_id     uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into contact_memory (org_id, contact_id, call_count, updated_at)
  values (p_org_id, p_contact_id, 1, now())
  on conflict (org_id, contact_id) do update
    set call_count = contact_memory.call_count + 1,
        updated_at = now();
end;
$$;

select 'Lifecycle Patch 1 complete ✓ (increment_call_count RPC)' as result;
