-- ============================================================
-- NodeFlow — Campaign Core: cola de trabajos salientes
-- Motor GENÉRICO (ciego al dominio): el dispatcher solo conoce
-- colas, ventanas, reintentos y resultados. El "qué decir" viaja
-- en payload.promptBlock, calculado por la capa de producto.
-- Consumidores: recuperación, anti no-show, informe por voz, Auto-QA.
-- ============================================================

create table if not exists nf_campaign_calls (
  id            uuid primary key default gen_random_uuid(),
  org_id        text not null,
  campaign_type text not null,                    -- recovery | no_show | weekly_report | auto_qa | ...
  phone         text not null,
  contact_id    uuid,
  payload       jsonb not null default '{}'::jsonb, -- { promptBlock, ...datos del producto }
  status        text not null default 'queued',   -- queued | calling | done | failed | cancelled
  attempts      int  not null default 0,
  max_attempts  int  not null default 2,
  not_before    timestamptz not null default now(), -- ventana: no llamar antes de
  started_at    timestamptz,
  finished_at   timestamptz,
  outcome       text,                              -- del call-session: booked | info | abandoned | no_answer...
  call_sid      text,
  error         text,
  created_at    timestamptz not null default now()
);

create index if not exists idx_campaign_calls_due
  on nf_campaign_calls (status, not_before);
create index if not exists idx_campaign_calls_org
  on nf_campaign_calls (org_id, created_at desc);

-- RLS: solo service-role (el backend); el portal lee vía API propia.
alter table nf_campaign_calls enable row level security;
