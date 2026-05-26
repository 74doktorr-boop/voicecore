require('dotenv').config();
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const https = require('https');

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;

async function cloneVoice(audioFilePath, voiceName = 'VoiceCore Assistant - Unai') {
  console.log('🎙️  Clonando voz desde:', audioFilePath);
  console.log('📝  Nombre de la voz:', voiceName);
  
  if (!fs.existsSync(audioFilePath)) {
    console.error('❌ Archivo no encontrado:', audioFilePath);
    process.exit(1);
  }
  
  const fileSize = fs.statSync(audioFilePath).size;
  console.log('📦  Tamaño del archivo:', (fileSize / 1024 / 1024).toFixed(2), 'MB');
  
  const form = new FormData();
  form.append('name', voiceName);
  form.append('description', 'Voz clonada para VoiceCore - Asistente IA en español para NodeFlow');
  form.append('files', fs.createReadStream(audioFilePath));
  // Labels for organization
  form.append('labels', JSON.stringify({
    language: 'es',
    use_case: 'voicecore_assistant',
    accent: 'spanish_basque'
  }));
  
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.elevenlabs.io',
      path: '/v1/voices/add',
      method: 'POST',
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
        ...form.getHeaders()
      }
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          const result = JSON.parse(data);
          console.log('\n✅ ¡Voz clonada con éxito!');
          console.log('🆔 Voice ID:', result.voice_id);
          console.log('\n📋 Próximos pasos:');
          console.log('1. Añadir a .env: ELEVENLABS_VOICE_ID=' + result.voice_id);
          console.log('2. Redesplegar en Easypanel');
          console.log('3. Probar con llamada de prueba');
          resolve(result);
        } else {
          console.error('❌ Error:', res.statusCode);
          console.error('Response:', data);
          reject(new Error(data));
        }
      });
    });
    
    form.pipe(req);
  });
}

// Preview: list existing voices
async function listVoices() {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.elevenlabs.io',
      path: '/v1/voices',
      method: 'GET',
      headers: { 'xi-api-key': ELEVENLABS_API_KEY }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const voices = JSON.parse(data);
        console.log('\n📋 Voces disponibles:');
        voices.voices.forEach(v => {
          const labels = v.labels || {};
          console.log(`  🔊 ${v.name} (${v.voice_id}) - ${v.category} - ${labels.language || 'unknown'}`);
        });
        resolve(voices);
      });
    });
    req.end();
  });
}

// Test: generate speech with a voice
async function testVoice(voiceId, text = 'Hola, bienvenido a NodeFlow. ¿En qué puedo ayudarte hoy?') {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      text: text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.8,
        style: 0.3,
        use_speaker_boost: true
      }
    });

    const req = https.request({
      hostname: 'api.elevenlabs.io',
      path: `/v1/text-to-speech/${voiceId}`,
      method: 'POST',
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg'
      }
    }, (res) => {
      if (res.statusCode === 200) {
        const outputPath = path.join(__dirname, 'voice_test_output.mp3');
        const file = fs.createWriteStream(outputPath);
        res.pipe(file);
        file.on('finish', () => {
          console.log('✅ Audio de prueba guardado en:', outputPath);
          resolve(outputPath);
        });
      } else {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          console.error('❌ Error:', res.statusCode, data);
          reject(new Error(data));
        });
      }
    });
    req.write(body);
    req.end();
  });
}

// CLI
const command = process.argv[2];
const arg = process.argv[3];

switch (command) {
  case 'clone':
    if (!arg) {
      console.log('Uso: node clone_voice.js clone <ruta-audio>');
      console.log('Ejemplo: node clone_voice.js clone ./mi_voz.mp3');
      process.exit(1);
    }
    cloneVoice(arg);
    break;
  case 'list':
    listVoices();
    break;
  case 'test':
    if (!arg) {
      console.log('Uso: node clone_voice.js test <voice-id>');
      process.exit(1);
    }
    testVoice(arg, process.argv[4] || undefined);
    break;
  default:
    console.log('🎙️  VoiceCore Voice Cloning Tool');
    console.log('');
    console.log('Comandos:');
    console.log('  node clone_voice.js list              → Ver voces disponibles');
    console.log('  node clone_voice.js clone <audio.mp3> → Clonar nueva voz');
    console.log('  node clone_voice.js test <voice-id>   → Generar audio de prueba');
}
