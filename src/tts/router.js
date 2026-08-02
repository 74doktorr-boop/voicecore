// ============================================
// VoiceCore — Smart TTS Router
// Selects the best provider per request based on strategy, language and
// real-time metrics. Includes fallback chains and result caching.
//
// Language affinity
// -----------------
// Some providers are the *only* good option for a language even if they are
// slower than alternatives. A provider can declare `languageAffinity: ['eu']`
// to signal "I'm the preferred choice for these languages". When the router
// builds a chain and no explicit provider is requested, affinity providers
// jump to the front of the queue for those languages regardless of strategy.
//
// Example: local TTS is ~600 ms but is the only provider with a native Basque
// voice. With strategy:'latency', Google (200 ms) would otherwise win, giving
// the caller a generic synthesized voice instead of the real Basque one.
// ============================================

const { Logger } = require('../utils/logger');
const log = new Logger('TTS:ROUTER');

// ─────────────────────────────────────────────────────────────────────────────
// LIBRO DE CONSUMO DE VOZ
//
// Por qué existe: la columna `cost` de nf_calls llevaba desde el principio a
// 0,0000 en TODAS las llamadas, y no se guardaba qué proveedor había atendido
// ninguna. Es decir, el coste de voz —que es el 88% del coste variable de la
// empresa— no estaba medido en ningún sitio. Se manejaban DOS constantes
// distintas escritas a mano para lo mismo (0,07 en este fichero y 0,10 en el
// resto), y no había forma de contrastar ninguna con una factura porque no
// había nada contra lo que contrastar.
//
// SE GUARDAN CARACTERES, NO EUROS. El carácter es la unidad que factura el
// proveedor: es lo que aparece en la factura y lo que se puede cuadrar línea a
// línea. El euro es un derivado, y guardarlo congelaría el precio del día en
// que se escribió — el día que cambie la tarifa, el histórico entero pasaría a
// ser mentira. Con los caracteres guardados, el coste se recalcula cuando haga
// falta y las llamadas viejas siguen siendo verdad.
// ─────────────────────────────────────────────────────────────────────────────
const _consumo = new Map();     // callId → { proveedor: { caracteres, sintesis } }
const _nacimiento = new Map();  // callId → cuándo se abrió, para la purga

function anotarConsumo(callId, proveedor, caracteres) {
  if (!callId || !caracteres) return;
  let llamada = _consumo.get(callId);
  if (!llamada) { llamada = {}; _consumo.set(callId, llamada); _nacimiento.set(callId, Date.now()); }
  const p = llamada[proveedor] || (llamada[proveedor] = { caracteres: 0, sintesis: 0 });
  p.caracteres += caracteres;
  p.sintesis += 1;
}

/** Lo consumido por una llamada, sin borrarlo. */
function consumoDeLlamada(callId) {
  return _consumo.get(callId) || {};
}

/**
 * Devuelve el consumo y lo saca del mapa. Se llama al cerrar la llamada.
 *
 * El olvido importa: sin esto el mapa crece durante toda la vida del proceso y
 * acaba siendo una fuga de memoria lenta, de las que sólo se notan semanas
 * después y cuando ya no se sabe por qué. Por si alguna llamada no llega a
 * cerrarse bien (cuelgue abrupto, reinicio a medias), hay además una purga por
 * antigüedad más abajo.
 */
function cerrarConsumo(callId) {
  const c = _consumo.get(callId) || {};
  _consumo.delete(callId);
  _nacimiento.delete(callId);
  return c;
}

// Red de seguridad: nada vive aquí más de una hora. Una llamada de teléfono no
// dura eso ni de lejos, así que lo que quede es de una que no llegó a cerrarse
// (cuelgue abrupto, reinicio a medias). Sin esto el mapa crece durante toda la
// vida del proceso: una fuga lenta, de las que se notan semanas después y ya no
// se sabe por qué.
function purgarConsumo(ahora = Date.now()) {
  const limite = ahora - 3600000;
  let purgadas = 0;
  for (const [id, t] of _nacimiento) {
    if (t < limite) { _consumo.delete(id); _nacimiento.delete(id); purgadas++; }
  }
  return purgadas;
}
// .unref() para que este temporizador NO mantenga vivo el proceso: sin él, un
// script que sólo importe este módulo se queda colgado sin decir por qué.
setInterval(purgarConsumo, 600000).unref?.();

/**
 * Convierte el consumo en euros con la tarifa de cada proveedor.
 *
 * Se calcula al leer, nunca al guardar: así una subida de tarifa no reescribe
 * el pasado y el histórico sigue siendo comparable con las facturas viejas.
 */
function costeDeConsumo(consumo, tarifas) {
  let total = 0;
  const desglose = {};
  for (const [proveedor, d] of Object.entries(consumo || {})) {
    // ~14 caracteres por segundo de habla en castellano a ritmo normal. Es una
    // conversión, no una medida: por eso se guardan los caracteres y esto se
    // puede afinar después contra la duración real sin tocar los datos.
    const minutos = d.caracteres / 14 / 60;
    const eur = minutos * (tarifas?.[proveedor] ?? 0);
    desglose[proveedor] = { ...d, minutosEstimados: +minutos.toFixed(3), eur: +eur.toFixed(4) };
    total += eur;
  }
  return { total: +total.toFixed(4), desglose };
}

// ── LA VOZ DE RESERVA, y por qué merece una función propia ──────────────────
//
// Cuando la voz que eligió el cliente no se puede usar —su proveedor no está
// activo, o el id es de otro— hay que poner alguna. Hasta el 02/08 esa «alguna»
// era un UUID escrito a fuego en mitad del router que resultó ser
// **«Greg - Supporter», idioma `en`**. Un hombre inglés leyendo castellano al
// teléfono. Nadie lo eligió nunca: es un literal de la primera integración con
// Cartesia que sobrevivió a todos los cambios posteriores.
//
// Ahora sale del catálogo curado —las mismas voces que se ofrecen en el
// selector—, se elige por género, y si el catálogo fallara se cae a Blanca, que
// está verificada contra la API de Cartesia como `language: es`.
//
// La regla, que es la del charter: **una reserva es una decisión de producto,
// no un valor por defecto que nadie ha mirado.**
const _RESERVA_ULTIMA = '538a8872-3799-4df5-b373-b78493b766c6';  // Blanca, es, femenina

function _reservaCastellana(genero) {
  try {
    const { staticCatalog } = require('./voice-catalog');
    const castellanas = staticCatalog().filter(v =>
      v.provider === 'cartesia' && (v.tier === 'estandar' || !v.tier));
    if (!castellanas.length) return _RESERVA_ULTIMA;
    const mismoGenero = genero ? castellanas.filter(v => v.gender === genero) : [];
    const elegida = (mismoGenero[0] || castellanas[0]);
    // El catálogo guarda el id de NodeFlow y el del proveedor; a Cartesia hay
    // que darle el suyo.
    const { resolveVoiceEntry } = require('./voice-catalog');
    const e = resolveVoiceEntry(elegida.id);
    return (e && e.providerVoiceId) || _RESERVA_ULTIMA;
  } catch (_) {
    return _RESERVA_ULTIMA;
  }
}

class TTSRouter {
  constructor(config = {}) {
    this.providers = new Map();
    this.metrics = new Map();
    this.cache = new Map();
    // 24h/500: las frases fijas (saludo, recuperación, despedida, "¿Sí?
    // Dígame") se sintetizan UNA vez y el resto de llamadas las reutilizan
    // gratis — ahorro directo de créditos TTS en cada llamada (petición
    // Unai 2026-07-03; con 1h el saludo se re-pagaba cada hora).
    this.cacheMaxAge = 7 * 24 * 3_600_000; // 7 días — el límite real lo pone el deploy (caché en memoria)
    this.cacheMaxSize = 500;

    this._initProviders(config);
  }

  _initProviders(config) {
    // Cartesia Sonic — ultra-low latency via State Space Models
    if (config.cartesiaApiKey) {
      const { CartesiaTTS } = require('./cartesia');
      this.providers.set('cartesia', {
        instance: new CartesiaTTS(config.cartesiaApiKey),
        priority: 1,
        avgLatency: 80,
        costPerMinute: 0.015,
        features: ['streaming', 'cloning', 'emotions'],
        languages: ['es', 'en', 'fr', 'de', 'pt', 'it'],
        languageAffinity: [],
      });
      log.info('Provider registered: Cartesia Sonic');
    }

    // ElevenLabs — voz premium (Flash v2.5). Preferente para CASTELLANO cuando hay
    // key: es la mejor voz para cerrar clientes.
    // GALEGO: incluido en 'languages' — hay una voz ElevenLabs curada (brais-gl,
    // multilingual auto-detecta gl). EUSKERA se queda FUERA: ElevenLabs no soporta
    // vasco → lo sirven las voces nativas del modelo local (ane/mikel).
    if (config.elevenlabsApiKey) {
      const { ElevenLabsTTS } = require('./elevenlabs');
      this.providers.set('elevenlabs', {
        instance: new ElevenLabsTTS(config.elevenlabsApiKey),
        priority: 2,
        avgLatency: 150,
        costPerMinute: 0.07,
        features: ['streaming', 'cloning', 'multilingual', 'emotions'],
        languages: ['es', 'gl', 'en', 'fr', 'de', 'pt', 'it', 'ja', 'ko', 'zh'],
        languageAffinity: ['es'],  // preferente para castellano (gl usa provider explícito)
      });
      log.info('Provider registered: ElevenLabs');
    }

    // OpenAI TTS — reliable, good quality, widely supported
    if (config.openaiApiKey) {
      const { OpenAITTS } = require('./openai-tts');
      this.providers.set('openai', {
        instance: new OpenAITTS(config.openaiApiKey),
        priority: 3,
        avgLatency: 300,
        costPerMinute: 0.02,
        features: ['streaming'],
        languages: ['es', 'en', 'fr', 'de', 'pt', 'it', 'ja', 'ko', 'zh'],
        languageAffinity: [],
      });
      log.info('Provider registered: OpenAI TTS');
    }

    // Google Cloud TTS — studio quality, SSML support
    if (config.googleApiKey) {
      const { GoogleTTS } = require('./google-tts');
      this.providers.set('google', {
        instance: new GoogleTTS(config.googleApiKey),
        priority: 4,
        avgLatency: 200,
        costPerMinute: 0.016,
        features: ['ssml', 'studio-voices'],
        languages: ['es', 'en', 'fr', 'de', 'pt', 'it', 'ja', 'ko', 'zh', 'eu'],
        languageAffinity: [],
      });
      log.info('Provider registered: Google Cloud TTS');
    }

    // Local TTS — XTTS v2 on RTX 4090, native Basque voice, zero API cost.
    // Has language affinity for 'eu': even though latency is higher than Google,
    // it is the only provider with a real cloned Basque voice.
    if (config.localTtsUrl) {
      const { LocalTTS } = require('./local-tts');
      this.providers.set('local', {
        instance: new LocalTTS(config.localTtsUrl),
        priority: 0,
        avgLatency: 600,
        costPerMinute: 0,
        features: ['cloning', 'euskera'],
        languages: ['eu', 'es'],
        languageAffinity: ['eu'],  // Always preferred for Basque
      });
      log.info(`Provider registered: Local TTS (${config.localTtsUrl})`);
    }

    // Local TTS (Galician) — Proyecto Nós / F5-TTS cross-lingual on RTX 4090.
    // Has language affinity for 'gl': only provider with a native Galician voice.
    // URL configured separately via LOCAL_TTS_URL_GL env var so it can point to
    // a different model endpoint than the Basque one.
    if (config.localTtsUrlGl) {
      const { LocalTTS } = require('./local-tts');
      this.providers.set('local-gl', {
        instance: new LocalTTS(config.localTtsUrlGl),
        priority: 0,
        avgLatency: 600,
        costPerMinute: 0,
        features: ['cloning', 'galego'],
        languages: ['gl', 'es', 'pt'],
        languageAffinity: ['gl'],  // Always preferred for Galician
      });
      log.info(`Provider registered: Local TTS GL (${config.localTtsUrlGl})`);
    }

    log.info(`TTS Router initialized with ${this.providers.size} provider(s)`);
  }

  /**
   * Synthesize with smart provider selection.
   *
   * @param {object}  params
   * @param {string}  params.callId
   * @param {string}  params.text
   * @param {string}  [params.voice]     - Voice name / ID (provider-specific)
   * @param {number}  [params.speed]     - Playback speed (1.0 = normal)
   * @param {string}  [params.provider]  - Force a specific provider
   * @param {string}  [params.fallback]  - Explicit fallback provider
   * @param {string}  [params.strategy]  - 'latency' | 'quality' | 'cost' | 'specific'
   * @param {string}  [params.language]  - BCP-47 language code (default 'es')
   * @returns {Promise<Buffer>} mulaw 8 kHz audio
   */
  async synthesize({ callId, text, voice, speed, provider, fallback, strategy = 'latency', language = 'es' }) {
    if (!text?.trim()) return Buffer.alloc(0);

    // Cache check
    const cacheKey = this._cacheKey(text, voice, provider, language);
    const cached = this._getFromCache(cacheKey);
    if (cached) {
      log.metric(`[${callId}] TTS cache hit`);
      return cached;
    }

    const chain = this._buildProviderChain(provider, fallback, strategy, language);
    if (chain.length === 0) {
      log.error(`[${callId}] No TTS providers available for language '${language}'`);
      return Buffer.alloc(0);
    }

    for (const providerName of chain) {
      const info = this.providers.get(providerName);
      if (!info) continue;
      // Apartado por rechazo de plan/credenciales: se salta sin pedirle nada.
      // Es lo que ahorra los ~150 ms por frase; sin este salto, el corte de
      // abajo sólo serviría para escribir un log más bonito.
      if (info._apartadoHasta && Date.now() < info._apartadoHasta) continue;

      try {
        const t0 = Date.now();
        const params = this._buildParams(providerName, voice, speed, language);
        params.callId = callId;
        params.text = text;

        const audio = await info.instance.synthesize(params);
        const latency = Date.now() - t0;

        // Un buffer VACÍO no es éxito: síntesis fallida silenciosa (API que
        // responde 200 sin cuerpo, hipo transitorio). Tratarlo como error →
        // siguiente proveedor, y JAMÁS cachearlo: una frase FIJA (saludo,
        // recuperación, despedida) cacheada vacía = silencio permanente en
        // TODAS las llamadas hasta el próximo deploy (el que llama descuelga,
        // oye nada y cuelga). Bug latente 2026-07.
        if (!audio || audio.length === 0) {
          log.warn(`[${callId}] TTS '${providerName}' devolvió audio VACÍO — trying next`);
          this._updateMetrics(providerName, 0, true);
          continue;
        }

        this._updateMetrics(providerName, latency, false);
        // Se apunta lo que de verdad se ha sintetizado. Va AQUÍ, dentro del
        // bucle y después de comprobar que el audio no viene vacío, por dos
        // motivos que cambian la cifra:
        //   · un acierto de caché sale por arriba y no llega hasta aquí — y no
        //     cuesta nada, así que contarlo inflaría la factura;
        //   · un proveedor que falla tampoco cuenta: lo que se paga es lo que
        //     devolvió audio, no lo que se intentó.
        anotarConsumo(callId, providerName, text.length);
        this._addToCache(cacheKey, audio);

        log.metric(`[${callId}] TTS via ${providerName} in ${latency}ms`);
        return audio;

      } catch (err) {
        // Un 401/402/403 NO es un hipo: es una respuesta estable. El plan no
        // cambia entre una llamada y la siguiente.
        //
        // Medido el 2026-07-31: la clave de ElevenLabs está en plan gratuito y
        // devuelve 402 «Free users cannot use library voices via the API».
        // SIEMPRE. Cero caracteres consumidos en 90 días. Y como para el
        // castellano tiene afinidad de idioma, iba PRIMERA en la cadena: cada
        // síntesis de cada llamada gastaba ~150 ms en pedirle audio a un
        // proveedor que se sabía que iba a decir que no, y luego caía al
        // siguiente. En un producto de teléfono en tiempo real eso es tiempo
        // que el que llama pasa oyendo silencio, en cada frase.
        //
        // Se aparta el proveedor y se revisa dentro de media hora, por si
        // alguien contrata el plan: apartarlo para siempre obligaría a
        // reiniciar el proceso para que volviera.
        if (/\b(401|402|403)\b/.test(err.message)) {
          info._apartadoHasta = Date.now() + 30 * 60 * 1000;
          log.error(`[${callId}] TTS '${providerName}' rechaza por plan/credenciales (${err.message}). ` +
            'Apartado 30 min: seguir pidiéndole audio en cada frase sólo añade latencia.');
        } else {
          log.warn(`[${callId}] TTS '${providerName}' failed: ${err.message} — trying next`);
        }
        this._updateMetrics(providerName, 0, true);
      }
    }

    log.error(`[${callId}] All TTS providers failed`);
    return Buffer.alloc(0);
  }

  /**
   * Tarifa por minuto de cada proveedor REGISTRADO, tal cual está declarada
   * arriba. No se copia la cifra a ningún otro sitio a propósito: ya había dos
   * constantes distintas para ElevenLabs (0,07 aquí y 0,10 en el resto del
   * sistema) y nadie sabía cuál era la buena. Una sola fuente.
   */
  tarifasPorProveedor() {
    const t = {};
    for (const [nombre, info] of this.providers) t[nombre] = info.costPerMinute ?? 0;
    return t;
  }

  // ── Chain builder ─────────────────────────────────────────────────────────

  _buildProviderChain(preferred, fallback, strategy, language) {
    const chain = [];

    // 1. Explicit provider request is always first
    if (preferred && this.providers.has(preferred)) {
      chain.push(preferred);
    }

    // 2. Language-affinity providers jump to the front (if not already there)
    //    Only applies when no explicit provider is requested.
    if (!preferred) {
      for (const [name, info] of this.providers) {
        if (info.languageAffinity?.includes(language) && !chain.includes(name)) {
          chain.push(name);
        }
      }
    }

    // 3. Remaining compatible providers sorted by strategy
    const remaining = Array.from(this.providers.entries())
      .filter(([name]) => !chain.includes(name))
      // Un idioma COMBINADO ('es+gl', 'es+en') no está en la lista de ningún
      // proveedor, así que este filtro los descartaba todos y sólo quedaba el
      // fallback declarado. Medido: con 'es+gl' la cadena era «openai» a secas
      // — el cliente gallego perdía Cartesia, que es la voz por defecto y la
      // más barata (0,015 frente a 0,02 €/min), sin que nada fallara ni se
      // registrara. Se comprueba cada parte del combo por separado.
      .filter(([, info]) => String(language).split('+').some(l => info.languages.includes(l)))
      .sort(([nameA, a], [nameB, b]) => {
        switch (strategy) {
          case 'latency':
            // BUG-29 FIX: _realAvgLatency must receive the provider *name* (string key),
            // not the info object — this.metrics is keyed by name.
            return (this._realAvgLatency(nameA) ?? a.avgLatency) -
                   (this._realAvgLatency(nameB) ?? b.avgLatency);
          case 'cost':
            return a.costPerMinute - b.costPerMinute;
          case 'quality':
          default:
            return a.priority - b.priority;
        }
      });

    for (const [name] of remaining) chain.push(name);

    // 4. Explicit fallback appended if not already present
    if (fallback && !chain.includes(fallback) && this.providers.has(fallback)) {
      chain.push(fallback);
    }

    return chain;
  }

  _buildParams(providerName, voice, speed, language) {
    // (la reserva castellana vive fuera de la clase — ver _reservaCastellana)
    const params = { speed: speed ?? 1.0 };

    // Una voz de un proveedor NO vale en otro.
    //
    // El asistente pide la voz con el id del proveedor al que pertenece. Si ese
    // proveedor no atiende —no está registrado, o rechaza— el router pasa al
    // siguiente de la cadena… y hasta ahora le entregaba el MISMO id. Cartesia
    // recibiendo un id de ElevenLabs no sintetiza: falla. Y el siguiente
    // tampoco. La cadena entera se agota por un id que no era suyo, y lo que
    // oye el que llama es silencio.
    //
    // Caso real: la única org con voz premium (Freixa, 'ana-es' → ElevenLabs)
    // pide un proveedor que devuelve 402 desde siempre. Al caer a Cartesia le
    // llegaba el id de ElevenLabs. Se descubrió al ir a quitar la clave, y sin
    // esto quitarla habría dejado la cadena sin salida.
    //
    // Si la voz no es de este proveedor, se ignora y cada uno usa la suya por
    // defecto: mejor una voz distinta que ninguna. La preferencia del cliente
    // NO se toca en la base de datos — el día que se contrate el plan, su voz
    // vuelve sola.
    // Se guarda el GÉNERO de la voz que el cliente eligió antes de descartarla:
    // si hay que caer a una de reserva, al menos que sea del mismo género. Un
    // negocio que eligió voz femenina y de pronto contesta un hombre es un
    // cambio que se nota en la primera sílaba.
    let voiceGender = null;
    if (voice) {
      try {
        const { resolveVoiceEntry } = require('./voice-catalog');
        const entrada = resolveVoiceEntry(voice);
        if (entrada) voiceGender = entrada.gender || null;
        if (entrada && entrada.provider && entrada.provider !== providerName) voice = null;
      } catch (_) { /* sin catálogo se sigue como antes */ }
    }

    // El código de idioma se NORMALIZA a uno que el proveedor entienda.
    //
    // Medido contra la API de Cartesia: `language:'es'` sintetiza sin problema,
    // pero 'es+gl' y 'gl' devuelven «400 Invalid language». O sea que a un
    // cliente en es+gl, Cartesia le fallaba SIEMPRE por el código —no por la
    // voz— y la llamada acababa en el siguiente de la cadena, más caro. Meter
    // Cartesia en la cadena (arreglo anterior) no servía de nada si luego se le
    // manda un idioma que rechaza.
    //
    // Se elige la primera parte del combo que el proveedor declare soportar.
    // Para 'es+gl' eso es 'es': el texto lo escribe el LLM en galego y la voz
    // castellana lo lee bien —comprobado sintetizando «Bo día, grazas por
    // chamar»—. No es una voz gallega nativa, y la web no debe decir que lo sea.
    const idiomaProveedor = (() => {
      const soportados = this.providers.get(providerName)?.languages || [];
      const partes = String(language || 'es').split('+');
      return partes.find(l => soportados.includes(l)) || partes[0] || 'es';
    })();

    switch (providerName) {
      case 'cartesia':
        // La voz de reserva sale del CATÁLOGO, no de un literal.
        //
        // Aquí había escrito a fuego `a0e99841-438c-4a64-b679-ae501e7d6091`.
        // Preguntado a Cartesia el 02/08, resulta ser **«Greg - Supporter»,
        // idioma `en`**: un hombre inglés. Así que cualquier organización cuya
        // voz no se resolviera atendía el teléfono con una voz INGLESA leyendo
        // castellano. Suena a inglés con acento español y calidad pésima, que
        // es exactamente como sonó al llamar al número de producción.
        //
        // Y no era un caso raro: la única org con llamadas reales tiene guardada
        // `ana-es`, de ElevenLabs, cuya clave se retiró. La guarda que impide
        // pasarle un id ajeno a Cartesia hace lo correcto —deja la voz en
        // null— y justo por eso caía aquí, en la reserva inglesa.
        //
        // Nadie eligió nunca esa voz: es un literal de la primera integración
        // que sobrevivió a todo. Ahora la reserva es una voz castellana de las
        // que ofrecemos, y se elige por GÉNERO para que, cuando una voz
        // desaparezca, el cambio no cante más de lo imprescindible.
        params.voice = voice ?? _reservaCastellana(voiceGender);
        params.language = idiomaProveedor;
        break;
      case 'elevenlabs':
        // El voice puede venir como nombre de OpenAI (nova…) del selector;
        // lo traducimos a un voiceId real de ElevenLabs (default seguro).
        params.voiceId   = require('./voice-map').resolveElevenVoice(voice);
        params.language  = idiomaProveedor;  // lock language — prevents mid-speech switching
        break;
      case 'openai':
        params.voice = voice ?? 'nova';
        break;
      case 'google':
        params.voice = voice ?? 'studio-female-es';
        break;
      case 'local':
        params.voice = voice ?? 'ane';
        params.language = idiomaProveedor;
        break;
      case 'local-gl':
        params.voice = voice ?? 'default';  // Will be updated when GL voices are cloned
        params.language = idiomaProveedor;
        break;
      default:
        params.voice = voice;
    }

    return params;
  }

  // ── Metrics ───────────────────────────────────────────────────────────────

  _realAvgLatency(providerName) {
    const m = this.metrics.get(providerName);
    if (!m || m.callCount <= m.errorCount) return null;
    return Math.round(m.totalLatency / (m.callCount - m.errorCount));
  }

  _updateMetrics(providerName, latency, isError) {
    if (!this.metrics.has(providerName)) {
      this.metrics.set(providerName, { totalLatency: 0, callCount: 0, errorCount: 0 });
    }
    const m = this.metrics.get(providerName);
    m.callCount++;
    if (isError) {
      m.errorCount++;
    } else {
      m.totalLatency += latency;
    }
  }

  getMetrics() {
    const result = {};
    for (const [name, info] of this.providers) {
      const m = this.metrics.get(name) ?? { totalLatency: 0, callCount: 0, errorCount: 0 };
      const goodCalls = m.callCount - m.errorCount;
      result[name] = {
        avgLatency: goodCalls > 0 ? Math.round(m.totalLatency / goodCalls) : info.avgLatency,
        callCount: m.callCount,
        errorRate: m.callCount > 0 ? Math.round((m.errorCount / m.callCount) * 100) : 0,
        costPerMinute: info.costPerMinute,
        features: info.features,
        languageAffinity: info.languageAffinity ?? [],
      };
    }
    return result;
  }

  listAvailableVoices() {
    const voices = [];
    for (const [providerName, info] of this.providers) {
      voices.push({
        provider: providerName,
        languages: info.languages,
        languageAffinity: info.languageAffinity ?? [],
        features: info.features,
        costPerMinute: info.costPerMinute,
        avgLatency: info.avgLatency,
      });
    }
    return voices;
  }

  // ── Cache ─────────────────────────────────────────────────────────────────

  _cacheKey(text, voice, provider, language) {
    const crypto = require('crypto');
    return crypto
      .createHash('md5')
      .update(`${text}:${voice}:${provider}:${language}`)
      .digest('hex');
  }

  _getFromCache(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > this.cacheMaxAge) {
      this.cache.delete(key);
      return null;
    }
    return entry.audio;
  }

  _addToCache(key, audio) {
    if (this.cache.size >= this.cacheMaxSize) {
      // Evict oldest entry
      this.cache.delete(this.cache.keys().next().value);
    }
    this.cache.set(key, { audio, timestamp: Date.now() });
  }
}

module.exports = {
  TTSRouter,
  anotarConsumo, consumoDeLlamada, cerrarConsumo, purgarConsumo, costeDeConsumo,
};
