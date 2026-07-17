-- ============================================================
-- NodeFlow — Ledger de consumos de bono (2026-07-17)
-- Hace ROBUSTO el reembolso al cancelar: en vez de depender de un bonoId en
-- memoria (que se pierde si el server reinicia entre reserva y cancelación),
-- cada consumo de una sesión deja un registro persistente que enlaza cita↔bono.
-- Al cancelar, se localiza por appointment_id y se devuelve la sesión con
-- exactitud, sobreviva o no un reinicio. NO se pierde ninguna sesión pagada.
-- El código es NO-OP sin esta tabla (42P01). Idempotente. Requiere nf_bonos.
-- ============================================================

create table if not exists nf_bono_consumptions (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null,
  bono_id        uuid not null references nf_bonos(id) on delete cascade,
  appointment_id text not null,                -- id de la cita que consumió la sesión
  created_at     timestamptz not null default now(),
  unique (org_id, appointment_id)              -- una cita consume como mucho un bono
);

create index if not exists idx_nf_bono_consumptions_appt
  on nf_bono_consumptions (org_id, appointment_id);

alter table nf_bono_consumptions enable row level security;
drop policy if exists "service_role_all" on nf_bono_consumptions;
create policy "service_role_all" on nf_bono_consumptions
  for all to service_role using (true) with check (true);
