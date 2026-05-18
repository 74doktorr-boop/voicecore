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
    return output;
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
}

module.exports = { Logger };
