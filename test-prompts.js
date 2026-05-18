// VoiceCore — Edge Case Tests (Round 2)
// Tests difficult scenarios: ambiguity, corrections, rude users, etc.
require('dotenv').config();
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const { ToolExecutor } = require('./src/tools/executor');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const toolExecutor = new ToolExecutor();
const clinicConfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'assistants/demo-clinic.json'), 'utf8'));
const systemPrompt = clinicConfig.systemPrompt.replace('{{DATE}}', new Date().toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }));
const tools = clinicConfig.tools.filter(t => t.type === 'function').map(t => ({ type: 'function', function: t.function }));

const scenarios = [
  {
    name: "Usuario impaciente — da todo rapido",
    messages: [
      "Hola, mira necesito una revision dental para el viernes a las diez, me llamo Juan Perez, mi telefono 612345678",
      "Si, perfecto"
    ]
  },
  {
    name: "Usuario cambia de opinion",
    messages: [
      "Hola, quiero pedir cita",
      "Soy Maria Lopez",
      "Una limpieza",
      "El lunes por la manana",
      "Ay no espera, mejor el martes por la tarde",
      "A las seis esta bien",
      "666111222",
      "Si, confirmo"
    ]
  },
  {
    name: "Usuario pregunta precios",
    messages: [
      "Hola, queria saber cuanto cuesta una limpieza dental",
      "Y un blanqueamiento?",
      "Vale, pues una limpieza entonces",
      "Soy Roberto Diaz",
      "El jueves que viene por la tarde",
      "A las cuatro me viene bien",
      "Mi movil es el 677888999",
      "Si"
    ]
  },
  {
    name: "Usuario vago — respuestas minimas",
    messages: [
      "Cita",
      "Revision",
      "Paco",
      "Paco Gonzalez",
      "La semana que viene",
      "Mananas",
      "Si",
      "677111333",
      "Vale"
    ]
  },
  {
    name: "Respuesta corta tras saludo",
    messages: [
      "Buenos dias, queria una cita",
      "Era para pedir una cita para una revision por favor",
      "Me llamo Unay",
      "Pues solo tengo disponibilidad por las tardes",
      "A las cinco me vendria bien",
      "666351319",
      "Si, correcto"
    ]
  },
  {
    name: "Usuario dice 'a las cinco de la tarde' — no debe preguntar 16 o 17",
    messages: [
      "Hola, soy Elena y quiero una revision",
      "El miercoles por la tarde",
      "A las cinco de la tarde",
      "Si, perfecto, mi telefono es 611222333",
      "Si, confirmo"
    ]
  }
];

async function runScenario(scenario) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`TEST: ${scenario.name}`);
  console.log('='.repeat(60));

  const conversation = [
    { role: 'system', content: systemPrompt },
    { role: 'assistant', content: clinicConfig.firstMessage }
  ];
  console.log(`BOT: ${clinicConfig.firstMessage}`);

  let issues = [];

  for (const userMsg of scenario.messages) {
    console.log(`\nUSR: ${userMsg}`);
    conversation.push({ role: 'user', content: userMsg });

    let keepProcessing = true;
    let rounds = 0;
    while (keepProcessing && rounds < 5) {
      rounds++;
      const params = { model: clinicConfig.model, messages: conversation, temperature: clinicConfig.temperature, max_tokens: clinicConfig.maxTokens };
      if (tools.length > 0) params.tools = tools;
      const response = await openai.chat.completions.create(params);
      const message = response.choices[0].message;

      if (message.tool_calls && message.tool_calls.length > 0) {
        conversation.push(message);
        for (const tc of message.tool_calls) {
          let args = {}; try { args = JSON.parse(tc.function.arguments || '{}'); } catch (e) {}
          console.log(`  [TOOL] ${tc.function.name}(${JSON.stringify(args).substring(0,100)})`);
          const result = await toolExecutor.execute(tc.function.name, args, 'demo-clinic');
          conversation.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
        }
        continue;
      }

      if (message.content) {
        conversation.push({ role: 'assistant', content: message.content });
        // Issue detection
        const flags = [];
        if (/\b(what|how|can|please|would|your|name|appointment|hello|hi)\b/i.test(message.content)) flags.push('ENGLISH');
        if (message.content.length > 300) flags.push('TOO_LONG');
        if (/te refieres.*16.*17|16 o 17|dieciséis o diecisiete/i.test(message.content)) flags.push('UNNECESSARY_CLARIFICATION');
        if (flags.length) { issues.push(...flags); console.log(`BOT [!!${flags.join(',')}!!]: ${message.content}`); }
        else console.log(`BOT: ${message.content}`);
      }
      keepProcessing = false;
    }
  }
  return issues;
}

async function main() {
  console.log('VoiceCore Edge Case Tests — Round 2\n');
  const allIssues = {};
  for (const s of scenarios) {
    try {
      const issues = await runScenario(s);
      allIssues[s.name] = issues;
    } catch (err) { console.error(`ERROR: ${s.name}: ${err.message}`); allIssues[s.name] = ['CRASH']; }
  }
  console.log(`\n${'='.repeat(60)}`);
  console.log('SUMMARY');
  console.log('='.repeat(60));
  for (const [name, issues] of Object.entries(allIssues)) {
    console.log(`${issues.length === 0 ? 'PASS' : 'FAIL'} ${name}${issues.length ? ` — ${issues.join(', ')}` : ''}`);
  }
}
main();
