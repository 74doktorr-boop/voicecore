# NodeFlow Vision — documento vivo

> Solo oportunidades. Los bugs viven en los planes de ejecución.
>
> **Filtro de entrada (las 10 preguntas del cofundador):** antes de aceptar
> cualquier implementación — ¿la hace más difícil de copiar? ¿permite cobrar
> más? ¿retiene más años? ¿genera datos que solo tendremos nosotros? ¿se
> reutiliza en otros productos? ¿reduce soporte? ¿mejora la demo? ¿ventaja
> permanente? ¿efecto red? ¿sube el valor de TODA la plataforma?
> Si no mejora al menos una, se cuestiona.
>
> **Test de demo:** toda idea declara si se enseña en <30 segundos. Si no,
> cómo convertirla en enseñable. Vender SaaS = acumular WOWs comprensibles.
>
> **Regla de lenguaje:** cada entrada se escribe COMO LA VERÍA EL CLIENTE,
> no como la construye el ingeniero. "Parser de reservas" = 😐.
> "Entiende 'a la una y media' como una persona" = 🤯. Misma feature.
>
> **Reparto de esfuerzo acordado:** 40% producto visible · 30% capacidades
> reutilizables (Cores) · 30% fosos (datos, IA por sector, red).

## La visión en una frase

**NodeFlow es el sistema operativo del negocio local**: el dueño trabaja con
las manos; NodeFlow atiende, agenda, cobra, recuerda, recupera y hace crecer.

**Arco de 3 años:** Año 1 *no pierdas nada* → Año 2 *se gestiona solo* →
Año 3 *crece solo*.

---

# Los Cores — capacidades, no productos

La plataforma que hace que el SIGUIENTE SaaS vertical se construya en semanas.

**REGLA DE CEGUERA DE DOMINIO: ningún Core conoce el negocio.**
Voice Core no sabe qué es una peluquería — solo habla, escucha, detecta
silencios, interrumpe y sintetiza. Booking Core no sabe qué es un masaje —
solo recursos, duraciones, disponibilidad y conflictos. Campaign Core no sabe
qué vende el cliente — solo trabajos, reintentos, ventanas, colas y métricas.
El conocimiento del negocio vive en la capa de producto (prompts, configs,
sector-templates). Cuanto menos sabe un Core, más productos lo reutilizan.

## El quinto Core — el más importante

| Core | Qué es |
|---|---|
| **Intelligence Core** | **No IA: INTELIGENCIA.** La IA responde; la inteligencia APRENDE. Todo (llamadas, reservas, chats, campañas, valoraciones, agenda, estadísticas) desemboca en un único cerebro que **genera conocimiento nuevo, no almacena datos**. No dice "42 llamadas": dice *"las reservas del martes tarde se cancelan un 73% más"*, *"las llamadas perdidas de 13:00-14:30 te cuestan ~1.280€/mes"*, *"quien reserva mesa de dos un viernes vuelve un 47% más"*. Imposible de copiar rápido: requiere meses de datos. **Compounding 10/10.** Semillas hoy: transcript-analyzer, kpis, insights por reglas. v1 realista: job nocturno que cruza citas×cancelaciones×horas×llamadas perdidas×ticket y produce 1-3 hallazgos accionables por negocio y semana. |

**NodeFlow Platform Score** (panel interno, revisar mensualmente): cada Core
puntúa en madurez · cobertura de tests · nº de productos que lo usan · tiempo
desde el último bug crítico · reutilización · documentación · API estable ·
performance · escalabilidad · valor estratégico. El objetivo deja de ser
"hacer Osakin" y pasa a ser "hacer crecer NodeFlow".

Estado honesto de cada core hoy:

| Core | Qué es | Estado hoy | Para ser Core de verdad |
|---|---|---|---|
| **Voice Core** | Motor de llamadas en tiempo real: pacer, reloj de reproducción, barge-in, routers STT/TTS multi-proveedor con fallback, multi-idioma es/eu/gl | ⭐ El más maduro — v2 probado en PSTN real | Extraer interfaz limpia (hoy acoplado a "asistente de negocio"); doc de integración |
| **AI Core** | Router LLM multi-proveedor con fallback, generación de agentes desde config (org-assistant), análisis post-conversación (transcript-analyzer), intents (assistant-command) | Sólido pero disperso en 4 módulos | Unificar: "dame un agente con este prompt/tools/memoria" como API única |
| **Identity Core** | Magic links, sesiones JWT propias, contraseñas con ciclo completo, multi-tenancy por org | Completo tras esta semana | Extraer de routes-auth a módulo con tests propios |
| **Event Core** | webhookDispatcher con firma HMAC, eventos de dominio (call.*, appointment.*) | Existe y funciona | Catálogo de eventos formal; suscripciones internas (no solo webhooks salientes) |
| **Automation Core** | Scheduler de citas, reminder-engine multicanal (WA→SMS→email), crons, cola de campañas (fase 1) | Funcional, acoplado al dominio citas | El dispatcher de campañas (fase 2) nace ya como módulo genérico de "trabajos salientes" |
| **Notification Core** | Cascada WA propio/compartido → SMS → email, plantillas Meta aprobadas | Funciona con niveles | Plantillas por producto, no hardcoded |
| **Audit Core** | recordAudit con IP/target/details en admin | Mínimo viable | Extenderlo a acciones del portal |
| **Analytics Core** | KPIs, series, atribución, ledger de uso/coste por llamada | Datos ricos, presentación pobre | El "ledger de valor" (V4) lo convierte en producto |
| **Design Core** | nf-design-system.css: tokens+componentes probados en portal y admin | Reutilizable YA (ETS Guard podría usarlo) | Empaquetarlo versionado |

**Regla:** cada feature nueva se pregunta a qué Core alimenta. Si no alimenta
ninguno y tampoco es WOW/Lock-in/Moat → se cuestiona su existencia.

---

# WOW — las que venden ("hostia")

### W1 · Tu negocio contesta con TU voz (voz clonada)
- **Como lo ve el cliente:** «Llaman a mi peluquería… y contesto YO, sin estar.»
- **Problema:** desviar el teléfono a "una IA" da miedo; la voz genérica se siente ajena.
- **Oportunidad:** tier premium con alta guiada de 5 min (leer un texto). ElevenLabs cloning ya en catálogo (custom-clone).
- **Valor/Impacto:** el WOW que se enseña en el bar; +15-25€/mes; lock-in emocional.
- **Complejidad:** baja-media (flujo de grabación + consentimiento — contrato ya existe).
- **Demo <30s:** SÍ — grabas 20s, llamas, te contestas a ti mismo. La mejor demo posible.
- **Prioridad:** alta. **Dependencias:** Voice Core estable (✓). **Cores:** Voice.

### W2 · El lunes te llama tu negocio
- **Como lo ve el cliente:** «Mi negocio me llama los lunes y me cuenta la semana en 30 segundos.»
- **Oportunidad:** informe semanal POR VOZ vía saliente con propósito (infra fase 1 ✓): llamadas, citas, € y un aviso accionable.
- **Valor/Impacto:** WOW recurrente; imposible olvidar qué pagas; churn ↓.
- **Complejidad:** baja-media (guionizar el informe semanal existente).
- **Demo <30s:** SÍ — se lanza en vivo: "mira, me llama ahora".
- **Prioridad:** media-alta. **Cores:** Voice, Analytics.

### W3 · Onboarding mágico: dime tu negocio y ya te conozco
- **Como lo ve el cliente:** «Escribí el nombre de mi bar y ya sabía mis horarios, mi carta y mis reseñas.»
- **Oportunidad:** alta con solo nombre/teléfono → lee Google Business → preconfigura todo → "Llámame y pruébalo" en el minuto 2.
- **Valor/Impacto:** activación ×2-3; la demo comercial se hace EN VIVO con el negocio del prospecto → cierre en primera visita.
- **Complejidad:** media (Places API + mapeo a assistant_config).
- **Demo <30s:** SÍ — es literalmente la demo: nombre → asistente funcionando.
- **Prioridad:** alta (antes de escalar outreach). **Cores:** AI.

### W4 · "¿Lo de siempre, María?" — reserva en 20 segundos
- **Como lo ve el cliente:** «Mis clientas fijas ni dan sus datos: les propone su cita de siempre.»
- **Oportunidad:** memoria (✓) + caller ID (✓) + patrón de citas del historial → fast-path del habitual.
- **Valor/Impacto:** "es mejor que mi recepcionista" dicho por el cliente FINAL; llamadas más cortas (coste ↓).
- **Complejidad:** baja-media (falta: servicio+franja más frecuentes del historial del contacto).
- **Demo <30s:** SÍ — segunda llamada del mismo móvil en la demo: te saluda por tu nombre y te ofrece repetir.
- **Prioridad:** alta — culminación del CRM progresivo (✓ hoy). **Cores:** AI, Automation.

### W5 · "Háblanos ahora" — su web atiende por voz
- **Como lo ve el cliente:** «En mi web hay un botón y la gente HABLA con mi negocio, sin llamar.»
- **Oportunidad:** browser-call del engine (existe para la demo) empaquetado multi-tenant en el widget.
- **Valor/Impacto:** su web pasa de folleto a empleado; diferenciador total.
- **Complejidad:** media. **Demo <30s:** SÍ — clic en su web, hablas, reserva hecha.
- **Prioridad:** media. **Cores:** Voice.

---

# Lock-in — las que retienen

### L1 · Ledger de valor: "NodeFlow te ha generado 3.410€"
- **Como lo ve el cliente:** «Sé exactamente cuánto dinero me ha traído — cada mes que pago se justifica solo.»
- **Oportunidad:** contador vitalicio (citas × ticket real + recuperados + huecos rellenados) en dashboard + email + renovación. Fórmula transparente.
- **Complejidad:** baja (datos ✓; falta agregación + UI).
- **Demo <30s:** SÍ — un número gigante que crece. Se entiende en 3 segundos.
- **Prioridad:** ALTA e infravalorada: es la más barata de la lista. **Cores:** Analytics.

### L2 · Conocimiento que se enseña solo
- **Como lo ve el cliente:** «Cada semana mi asistente sabe más — yo solo apruebo con un clic.»
- **Oportunidad:** v1 (✓) detecta preguntas sin respuesta; v2: la IA PROPONE la respuesta (su web, sus reseñas, negocios similares) y el dueño solo pulsa ✓.
- **Complejidad:** media. **Demo <30s:** SÍ — "mira: ayer no supo esto, hoy alguien preguntó y respondió".
- **Prioridad:** alta. **Cores:** AI. **También es Moat** (ver M1).

### L3 · Una sola ficha por cliente (memoria multi-canal)
- **Como lo ve el cliente:** «Le da igual si María llama o escribe por WhatsApp — se acuerda de todo.»
- **Oportunidad:** identidad por teléfono: WA y llamada comparten hilo y timeline.
- **Complejidad:** media (contact_memory ✓; falta ingestar WA al mismo hilo).
- **Demo <30s:** SÍ — llamas, luego escribes por WA y te contesta con contexto de la llamada.
- **Prioridad:** media-alta. **Cores:** AI, Notification.

### L4 · Agenda que se defiende sola
- **Como lo ve el cliente:** «Se me canceló una cita y a los 8 minutos ya estaba rellenada con la lista de espera.»
- **Oportunidad:** cancelación → llamadas/WA automáticos a la waitlist hasta rellenar; KPI "ocupación defendida".
- **Complejidad:** media (waitlist ✓ + cola de campañas fase 2).
- **Demo <30s:** SÍ — cancelas en vivo y ves el feed: "llamando a la lista de espera…".
- **Prioridad:** alta dentro de campañas. **Cores:** Automation, Voice.

### L5 · Auto-QA: tu recepcionista se examina sola
- **Como lo ve el cliente:** «Cada semana veo que mi asistente funciona — sin tener que probarlo yo.»
- **Oportunidad:** llamada de prueba automática semanal + score de salud (latencia, dicción, reserva OK) + alerta si degrada.
- **Semilla construida (2026-07-03):** cada llamada real YA se puntúa sola (Conversation Success Score 0-100 en nf_calls: confianza, latencia, fricción) + salud de audio por llamada. Falta: agregación por negocio, tendencia («tu asistente lleva 3 días oyendo peor»), badge en portal y auditor IA post-llamada (diseñado sobre transcript-analyzer). El producto se AUTODIAGNOSTICA: el dueño no reporta bugs — NodeFlow se los cuenta ya arreglados.
- **Demo <30s:** SÍ — el badge "Salud: 98/100 · examinada hoy" se explica solo.
- **Prioridad:** media-alta (reduce soporte + churn silencioso). **Cores:** Voice, AI, Analytics.

---

# Scale — las que multiplican la velocidad (ver tabla de Cores arriba)

### S1 · Dispatcher de campañas como módulo genérico
- **Oportunidad:** la fase 2 de campañas se construye YA como "motor de trabajos salientes con ventana horaria, ritmo, reintentos y resultados" — no como feature de citas. Sirve para: recuperación, anti no-show, informes por voz (W2), Auto-QA (L5), encuestas, cobros futuros.
- **Demo <30s:** no directamente → se enseña a través de lo que ejecuta (L4, W2).
- **Prioridad:** ALTA — es la siguiente gran pieza y nace como Core.

### S2 · Design Core empaquetado
- **Oportunidad:** nf-design-system.css versionado y usado en el próximo producto (ETS Guard ya podría). Un solo lenguaje visual NodeFlow.
- **Demo <30s:** indirecto — "todos nuestros productos se sienten igual de premium".

### S3 · Catálogo formal de eventos (Event Core)
- **Oportunidad:** todo lo que pasa (llamada, reserva, cancelación, pago) como evento tipado con suscriptores internos — las automatizaciones del futuro se enchufan sin tocar el emisor.
- **Demo <30s:** no → se enseña como "cada cosa que pasa puede disparar lo que quieras" (Zapier interno).

---

# Moat — las que un competidor tarda años en copiar

### M1 · El dataset de conversación comercial local es/eu/gl
- **Por qué es foso:** cada llamada mejora prompts, respuestas por sector y detección de intents. Con 500 negocios: el mejor corpus del nicho en 3 idiomas. No se puede comprar.
- **Cómo se acumula:** ya está pasando (transcripts + analyzer + KB loops). Falta: agregación anónima por sector (opt-in) para que lo aprendido en 50 peluquerías sirva a la 51.
- **Demo <30s:** vía L2 ("mira lo que ya sabe sin que nadie se lo enseñara").
- **Prioridad:** el trabajo de fondo del año 2. **Cores:** AI.

### M2 · Benchmarks entre negocios
- **Como lo ve el cliente:** «Contesto el 92% de llamadas; la media de mi sector es el 61%.»
- **Por qué es foso:** requiere masa de datos que solo tiene quien llegó primero. Irse = perder tu espejo.
- **Complejidad:** baja técnica, alta en volumen (>50 orgs/sector).
- **Demo <30s:** SÍ — una frase comparativa. Oro para marketing.

### M3 · IA especializada por sector
- **Por qué es foso:** los playbooks (qué pregunta un cliente de fisio vs taller, calendario estacional, objeciones típicas) destilados de conversaciones REALES por sector. Un generalista no puede fingirlo.
- **Cómo:** sector-fields (✓) + templates (✓) + M1. **Prioridad:** continua.

### M4 · Red NodeFlow: derivaciones entre negocios
- **Como lo ve el cliente:** «No tenía hueco y mi asistente le consiguió cita en otra peluquería de la red — y ellos me mandan clientes a mí.»
- **Por qué es foso:** efecto red puro por densidad geográfica. El candado definitivo.
- **Complejidad:** alta (reciprocidad, confianza). **Demo <30s:** SÍ — la frase del cliente de arriba.
- **Prioridad:** año 3, pero cada negocio de Gipuzkoa que sumamos hoy la acerca.

### M5 · Marketing autónomo estacional
- **Como lo ve el cliente:** «Tres semanas antes de Navidad me propuso la campaña de bonos regalo — un clic y facturé +18%.»
- **Por qué es foso:** playbooks por sector probados con resultados reales de la red (M1+M2 alimentan esto).
- **Demo <30s:** SÍ — la tarjeta de propuesta con el botón "Lanzar".
- **Prioridad:** año 2 tardío. **Cores:** Automation, AI, Analytics.

---

# Compounding Score — la ordenación que importa

**Pregunta:** si lo implemento UNA vez, ¿su valor crece solo cada mes sin tocar
código? Priorizar por interés compuesto: dentro de dos años, lo que más ingresa
no será lo más llamativo hoy, sino lo que creció con el uso.

| Idea | Compounding | Por qué |
|---|---|---|
| Intelligence Core | **10** | Cada dato de cada cliente lo hace más listo para todos |
| M1 Dataset conversaciones es/eu/gl | **10** | Cada llamada lo mejora |
| M2 Benchmarks entre negocios | **10** | Cada cliente nuevo sube el valor para todos |
| M4 Red de derivaciones | **10** | Efecto red puro por densidad |
| L2 Conocimiento auto-enseñado | **9** | Cada pregunta sin respuesta enseña al sistema |
| L5 Auto-QA | **9** | Cada examen afina el motor |
| W4 "¿Lo de siempre?" | **9** | Cada reserva mejora la siguiente |
| M3 IA por sector | **9** | Cada conversación destila el playbook |
| M5 Marketing estacional | **8** | Cada campaña lanzada calibra la siguiente |
| L1 Ledger de valor | **8** | El número crece solo — y con él la retención |
| L3 Ficha única multi-canal | **8** | Cada interacción enriquece el perfil |
| S1 Dispatcher de campañas | **7** | Cada nuevo consumidor lo amortiza |
| S3 Event Core formal | **7** | Cada suscriptor nuevo multiplica |
| W2 El lunes te llama | **7** | Con Intelligence Core, el guion mejora solo |
| L4 Agenda que se defiende | **6** | Ejecuta igual; compone vía datos de waitlist |
| W1 Voz clonada | **6** | Espectacular hoy, igual dentro de un año |
| S2 Design Core | **6** | Amortiza por producto nuevo |
| W3 Onboarding mágico | **5** | Capacidad estática (enorme, pero no compone) |
| W5 Web que habla | **5** | Ídem |

**Lectura estratégica:** los WOW venden la entrada; los 9-10 construyen la
empresa. El 30% de esfuerzo de foso va SIEMPRE a la mitad alta de esta tabla.

---

# Oportunidad ETS Guard → NodeFlow Platform (capturada 2026-07-03)

**Origen:** al revisar ETS Guard como producto europeo, emergió que el activo
más valioso no es el vertical sino el motor: auth+RBAC+auditoría, tiempo real
(SSE+outbox offline), mapas vivos, PWA, capa de IA determinista explicable,
push, informes narrativos, motor normativo. Es el mismo patrón Intelligence
Core / Event Core de este documento, demostrado en un segundo dominio.

- **La jugada:** no extraer la plataforma todavía (trampa de plataforma:
  modularizar con n=1 congela la velocidad). Regla de tres: construir el
  SEGUNDO vertical (mantenimiento/inspecciones es el más cercano: mismas
  primitivas ronda-checklist-parte-SLA) copiando descaradamente de ETS Guard,
  y extraer solo lo que se repita idéntico. La plataforma emerge, no se diseña.
- **Compounding: 10.** Cada vertical nuevo amortiza el motor y cada mejora del
  motor sube a todos los verticales — es el interés compuesto estructural de
  NodeFlow (VoiceCore=voz, ETS Guard=operaciones de campo, mismo tronco).
- **Prioridad:** decisión de fundador para año 1-2; el gatillo es el primer
  cliente firme de un segundo vertical, no antes.

# Oportunidades del Replay del gemelo + Modo crisis (capturadas 2026-07-03)

**Origen:** al construir el replay de jornada y el modo crisis (#61) de ETS
Guard emergieron tres activos que trascienden el vertical.

- **La sombra de decisión como categoría vendible.** Cada decisión de crisis
  guarda, capturada por el servidor, la foto operativa de lo que se sabía en
  ese momento. En lenguaje de cliente: «cuando le reclamen dentro de un año,
  usted podrá demostrar por qué decidió lo que decidió». Es defensa legal +
  ISO 27001/22301 (gestión de continuidad) empaquetada. Ningún competidor de
  seguridad privada lo tiene; aplica idéntico a mantenimiento, sanidad y
  cualquier vertical con responsabilidad civil. Compounding: 9.
- **El replay como demo comercial universal.** Reproducir una jornada real
  sobre el mapa en 2 minutos es el mejor vídeo de ventas posible y lo genera
  el propio producto con datos del cliente. Para el kit comercial: grabar el
  replay de un día real (con permiso) vale más que cualquier mockup. Además
  es la semilla del «gemelo digital» prometido en el pitch: mismos datos,
  ahora con tiempo. Compounding: 7.
- **El patrón «la UI cambia de forma».** Declarar un estado global (crisis)
  que reconfigura toda la plataforma vía SSE es un primitivo reutilizable:
  modo simulacro (DRILL, #63 del roadmap), modo apagón, modo evento masivo
  (partidos/conciertos — aforo + refuerzos). Una vez existe el mecanismo,
  cada «modo» nuevo es barato y se vende como módulo. Compounding: 8.

- **(2026-07-03, ETS Guard) El cuadrante que se hace solo.** Un motor
  determinista propone la semana entera en un clic: cobertura, descansos
  legales, equidad de horas, continuidad de estación — y declara cada hueco
  con su motivo («la plantilla da para 85 jornadas y pides 140»). Es EL dolor
  de cabeza semanal de cualquier empresa de seguridad/limpieza/logística, y
  la misma pieza sirve para VoiceCore-verticales con turnos (clínicas).
  Demo de 30s perfecta: «genera» → semana pintada → «aplicar». Compounding: 9.

- **(2026-07-03, ETS Guard) Multi-réplica por una variable de entorno.** La
  capa Redis con fallback a memoria convierte «escala» en un argumento de
  venta enterprise sin coste operativo hasta que hace falta. El mismo patrón
  (adapter + degradación honesta) es plantilla para VoiceCore. Compounding: 7.

# Oportunidades del editor único de servicios + landing (capturadas 2026-07-04)

- **(#8) Plantillas de servicios por sector = asistente experto al minuto.**
  La tabla única alimenta prompt, precios exactos y huecos de agenda a la
  vez; una plantilla pre-rellenada por vertical («peluquería: corte 30 min,
  tinte 90…») en el onboarding convierte el alta en un asistente que ya sabe
  vender antes de la primera edición. Es la pieza W3 (self-service) más
  barata que existe: son datos, no código. Compounding: 9.
- **(#8) El ledger de valor puede hablar en servicios reales.** Con precio y
  duración estructurados por cita, «NodeFlow te ha generado X€» puede
  desglosarse en «4 tintes (180€) + 9 cortes (135€)» en vez de multiplicar
  por ticket medio. Mismo dato, el doble de credibilidad — y enseña qué
  servicio trae el dinero (insight que ningún fijo de recepción da).
  Compounding: 8.
- **(#8) «Plazas» ya tiene casa.** El diseño de capacidad de Fase 2 (seats
  por servicio) aterriza en una columna más de la misma tabla — la UI y el
  flujo de datos ya existen. Vender clases/grupos (yoga, academias,
  gimnasios) deja de ser un rediseño y pasa a ser una columna. Compounding: 7.
- **(#6) IndexNow como reflejo post-publicación.** El script de envío puede
  colgarse del CI tras cada deploy que toque public/: cada página de sector
  nueva queda notificada a Bing sola. SEO que se acumula sin que nadie se
  acuerde de él. Compounding: 6.

- **(2026-07-04, copiloto) «Dímelo con tus palabras» como patrón de toda la
  plataforma.** El circuito lenguaje natural → propuesta estructurada →
  validador determinista → confirmación del dueño (v1: servicios y horarios)
  es EL desbloqueador del onboarding self-service (W3): un negocio entero se
  configura dictando tres frases. El mismo patrón sirve para automatizaciones
  («recuérdales la cita dos días antes»), campañas y cualquier formulario
  futuro. En demo de 30s es magia visible: hablas, aparece configurado, y la
  IA de la llamada lo dice bien. Compounding: 9.

---

*Última revisión: 2026-07-04 · Ritual: cada feature terminada pasa por las 10
preguntas + test de demo 30s + Compounding Score, y lo que emerja se escribe
AQUÍ en lenguaje de cliente. Añadir aquí, no en la cabeza.*
