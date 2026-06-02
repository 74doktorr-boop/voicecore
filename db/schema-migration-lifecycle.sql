-- ============================================================
-- NodeFlow Lifecycle Reminders — DB Migration
-- Run manually in Supabase SQL Editor
-- ============================================================

-- 1. contact_memory — accumulated state per contact
create table if not exists contact_memory (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid references organizations(id) on delete cascade,
  contact_id       uuid references contacts(id) on delete cascade,
  call_count       int not null default 0,
  last_call_at     timestamptz,
  last_call_summary text,
  preferences      jsonb not null default '{}',
  sensitivities    jsonb not null default '{}',
  no_whatsapp      boolean not null default false,
  no_email         boolean not null default false,
  no_sms           boolean not null default false,
  failed_attempts  int not null default 0,
  last_failed_at   timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (org_id, contact_id)
);

-- 2. call_summaries — immutable per-call records
create table if not exists call_summaries (
  id               uuid primary key default gen_random_uuid(),
  call_session_id  text,
  org_id           uuid references organizations(id) on delete set null,
  contact_id       uuid references contacts(id) on delete set null,
  summary          text not null,
  outcome          text check (outcome in (
    'booked','rescheduled','declined','no_answer',
    'callback_requested','wrong_number','do_not_contact','voicemail_left'
  )),
  extracted_data   jsonb not null default '{}',
  topics           text[] not null default '{}',
  created_at       timestamptz not null default now()
);

create index if not exists idx_call_summaries_contact
  on call_summaries (contact_id, org_id, created_at desc);

-- 3. scheduled_reminders — reminder queue
create table if not exists scheduled_reminders (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid references organizations(id) on delete cascade,
  contact_id      uuid references contacts(id) on delete cascade,
  service_key     text not null,
  channel         text not null check (channel in ('whatsapp', 'sms', 'email')),
  scheduled_for   timestamptz not null,
  status          text not null default 'pending'
                  check (status in ('pending','sending','sent','failed','cancelled','postponed')),
  sent_at         timestamptz,
  failed_reason   text,
  postponed_from  uuid references scheduled_reminders(id),
  postponed_days  int,
  message_preview text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_reminders_pending
  on scheduled_reminders (org_id, scheduled_for)
  where status = 'pending';

-- 4. org_reminder_config — per-org interval overrides
create table if not exists org_reminder_config (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid references organizations(id) on delete cascade unique,
  config     jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

-- 5. org_campaigns — seasonal org-wide campaigns
create table if not exists org_campaigns (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid references organizations(id) on delete cascade,
  service_key     text not null,
  campaign_name   text not null,
  fire_month      int not null check (fire_month between 1 and 12),
  fire_day        int not null check (fire_day between 1 and 31),
  channel         text not null check (channel in ('whatsapp', 'sms', 'email')),
  enabled         boolean not null default true,
  last_fired_year int,
  created_at      timestamptz not null default now()
);

-- 6. scheduled_outbounds — HIDDEN, all enabled=false
create table if not exists scheduled_outbounds (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid references organizations(id) on delete cascade,
  contact_id     uuid references contacts(id) on delete cascade,
  service_key    text not null,
  scheduled_for  timestamptz not null,
  status         text not null default 'pending'
                 check (status in ('pending','calling','completed','failed','cancelled')),
  enabled        boolean not null default false,
  created_at     timestamptz not null default now()
);

-- 7. Add opt-in columns to contacts (idempotent)
alter table contacts add column if not exists wa_opted_in  boolean not null default false;
alter table contacts add column if not exists sms_opted_in boolean not null default false;

-- 8. RPC: atomic claim of pending reminders (prevents duplicate sends on restart)
create or replace function claim_pending_reminders(
  p_window_end timestamptz,
  p_limit      int default 50
)
returns setof scheduled_reminders
language plpgsql
security definer
as $$
begin
  return query
  update scheduled_reminders
  set status = 'sending', updated_at = now()
  where id in (
    select id from scheduled_reminders
    where status = 'pending'
      and scheduled_for <= p_window_end
    order by scheduled_for asc
    limit p_limit
    for update skip locked
  )
  returning *;
end;
$$;

-- 9. RPC: upsert/increment failed attempts
create or replace function increment_failed_attempts(
  p_contact_id uuid,
  p_org_id     uuid
)
returns void
language plpgsql
security definer
as $$
begin
  insert into contact_memory (org_id, contact_id, failed_attempts, last_failed_at, updated_at)
  values (p_org_id, p_contact_id, 1, now(), now())
  on conflict (org_id, contact_id) do update
    set failed_attempts = contact_memory.failed_attempts + 1,
        last_failed_at  = now(),
        updated_at      = now();
end;
$$;

-- 10. Recover stalled 'sending' reminders older than 10 min (run on startup or cron)
create or replace function recover_stalled_reminders()
returns int
language plpgsql
security definer
as $$
declare v_count int;
begin
  update scheduled_reminders
  set status = 'pending', updated_at = now()
  where status = 'sending'
    and updated_at < now() - interval '10 minutes';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
