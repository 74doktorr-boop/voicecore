-- ============================================================
-- NodeFlow — Transcript de WhatsApp: guarda cada mensaje entrante y saliente
-- ============================================================
-- Hasta ahora las conversaciones de WhatsApp (incluidas las que atiende el
-- asistente) no se guardaban en ningún sitio → no se podían ver ni depurar.
-- Esta tabla registra cada mensaje (entrante del cliente / saliente del bot o
-- del negocio) para poder pintar el hilo en el portal y diagnosticar.
--
-- Ejecutar A MANO en Supabase → SQL Editor. Idempotente y aditiva. La app es
-- fail-open: si la tabla no existe todavía, el logging simplemente no ocurre.
-- ============================================================

create table if not exists nf_wa_messages (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  contact_id  uuid,
  phone       text not null,              -- normalizado '+34...'
  direction   text not null,              -- 'in' (del cliente) | 'out' (del negocio/bot)
  body        text,
  kind        text,                       -- 'text' | 'template' | 'ai' | 'no_show' | 'reminder' | ...
  created_at  timestamptz not null default now()
);

-- Hilo por (negocio, teléfono) en orden cronológico.
create index if not exists idx_wa_msg_thread
  on nf_wa_messages (org_id, phone, created_at);
create index if not exists idx_wa_msg_org
  on nf_wa_messages (org_id, created_at desc);

-- RLS: solo el backend (service_role); el portal lee vía su API.
alter table nf_wa_messages enable row level security;

-- Verificación (debe devolver 1 fila):
select table_name from information_schema.tables where table_name = 'nf_wa_messages';
