// ============================================================
// VoiceCore — Filtro de tool calls textualizados (Llama/Groq)
// Bug real (llamada PSTN 2026-07-03): Llama 3.3 emitió
// "<function=check_availability>{...}" como TEXTO plano en vez de
// usar el canal estructurado de tool_calls. El pipeline lo trató
// como una frase, lo mandó a ElevenLabs y el cliente OYÓ el JSON
// recitado — y la herramienta jamás se ejecutó (violando la regla
// de oro: nunca hablar de disponibilidad sin consultarla).
//
// Este filtro trabaja en pleno streaming: deja pasar el texto
// seguro, retiene cualquier cola que pueda ser el inicio de un
// "<function" partido entre chunks, y al cerrar el stream devuelve
// los tool calls parseados como si hubieran sido nativos.
// ============================================================
'use strict';

const MARKER = '<function';

// Mayor k tal que los últimos k caracteres de s son un prefijo de MARKER.
// Sirve para retener "…<fun" al final de un chunk sin bloquear el resto.
function partialMarkerSuffix(s) {
  const max = Math.min(s.length, MARKER.length - 1);
  for (let k = max; k > 0; k--) {
    if (s.slice(-k) === MARKER.slice(0, k)) return k;
  }
  return 0;
}

// Red de seguridad para cualquier texto que vaya a TTS: corta desde el
// primer tool call textualizado hasta el final. Nunca se lee en voz alta.
function stripTextualToolCalls(text) {
  return String(text || '')
    .replace(/<function[\s\S]*$/i, '')
    .replace(/<tool_call[\s\S]*$/i, '')
    .trim();
}

class TextualToolFilter {
  constructor() {
    this.held = '';      // texto retenido (posible prefijo parcial del marker)
    this.toolText = '';  // todo lo posterior al primer marker completo
    this.inTool = false;
  }

  /**
   * Procesa un delta del stream. Devuelve el texto SEGURO para emitir
   * ahora mismo (puede ser '' si hay que retener).
   */
  push(delta) {
    if (this.inTool) {
      this.toolText += delta;
      return '';
    }
    this.held += delta;
    const idx = this.held.toLowerCase().indexOf(MARKER);
    if (idx !== -1) {
      const safe = this.held.slice(0, idx);
      this.toolText = this.held.slice(idx);
      this.held = '';
      this.inTool = true;
      return safe;
    }
    const keep = partialMarkerSuffix(this.held.toLowerCase());
    const safe = this.held.slice(0, this.held.length - keep);
    this.held = this.held.slice(this.held.length - keep);
    return safe;
  }

  /**
   * Cierra el stream: devuelve el texto retenido que resultó inocuo y
   * los tool calls parseados del texto interceptado.
   */
  finish() {
    const text = this.held;
    this.held = '';
    const toolCalls = [];
    if (this.toolText) {
      const re = /<function=([\w.\-]+)>\s*([\s\S]*?)\s*(?=<function=|$)/gi;
      let m;
      let i = 0;
      while ((m = re.exec(this.toolText)) !== null) {
        const args = m[2].replace(/<\/function>\s*$/i, '').trim();
        toolCalls.push({
          id: `textual_${Date.now()}_${i++}`,
          type: 'function',
          function: { name: m[1], arguments: args || '{}' },
        });
      }
      this.toolText = '';
    }
    return { text, toolCalls };
  }
}

module.exports = { TextualToolFilter, stripTextualToolCalls };
