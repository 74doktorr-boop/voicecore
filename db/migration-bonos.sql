-- ============================================================
-- NodeFlow — Bonos / paquetes prepagados de sesiones (2026-07-17)
-- Objeción nº3 de la crítica sectorial (~15 sectores: wellness, estética,
-- láser, fisio de sesiones): el modelo de ingresos es el BONO prepago
-- ("bono de 10 sesiones"), con saldo, consumo y caducidad — no la cita suelta.
-- El código es NO-OP sin esta tabla (42P01 → se comporta como hasta ahora).
-- Idempotente. Ejecutar en Supabase → SQL Editor.
-- ============================================================

create table if not exists nf_bonos (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  contact_id     uuid references contacts(id) on delete set null,
  phone          text not null,               -- normalizado, para casar por caller-id
  service_key    text,                        -- servicio/clase que cubre (null = cualquiera)
  label          text,                        -- "Bono 10 sesiones fisio"
  total_sessions int  not null default 0,
  used_sessions  int  not null default 0 check (used_sessions >= 0),
  expires_at     date,                        -- null = sin caducidad
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_nf_bonos_lookup
  on nf_bonos (org_id, phone, service_key);

-- RLS: solo service-role (el backend). El portal lee/escribe por su API propia.
alter table nf_bonos enable row level security;
drop policy if exists "service_role_all" on nf_bonos;
create policy "service_role_all" on nf_bonos
  for all to service_role using (true) with check (true);
