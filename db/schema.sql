-- ============================================
-- VoiceCore v2.0 — Database Schema
-- Multi-tenant Voice AI Platform
-- ============================================

-- Organizations (tenants)
CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  plan TEXT NOT NULL DEFAULT 'starter', -- starter, pro, business, enterprise
  api_key TEXT UNIQUE NOT NULL,
  api_key_hash TEXT,
  owner_email TEXT NOT NULL,
  owner_name TEXT,
  phone TEXT,
  settings JSONB DEFAULT '{}',
  monthly_minutes_limit INT DEFAULT 50,
  monthly_minutes_used DECIMAL(10,2) DEFAULT 0,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Assistants (per org)
CREATE TABLE IF NOT EXISTS assistants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  system_prompt TEXT,
  first_message TEXT,
  voice TEXT DEFAULT 'nova',
  language TEXT DEFAULT 'es',
  model TEXT DEFAULT 'gpt-4o-mini',
  fallback_model TEXT,
  stt_provider TEXT DEFAULT 'deepgram',
  stt_model TEXT DEFAULT 'nova-3',
  tts_provider TEXT DEFAULT 'openai',
  tts_strategy TEXT DEFAULT 'latency',
  tts_fallback TEXT DEFAULT 'openai',
  temperature DECIMAL(3,2) DEFAULT 0.7,
  max_tokens INT DEFAULT 500,
  speed DECIMAL(3,2) DEFAULT 1.0,
  utterance_end_ms INT DEFAULT 1000,
  endpointing INT DEFAULT 300,
  tools JSONB DEFAULT '[]',
  metadata JSONB DEFAULT '{}',
  phone_number TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, slug)
);

-- Calls (call history)
CREATE TABLE IF NOT EXISTS calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  assistant_id UUID REFERENCES assistants(id) ON DELETE SET NULL,
  call_sid TEXT,
  caller_number TEXT,
  called_number TEXT,
  direction TEXT DEFAULT 'inbound', -- inbound, outbound, browser
  status TEXT DEFAULT 'active', -- active, ended, failed
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  duration_ms INT DEFAULT 0,
  turn_count INT DEFAULT 0,
  transcript JSONB DEFAULT '[]',
  metrics JSONB DEFAULT '{}',
  cost JSONB DEFAULT '{}',
  total_cost DECIMAL(10,6) DEFAULT 0,
  stt_provider TEXT,
  llm_provider TEXT,
  tts_provider TEXT,
  recording_url TEXT,
  webhook_data JSONB,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Appointments (scheduling)
CREATE TABLE IF NOT EXISTS appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  business_id TEXT NOT NULL,
  call_id UUID REFERENCES calls(id) ON DELETE SET NULL,
  patient_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  service TEXT,
  service_id TEXT,
  date DATE NOT NULL,
  time TIME NOT NULL,
  duration INT DEFAULT 30,
  price DECIMAL(10,2) DEFAULT 0,
  status TEXT DEFAULT 'confirmed', -- confirmed, cancelled, completed, no_show
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Usage tracking (per org per period)
CREATE TABLE IF NOT EXISTS usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  period TEXT NOT NULL, -- YYYY-MM format
  call_count INT DEFAULT 0,
  call_minutes DECIMAL(10,2) DEFAULT 0,
  stt_minutes DECIMAL(10,2) DEFAULT 0,
  llm_tokens INT DEFAULT 0,
  tts_characters INT DEFAULT 0,
  tool_calls INT DEFAULT 0,
  total_cost DECIMAL(10,4) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, period)
);

-- Webhooks (per org)
CREATE TABLE IF NOT EXISTS webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  events TEXT[] DEFAULT ARRAY['call.started', 'call.ended'],
  secret TEXT,
  is_active BOOLEAN DEFAULT true,
  last_triggered_at TIMESTAMPTZ,
  failure_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Registros (leads from landing page form, pre-payment)
CREATE TABLE IF NOT EXISTS registros (
  id TEXT PRIMARY KEY,                          -- reg_XXXXXXXXXXXXXXXX
  status TEXT NOT NULL DEFAULT 'pending_payment', -- pending_payment, active, cancelled
  sector TEXT NOT NULL,
  negocio TEXT NOT NULL,
  contacto TEXT NOT NULL,
  ciudad TEXT NOT NULL,
  telefono TEXT NOT NULL,
  email TEXT NOT NULL,
  plan TEXT NOT NULL,                           -- negocio, pro
  voz TEXT NOT NULL,
  idioma TEXT NOT NULL,
  saludo TEXT NOT NULL,
  horario JSONB DEFAULT '{}',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_registros_email ON registros(email);
CREATE INDEX IF NOT EXISTS idx_registros_status ON registros(status);
CREATE INDEX IF NOT EXISTS idx_registros_stripe_customer ON registros(stripe_customer_id);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_assistants_org ON assistants(org_id);
CREATE INDEX IF NOT EXISTS idx_calls_org ON calls(org_id);
CREATE INDEX IF NOT EXISTS idx_calls_started ON calls(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_status ON calls(status);
CREATE INDEX IF NOT EXISTS idx_appointments_org ON appointments(org_id);
CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(date, time);
CREATE INDEX IF NOT EXISTS idx_usage_org_period ON usage(org_id, period);
CREATE INDEX IF NOT EXISTS idx_orgs_api_key ON organizations(api_key);

-- Row Level Security (RLS)
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistants ENABLE ROW LEVEL SECURITY;
ALTER TABLE calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;
