-- ============================================================
-- NodeFlow — nf_calls v2: columnas para follow-ups y email
-- El sistema de follow-up (email 30 min tras llamadas de info) y su
-- recuperación por cron apuntaban a la tabla legacy "calls" (vacía y
-- sin la columna clave). Al migrar todos los lectores/escritores a
-- nf_calls (2026-07-03), estas columnas pasan aquí.
-- ============================================================

alter table nf_calls add column if not exists client_email  text;
alter table nf_calls add column if not exists followup_at   timestamptz;
alter table nf_calls add column if not exists followup_sent boolean not null default false;

create index if not exists idx_nf_calls_followup
  on nf_calls (followup_sent, followup_at)
  where followup_at is not null;
