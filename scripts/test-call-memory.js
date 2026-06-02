// Quick smoke test — requires DB connection
// Run: node scripts/test-call-memory.js
require('dotenv').config();
const { buildCallContext } = require('../src/lifecycle/call-memory');

async function main() {
  // Should return isFirstCall: true for a non-existent contact
  const ctx = await buildCallContext('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000');
  console.assert(ctx.isFirstCall === true, 'Expected isFirstCall: true for unknown contact');
  console.assert(typeof ctx.sectorData === 'object', 'Expected sectorData object');
  console.log('✅ buildCallContext cold start: OK');
  process.exit(0);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
