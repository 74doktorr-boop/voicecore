// ============================================
// VoiceCore — Assistant Manager
// Load, manage, and hot-reload assistant configurations
// ============================================

const fs = require('fs');
const path = require('path');
const { Logger } = require('../utils/logger');
const { timeOfDayGreeting } = require('./i18n');

const log = new Logger('ASSISTANT');

class AssistantManager {
  constructor(configDir = null) {
    this.assistants = new Map();
    this.configDir = configDir || path.join(process.cwd(), 'assistants');
    this.watchers = new Map();
  }

  /**
   * Load all assistant configurations from directory
   */
  loadAll() {
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
      log.info(`Created assistants directory: ${this.configDir}`);
    }

    const files = fs.readdirSync(this.configDir).filter(f => f.endsWith('.json'));
    
    for (const file of files) {
      const filePath = path.join(this.configDir, file);
      try {
        const config = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const id = config.id || path.basename(file, '.json');
        config.id = id;
        config._filePath = filePath;
        this.assistants.set(id, config);
        log.info(`Loaded assistant: ${id} (${config.name || 'unnamed'})`);
      } catch (e) {
        log.error(`Failed to load assistant config: ${file}`, { error: e.message });
      }
    }

    log.info(`Loaded ${this.assistants.size} assistant(s)`);
  }

  /**
   * Enable hot-reload watching on config directory
   */
  enableHotReload() {
    if (!fs.existsSync(this.configDir)) return;

    const watcher = fs.watch(this.configDir, (eventType, filename) => {
      if (!filename || !filename.endsWith('.json')) return;
      
      const filePath = path.join(this.configDir, filename);
      if (eventType === 'change' && fs.existsSync(filePath)) {
        try {
          const config = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          const id = config.id || path.basename(filename, '.json');
          config.id = id;
          config._filePath = filePath;
          this.assistants.set(id, config);
          log.info(`♻️ Hot-reloaded assistant: ${id}`);
        } catch (e) {
          log.error(`Failed to hot-reload: ${filename}`, { error: e.message });
        }
      }
    });

    this.watchers.set('dir', watcher);
    log.info('Hot-reload enabled for assistants directory');
  }

  /**
   * Get an assistant by ID
   */
  get(id) {
    return this.assistants.get(id);
  }

  /**
   * Get the default assistant (first one or 'default')
   */
  getDefault() {
    return this.assistants.get('default') || this.assistants.values().next().value;
  }

  /**
   * Get assistant by phone number
   */
  getByPhoneNumber(phoneNumber) {
    // Comparación normalizada al número nacional de 9 dígitos (util canónica):
    // '+34 843 98 76 54', '34843987654', '843987654' y '0034843987654' son el MISMO
    // número. Antes se mantenía el prefijo 34 → un número guardado sin país no casaba
    // con el E.164 de la telefonía y contestaba el negocio equivocado (multi-tenant).
    const { normalizePhone: norm } = require('../utils/phone');
    const target = norm(phoneNumber);
    if (target) {
      for (const [id, config] of this.assistants) {
        if (norm(config.phoneNumber) === target) return config;
        if (config.phoneNumbers?.some(p => norm(p) === target)) return config;
      }
    }
    return this.getDefault();
  }

  /**
   * Create or update an assistant
   */
  upsert(id, config) {
    // BUG-51 FIX: Sanitize id before using it as a filename to prevent path traversal.
    // An authenticated caller could pass id="../../package.json" and overwrite server files.
    // Allow only alphanumeric, hyphens, and underscores; strip everything else.
    const safeId = String(id).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100);
    if (!safeId) throw new Error('Invalid assistant id — only alphanumeric, hyphens and underscores allowed');
    id = safeId;

    config.id = id;
    config.updatedAt = new Date().toISOString();

    if (!config.createdAt) {
      config.createdAt = config.updatedAt;
    }

    this.assistants.set(id, config);

    // Save to file
    const filePath = path.join(this.configDir, `${id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2));
    config._filePath = filePath;

    log.info(`Saved assistant: ${id}`);
    return config;
  }

  /**
   * Delete an assistant
   */
  delete(id) {
    const config = this.assistants.get(id);
    if (config?._filePath && fs.existsSync(config._filePath)) {
      fs.unlinkSync(config._filePath);
    }
    this.assistants.delete(id);
    log.info(`Deleted assistant: ${id}`);
  }

  /**
   * List all assistants
   */
  list() {
    return Array.from(this.assistants.values()).map(a => ({
      id: a.id,
      name: a.name,
      voice: a.voice,
      model: a.model,
      language: a.language,
      phoneNumber: a.phoneNumber,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    }));
  }

  /**
   * Build the system message for an assistant
   */
  buildSystemMessage(assistant) {
    let systemPrompt = assistant.systemPrompt || assistant.system_prompt || '';
    
    // Add current date/time context (BUG-47: always use Madrid timezone — server runs UTC)
    const now = new Date();
    const dateStr = now.toLocaleDateString('es-ES', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      timeZone: 'Europe/Madrid',
    });
    const timeStr = now.toLocaleTimeString('es-ES', {
      hour: '2-digit', minute: '2-digit',
      timeZone: 'Europe/Madrid',
    });

    // BUG-31 FIX: Replace {{DATE}} placeholder that generatePrompt() embeds in templates.
    // Without this, the LLM sees the literal string "FECHA DE HOY: {{DATE}}" in its prompt.
    systemPrompt = systemPrompt.replace('{{DATE}}', dateStr);

    // Time-of-day greeting token — en el idioma del asistente (es/gl/eu)
    const madridHour = parseInt(now.toLocaleTimeString('es-ES', { hour: '2-digit', hour12: false, timeZone: 'Europe/Madrid' }), 10);
    const greeting = timeOfDayGreeting(assistant.language, madridHour);
    systemPrompt = systemPrompt.replace(/\{\{GREETING\}\}/g, greeting);

    systemPrompt += `\n\n[Contexto actual: ${dateStr}, ${timeStr}. Saludo apropiado: "${greeting}".]`;

    // Universal fallback rules appended to every assistant — override nothing, just safety net
    systemPrompt +=
      '\n\n[REGLAS GLOBALES DEL SISTEMA — siempre vigentes:' +
      '\n- Si el cliente dice "quiero hablar con una persona", "ponme con alguien", "quiero hablar con el responsable" o similar: di "Por supuesto, le aviso ahora mismo para que le llame en cuanto pueda" y usa flag_urgent con issue="El cliente quiere hablar con una persona".' +
      // Transparencia IA (AI Act): jamás fingir ser humano.
      '\n- Si el cliente pregunta si eres una persona, un robot o una inteligencia artificial: di la verdad con naturalidad ("Soy el asistente virtual del negocio") y sigue ayudando con normalidad. Nunca finjas ser una persona.' +
      '\n- Si la llamada llega fuera del horario de atención del negocio: di "Ahora mismo estamos cerrados, pero si me dejas tu nombre y teléfono te llamamos en cuanto abramos" y usa register_lead para guardar los datos.' +
      '\n- Nunca des un diagnóstico médico, consejo legal, fiscal, ni información de seguridad crítica — di que el especialista le contactará.' +
      '\n- Si no entiendes bien lo que dice el cliente, pide que lo repita una sola vez de forma natural.' +
      // Hallazgo del auditor (2026-07-06, 6/6 llamadas): el asistente re-preguntaba
      // y sobre-confirmaba ("¿ha dicho ok?", repetir el nombre). Regla determinista.
      '\n- No repitas lo que el cliente acaba de decir ni vuelvas a pedirle datos que ya te ha dado, y no confirmes cada frase ("¿ha dicho X?") salvo que de verdad no se entienda ni repitas su nombre para rellenar. Si ya tienes lo necesario, actúa —usa la herramienta o responde—, sin volver a preguntar.' +
      // Hallazgo del auditor: sobre-promesas ("el equipo le llamará muy pronto a este
      // número", ofrecer enviar email/WhatsApp que no puede enviar en la llamada).
      '\n- Comprométete SOLO a lo que puedes hacer con tus herramientas: agendar una cita, registrar el recado o avisar al responsable. NO ofrezcas enviar información por email, WhatsApp o SMS, ni prometas plazos concretos ("muy pronto", "en cinco minutos"), ni que "llamarás tú": al registrar un aviso, di simplemente que un compañero se pondrá en contacto, sin garantizar cuándo ni cómo.]';

    return { role: 'system', content: systemPrompt };
  }

  /**
   * Merge assistant tools with mandatory global tools.
   * Ensures flag_urgent and register_lead are always available
   * regardless of what the JSON declares.
   */
  buildToolList(assistant) {
    const existingTools = Array.isArray(assistant.tools) ? assistant.tools : [];
    const existingNames = new Set(existingTools.map(t =>
      t?.function?.name || t?.name || t
    ).filter(Boolean));

    const GLOBAL_TOOLS = [
      {
        type: 'function',
        function: {
          name: 'flag_urgent',
          description: 'Urgencia o petición de hablar con una persona. Alerta inmediata al responsable del negocio.',
          parameters: {
            type: 'object',
            properties: {
              client_name: { type: 'string' },
              phone:        { type: 'string' },
              issue:        { type: 'string', description: 'Qué está pasando o qué necesita el cliente' },
            },
            required: ['issue'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'register_lead',
          description: 'Guarda nombre y teléfono de un cliente que llama fuera de horario o quiere ser contactado.',
          parameters: {
            type: 'object',
            properties: {
              name:  { type: 'string' },
              phone: { type: 'string' },
              notes: { type: 'string' },
            },
            required: ['name', 'phone'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'add_to_waitlist',
          description: 'Cuando el cliente quiere una cita pero NO hay hueco disponible en su franja preferida, apúntalo a la lista de espera. Dile que le avisarás en cuanto se libere un hueco. Pide nombre, teléfono y cuándo le viene bien.',
          parameters: {
            type: 'object',
            properties: {
              name:      { type: 'string' },
              phone:     { type: 'string' },
              service:   { type: 'string', description: 'Servicio o tratamiento que quiere' },
              preferred: { type: 'string', description: 'Cuándo le viene bien (ej. "martes por la mañana")' },
            },
            required: ['phone'],
          },
        },
      },
    ];

    const toAdd = GLOBAL_TOOLS.filter(t => !existingNames.has(t.function.name));
    return [...existingTools, ...toAdd];
  }

  /**
   * Clean up watchers
   */
  destroy() {
    for (const [, watcher] of this.watchers) {
      watcher.close();
    }
    this.watchers.clear();
  }
}

module.exports = { AssistantManager };
