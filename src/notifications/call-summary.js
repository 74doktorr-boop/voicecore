'use strict';
// ============================================================
// NodeFlow — Qué contar en el resumen de una llamada.
//
// POR QUÉ EXISTE (2026-07-29):
// El email de resumen al dueño decía "ℹ️ CONSULTA", el número y la duración. Y
// ya. Para una llamada de información —que es la mayoría— eso no informa de
// NADA: el dueño sabe que sonó el teléfono, que es justo lo que ya sabía.
//
// Lo llamativo es que los datos estaban todos ahí: el post-call recibe el
// `transcript` completo y las `aiDecisions` (la caja negra que se construyó
// precisamente para enseñar qué hizo la IA). El email simplemente no los
// pintaba. Es el mismo patrón que el ROI: la información existe, se calcula, y
// se descarta antes de enseñarla.
//
// Todo aquí es PURO: sin BD, sin red, sin plantillas HTML. Devuelve datos; el
// que arma el email decide cómo pintarlos. Así se puede probar de verdad, que
// importa porque el texto lo dicta QUIEN LLAMA.
// ============================================================

// El transcript llega como [{ role:'user'|'assistant', content, timestamp }].
const _texto = (t) => String((t && (t.content ?? t.text)) || '').replace(/\s+/g, ' ').trim();

/**
 * Qué pedía el cliente: su primera intervención con contenido real.
 *
 * Se salta los "sí", "hola", "dígame" y el ruido que transcribe el STT — con
 * esos el dueño sigue sin saber de qué iba la llamada. Si ninguna llega al
 * mínimo, se devuelve la más larga: es preferible una frase corta a nada.
 *
 * @param {Array} transcript
 * @param {number} [minLen] longitud a partir de la cual se considera contenido
 * @returns {string} '' si el cliente no llegó a decir nada
 */
function firstAsk(transcript, minLen = 12) {
  const dichas = (Array.isArray(transcript) ? transcript : [])
    .filter(t => t && t.role === 'user')
    .map(_texto)
    .filter(Boolean);
  if (!dichas.length) return '';
  return dichas.find(t => t.length >= minLen) || dichas.reduce((a, b) => (b.length > a.length ? b : a), '');
}

/**
 * Las decisiones de la IA, listas para pintar. Ya vienen redactadas en lenguaje
 * de dueño desde el ToolExecutor ("Reservó cita: Ana, 2026-07-30 10:00").
 * @returns {Array<{ok: boolean, texto: string}>}
 */
function decisionLines(aiDecisions, max = 12) {
  return (Array.isArray(aiDecisions) ? aiDecisions : [])
    .filter(d => d && (d.summary || d.tool))
    .slice(0, max)
    .map(d => ({ ok: d.ok !== false, texto: String(d.summary || d.tool).replace(/\s+/g, ' ').trim() }));
}

/**
 * La conversación, recortada para que quepa en un email.
 *
 * Se conservan las ÚLTIMAS intervenciones cuando hay que recortar: el final de
 * una llamada (lo que se acordó, el teléfono que dejó, la pega que puso) es lo
 * que el dueño necesita. El principio suele ser el saludo.
 *
 * @returns {{lineas: Array<{quien:'cliente'|'asistente', texto:string}>, recortadas:number}}
 */
function conversationLines(transcript, maxLineas = 20, maxChars = 400) {
  const todas = (Array.isArray(transcript) ? transcript : [])
    .map(t => ({ quien: t && t.role === 'user' ? 'cliente' : 'asistente', texto: _texto(t) }))
    .filter(l => l.texto);
  const recortadas = Math.max(0, todas.length - maxLineas);
  const lineas = todas.slice(-maxLineas).map(l => ({
    quien: l.quien,
    texto: l.texto.length > maxChars ? l.texto.slice(0, maxChars) + '…' : l.texto,
  }));
  return { lineas, recortadas };
}

/**
 * Asunto del email: que se entienda SIN abrirlo.
 * "Llamada CONSULTA — +34666351319 (1:38)" no dice nada; la bandeja de entrada
 * es donde el dueño decide si esto merece su atención ahora o luego.
 */
function subjectLine({ outcome, callerNumber, durationFormatted, bookedAppointment, transcript }) {
  const tel = callerNumber || 'desconocido';
  if (outcome === 'booked' && bookedAppointment) {
    const a = bookedAppointment;
    return `📅 Cita nueva: ${a.patientName || tel} · ${a.service || 'servicio'} · ${a.date || ''} ${a.time || ''}`.trim();
  }
  const pedido = firstAsk(transcript);
  if (pedido) {
    const corto = pedido.length > 60 ? pedido.slice(0, 60).trim() + '…' : pedido;
    return `📞 ${tel}: "${corto}"`;
  }
  if (outcome === 'abandoned') return `📞 Llamada colgada sin hablar — ${tel} (${durationFormatted || '0:00'})`;
  return `📞 Llamada de ${tel} (${durationFormatted || '0:00'})`;
}

module.exports = { firstAsk, decisionLines, conversationLines, subjectLine };
