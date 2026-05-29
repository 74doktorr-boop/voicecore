-- ============================================================
-- NodeFlow — Schema Migration v3 (CRM)
-- Run this in Supabase SQL Editor (Database → SQL Editor)
-- Safe to run multiple times (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS)
-- ============================================================

-- ── Organizations: missing columns used by portal + assistant routes ──────────
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS status            TEXT         DEFAULT 'active', -- 'active' | 'suspended' | 'cancelled'
  ADD COLUMN IF NOT EXISTS registered_at     TIMESTAMPTZ  DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS assistant_config  JSONB        DEFAULT '{}';

-- Backfill status from is_active for existing rows
UPDATE organizations SET status = CASE WHEN is_active = true THEN 'active' ELSE 'suspended' END
  WHERE status IS NULL OR status = 'active';

COMMENT ON COLUMN organizations.status IS 'active | suspended | cancelled';
COMMENT ON COLUMN organizations.assistant_config IS 'Per-business assistant configuration (name, voice, schedule, sector data)';

-- ── Calls: missing columns used by post-call-handler and portal ───────────────
ALTER TABLE calls
  ADD COLUMN IF NOT EXISTS outcome           TEXT,           -- 'booked' | 'info' | 'abandoned'
  ADD COLUMN IF NOT EXISTS client_email      TEXT,
  ADD COLUMN IF NOT EXISTS booked_appointment JSONB;

-- Index for CRM queries (contacts by phone)
CREATE INDEX IF NOT EXISTS idx_calls_caller_number ON calls(org_id, caller_number);
CREATE INDEX IF NOT EXISTS idx_calls_call_sid ON calls(call_sid) WHERE call_sid IS NOT NULL;

-- ── Magic tokens table (persistent magic link auth) ────────────────────────────
CREATE TABLE IF NOT EXISTS magic_tokens (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  token       TEXT        UNIQUE NOT NULL,
  email       TEXT        NOT NULL,
  registro_id TEXT,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_count  INT         DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_magic_tokens_token ON magic_tokens(token);
CREATE INDEX IF NOT EXISTS idx_magic_tokens_email ON magic_tokens(email);

-- Auto-expire old tokens (keep table clean)
CREATE INDEX IF NOT EXISTS idx_magic_tokens_expires ON magic_tokens(expires_at);

-- ── Contacts table (CRM — one row per phone number per org) ───────────────────
CREATE TABLE IF NOT EXISTS contacts (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  phone        TEXT        NOT NULL,
  name         TEXT,
  email        TEXT,
  notes        TEXT,
  call_count   INT         DEFAULT 0,
  last_call_at TIMESTAMPTZ,
  deleted_at   TIMESTAMPTZ,  -- soft delete
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, phone)
);

CREATE INDEX IF NOT EXISTS idx_contacts_org ON contacts(org_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(org_id, phone) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_last_call ON contacts(org_id, last_call_at DESC) WHERE deleted_at IS NULL;

-- ── upsert_contact RPC (called by post-call-handler fire-and-forget) ──────────
-- Creates or updates a contact; increments call_count and sets last_call_at.
-- Safe to call concurrently — uses ON CONFLICT.
CREATE OR REPLACE FUNCTION upsert_contact(
  p_org_id       UUID,
  p_phone        TEXT,
  p_name         TEXT,
  p_email        TEXT,
  p_last_call_at TIMESTAMPTZ
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO contacts (org_id, phone, name, email, call_count, last_call_at, created_at, updated_at)
  VALUES (p_org_id, p_phone, p_name, p_email, 1, p_last_call_at, NOW(), NOW())
  ON CONFLICT (org_id, phone) DO UPDATE
    SET call_count   = contacts.call_count + 1,
        last_call_at = EXCLUDED.last_call_at,
        -- Only overwrite name/email if we have a value and the existing is NULL
        name         = COALESCE(EXCLUDED.name, contacts.name),
        email        = COALESCE(EXCLUDED.email, contacts.email),
        updated_at   = NOW();
END;
$$;

-- ── RLS for new tables ─────────────────────────────────────────────────────────
ALTER TABLE contacts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE magic_tokens ENABLE ROW LEVEL SECURITY;

-- Service role has full access (used by backend with service key)
DO $$
BEGIN
  -- contacts
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='contacts' AND policyname='service_role_all') THEN
    CREATE POLICY "service_role_all" ON contacts TO service_role USING (true) WITH CHECK (true);
  END IF;
  -- magic_tokens
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='magic_tokens' AND policyname='service_role_all') THEN
    CREATE POLICY "service_role_all" ON magic_tokens TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

SELECT 'CRM Migration complete ✓ — contacts, magic_tokens, upsert_contact RPC added' AS result;
