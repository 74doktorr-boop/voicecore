// ============================================
// VoiceCore — Structured Logger
// Color-coded, timestamped logging with call context
// ============================================

const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
};

const LEVEL_CONFIG = {
  DEBUG: { color: COLORS.dim, icon: '🔍' },
  INFO: { color: COLORS.cyan, icon: '💬' },
  WARN: { color: COLORS.yellow, icon: '⚠️' },
  ERROR: { color: COLORS.red, icon: '❌' },
  CALL: { color: COLORS.green, icon: '📞' },
  STT: { color: COLORS.blue, icon: '👂' },
  LLM: { color: COLORS.magenta, icon: '🧠' },
  TTS: { color: COLORS.cyan, icon: '🔊' },
  TOOL: { color: COLORS.yellow, icon: '🔧' },
  METRIC: { color: COLORS.green, icon: '📊' },
};

// ── Redacción de datos personales (auditoría 2026-07-29, hallazgo F7) ────────
// Los logs van a stdout de EasyPanel y llevaban teléfonos completos de los
// clientes finales de nuestros clientes, y en el caso del STT la transcripción
// íntegra de lo que dice un paciente. Son datos de terceros que nunca
// contrataron nada con NodeFlow, y en sectores sanitarios son categoría
// especial (art. 9 RGPD). No había NADA de redacción en todo el logger.
//
// Se enmascara el cuerpo del teléfono y se deja prefijo + últimos 2 dígitos:
// suficiente para correlacionar y diagnosticar, inútil para identificar.
// LOG_PII=1 lo desactiva para depurar en local.
// Candidato a teléfono. Las miradas atrás/adelante `(?<![\w-])` y `(?![\w-])`
// son la clave: sin ellas se enmascaraban trozos de UUID (los callId, que son
// justo lo que permite correlacionar una llamada en los logs) y de fechas.
const PHONE_RE = /(?<![\w-])(\+?\d[\d\s.-]{7,17}\d)(?![\w-])/g;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function redactPII(text) {
  const s = String(text);
  if (process.env.LOG_PII === '1') return s;
  return s.replace(PHONE_RE, (m) => {
    const t = m.trim();
    if (ISO_DATE_RE.test(t)) return m;                        // 2026-08-01
    const digits = t.replace(/\D/g, '');
    // Los teléfonos españoles tienen 9 dígitos (11-12 con prefijo). Por debajo
    // de 9 casi siempre es una métrica; por encima de 15 no es un E.164 válido.
    if (digits.length < 9 || digits.length > 15) return m;
    return `${t.startsWith('+') ? '+' : ''}${digits.slice(0, 3)}······${digits.slice(-2)}`;
  });
}

class Logger {
  constructor(module = 'CORE') {
    this.module = module;
  }

  _format(level, message, data = null) {
    const config = LEVEL_CONFIG[level] || LEVEL_CONFIG.INFO;
    const timestamp = new Date().toISOString().replace('T', ' ').replace('Z', '');
    const prefix = `${config.color}${config.icon} [${timestamp}] [${level}] [${this.module}]${COLORS.reset}`;
    
    let output = `${prefix} ${message}`;
    if (data) {
      if (typeof data === 'object') {
        const compact = JSON.stringify(data, null, 0);
        if (compact.length < 200) {
          output += ` ${COLORS.dim}${compact}${COLORS.reset}`;
        } else {
          output += `\n${COLORS.dim}${JSON.stringify(data, null, 2)}${COLORS.reset}`;
        }
      } else {
        output += ` ${COLORS.dim}${data}${COLORS.reset}`;
      }
    }
    return redactPII(output);
  }

  debug(msg, data) { console.log(this._format('DEBUG', msg, data)); }
  info(msg, data) { console.log(this._format('INFO', msg, data)); }
  warn(msg, data) { console.warn(this._format('WARN', msg, data)); }
  error(msg, data) { console.error(this._format('ERROR', msg, data)); }
  call(msg, data) { console.log(this._format('CALL', msg, data)); }
  stt(msg, data) { console.log(this._format('STT', msg, data)); }
  llm(msg, data) { console.log(this._format('LLM', msg, data)); }
  tts(msg, data) { console.log(this._format('TTS', msg, data)); }
  tool(msg, data) { console.log(this._format('TOOL', msg, data)); }
  metric(msg, data) { console.log(this._format('METRIC', msg, data)); }

  child(module) {
    return new Logger(`${this.module}:${module}`);
  }

  /**
   * Logger atado a una llamada: antepone `[callId]` a todo lo que emita.
   *
   * F6 (auditoría 2026-07-29): el id de correlación cubría ~17% de las trazas y
   * el corte estaba justo donde más duele — NINGUNO de los 22 logs del
   * post-call lo llevaba. Si a un cliente no le llegaba su confirmación de cita,
   * en los logs quedaba "WA confirmation to client failed" sin llamada, sin
   * negocio y sin teléfono: no diagnosticable. Y ese callId es además la PK de
   * nf_calls y el id que usa el portal para la transcripción, así que
   * correlaciona logs ↔ BD ↔ interfaz.
   */
  forCall(callId) {
    if (!callId) return this;
    const base = this;
    const wrap = (level) => (msg, data) => base[level](`[${callId}] ${msg}`, data);
    return {
      debug: wrap('debug'), info: wrap('info'), warn: wrap('warn'), error: wrap('error'),
      call: wrap('call'), stt: wrap('stt'), llm: wrap('llm'), tts: wrap('tts'),
      tool: wrap('tool'), metric: wrap('metric'),
    };
  }
}

module.exports = { Logger, redactPII };
