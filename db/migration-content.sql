-- ============================================================
-- NodeFlow — Contenido & SEO: artículos por cliente (micrositios)
-- Multi-tenant, servido dinámico (no ficheros). Cada fila = un artículo SEO
-- generado para el micrositio de un negocio (/n/:slug/:article-slug).
-- ============================================================
create table if not exists nf_content (
  id               uuid primary key default gen_random_uuid(),
  org_id           text not null,
  slug             text not null,                 -- url del artículo dentro del micrositio
  meta_title       text,
  meta_description text,
  h1               text,
  intro            text,
  sections         jsonb not null default '[]'::jsonb,  -- [{h2, content}]
  conclusion       text,
  faqs             jsonb not null default '[]'::jsonb,  -- [{question, answer}]
  keywords         jsonb not null default '[]'::jsonb,
  reading_minutes  int,
  status           text not null default 'published',   -- published | draft
  created_at       timestamptz not null default now(),
  published_at     timestamptz not null default now(),
  unique (org_id, slug)
);

-- Listado del micrositio (por negocio, recientes primero).
create index if not exists idx_nf_content_org on nf_content (org_id, published_at desc);
-- Conteo mensual para el tope de coste de generación.
create index if not exists idx_nf_content_created on nf_content (org_id, created_at);

alter table nf_content enable row level security;

-- Verificación (debe devolver 1 fila):
select table_name from information_schema.tables where table_name = 'nf_content';
