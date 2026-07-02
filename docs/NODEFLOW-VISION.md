# NodeFlow Vision — documento vivo

> Solo oportunidades. Los bugs viven en los planes de ejecución.
> Proceso: al terminar cada funcionalidad, pasarla por las 9 preguntas
> (¿10x? ¿elimina otra herramienta? ¿automatiza sin pedirlo? ¿sorprende?
> ¿WOW? ¿hace recomendar? ¿retiene? ¿sube ARPU? ¿reduce trabajo humano?)
> y capturar aquí lo que emerja. Revisar en cada sesión de producto.

## La visión en una frase

**NodeFlow es el sistema operativo del negocio local**: el dueño trabaja con
las manos; NodeFlow atiende, agenda, cobra, recuerda, recupera y hace crecer.

**Arco de 3 años:**
- **Año 1 — No pierdas nada**: recepcionista que atiende cada llamada (hoy).
- **Año 2 — Se gestiona solo**: agenda que se defiende sola, cobros, recuperación, conocimiento que se auto-mejora.
- **Año 3 — Crece solo**: marketing autónomo por sector, benchmarks, red entre negocios, equipo completo de empleados IA.

**El foso** (por qué será incopiable): (1) el mejor dataset de conversación
comercial local en es/eu/gl, que mejora cada asistente cada semana; (2) el
número de teléfono + historial + conocimiento entrenado = coste de cambio
altísimo; (3) profundidad por sector que un player generalista no puede fingir.

---

## Oportunidades

### V1 · "Mi equipo" — los empleados IA como interfaz
- **Problema:** el portal habla de "features" (secciones, toggles); el dueño no piensa en features, piensa en personas que trabajan.
- **Oportunidad:** reencuadrar TODO el producto como un equipo: Sofía (recepción) con su tarjeta, su foto, su rol y sus resultados semanales — "Esta semana atendí 47 llamadas, reservé 12 citas y recuperé 3 clientes (210€)". Cada empleado nuevo = add-on.
- **Valor cliente:** entiende qué paga en 5 segundos; el precio se compara con un sueldo, no con un SaaS.
- **Complejidad:** media (es UI + copy sobre datos que ya tenemos).
- **Impacto:** retención + pricing power + identidad de marca única. Nadie del sector lo presenta así.
- **Prioridad:** alta (tras estabilidad).
- **Dependencias:** dashboard actual, métricas por asistente (existen).
- **Encaje:** ES la visión hecha interfaz — el puente natural al año 3 (más empleados).

### V2 · Recepcionista con la voz clonada del dueño
- **Problema:** desviar el teléfono a "una IA" da miedo; la voz genérica se siente ajena.
- **Oportunidad:** `custom-clone` ya está en el catálogo — convertirlo en tier premium con alta guiada (5 min leyendo un texto). "Tu negocio contesta con TU voz."
- **Valor:** WOW emocional máximo; el cliente lo enseña a todo el mundo (viralidad orgánica).
- **Complejidad:** baja-media (ElevenLabs cloning + flujo de consentimiento y grabación).
- **Impacto:** conversión de demo, premium +15-25€/mes, lock-in emocional.
- **Prioridad:** alta.
- **Dependencias:** motor de voz estable (v2 ✓), flujo legal de consentimiento de voz (contrato ya existe en docs/).
- **Encaje:** convierte la infraestructura de voz en identidad del negocio.

### V3 · Onboarding mágico: solo el nombre del negocio
- **Problema:** configurar asistente + servicios + horarios cuesta 20-30 min y frena la activación.
- **Oportunidad:** el alta pide UNA cosa: el nombre (o teléfono) del negocio. La IA lee su ficha de Google Business (horarios, servicios, reviews, fotos, dirección) y preconfigura todo; el dueño solo revisa y confirma. Primer "Llámame y pruébalo" en el minuto 2.
- **Valor:** de "otro software que configurar" a "esto ya me conoce".
- **Complejidad:** media (scraping/Places API + mapeo a assistant_config).
- **Impacto:** activación x2-3; la demo comercial se hace EN VIVO con el negocio del prospecto delante — cierre en la primera visita.
- **Prioridad:** alta (antes de escalar outreach).
- **Dependencias:** ninguna técnica seria.
- **Encaje:** "automatiza sin que lo pidan" desde el segundo cero.

### V4 · Ledger de valor: "NodeFlow te ha generado 3.410€"
- **Problema:** el valor se disuelve — el dueño ve llamadas, no dinero acumulado.
- **Oportunidad:** contador vitalicio (citas × ticket real + recuperados + no-shows evitados), en dashboard, en el informe semanal y en el email de renovación. Fórmula transparente, clicable, honesta.
- **Valor:** justifica los 49€ cada mes sin que nadie tenga que venderlos.
- **Complejidad:** baja (los datos ya existen; falta agregación + UI).
- **Impacto:** retención directa; munición para subir precios y para testimonios ("me generó X").
- **Prioridad:** alta, es barata.
- **Dependencias:** ticket medio real configurado (nudge ya desplegado).
- **Encaje:** la métrica única del año 1: dinero no perdido.

### V5 · Auto-QA: el asistente se llama a sí mismo
- **Problema:** si la voz degrada (proveedor caído, config rota), lo descubre un CLIENTE del negocio — lo peor posible.
- **Oportunidad:** llamada de prueba automática semanal por org: guion estándar, se mide latencia/dicción/booking OK, resultado como "salud de tu recepcionista" en el portal y alerta si falla.
- **Valor:** confianza estructural ("sé que funciona sin probarlo yo").
- **Complejidad:** media (outbound ya existe + evaluación del transcript con LLM).
- **Impacto:** churn evitado por incidentes silenciosos; argumento de venta enterprise (Osakin).
- **Prioridad:** media-alta.
- **Dependencias:** outbound validado, cola de campañas (comparte motor).
- **Encaje:** la fiabilidad como feature visible, no como promesa.

### V6 · Conocimiento que se enseña solo
- **Problema:** el bucle actual (preguntas sin respuesta → responder en 1 clic) aún exige que el dueño escriba la respuesta.
- **Oportunidad:** la IA PROPONE la respuesta (buscando en su web, en sus reviews, en negocios similares del sector) y el dueño solo pulsa "✓ Correcto" o edita. Y agregado anónimo por sector: lo que 50 peluquerías enseñaron beneficia a la 51 (opt-in).
- **Valor:** el asistente mejora semana a semana sin trabajo; efecto red real entre clientes.
- **Complejidad:** media (RAG ya existe; falta generación de propuestas + flujo de aprobación).
- **Impacto:** EL foso de datos. Cada semana de ventaja se compone.
- **Prioridad:** alta (año 2 empieza aquí).
- **Dependencias:** bucle v1 (✓), volumen de llamadas.
- **Encaje:** el producto que se auto-mejora — imposible de copiar sin la base instalada.

### V7 · Cobro de señal durante la llamada
- **Problema:** los no-shows cuestan más que la cuota de NodeFlow; el recordatorio ayuda pero no compromete.
- **Oportunidad:** en la reserva, el asistente ofrece pagar señal (o el total): "¿Quiere dejar pagada la señal de cinco euros? Le envío un enlace por WhatsApp ahora mismo" → Stripe Payment Link → confirmación en la misma llamada.
- **Valor:** no-shows ↓ drásticamente; caja anticipada.
- **Complejidad:** media (Stripe existe; falta link dinámico + confirmación por webhook al hilo de la llamada).
- **Impacto:** ARPU (comisión por cobro gestionado, p.ej. 1%) + retención (nadie renuncia a lo que le llena la caja).
- **Prioridad:** media-alta (tras campañas).
- **Dependencias:** WhatsApp por niveles (✓), Stripe (✓).
- **Encaje:** de agenda a CAJA — la primera pieza de "NodeFlow cobra por ti" (año 2).

### V8 · El lunes te llama tu negocio
- **Problema:** los informes por email no se leen; el dueño no entra al portal a diario.
- **Oportunidad:** el lunes a las 8:30, tu asistente TE llama: "Buenos días Unai. La semana pasada atendí 34 llamadas, reservé 11 citas, recuperé 2 clientes: unos 340 euros. Ojo: el jueves por la tarde perdiste 3 llamadas seguidas, revisa el desvío". 30 segundos. Opt-in.
- **Valor:** el canal ES el producto — la voz demostrándose a sí misma cada semana.
- **Complejidad:** baja-media (informe semanal existe + outbound existe; falta guionizarlo).
- **Impacto:** WOW recurrente, imposible de olvidar que pagas por algo que te llama; churn ↓.
- **Prioridad:** media (quick win tras campañas).
- **Dependencias:** outbound validado.
- **Encaje:** la voz como interfaz universal — también hacia el dueño.

### V9 · Agenda que se defiende sola (ocupación como métrica estrella)
- **Problema:** cancelación = hueco = dinero perdido; la lista de espera actual es pasiva.
- **Oportunidad:** al cancelarse una cita, el sistema llama/escribe SOLO a la lista de espera hasta rellenar el hueco, y reporta: "Hueco del martes 17:00 rellenado en 8 minutos". KPI visible: % de ocupación defendida.
- **Valor:** dinero directo sin mover un dedo.
- **Complejidad:** media (waitlist ✓ + cola de campañas).
- **Impacto:** el caso de éxito más contable que existe; sube el ticket del add-on Crecimiento.
- **Prioridad:** alta dentro de campañas v2.
- **Dependencias:** cola de campañas (plan 3).
- **Encaje:** primer "se gestiona solo" del año 2.

### V10 · Benchmarks de sector
- **Problema:** el dueño no sabe si su 38% de conversión llamada→cita es bueno.
- **Oportunidad:** con masa crítica: "Conviertes el 38%; la media de peluquerías en Gipuzkoa es 29%. Tu hora punta desatendida son los viernes 12-14h". Agregado anónimo.
- **Valor:** contexto que ningún contestador puede dar; consejo accionable.
- **Complejidad:** baja técnicamente, alta en masa de datos (>50 orgs/sector).
- **Impacto:** retención (irse = perder tu espejo) + contenido de marketing brutal.
- **Prioridad:** media (activar al llegar la masa).
- **Dependencias:** volumen.
- **Encaje:** el foso de datos hecho visible al cliente.

### V11 · "Háblanos ahora" — el widget de voz en su web
- **Problema:** la web del negocio convierte fatal; el widget actual pide "te llamamos" (fricción de formulario).
- **Oportunidad:** botón en su web que abre conversación de VOZ con su asistente en el navegador (browser-call ya existe en el engine para la demo) — sin teléfono, sin formulario, reserva en la web hablando.
- **Valor:** su web pasa de folleto a empleado; diferenciador total frente a contestadores.
- **Complejidad:** media (empaquetar browser-call multi-tenant en el widget).
- **Impacto:** más reservas atribuibles + razón de recomendación entre negocios.
- **Prioridad:** media.
- **Dependencias:** motor de voz estable (✓), widget actual.
- **Encaje:** mismo asistente, todos los canales — la promesa multi-canal.

### V12 · Red NodeFlow: derivaciones entre negocios
- **Problema:** "no tengo hueco esta semana" = cliente perdido para el negocio y para nadie más.
- **Oportunidad:** red opt-in por zona/sector: si no hay hueco, el asistente ofrece derivar a otro negocio NodeFlow cercano (recíproco, con atribución). "Te he conseguido cita en X, que también trabaja con nosotros."
- **Valor:** el cliente final siempre sale atendido; los negocios se alimentan entre sí.
- **Complejidad:** alta (reglas, reciprocidad, confianza).
- **Impacto:** network effect puro — cada negocio nuevo hace la red más valiosa. El candado definitivo.
- **Prioridad:** baja hoy, estratégica año 3.
- **Dependencias:** densidad geográfica.
- **Encaje:** de herramienta a INFRAESTRUCTURA del comercio local.

### V13 · Memoria multi-canal: una sola ficha por cliente
- **Problema:** llamada, WhatsApp y widget hoy son hilos separados; María es "3 Marías".
- **Oportunidad:** identidad unificada por teléfono: la conversación de WhatsApp sabe lo que se habló por teléfono ayer, y viceversa. El timeline del contacto lo muestra todo.
- **Valor:** elimina el CRM externo del todo; conversaciones que continúan en vez de empezar.
- **Complejidad:** media (contact_memory ya es la base; falta ingestar WA al mismo hilo).
- **Impacto:** retención estructural + precondición de campañas inteligentes.
- **Prioridad:** media-alta.
- **Dependencias:** WhatsApp propio activo.
- **Encaje:** un negocio = un cerebro, no un cajón de canales.

### V14 · Marketing autónomo estacional por sector
- **Problema:** el negocio local no hace marketing; no sabe ni cuándo.
- **Oportunidad:** playbooks por sector que se PROPONEN solos en el momento justo: "Quedan 3 semanas para Navidad: ¿lanzo la campaña de bonos regalo a tus 120 clientas? El año pasado las peluquerías de la red facturaron +18% con esto". Un clic.
- **Valor:** un empleado de marketing que sabe el calendario de SU sector.
- **Complejidad:** media-alta (contenido por sector + cola de campañas + resultados).
- **Impacto:** ARPU del add-on Crecimiento; el "sin que el usuario lo pida" hecho ingresos.
- **Prioridad:** media (año 2).
- **Dependencias:** cola de campañas, WhatsApp propio, ledger (para probar ROI).
- **Encaje:** el año 3 ("crece solo") empezando por lo repetible.

---

*Última revisión: 2026-07-03 · Añadir aquí, no en la cabeza.*
