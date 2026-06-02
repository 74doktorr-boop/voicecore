require('dotenv').config();
const { analyzeTranscript } = require('../src/lifecycle/transcript-analyzer');

const SAMPLE_TRANSCRIPT = [
  { role: 'assistant', content: 'Hola, soy el asistente de la Clínica Dental Arrate. ¿En qué le puedo ayudar?' },
  { role: 'user',      content: 'Quería pedir una cita para una revisión' },
  { role: 'assistant', content: '¿Para qué día le viene bien? Tenemos el martes a las 10 disponible' },
  { role: 'user',      content: 'Perfecto, el martes a las 10. Me llamo María García, mi teléfono es el 612345678' },
  { role: 'assistant', content: 'Cita confirmada para María García el martes a las 10. ¡Hasta pronto!' },
];

async function main() {
  console.log('Testing analyzeTranscript...');
  const result = await analyzeTranscript(SAMPLE_TRANSCRIPT);
  if (!result) { console.error('❌ result is null'); process.exit(1); }
  console.assert(result.outcome === 'booked', `Expected outcome 'booked', got '${result.outcome}'`);
  console.assert(typeof result.summary === 'string' && result.summary.length > 10, 'Expected non-empty summary');
  console.assert(Array.isArray(result.topics), 'Expected topics array');
  console.log('✅ analyzeTranscript:', JSON.stringify(result, null, 2));
  process.exit(0);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
