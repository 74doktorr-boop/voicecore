-- ============================================================
-- NodeFlow — ENTIDADES v0 (vehículos y mascotas)
-- Diseño: "NodeFlow — Entidades (lecciones de Twenty)" 2026-07-08
-- ------------------------------------------------------------
-- ⚠️  NO SE APLICA AUTOMÁTICAMENTE. Ejecutar A MANO en el SQL
--     Editor de Supabase (app.supabase.com) cuando Unai lo confirme.
--     Todo el código de la app NO-OPea con gracia si estas tablas
--     no existen todavía (detección 42P01 → feature oculta).
--
-- Idempotente: se puede ejecutar varias veces sin efecto adicional.
--
-- Capa ADITIVA sobre el esquema actual:
--   · 2 tablas nuevas (registro de tipos + datos) + 1 de eventos
--   · 2 columnas NULLABLE en tablas existentes (cero impacto)
--   · Rollback = no usar la feature (o flag ENTITIES_DISABLED=1)
-- ============================================================

-- pg_trgm para el buscador por display_name (ILIKE acelerado por GIN).
-- En Supabase ya suele estar disponible; idempotente igualmente.
create extension if not exists pg_trgm;

-- ─── 1. nf_entity_types — el REGISTRO de metadatos ──────────────────────────
-- Una fila por tipo de entidad y organización ("Vehículos" del taller X).
-- Copy-on-create desde el catálogo de sectores (catalog_key versionado
-- 'taller.vehiculo@v1' para poder reconciliar plantillas en v1).
-- fields = array JSONB de definiciones de campo:
--   { key, type: text|number|date|select|multiselect|boolean|phone|note,
--     label, required, options, show_in_list, position,
--     reminder: { offset_days, campaign_kind, message_hint } }
create table if not exists nf_entity_types (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  key             text not null,              -- 'vehiculo' | 'mascota'
  catalog_key     text,                       -- 'taller.vehiculo@v1' (origen)
  label_singular  text not null,              -- 'Vehículo'
  label_plural    text not null,              -- 'Vehículos' (nombre de pestaña)
  icon            text,
  color           text,
  label_template  text not null,              -- '{{marca}} {{modelo}} · {{matricula}}'
  fields          jsonb not null default '[]',
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, key)
);

create index if not exists idx_entity_types_org
  on nf_entity_types (organization_id) where is_active;

-- ─── 2. nf_entities — los DATOS ─────────────────────────────────────────────
-- attrs JSONB validado en la capa de servicio contra las definiciones de campo
-- (regla de negocio en código, no en BD ni en el LLM — Engineering Charter).
-- display_name se computa del label_template al escribir (lección 1.3 de
-- Twenty: etiqueta desnormalizada = chips/listas/buscador universales).
create table if not exists nf_entities (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  entity_type_id  uuid not null references nf_entity_types(id) on delete cascade,
  contact_id      uuid references contacts(id) on delete set null,  -- dueño/titular (nullable)
  display_name    text not null,
  attrs           jsonb not null default '{}',
  is_archived     boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_ent_org_type
  on nf_entities (organization_id, entity_type_id) where not is_archived;
create index if not exists idx_ent_contact
  on nf_entities (contact_id) where contact_id is not null;
-- Búsqueda por atributo exacto (matrícula, chip…) vía @> / ->>
create index if not exists idx_ent_attrs
  on nf_entities using gin (attrs jsonb_path_ops);
-- Buscador de texto libre por nombre ("el golf de Ane")
create index if not exists idx_ent_name_trgm
  on nf_entities using gin (display_name gin_trgm_ops);

-- ─── 3. nf_entity_events — timeline nativo de la entidad ────────────────────
-- Solo eventos PROPIOS (creación, cambio de campo, nota, mención de la IA).
-- Llamadas/citas/recordatorios NO se duplican aquí: se enlazan por entity_id
-- y el timeline los une en la consulta (cero doble-escritura).
create table if not exists nf_entity_events (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  entity_id       uuid not null references nf_entities(id) on delete cascade,
  happens_at      timestamptz not null default now(),
  kind            text not null,              -- 'created'|'field_change'|'note'|'ai_mention'
  title           text,                       -- listo para pintar, sin joins (lección 1.5)
  properties      jsonb default '{}',         -- diff { campo: { antes, despues } }
  actor           text not null default 'staff'  -- 'ai'|'staff'|'system'
);

create index if not exists idx_ee_entity
  on nf_entity_events (entity_id, happens_at desc);

-- ─── 4. Columnas ADITIVAS en tablas existentes (nullable ⇒ cero impacto) ────
-- Cita vinculada a la entidad ("la ITV del coche X" aparece en su timeline).
alter table nf_appointments
  add column if not exists entity_id uuid references nf_entities(id) on delete set null;

-- Recordatorios nacidos de campos-fecha de entidad (ITV, vacuna…) quedan
-- enlazados. El motor de envío existente NO cambia.
alter table scheduled_reminders
  add column if not exists entity_id uuid references nf_entities(id) on delete cascade;

-- Dedupe del materializador nocturno: un solo pendiente por
-- (entidad, campo, día). El job además compara por día antes de insertar;
-- este índice es el cinturón de seguridad ante carreras.
create unique index if not exists uq_reminder_entity_field_day
  on scheduled_reminders (entity_id, service_key, (scheduled_for::date))
  where entity_id is not null and status = 'pending';

-- Consulta del job nocturno ("pendientes de esta entidad")
create index if not exists idx_reminders_entity
  on scheduled_reminders (entity_id) where entity_id is not null;

-- ─── 5. RLS — mismo patrón que el resto de la plataforma ────────────────────
-- service_role (el servidor) lo puede todo; anon key bloqueado (deny-by-default).
alter table nf_entity_types  enable row level security;
alter table nf_entities      enable row level security;
alter table nf_entity_events enable row level security;

drop policy if exists "service_role_all" on nf_entity_types;
create policy "service_role_all" on nf_entity_types
  to service_role using (true) with check (true);

drop policy if exists "service_role_all" on nf_entities;
create policy "service_role_all" on nf_entities
  to service_role using (true) with check (true);

drop policy if exists "service_role_all" on nf_entity_events;
create policy "service_role_all" on nf_entity_events
  to service_role using (true) with check (true);
