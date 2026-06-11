-- ============================================================
-- NodeFlow — Migración: sistema de referidos
-- ============================================================
-- Cada negocio activo tiene un código de referido único. Cuando
-- otro negocio se registra y paga con ese código:
--   · el NUEVO negocio entra con descuento (referee)
--   · el negocio que refirió gana una recompensa (referrer)
--
-- Ejecutar una vez en Supabase → SQL Editor. Idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS nf_referrals (
  code              text PRIMARY KEY,                  -- ej. "REF-DENTALX-A3F9"
  referrer_org_id   text NOT NULL,                     -- quién refiere
  referrer_email    text,
  referee_discount  int  NOT NULL DEFAULT 15,          -- % de descuento para el nuevo negocio
  times_shared      int  NOT NULL DEFAULT 0,           -- veces usado en un registro
  times_converted   int  NOT NULL DEFAULT 0,           -- veces que el referido pagó
  reward_pending    int  NOT NULL DEFAULT 0,           -- recompensas pendientes de aplicar al referrer
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_referrals_org ON nf_referrals (referrer_org_id);

-- Registro de cada conversión (para auditoría y para no recompensar dos veces)
CREATE TABLE IF NOT EXISTS nf_referral_conversions (
  id                bigserial PRIMARY KEY,
  code              text NOT NULL REFERENCES nf_referrals(code),
  referee_registro_id text,
  referee_email     text,
  status            text NOT NULL DEFAULT 'signup',    -- 'signup' | 'converted'
  created_at        timestamptz NOT NULL DEFAULT now(),
  converted_at      timestamptz
);

CREATE INDEX IF NOT EXISTS idx_referral_conv_code ON nf_referral_conversions (code);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_referral_conv_registro
  ON nf_referral_conversions (referee_registro_id)
  WHERE referee_registro_id IS NOT NULL;
