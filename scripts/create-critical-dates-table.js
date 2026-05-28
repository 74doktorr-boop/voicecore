// Script to create the critical_dates table in Supabase
// Run: node scripts/create-critical-dates-table.js

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;

if (!url || !key) {
  console.error('ERROR: SUPABASE_URL or SUPABASE_SERVICE_KEY not set in .env');
  process.exit(1);
}

const client = createClient(url, key);

async function main() {
  console.log('Checking if critical_dates table exists...');

  // Check if table already exists
  const { error: checkErr } = await client.from('critical_dates').select('id').limit(1);

  if (!checkErr) {
    console.log('✅ Table critical_dates already exists and is accessible.');
    process.exit(0);
  }

  console.log('Table does not exist yet, creating via Supabase Management API...');
  console.log('Error was:', checkErr.message);

  // Supabase doesn't allow DDL via JS client directly — use the REST SQL endpoint
  // (requires service key with postgres access)
  const sql = `
    create table if not exists public.critical_dates (
      id uuid primary key,
      business_id text not null,
      client_name text not null,
      client_email text,
      client_phone text,
      type text not null,
      due_date date not null,
      notes text,
      advance_days integer[] default array[30, 15, 7],
      sent_reminders text[] default array[]::text[],
      active boolean default true,
      created_at timestamptz default now()
    );
    create index if not exists idx_critical_dates_business on public.critical_dates (business_id, active);
    create index if not exists idx_critical_dates_due_date on public.critical_dates (due_date) where active = true;
  `;

  // Try via Supabase SQL REST endpoint (requires Postgres URL)
  const pgUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  if (pgUrl) {
    try {
      const { Pool } = require('pg');
      const pool = new Pool({ connectionString: pgUrl, ssl: { rejectUnauthorized: false } });
      await pool.query(sql);
      await pool.end();
      console.log('✅ Table created via pg direct connection!');
      process.exit(0);
    } catch (e) {
      console.log('pg direct failed:', e.message);
    }
  }

  // If we got here, output the SQL for manual execution
  console.log('\n───────────────────────────────────────────');
  console.log('Could not create table automatically.');
  console.log('Please run this SQL in your Supabase SQL Editor:');
  console.log('───────────────────────────────────────────');
  console.log(sql);
  console.log('───────────────────────────────────────────');
  process.exit(1);
}

main().catch(e => {
  console.error('Fatal error:', e.message);
  process.exit(1);
});
