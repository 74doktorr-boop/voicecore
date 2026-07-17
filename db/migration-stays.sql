-- ============================================================
-- NodeFlow — Estancias por noches / inventario por fechas (2026-07-17)
-- Objeción de la crítica sectorial: hotel, residencia de mascotas y guardería
-- NO reservan "una cita a una hora" sino un RANGO de fechas con plazas por
-- noche (inventario). El scheduler de citas 1:1/aforo no lo modela.
-- El código es NO-OP sin esta tabla (42P01). Idempotente.
-- ============================================================

create table if not exists nf_stays (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  unit_key     text,                          -- tipo de plaza/unidad ("suite", "canil_grande")
  guest_name   text,
  phone        text,
  checkin      date not null,
  checkout     date not null,                 -- exclusivo: última noche = checkout-1
  units        int  not null default 1 check (units > 0),
  status       text not null default 'confirmed',  -- confirmed | cancelled
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (checkout > checkin)
);

create index if not exists idx_nf_stays_lookup
  on nf_stays (org_id, unit_key, checkin, checkout);

alter table nf_stays enable row level security;
drop policy if exists "service_role_all" on nf_stays;
create policy "service_role_all" on nf_stays
  for all to service_role using (true) with check (true);
