// ============================================
// VoiceCore — Assistant Manager
// Load, manage, and hot-reload assistant configurations
// ============================================

const fs = require('fs');
const path = require('path');
const { Logger } = require('../utils/logger');

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
    for (const [id, config] of this.assistants) {
      if (config.phoneNumber === phoneNumber || config.phoneNumbers?.includes(phoneNumber)) {
        return config;
      }
    }
    return this.getDefault();
  }

  /**
   * Create or update an assistant
   */
  upsert(id, config) {
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
    
    // Add current date/time context
    const now = new Date();
    const dateStr = now.toLocaleDateString('es-ES', { 
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' 
    });
    const timeStr = now.toLocaleTimeString('es-ES', { 
      hour: '2-digit', minute: '2-digit' 
    });

    systemPrompt += `\n\n[Contexto actual: ${dateStr}, ${timeStr}]`;

    return { role: 'system', content: systemPrompt };
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
