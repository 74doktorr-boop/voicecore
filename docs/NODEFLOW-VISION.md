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
- **Complejidad:** media (outbound ✓ + evaluación LLM del transcript).
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

*Última revisión: 2026-07-03 · Ritual: cada feature terminada pasa por las 10
preguntas + test de demo 30s, y lo que emerja se escribe AQUÍ en lenguaje de
cliente. Añadir aquí, no en la cabeza.*
