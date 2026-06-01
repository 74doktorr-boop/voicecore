-- ============================================================
-- NodeFlow — Webhook Configs Migration
-- Run once in Supabase SQL editor to enable webhook storage.
-- Without this table the webhook system runs in-memory only
-- (configs lost on restart).
-- ============================================================

CREATE TABLE IF NOT EXISTS webhook_configs (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  TEXT        NOT NULL,
  url          TEXT        NOT NULL,
  secret       TEXT        NOT NULL,           -- whsec_ prefix, HMAC-SHA256 signing key
  events       TEXT[]      NOT NULL DEFAULT ARRAY['*']::TEXT[],  -- ['*'] = all events
  enabled      BOOLEAN     NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast lookup by business
CREATE INDEX IF NOT EXISTS idx_webhook_configs_business_id
  ON webhook_configs (business_id);

-- RLS: business can only see their own webhook configs
ALTER TABLE webhook_configs ENABLE ROW LEVEL SECURITY;

-- NodeFlow server (service role) has full access — no RLS restriction needed
-- Client-facing portal uses the server as a proxy, so service role is fine.

-- ── Optional: delivery log table ──────────────────────────────────────────────
-- Uncomment if you want delivery history / debugging visibility in the portal.
-- The dispatcher does NOT require this table to function.
--
-- CREATE TABLE IF NOT EXISTS webhook_deliveries (
--   id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
--   webhook_config_id UUID        REFERENCES webhook_configs(id) ON DELETE CASCADE,
--   business_id       TEXT        NOT NULL,
--   event_type        TEXT        NOT NULL,
--   payload           JSONB       NOT NULL,
--   response_status   INT,
--   attempts          INT         NOT NULL DEFAULT 1,
--   delivered_at      TIMESTAMPTZ,
--   failed_at         TIMESTAMPTZ,
--   created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
-- );
-- CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_config
--   ON webhook_deliveries (webhook_config_id, created_at DESC);
