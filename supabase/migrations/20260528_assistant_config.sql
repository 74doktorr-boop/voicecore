-- Migration: Playground + Assistant Config
-- Run this in Supabase SQL Editor:
-- https://supabase.com/dashboard/project/fmqhreiumahjpdmeyooh/sql/new

-- 1. Add assistant_config JSONB column to organizations
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS assistant_config JSONB DEFAULT '{}';

-- 2. Create demo_bots table (test assistants not linked to any org)
CREATE TABLE IF NOT EXISTS demo_bots (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  sector      TEXT NOT NULL DEFAULT 'generico',
  config      JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Verify
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'organizations'
  AND column_name = 'assistant_config';

SELECT EXISTS (
  SELECT FROM pg_tables
  WHERE schemaname = 'public' AND tablename = 'demo_bots'
) AS demo_bots_exists;
