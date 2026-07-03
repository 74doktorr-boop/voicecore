-- ============================================================
-- NodeFlow — nf_calls: registro persistente de llamadas
-- Hallazgo C1 de la auditoría 2026-07-03: la tabla legacy "calls"
-- tenía 0 filas en producción (el historial vivía en memoria y cada
-- deploy lo borraba; los KPIs consultaban una tabla vacía). La tabla
-- legacy además arrastra NOT NULLs de otro diseño (agency_id,
-- caller_phone) que rompen cualquier insert del pipeline.
-- Tabla nueva bajo la convención nf_* (como nf_appointments,
-- nf_campaign_calls). id = callId del stream → trazabilidad extremo
-- a extremo entre logs, capturas de audio y registro.
-- ============================================================

create table if not exists nf_calls (
  id            text primary key,                    -- callId del media stream
  org_id        text,
  assistant_id  text,
  direction     text not null default 'inbound',     -- inbound | outbound | browser
  caller_number text,
  called_number text,
  status        text not null default 'active',      -- active | ended | failed
  outcome       text,                                -- booked | info | abandoned | ...
  transcript    jsonb not null default '[]'::jsonb,
  metrics       jsonb not null default '{}'::jsonb,  -- turnos, latencias, audioRx
  cost          jsonb not null default '{}'::jsonb,
  booked_appointment jsonb,
  campaign_ref  uuid,
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,
  duration_ms   integer,
  turn_count    integer,
  created_at    timestamptz not null default now()
);

create index if not exists idx_nf_calls_org
  on nf_calls (org_id, started_at desc);
create index if not exists idx_nf_calls_started
  on nf_calls (started_at desc);

-- RLS: solo service-role (el backend); el portal lee vía API propia.
alter table nf_calls enable row level security;
