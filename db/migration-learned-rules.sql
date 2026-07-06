-- ============================================================
-- NodeFlow — Reglas aprendidas (bucle APROBAR → APLICAR) 2026-07-06
-- El fundador aprueba reglas candidatas del bucle de mejora y se inyectan
-- en el prompt del sector (o global). Ver src/lifecycle/learned-rules.js.
-- ============================================================
create table if not exists nf_learned_rules (
  id           uuid primary key default gen_random_uuid(),
  sector       text not null,                       -- slug del vertical o 'global'
  rule_key     text not null,                       -- texto normalizado (dedup)
  text         text not null,                       -- la regla legible
  status       text not null default 'candidate',   -- candidate | active | rejected
  count        int  default 1,                      -- veces observada
  recurrent    boolean default false,               -- sobrevivió de una semana a otra
  created_at   timestamptz default now(),
  last_seen_at timestamptz default now(),
  approved_at  timestamptz,
  unique (sector, rule_key)
);

create index if not exists idx_learned_rules_status on nf_learned_rules(status);
create index if not exists idx_learned_rules_sector on nf_learned_rules(sector);

-- RLS: solo service_role (backend). El portal/cliente no toca esta tabla.
alter table nf_learned_rules enable row level security;
