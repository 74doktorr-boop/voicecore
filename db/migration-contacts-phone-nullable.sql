-- ============================================================================
-- NodeFlow — permitir FICHAS DE CLIENTE SIN TELÉFONO
-- ----------------------------------------------------------------------------
-- Antes: contacts.phone era NOT NULL, así que una cita creada a mano sin
-- teléfono no podía crear contacto → el cliente quedaba sin ficha editable.
--
-- La restricción UNIQUE(org_id, phone) SE MANTIENE y sigue siendo correcta:
-- en PostgreSQL varios valores NULL no colisionan en un índice único, así que
-- las fichas sin teléfono coexisten sin problema. La deduplicación de fichas
-- sin teléfono se hace por nombre en la capa de aplicación.
--
-- Aplicar en Supabase (SQL Editor). Idempotente.
-- ============================================================================

ALTER TABLE contacts ALTER COLUMN phone DROP NOT NULL;

SELECT 'contacts.phone ahora admite NULL — fichas sin teléfono permitidas ✓' AS result;
