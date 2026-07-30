'use strict';
// ============================================================
// NodeFlow — Qué pasó de verdad en una llamada "rota".
//
// POR QUÉ EXISTE (2026-07-29):
// La auditoría nocturna avisaba de "10 llamadas rotas de 54" (18%). Al mirarlas
// una a una:
//
//   · 8 de las 10 eran PRUEBAS de Unai — de madrugada, con asistentes de broma
//     ("templo porno de unai", "peluqueria de unai"), desde su propio móvil y
//     desde el número de NodeFlow.
//   · Las otras 2 eran personas reales que oyeron el saludo y colgaron a los
//     5-8 segundos.
//
// O sea: CERO fallos del sistema, y una alarma que iba a sonar todas las
// mañanas. Una alarma que cría lobo se acaba ignorando, y entonces no avisa el
// día que importa.
//
// El fallo de fondo es que `_isBroken` mete en el mismo saco dos cosas que
// piden acciones opuestas:
//
//   FALLO DEL SISTEMA  → arréglalo tú. La IA no habló, o la llamada murió a
//                        media conversación. Es culpa nuestra.
//   COLGÓ EN EL SALUDO → el sistema funcionó perfectamente. Es una señal de
//                        PRODUCTO: la gente cuelga al oír a la IA. Se arregla
//                        con el saludo y la voz, no con código.
//
// Juntarlas hace dos daños a la vez: la alarma técnica salta sin motivo, y la
// señal de producto —cuánta gente te cuelga— queda enterrada y nadie la mira.
//
// Todo PURO: entra una fila de nf_calls, sale una clasificación.
// ============================================================

const SALUDO_MAX_MS = 15000;   // colgar en los primeros 15s es "colgó al saludo"

const _norm = (t) => String(t || '').replace(/[^\d]/g, '');

/**
 * ¿Esta llamada es tráfico NUESTRO (pruebas, demos, salientes desde el pool)?
 *
 * No se puede juzgar la salud del producto con las llamadas que hacemos
 * nosotros para probarlo. Y son la mayoría del histórico.
 *
 * @param {object} llamada  fila de nf_calls
 * @param {{propios?: string[], prueba?: string[]}} nums
 *   propios — nuestros números (nf_phone_pool): si LLAMA uno de ellos, es saliente nuestra
 *   prueba  — móviles conocidos de pruebas (env TEST_PHONE_NUMBERS, OWNER_PHONE)
 */
function esTraficoInterno(llamada, nums = {}) {
  const propios = (nums.propios || []).map(_norm).filter(Boolean);
  const prueba  = (nums.prueba  || []).map(_norm).filter(Boolean);
  const de = _norm(llamada && llamada.caller_number);
  if (!de) return false;
  if (propios.includes(de)) return true;              // saliente desde nuestro pool
  if (prueba.includes(de)) return true;               // móvil de pruebas conocido
  return false;
}

/**
 * ¿Esta ORGANIZACIÓN es nuestra, y no un cliente?
 *
 * POR QUÉ (2026-07-30): al buscar por qué un número asignado no recibía
 * llamadas, salió "Centro Osakin: 15 días con número y ni una entrante". Parecía
 * un cliente con el desvío roto. Su owner_email era
 * `74doktorr+metarevisor@gmail.com` y su config decía "Meta app review demo":
 * era la cuenta que montamos NOSOTROS para que Meta revisara la app. Igual que
 * `unai+googlereview@nodeflow.es` para la revisión de Google.
 *
 * Sin esto, la auditoría avisa cada noche de un cliente que no existe. Es
 * exactamente el mismo fallo que `esTraficoInterno` arregla en las llamadas:
 * juzgar el negocio con datos que hemos generado nosotros.
 *
 * Compara ignorando el `+etiqueta`, que es justo el truco que usamos para crear
 * estas cuentas.
 *
 * @param {string} email  owner_email de la organización
 * @param {string[]} internos  direcciones nuestras (env INTERNAL_EMAILS)
 */
function esCuentaInterna(email, internos = []) {
  const base = (e) => {
    const s = String(e || '').trim().toLowerCase();
    const at = s.lastIndexOf('@');
    if (at < 1) return '';
    const local = s.slice(0, at).split('+')[0];
    return local ? `${local}@${s.slice(at + 1)}` : '';
  };
  const mio = base(email);
  if (!mio) return false;
  return internos.map(base).filter(Boolean).includes(mio);
}

/**
 * Clasifica una llamada. PURA.
 * @returns {{tipo:'conversacion'|'colgo_en_saludo'|'fallo_sistema'|'sin_audio', motivo:string}}
 */
function clasificarLlamada(llamada = {}) {
  const turnos = Number(llamada.turn_count) || 0;
  const ms = Number(llamada.duration_ms) || 0;
  const t = Array.isArray(llamada.transcript) ? llamada.transcript : [];
  const hablóLaIA = t.some(x => x && x.role === 'assistant');

  if (llamada.status === 'lost' && turnos > 0) {
    return { tipo: 'fallo_sistema', motivo: 'la llamada murió a media conversación' };
  }
  if (turnos > 0) return { tipo: 'conversacion', motivo: '' };

  // Cero turnos a partir de aquí.
  if (!hablóLaIA) {
    return { tipo: 'sin_audio', motivo: 'la IA no llegó a decir nada — audio o TTS caídos, o colgaron antes del saludo' };
  }
  if (ms > 0 && ms <= SALUDO_MAX_MS) {
    // El sistema hizo su trabajo: descolgó y habló. El cliente decidió colgar.
    return { tipo: 'colgo_en_saludo', motivo: 'oyó el saludo y colgó' };
  }
  // Habló la IA, la línea duró, y nadie se entendió: eso SÍ huele a avería
  // (STT caído, audio mudo en un sentido).
  return { tipo: 'fallo_sistema', motivo: 'hubo línea abierta y ni un turno: audio o transcripción caídos' };
}

/**
 * Resumen de salud sobre un conjunto de llamadas, separando lo que es culpa
 * nuestra de lo que no, y excluyendo nuestro propio tráfico. PURA.
 */
function resumirSalud(llamadas, nums = {}) {
  const total = (llamadas || []).length;
  const externas = (llamadas || []).filter(c => !esTraficoInterno(c, nums));
  const cuenta = { conversacion: 0, colgo_en_saludo: 0, fallo_sistema: 0, sin_audio: 0 };
  const fallos = [];
  for (const c of externas) {
    const r = clasificarLlamada(c);
    cuenta[r.tipo]++;
    if (r.tipo === 'fallo_sistema' || r.tipo === 'sin_audio') fallos.push({ id: c.id, motivo: r.motivo });
  }
  const nFallos = cuenta.fallo_sistema + cuenta.sin_audio;
  return {
    total,
    internas: total - externas.length,
    externas: externas.length,
    ...cuenta,
    fallos,
    // Estas dos son las que hay que mirar, y son cosas DISTINTAS:
    tasaFallo: externas.length ? nFallos / externas.length : 0,
    tasaCuelgueSaludo: externas.length ? cuenta.colgo_en_saludo / externas.length : 0,
  };
}

module.exports = { esTraficoInterno, esCuentaInterna, clasificarLlamada, resumirSalud, SALUDO_MAX_MS };
