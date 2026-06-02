const { calculateScheduledFor } = require('../src/lifecycle/reminder-engine');

// Test from_last_appointment
const def1 = { trigger: 'from_last_appointment', days: 24 };
const lastApt = new Date(Date.now() - 10 * 86400000).toISOString(); // 10 days ago
const result1 = calculateScheduledFor(def1, {}, lastApt);
const expectedDaysFromNow = Math.round((result1 - Date.now()) / 86400000);
console.assert(expectedDaysFromNow >= 13 && expectedDaysFromNow <= 15, `Expected ~14 days, got ${expectedDaysFromNow}`);
console.log(`✅ from_last_appointment: fires in ~${expectedDaysFromNow} days`);

// Test before_sector_field with future date
const def2 = { trigger: 'before_sector_field', field: 'fecha_vencimiento_itv', days: 60 };
const futureDate = new Date(Date.now() + 100 * 86400000).toISOString().split('T')[0]; // 100 days from now
const result2 = calculateScheduledFor(def2, { fecha_vencimiento_itv: futureDate }, null);
const daysUntil = Math.round((result2 - Date.now()) / 86400000);
console.assert(daysUntil >= 38 && daysUntil <= 42, `Expected ~40 days, got ${daysUntil}`);
console.log(`✅ before_sector_field (ITV): fires in ~${daysUntil} days`);

// Test null returns for missing data
const result3 = calculateScheduledFor(def2, {}, null);
console.assert(result3 === null, 'Expected null when sector field missing');
console.log('✅ Missing field returns null correctly');

// Test past appointment returns null (don't schedule in past)
const def3 = { trigger: 'from_last_appointment', days: 5 };
const oldApt = new Date(Date.now() - 20 * 86400000).toISOString(); // 20 days ago → 5 days = 15 days in past
const result4 = calculateScheduledFor(def3, {}, oldApt);
console.assert(result4 === null, 'Expected null for past date');
console.log('✅ Past date returns null correctly');

process.exit(0);
