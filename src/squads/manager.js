// ============================================
// VoiceCore — Squad Manager (Multi-Agent)
// Transfer calls between specialized agents
// ============================================

const { Logger } = require('../utils/logger');
const log = new Logger('SQUADS');

class SquadManager {
  constructor(assistantManager) {
    this.assistantManager = assistantManager;
    this.squads = new Map();
    this.activeTransfers = new Map(); // callId -> transfer state
  }

  /**
   * Register a squad configuration
   */
  registerSquad(squadConfig) {
    const squad = {
      id: squadConfig.id,
      name: squadConfig.name,
      description: squadConfig.description || '',
      agents: squadConfig.agents || [],
      entryAgent: squadConfig.entryAgent || squadConfig.agents[0]?.id,
      transferMessage: squadConfig.transferMessage || 'Un momento, le paso con {agent}...',
      maxTransfers: squadConfig.maxTransfers || 5,
    };

    // Validate agents exist
    for (const agent of squad.agents) {
      if (!agent.id || !agent.role) {
        throw new Error(`Squad agent must have id and role: ${JSON.stringify(agent)}`);
      }
    }

    this.squads.set(squad.id, squad);
    log.info(`Squad registered: ${squad.id} — ${squad.name} (${squad.agents.length} agents)`);
    return squad;
  }

  /**
   * Get the entry agent for a squad
   */
  getEntryAgent(squadId) {
    const squad = this.squads.get(squadId);
    if (!squad) return null;
    return squad.agents.find(a => a.id === squad.entryAgent) || squad.agents[0];
  }

  /**
   * Evaluate transfer conditions after each LLM turn
   * Returns the agent to transfer to, or null
   */
  evaluateTransfer(callId, squadId, currentAgentId, lastUserMessage, lastAssistantMessage) {
    const squad = this.squads.get(squadId);
    if (!squad) return null;

    const currentAgent = squad.agents.find(a => a.id === currentAgentId);
    if (!currentAgent?.handoffConditions) return null;

    // Track transfer count
    const state = this.activeTransfers.get(callId) || { count: 0, history: [] };
    if (state.count >= squad.maxTransfers) {
      log.warn(`[${callId}] Max transfers reached (${squad.maxTransfers})`);
      return null;
    }

    const combined = `${lastUserMessage} ${lastAssistantMessage}`.toLowerCase();

    for (const condition of currentAgent.handoffConditions) {
      let shouldTransfer = false;

      // Intent-based matching
      if (condition.intent) {
        const keywords = Array.isArray(condition.keywords) ? condition.keywords : [condition.intent];
        shouldTransfer = keywords.some(kw => combined.includes(kw.toLowerCase()));
      }

      // Pattern matching
      if (condition.pattern) {
        const regex = new RegExp(condition.pattern, 'i');
        shouldTransfer = regex.test(combined);
      }

      // Function call trigger
      if (condition.onToolCall) {
        // Handled externally via checkToolCallTransfer
      }

      if (shouldTransfer) {
        const targetAgent = squad.agents.find(a => a.id === condition.transferTo);
        if (targetAgent) {
          state.count++;
          state.history.push({
            from: currentAgentId,
            to: condition.transferTo,
            reason: condition.intent || condition.pattern || 'condition_match',
            timestamp: new Date().toISOString(),
          });
          this.activeTransfers.set(callId, state);

          log.info(`[${callId}] Transfer: ${currentAgentId} → ${condition.transferTo} (${condition.intent || 'pattern'})`);
          return {
            targetAgent,
            message: (condition.transferMessage || squad.transferMessage).replace('{agent}', targetAgent.role),
            reason: condition.intent || condition.pattern,
          };
        }
      }
    }

    return null;
  }

  /**
   * Check if a tool call should trigger a transfer
   */
  checkToolCallTransfer(callId, squadId, currentAgentId, toolName) {
    const squad = this.squads.get(squadId);
    if (!squad) return null;

    const currentAgent = squad.agents.find(a => a.id === currentAgentId);
    if (!currentAgent?.handoffConditions) return null;

    for (const condition of currentAgent.handoffConditions) {
      if (condition.onToolCall === toolName) {
        const targetAgent = squad.agents.find(a => a.id === condition.transferTo);
        if (targetAgent) {
          log.info(`[${callId}] Tool-triggered transfer: ${currentAgentId} → ${condition.transferTo} (tool: ${toolName})`);
          return {
            targetAgent,
            message: (condition.transferMessage || squad.transferMessage).replace('{agent}', targetAgent.role),
            reason: `tool:${toolName}`,
          };
        }
      }
    }
    return null;
  }

  /**
   * Build the system prompt for an agent within a squad context
   */
  buildSquadPrompt(squadId, agentId) {
    const squad = this.squads.get(squadId);
    if (!squad) return null;

    const agent = squad.agents.find(a => a.id === agentId);
    if (!agent) return null;

    // Get agent's assistant config
    const assistant = this.assistantManager.get(agent.assistantId || agent.id);
    if (!assistant) return null;

    // Inject squad context into system prompt
    const squadContext = `\n\n[CONTEXTO DE EQUIPO]
Eres parte del equipo "${squad.name}". Tu rol es: ${agent.role}.
${agent.description || ''}
Otros miembros del equipo: ${squad.agents.filter(a => a.id !== agentId).map(a => `${a.role}`).join(', ')}.
Si detectas que el usuario necesita ayuda fuera de tu área, indica que le vas a transferir.`;

    return {
      ...assistant,
      systemPrompt: (assistant.systemPrompt || '') + squadContext,
    };
  }

  /**
   * Clear transfer state for a call
   */
  clearCall(callId) {
    this.activeTransfers.delete(callId);
  }

  /**
   * Get transfer history for a call
   */
  getTransferHistory(callId) {
    return this.activeTransfers.get(callId)?.history || [];
  }

  /**
   * List all squads
   */
  listSquads() {
    return Array.from(this.squads.values());
  }

  /**
   * Get squad by ID
   */
  getSquad(squadId) {
    return this.squads.get(squadId) || null;
  }
}

module.exports = { SquadManager };
