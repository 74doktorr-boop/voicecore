-- ============================================================
-- NodeFlow — Lifecycle scaling patch 2 (índices de cola y citas)
-- Aditivo y seguro: solo CREATE INDEX IF NOT EXISTS.
--
-- Motivación (escalado a miles de clientes):
--   El RPC claim_pending_reminders ejecuta una cola GLOBAL:
--     where status='pending' and scheduled_for <= X
--     order by scheduled_for asc limit N for update skip locked
--   El índice previo idx_reminders_pending (org_id, scheduled_for)
--   lidera por org_id, así que no sirve para un escaneo global
--   ordenado por scheduled_for: Postgres escanea todos los pendientes
--   y ordena. Es la consulta más caliente del sistema (cada tick, y
--   ahora drenando en varios lotes), por lo que necesita su índice
--   canónico de cola liderado por scheduled_for.
-- ============================================================

-- 1. Índice de cola: liderado por scheduled_for, parcial a 'pending'.
--    Sirve el filtro de rango Y el ORDER BY del claim → index scan que
--    para en el límite, sin sort. (idx_reminders_pending se conserva
--    para consultas por-org del portal.)
create index if not exists idx_reminders_due
  on scheduled_reminders (scheduled_for)
  where status = 'pending';

-- 2. Citas: el scheduler comprueba por org + teléfono en cada recordatorio
--    (where organization_id=? and phone=? and date>=? and status in (...)).
--    Existe idx_nf_appointments_phone(phone) pero un compuesto
--    (organization_id, phone) evita colisiones de teléfono entre orgs y
--    hace el lookup mucho más selectivo a gran volumen.
create index if not exists idx_nf_appointments_org_phone
  on nf_appointments (organization_id, phone);

-- ────────────────────────────────────────────────────────────
-- NOTA OPERATIVA: si estas tablas ya tienen muchas filas en
-- producción, crear los índices con CONCURRENTLY para no bloquear
-- escrituras (no puede ir dentro de una transacción):
--   create index concurrently if not exists idx_reminders_due
--     on scheduled_reminders (scheduled_for) where status = 'pending';
--   create index concurrently if not exists idx_nf_appointments_org_phone
--     on nf_appointments (organization_id, phone);
-- ────────────────────────────────────────────────────────────
