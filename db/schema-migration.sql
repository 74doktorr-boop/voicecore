-- ============================================================
-- NodeFlow — Schema Migration v2
-- Run this in Supabase SQL Editor (Database → SQL Editor)
-- ============================================================

-- ── Organizations: automation + Google + language columns ────────────────────
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS google_place_id        TEXT,
  ADD COLUMN IF NOT EXISTS review_url             TEXT,
  ADD COLUMN IF NOT EXISTS automation_config      JSONB        DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS google_calendar_id     TEXT,
  ADD COLUMN IF NOT EXISTS google_refresh_token   TEXT,
  ADD COLUMN IF NOT EXISTS google_access_token    TEXT,
  ADD COLUMN IF NOT EXISTS google_token_expiry    BIGINT,
  ADD COLUMN IF NOT EXISTS language               VARCHAR(5)   DEFAULT 'es';  -- 'es' | 'eu' | 'gl'

COMMENT ON COLUMN organizations.language IS 'Primary language of the business: es=Spanish, eu=Basque, gl=Galician';

-- ── Appointments: email + calendar event ID ──────────────────────────────────
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS email                    TEXT,
  ADD COLUMN IF NOT EXISTS google_calendar_event_id TEXT,
  ADD COLUMN IF NOT EXISTS reminder_sent_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS review_sent_at           TIMESTAMPTZ;

-- ── Registros: extra Stripe + source + language fields ──────────────────────
ALTER TABLE registros
  ADD COLUMN IF NOT EXISTS stripe_customer_id     TEXT,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS paid_at                TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS source                 TEXT,          -- 'galiza' | 'hementxe' | null
  ADD COLUMN IF NOT EXISTS language               VARCHAR(5) DEFAULT 'es';  -- 'es' | 'eu' | 'gl'

-- ── Index for automation cron queries ────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_appointments_date_status
  ON appointments (business_id, date, status);

CREATE INDEX IF NOT EXISTS idx_appointments_reminder_sent
  ON appointments (reminder_sent_at) WHERE reminder_sent_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_appointments_review_sent
  ON appointments (review_sent_at) WHERE review_sent_at IS NULL;

-- ── RLS: allow service role full access ──────────────────────────────────────
-- (Already set if you used the standard schema — just for reference)
-- ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "service_role_all" ON organizations TO service_role USING (true);

SELECT 'Migration complete ✓' AS result;
