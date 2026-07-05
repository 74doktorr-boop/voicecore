// ============================================================
// NodeFlow — el backup semanal DEBE cubrir las tablas críticas.
// Faltaba nf_calls (fuente de verdad de llamadas) y otras → si se pierde
// la BD no se recuperan. Este test evita que se caigan en el futuro.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { BACKUP_TABLES } = require('../src/db/backup');

describe('backup — cubre las tablas críticas', () => {
  const CRITICAL = [
    'organizations', 'contacts', 'contact_memory', 'nf_calls', 'call_summaries',
    'nf_appointments', 'nf_referrals', 'nf_referral_conversions', 'knowledge_chunks',
    'nf_sectors', 'nf_tasks', 'nf_waitlist', 'nf_callbacks', 'critical_dates',
    'whatsapp_accounts', 'registros', 'usage',
  ];
  for (const t of CRITICAL) {
    test(`incluye "${t}"`, () => assert.ok(BACKUP_TABLES.includes(t), `${t} DEBE estar en el backup`));
  }
  test('sin tablas duplicadas', () => {
    assert.strictEqual(new Set(BACKUP_TABLES).size, BACKUP_TABLES.length);
  });
});
