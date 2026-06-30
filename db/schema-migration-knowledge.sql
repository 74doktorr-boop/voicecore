-- ============================================================
-- NodeFlow — Base de conocimiento (RAG) por negocio
-- Aditivo y seguro. Aplicar en Supabase → SQL Editor → Run.
-- ============================================================

create table if not exists knowledge_chunks (
  id          uuid        primary key default gen_random_uuid(),
  org_id      text        not null,
  content     text        not null,
  embedding   jsonb       not null,             -- vector text-embedding-3-small (1536 floats)
  source      text        default 'manual',
  created_at  timestamptz not null default now()
);

create index if not exists idx_knowledge_chunks_org on knowledge_chunks (org_id);

alter table knowledge_chunks enable row level security;
create policy "service_role_all" on knowledge_chunks
  to service_role using (true) with check (true);

-- Verificación
select 'knowledge_chunks' as tabla,
       count(*) as filas
from knowledge_chunks;
