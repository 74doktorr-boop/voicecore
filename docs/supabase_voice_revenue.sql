-- NodeFlow — Voice Revenue Share Tracking
-- Run this in Supabase SQL editor (once)
-- =====================================================================

-- Track which voice was used in each call.
-- This assumes you already have a `calls` table with id, duration_sec, revenue_eur.
-- If not, create it or add the voice_id column to your existing calls table.

ALTER TABLE calls ADD COLUMN IF NOT EXISTS voice_id TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS revenue_eur NUMERIC(10,4) DEFAULT 0;

-- Voice contributor registry
CREATE TABLE IF NOT EXISTS voice_contributors (
  voice_id        TEXT PRIMARY KEY,        -- matches voice_id in calls table ("ane", "mikel", …)
  full_name       TEXT NOT NULL,
  email           TEXT NOT NULL,
  iban            TEXT,                    -- for payment
  revenue_pct     NUMERIC(5,2) NOT NULL,  -- e.g. 5.00 = 5%
  contract_signed DATE,
  active          BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Monthly revenue report view — run once per month to calculate payouts
CREATE OR REPLACE VIEW voice_revenue_monthly AS
SELECT
  c.voice_id,
  vc.full_name,
  vc.email,
  vc.revenue_pct,
  DATE_TRUNC('month', c.started_at)               AS month,
  COUNT(*)                                          AS call_count,
  ROUND(SUM(c.duration_sec) / 60.0, 2)            AS total_minutes,
  ROUND(SUM(c.revenue_eur), 4)                     AS gross_revenue_eur,
  ROUND(SUM(c.revenue_eur) * vc.revenue_pct / 100, 4) AS payout_eur
FROM calls c
JOIN voice_contributors vc ON vc.voice_id = c.voice_id
WHERE vc.active = TRUE
  AND c.voice_id IS NOT NULL
GROUP BY c.voice_id, vc.full_name, vc.email, vc.revenue_pct, DATE_TRUNC('month', c.started_at)
ORDER BY month DESC, payout_eur DESC;

-- Example: insert contributors after signing contracts
-- INSERT INTO voice_contributors (voice_id, full_name, email, revenue_pct, contract_signed)
-- VALUES
--   ('ane',   'Ane Etxeberria Zubiaurre', 'ane@email.com',   5.0, '2025-06-01'),
--   ('mikel', 'Mikel Arantzabal Uranga',  'mikel@email.com', 5.0, '2025-06-01');

-- Example: query payout for last month
-- SELECT * FROM voice_revenue_monthly
-- WHERE month = DATE_TRUNC('month', NOW() - INTERVAL '1 month');
