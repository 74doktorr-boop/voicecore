-- ============================================================
-- NodeFlow — WhatsApp Multi-Tenant Migration
-- Fecha: 2026-06-09
-- Descripción: Tabla whatsapp_accounts para gestionar credenciales
--   WA por negocio (360dialog BSP + Meta Cloud API).
-- Ejecutar en: Supabase SQL Editor
-- ============================================================

-- ── Tabla principal ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS whatsapp_accounts (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  waba_id           text        NOT NULL,
  phone_number_id   text        NOT NULL,
  phone_number      text        NOT NULL,       -- e.g. "+34 946 123 456"
  display_name      text,                       -- nombre del negocio en WA
  access_token      text        NOT NULL,       -- cifrado AES-256-GCM (ver accounts.js)
  api_base          text,                       -- null = Meta; "waba.360dialog.io" = 360dialog
  token_expires_at  timestamptz,                -- null = permanent token
  status            text        NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'suspended', 'pending', 'revoked')),
  templates_status  text        NOT NULL DEFAULT 'pending'
                    CHECK (templates_status IN ('pending', 'approved', 'rejected')),
  connected_at      timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- ── Un WABA por organización (upsert por organization_id) ──────────────────
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_accounts_org_unique
  ON whatsapp_accounts (organization_id);

-- ── Índices ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS whatsapp_accounts_status_idx
  ON whatsapp_accounts (status);

CREATE INDEX IF NOT EXISTS whatsapp_accounts_waba_idx
  ON whatsapp_accounts (waba_id);

-- ── updated_at automático ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_whatsapp_accounts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS whatsapp_accounts_updated_at ON whatsapp_accounts;
CREATE TRIGGER whatsapp_accounts_updated_at
  BEFORE UPDATE ON whatsapp_accounts
  FOR EACH ROW EXECUTE FUNCTION update_whatsapp_accounts_updated_at();

-- ── RLS (Row Level Security) ─────────────────────────────────────────────────
-- Solo el service_role (backend) puede leer/escribir.
-- El frontend NUNCA accede a esta tabla directamente.
ALTER TABLE whatsapp_accounts ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS — solo el backend tiene acceso.
-- No se crean políticas para anon/authenticated intencionalmente.

-- ── Campo en organizations ───────────────────────────────────────────────────
-- Indica rápidamente si el negocio tiene WA conectado (evita query a whatsapp_accounts).
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS whatsapp_connected boolean NOT NULL DEFAULT false;

-- Sincronizar: marcar como conectado si ya existe registro activo
UPDATE organizations o
SET whatsapp_connected = true
FROM whatsapp_accounts wa
WHERE wa.organization_id = o.id
  AND wa.status = 'active';

-- ── Comentarios ──────────────────────────────────────────────────────────────
COMMENT ON TABLE whatsapp_accounts IS
  'Credenciales WhatsApp por negocio. access_token cifrado AES-256-GCM. Ver src/whatsapp/accounts.js.';
COMMENT ON COLUMN whatsapp_accounts.access_token IS
  'Cifrado AES-256-GCM. Formato: iv_b64:tag_b64:ciphertext_b64. ENCRYPTION_KEY env var requerida.';
COMMENT ON COLUMN whatsapp_accounts.api_base IS
  'null = Meta Cloud API (graph.facebook.com). "waba.360dialog.io" = 360dialog BSP.';
