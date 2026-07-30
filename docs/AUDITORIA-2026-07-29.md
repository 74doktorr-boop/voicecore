# Auditoría integral NodeFlow — 2026-07-29

> **Estado de ejecución.** Los bloqueadores de las fases 0 y 1 están corregidos
> en la rama `fix/fase0-seguridad-voz` (13 commits, suite 2865 verde). El detalle
> de qué se arregló y qué queda está al final, en **§7 Ejecución**.


**Commit auditado:** `5de51e8` · **Método:** 8 auditorías independientes sobre el código + verificación del esquema real contra Supabase producción (solo lectura).

**Regla de este documento:** todo hallazgo lleva `fichero:línea`. Lo que no se ha podido verificar se marca como no verificado. No se afirma que algo funciona porque exista código que lo sugiera.

---

## 0. Estado real medido (no estimado)

Verificado contra Supabase el 2026-07-29 (`scratchpad/schema-check.js`, solo lectura):

| Dato | Valor real |
|---|---|
| Organizaciones activas | **4** |
| Llamadas últimos 30 días | **53** (51 `ended`, 2 `lost` = 3,8% perdidas) |
| Pool de números | 2 asignados, 2 disponibles, 3 retirados |
| `nf_calls.ai_decisions` | ✅ EXISTE |
| `nf_appointments.location` | ✅ EXISTE |
| `nf_appointments.outlook_event_id` | ✅ EXISTE |
| `contact_memory.no_calls` | ✅ EXISTE |
| `nf_campaign_calls` | ✅ EXISTE |
| **`nf_appointments.staff`** | ❌ **NO EXISTE** → citas fantasma por profesional |
| `nf_stays` | ❌ no existe (inocuo: hay NO-OP) |

> **`db/pending-migrations.md` está obsoleto y es peligroso.** Declara pendientes 5 migraciones que están aplicadas. Dos auditorías independientes concluyeron a partir de él que producción estaba perdiendo todas las llamadas y todas las citas. **Era falso.** Un documento de estado que induce a error es peor que no tenerlo: hay que regenerarlo desde la BD, no a mano.

**Consecuencia estratégica:** no hay incendio de pérdida de datos. Hay una ventana — 4 clientes, 53 llamadas/mes — para arreglar cimientos **antes** de los 20 fundadores. Los bloqueadores de abajo son de fiabilidad y de riesgo legal, no de supervivencia inmediata.

---

## 1. Mapa de arquitectura real

### 1.1 Servicios y flujo de una llamada entrante

```
Telnyx (número 843, TeXML App)
   │ POST /voice/telnyx            ← firma NO verificada (falta TELNYX_PUBLIC_KEY, fail-OPEN)
   ▼
routes.js:230 → TeXML <Connect><Stream> con stream-token HMAC (TTL 120s)
   │ WS /telnyx-stream             ← server.js:479 verifica el token (bien)
   ▼
telnyx-handler.js:23   callId = uuid()   ← NO se ata al call_sid de Telnyx (irreconciliable)
   │ media.payload (base64, A-law 8k mono)   ← msg.media.track NUNCA se inspecciona
   ▼
voice-pipeline.js:349  sttRouter.sendAudio → Deepgram (streaming, endpointing 300ms)
   │ speech_final / UtteranceEnd
   ▼
voice-pipeline.js:540  escalera de confianza (solo el nivel <0.55 es candado real)
   ▼
llm/router.js:111      groq(llama-3.3-70b) → openai(gpt-4o-mini) → anthropic     SIN TIMEOUT
   │ tool_calls
   ▼
tools/executor.js:331  check_availability / book_appointment / register_lead / flag_urgent …
   │                   ← candados deterministas: availabilityChecked + confirmed_with_customer
   ▼
tts/router.js:181      synthesize() COMPLETO (NO streaming) → ElevenLabs / Cartesia / OpenAI
   ▼
call-session.js:207    pacer por reloj (PACE_LEAD_MS=900) → frames μ-law a Telnyx
   ▼
endCall() → call-store.js:56  UPSERT único de TODO (transcript, outcome, métricas, coste)
   ▼
post-call-handler.js   WhatsApp cliente + email dueño + minutos facturables + auditor IA
```

### 1.2 Propietario de cada dato

| Dato | Fuente de verdad | Riesgo |
|---|---|---|
| Llamada en curso | **RAM** (`voice-pipeline.js:98`) hasta colgar | Deploy a media llamada = transcript perdido, minuto no facturado, **cita reservada sin que nadie avise al cliente** |
| Agenda (citas) | **RAM** (`scheduler.js:13`), BD como red asíncrona | Ver §3 bloqueador B4 |
| Config de negocio | BD (`organizations`, `assistant_config`, `automation_config`) | Rehidratada al arrancar |
| Minutos / facturación | **BD** (`organizations.monthly_minutes_used`) con mutex por org | Bien |
| Mensajes WhatsApp | BD (`nf_wa_messages`) | Bien, salvo la confirmación de reserva del scheduler que no se registra |
| Rate limits / sesiones admin | **RAM** (no hay `REDIS_URL`) | Se pierden en cada deploy |

### 1.3 Puntos únicos de fallo

1. **Deepgram** — si el WebSocket muere a mitad de llamada, `router.js:170` descarta el audio en silencio, sin log ni métrica, y no hay reconexión. La IA se queda sorda el resto de la llamada.
2. **`scheduler.appointments` en memoria** — se hidrata una vez al arrancar y nunca se re-sincroniza. Con 2+ réplicas, cada una es ciega a las citas de la otra.
3. **Sin `REDIS_URL`, `isLeader()` devuelve `true` en toda réplica** (`leader.js:75`) → con 2 réplicas, todos los crons se ejecutan por duplicado (recordatorios y campañas duplicados al cliente final).
4. **Un solo canal de alerta**: email a `NOTIFY_EMAIL`. Si Resend cae, la alerta se pierde en silencio.
5. **El servicio se monitoriza a sí mismo** (`health-check.js:105`, reconocido en el propio código). No hay watchdog externo.

### 1.4 Lo que está bien construido (para no romperlo)

- Candados deterministas de reserva (`executor.js:427-441`) y parsers de fecha/hora fuera del LLM.
- Zonas horarias hacia Google Calendar: correctas y comentadas (`google-calendar.js:66,132`).
- `appointments-store.js:116` — `loadAll` **lanza** en error en vez de devolver `[]`. Distinguir "no hay citas" de "no pude leer" es lo que evita el doble-booking silencioso.
- `dispatcher.js:92` — fail-CLOSED cuando no puede verificar el gasto.
- JWT propio bien hecho: ignora el `alg` del token, `timingSafeEqual`, lista negra de secretos débiles.
- Magic links: 256 bits, un solo uso por CAS atómico, respuesta neutra anti-enumeración.
- `/health` honesto con ping real a BD y SHA del commit desplegado.
- Anti-SSRF en feeds iCal, anti-inyección de fórmulas en exports CSV.

---

## 2. Auditoría de promesas — resumen

Detalle completo en la auditoría de promesas. Clasificación de las 40+ afirmaciones públicas revisadas:

| Estado | Nº | Ejemplos |
|---|---|---|
| **RIESGO LEGAL** | 8 | 27 testimonios inventados · "datos en Europa" · "verificado por Meta" · estadísticas de no-shows sin fuente · "sin registro" en el formulario Llámame · onboarding sin aviso legal · derecho de supresión inexistente |
| **ENGAÑOSA** | 9 | "24/7 / 0 llamadas sin atender" · euskera "nativo" · "sin cortes de servicio" · "todo incluido sin módulos" · ticker "en vivo" con `Math.random()` |
| **PARCIAL / FRÁGIL** | 12 | Google Calendar (no consulta en multi-sede) · lista de espera (flag OFF) · reseñas (mismatch de plantilla) · ROI (ticket 35€ inventado) |
| **INEXISTENTE** | 5 | SMS · Instagram/Gmail/Sheets · Outlook (sin credenciales) · plan "Básico 300 min" |
| **VERIFICADA** | 6 | Recordatorios WhatsApp con botones · cancelación propagada al calendario · 500 min/mes · exportación de datos |

**Los tres que hay que quitar hoy, sin discusión:**

1. **27 testimonios nominales inventados** (`public/abogados/index.html:554` + 26 páginas más). Con 4 clientes reales y "quedan 20 de 20 plazas" en la propia landing. RDL 1/2007 art. 20 bis + Ley 3/1991 art. 5. Denunciable por cualquier competidor.
2. **"tus datos se quedan en Europa"** (`public/recepcion/index.html:474`) — **desmentido por su propia política de privacidad** (`public/privacidad/index.html:283`). La voz del paciente sale del EEE en tiempo real a Deepgram y Groq.
3. **"Proveedor de tecnología verificado por Meta"** (6 páginas) — `docs/RUNBOOK.md:32` lo tiene como tarea **sin iniciar**. Meta puede retirar el acceso a la API por uso indebido de su marca.

**Contradicciones internas entre páginas vivas del mismo dominio:** "IVA incluido" vs "sin IVA" · "24/7 garantizado" vs "no garantizamos disponibilidad" · "operativo en minutos" vs "activa en 48 horas" · "0,3s" vs "<700ms" vs "<2s" · "todo incluido" vs 3 add-ons de pago 110 líneas más abajo.

**Subencargados que reciben datos personales y NO están nombrados en la política:** Deepgram (voz cruda), Groq (conversación íntegra), OpenAI, Anthropic, ElevenLabs, Cartesia, Google Calendar (nombre+teléfono+motivo de cita), Resend, y **CallMeBot** — un servicio gratuito de un particular al que se le envía **teléfono y nombre en la query string**, sin DPA posible (`src/notifications/whatsapp.js:32`). Ese último no debería estar en producción con datos personales.

---

## 3. Bloqueadores priorizados

Orden = riesgo × probabilidad × coste de arreglarlo. **P0 antes de vender a los 20 fundadores.**

### P0 — Seguridad (explotables hoy, arreglo pequeño)

| ID | Qué | Evidencia | Escenario |
|---|---|---|---|
| **S1** | **Secuestro de calendario cross-tenant.** El `state` del OAuth se usa como `orgId` sin validar contra la sesión | `google-calendar.js:29`, `routes-calendar.js:41,54`; idéntico en `routes-outlook.js:41,51` | El atacante cambia `state=<uuid-víctima>` en la URL de autorización, autoriza con SU cuenta de Google, y **todas las citas de la víctima empiezan a sincronizarse a su calendario**. El UUID de org es público (aparece en micrositios y enlaces de baja) |
| **S2** | **`/api/analytics/*` devuelve datos de TODA la flota** a cualquier tenant autenticado | `routes-extended.js:20-52`, `analytics/engine.js:102` — ninguna función acepta `orgId` | Un cliente hace `GET /api/analytics/assistants` y recibe llamadas, coste y conversión de todos los demás negocios, con sus UUIDs. Es además la munición de S1 |
| **S3** | **Webhooks de Telnyx sin firma** (fail-OPEN sin `TELNYX_PUBLIC_KEY`) | `utils/telnyx-signature.js:47-48`; la var no está ni en `.env` ni en `.env.example` | Un tercero POSTea a `/voice/telnyx` con el número de un cliente y arranca pipelines a cargo de NodeFlow, pudiendo crear citas falsas |
| **S4** | `JWT_SECRET` cae en `API_KEY` si falta | `routes-auth.js:23` | Quien tenga la API key puede forjar sesión de cualquier org |
| **S5** | `/api/admin/reload` acepta la API key **por query string** | `routes-admin.js:895` | Reintroduce lo que `middleware.js:49` eliminó a propósito (acaba en access logs) |

### P0 — Voz (rompen llamadas reales, hoy)

| ID | Qué | Evidencia | Escenario |
|---|---|---|---|
| **V1** | **`interrupted` nunca se resetea fuera de `_processTurn`** → el watchdog de re-enganche y la despedida del lifeguard **no pueden sonar nunca** | `voice-pipeline.js:170,970` vs `call-session.js:157`, reset solo en `voice-pipeline.js:525` | Falso positivo de barge-in → 75 s de silencio absoluto → el cliente cuelga. La garantía "jamás aire muerto" falla justo en el caso que la motivó |
| **V2** | **Barge-in durante la frase-puente deja un `tool_calls` huérfano** en el historial | `voice-pipeline.js:741-748, 859, 864`; sin saneamiento en `llm/openai.js:32` | El cliente interrumpe cuando la IA va a consultar la agenda → OpenAI devuelve 400 en **todas** las peticiones restantes → escalada a recado. **Se pierde la llamada entera** |
| **V3** | **Si Deepgram cierra el socket a mitad de llamada, la IA se queda sorda en silencio** | `deepgram.js:186-190` + `stt/router.js:170-178` (`return` sin log) | Sin reconexión en vuelo. El único que se entera es el lifeguard 75 s después — y por V1 ni siquiera puede despedirse |
| **V4** | **Cero timeouts en LLM y TTS** | grep `AbortController` en `src/llm/`, `src/tts/`: solo `local-tts.js` | Una conexión colgada bloquea el turno indefinidamente. El único límite es el lifeguard a 75 s |
| **V5** | **El failover de STT está roto para la configuración real** | `google-stt.js:38` (LINEAR16 sobre bytes A-law), `:36` (idioma `es+gl` no es BCP-47), `:85` (traga el error), `:24` (`isOpen:true` desde el constructor) | Un incidente de Deepgram degrada a transcripción de ruido con 2 s de retardo, y las métricas dirán "STT sano". Además la confianza desaparece → la escalera de seguridad se apaga sola |

### P0 — Agenda

| ID | Qué | Evidencia |
|---|---|---|
| **A1** | **`nf_appointments.staff` no existe** (verificado contra BD). La memoria permite dos profesionales en el mismo hueco (`scheduler.js:227`, consagrado en `test/reserva-profesional.test.js:36`), la BD lo rechaza con 23P01, y `staff` **ni siquiera se persiste** (`appointments-store.js:36-66`) | Cliente2 reserva con Beto el sábado 10:00, el bot confirma, la BD rechaza, el dueño recibe una alerta de doble reserva **falsa**, y la cita muere en el siguiente deploy. Además, tras reiniciar, `apt.staff` es `undefined` → la agenda colapsa a 1:1 y el negocio pierde media capacidad |
| **A2** | **La voz dice "confirmado" antes de que la cita exista en ningún sitio duradero** — la persistencia es fire-and-forget (`scheduler.js:350-357`) y `executor.js:508` devuelve al LLM sin esperarla | Hay reintentos y aviso al dueño, pero el cliente ya colgó creyendo que tiene cita |
| **A3** | **Sin timeout en Google Calendar durante la llamada** (`executor.js:131-136`; `googleapis` no impone default) | Un incidente de Google = 60 s de aire muerto a media llamada. Contraste: iCal sí lo hace bien (`ical-busy.js:20`) |
| **A4** | **Ventana de arranque con la agenda vacía**: `server.listen()` no espera a la hidratación, y `isHydrated()` existe pero **no lo llama nadie** | Redeploy a las 10:00, llamada a las 10:00:03 → el bot ofrece huecos ya ocupados |
| **A5** | **Multi-sede desactiva el bloqueo por calendario externo** (`executor.js:392,507`: `locations.length > 0 ? {} : …`) | El cliente que más paga (Osakin, 3 centros) pierde la protección contra doble agenda |
| **A6** | **Festivos, vacaciones, excepciones y buffers entre citas: no existen** | El 15 de agosto (viernes) el bot reserva 8 citas en una clínica cerrada |

### P1 — Fiabilidad y medición

| ID | Qué |
|---|---|
| **F1** | **La suite de 192 ficheros de test no se ejecuta nunca**: ni en `deploy.yml` ni en el `Dockerfile`. Es la deuda estructural más cara del repo |
| **F2** | **Solo medias, nunca percentiles** (grep `p95` en todo el repo: 0 resultados). El umbral de alerta son 1500 ms sobre la media, con objetivo de charter de 700 ms. Una llamada de 9 turnos a 400 ms y uno a 6 s sale "verde" |
| **F3** | `firstAudioMs` — la única métrica que modela lo que el cliente percibe — se captura y **no se agrega en ningún sitio**. El panel admin lee `avgFirstAudioMs`, que ningún backend produce |
| **F4** | `totalSttTime` es **siempre 0** (`turnMetrics.sttTime` nunca se asigna) y `llmTime` está contaminado por el TTS (`voice-pipeline.js:669` suspende el generador). El desglose de latencia que se enseña está sesgado hacia el LLM por construcción |
| **F5** | **No hay alerta si se cae el STT ni si Stripe rechaza un pago.** `error-tracker.capture()` existe y **ningún fallo de dominio lo usa** |
| **F6** | Logs en texto ANSI a stdout, **se pierden con el contenedor**. El correlation ID cubre ~17% de las trazas y **se rompe justo en el post-call** (0 de 22 logs en `post-call-handler.js` lo llevan) |
| **F7** | **PII cruda en logs**: transcripción íntegra (`deepgram.js:111`), nombre+teléfono en `executor.js:331`. Sin `LOG_LEVEL` en todo el repo |
| **F8** | El detalle auditable del ROI **se calcula y se descarta** en `routes-portal.js:4200`: `recoveries[]` y `bookings[]` nunca cruzan el HTTP. El dueño ve "~105€" y no tiene ningún camino para preguntar "¿cuáles?" |
| **F9** | **35€ de ticket inventado** en 5 sitios (`routes-portal.js:634,1298,1523,2040`, `analytics.js:325`) y **4 min ahorrados por llamada** sin ninguna base (`routes-portal.js:530`), pintados como KPI de primera fila. `nf_appointments.price` **existe y tiene datos** |
| **F10** | El TTS **no es streaming**: `streamSynthesize` está implementado en 4 proveedores y **nadie lo llama**. Y LLM/TTS están serializados (`voice-pipeline.js:669`), causa estructural de los huecos que mide `fragmentGaps` |

---

## 4. Unit economics

**Supuestos declarados:** 3 min/llamada · WhatsApp 0,045€/conversación · número 1,50€/mes · infra+email 1,60€/org/mes · saliente a móvil ES 0,055€/min.

### Coste real por minuto de llamada

| Configuración | Según COST_RATES del código | Reestimación con precios de lista |
|---|---|---|
| Voz premium (ElevenLabs) | 0,1103 €/min | **0,033 €/min** (el código sobreestima 3,3×) |
| Voz estándar (Cartesia) | 0,0253 €/min | **0,027 €/min** (el código subestima 7%) |

### Margen por escenario (plan 49€)

| | Ligero (60 llam.) | Medio (150) | Intensivo (300 + campañas) |
|---|---|---|---|
| COGS | 12,69€ | 25,57€ | 65,07€ |
| Margen **si el overage se cobra** | 36,3€ (74%) | 23,4€ (48%) | 100,9€ (61%) |
| Margen **si NO se cobra** | 36,3€ | 23,4€ | **−16,07€ (−33%)** |

**Break-even sin overage cobrado: ~1.322 min/mes. El tope duro está en 1.500 min** (`middleware.js:201`) — por encima del break-even. Y ese tope **solo se aplica a `/api/calls/outbound`**: las llamadas entrantes nunca pasan por `checkUsageLimits`.

### Los 3 agujeros de margen

1. **El overage se cuenta y no se cobra.** Dos env vars (`STRIPE_OVERAGE_METER_EVENT`, `STRIPE_MSG_METER_EVENT`) separan "contamos" de "cobramos". Es el único agujero que se vuelve negativo con un cliente **legítimo**, sin abuso.
2. **`Pro` es el tier por defecto** (`plan.js:22`) y Pro incluye todos los add-ons gratis (`addons.js:69`) → toda org sin `tier:'basico'` explícito recibe **64€/mes de complementos** dentro de un plan de 49€, incluido `growth` (campañas por voz, el add-on con más COGS).
3. **WhatsApp, número mensual y saliente están fuera del modelo de costes.** El saliente se valora a tarifa de entrante (0,0045 vs ~0,055 real, **12×**), lo que hace que las campañas parezcan gratis en `/api/admin/economics`.

### Errores de contabilidad que afectan a decisiones

- `kpis.js:11` usa `{negocio:49, pro:99}` pero el Pro real son **49 + add-on 36 = 85€**, y **todos los clientes llevan `plan='negocio'`** en BD (`signup-tier.js:38`). El MRR del panel **cuenta todo Pro a 49€ e ignora los add-ons**. Unai está decidiendo con un MRR infravalorado.
- Las tarifas están en USD y se restan a ingresos en EUR (`routes-admin.js:760`) → subestima el coste ~8%.
- El proveedor de TTS para el coste se lee de la **config**, no de quién sirvió: si ElevenLabs cae y sirve otro, se sigue imputando 0,10 €/min.
- `llm/router.js:22-42` etiqueta `costPer1kTokens` con valores que son **por millón** → error de 1000×. No factura, pero es una mina.

### Riesgo de gasto sin ingreso

| Vía | Tope | Persistente |
|---|---|---|
| **Minutos entrantes** | **Ninguno efectivo** (solo lifeguard 15 min + concurrencia 10) | — |
| Demo web `/api/demo/*` | 600 req/h **por IP** (no global) y **falla abierto** | Memoria sin Redis |
| Demo "Llámame" | 30/día en BD (bien hecho); topes por teléfono/IP en `Map` en memoria | Parcial |
| Llamadas salientes del portal | **Sin rate limit, sin `checkUsageLimits`, sin lista blanca de destinos** (`routes-portal.js:3396`) | — |

---

## 5. Plan de ejecución

### Fase 0 — Bloqueadores (antes de vender)
Seguridad S1-S5 · Voz V1-V5 · Agenda A1-A4 · `npm test` en CI (F1) · regenerar `pending-migrations.md` desde la BD.

### Fase 1 — Fiabilidad
Percentiles p50/p95 (F2, F3, F4) · alertas de dominio vía `error-tracker.capture()` (F5) · correlation ID en post-call + redacción de PII (F6, F7) · watchdog externo · reconciliación diaria Telnyx ↔ `nf_calls`.

### Fase 2 — Valor demostrable
Extracto línea a línea del ROI (F8) · ticket real desde `nf_appointments.price` (F9) · timeline unificado "lo que NodeFlow hizo por ti" · quitar horas-ahorradas inventadas.

### Fase 3 — Conversión y limpieza legal
Quitar los 27 testimonios · corregir "datos en Europa", "Meta verificado", euskera, "24/7", "sin registro" · aviso legal en el onboarding · nombrar subencargados · derecho de supresión operativo · despublicar `index-old.html`.

### Fase 4 — Economía
Activar los dos meters de Stripe · `checkUsageLimits` en el camino de voz entrante · bajar `hardCapMultiplier` a 2 · corregir el default a `basico` · meter WhatsApp/número/saliente en el modelo de costes · corregir `kpis.js`.

### Fase 5 — Verticalización y escala
Tres verticales con producto real · Redis obligatorio antes de multi-réplica · agenda fuera de memoria.

---

## 6. Lo que NO se puede verificar sin llamada real o factura

**Voz:** si Telnyx honra el evento `clear` (determina si el barge-in es inmediato o llega con 900 ms) · si Telnyx emite `media.track` y con qué valor · tasa real de falsos finales con 300 ms de endpointing · frecuencia con que Deepgram cierra el socket a mitad de llamada.

**Sin llamada nueva, solo consultando lo ya guardado:** los p50/p95 reales de `firstAudioMs` están en `nf_calls.metrics.turns[]` desde hace semanas. Y V2 es contrastable: buscar llamadas con `toolCalls > 0` seguidas de ≥2 `recoveries` o `escalatedTakeMessage`.

**Economía:** €/min real de entrante y **de saliente a móvil ES** (el que más distorsiona el modelo) · alquiler mensual por número · reparto del gasto de OpenAI entre llamada/auditor/embeddings/blog · caracteres facturados de ElevenLabs por minuto de llamada · coste por conversación de Meta (utility vs marketing) · **si `STRIPE_OVERAGE_METER_EVENT` está puesto en EasyPanel ahora mismo**.

---

## 7. Ejecución

Rama `fix/fase0-seguridad-voz`, 13 commits, **suite 2865 tests en verde**. Cada
commit explica el fallo concreto que corrige y por qué importaba.

### Corregido

| Bloque | Qué |
|---|---|
| **Seguridad** | S1 secuestro de calendario cross-tenant (nonce de un solo uso) · S2 fuga de analítica de toda la flota · S3 firma de Telnyx: anti-replay + estado visible en `/health` · S4 `JWT_SECRET` ya no cae en `API_KEY` · S5 API key fuera de la query string · SEC-13 tokens de Outlook cifrados |
| **Voz** | V1 el re-enganche y la despedida ya pueden sonar tras un barge-in · V2 una interrupción durante la frase-puente ya no invalida el historial y mata la llamada entera · V4 presupuesto de tiempo en LLM y TTS · E3 Anthropic deja de ser un fallback roto |
| **Agenda** | A1 `staff` se persiste + migración con el EXCLUDE corregido · AG-10 cambiar de servicio recalcula la duración · A3 timeout en Google Calendar · A4 no se atiende con la agenda a medio cargar |
| **Fiabilidad** | F1 la suite bloquea el despliegue · F2 percentiles (no existía ni un p50 en todo el repo) · F3 `firstAudioMs` agregado · F4 desglose de latencia sin sesgo · F5 alertas de dominio (STT caído, pago fallido, cita perdida) · F6 correlación en el post-call · F7 redacción de datos personales en logs |
| **Valor** | F8 el ROI se puede abrir y comprobar una a una · F9 fuera el ticket de 35€ y las horas ahorradas inventadas |
| **Legal** | 27 testimonios inventados · "datos en Europa" · "verificado por Meta" · euskera · "24/7 sin límite" · IVA · "sin registro" · onboarding sin aviso legal · estadísticas sin fuente · ticker falso · garantía · `index-old.html` · subencargados nombrados · derecho de supresión operativo · aviso de IA garantizado |
| **Operativa** | El esquema se comprueba (`npm run schema`) en vez de declararse · backups completos · un negocio saturado avisa por voz en vez de colgar en silencio |

### Pendiente de Unai (no es código)

Los seis puntos originales (migración de `staff`, `TELNYX_PUBLIC_KEY`,
`JWT_SECRET`, los dos meters de Stripe, Registro Mercantil, default de tier)
**están hechos**, más `TEST_PHONE_NUMBERS` e `INTERNAL_EMAILS` del 30/07.

Queda uno solo, y son cinco minutos: **watchdog externo** (UptimeRobot contra
`/health`). Hoy el servicio se vigila a sí mismo, que es como no vigilarlo.

### Cerrado después de escribir esto (30/07)

| Qué | Por qué importaba |
|---|---|
| V3 reconexión de STT en vuelo · V5 formato de audio del failover | La IA se quedaba sorda en silencio |
| Festivos, vacaciones y buffers entre citas | `business-calendar.js` |
| **"Llamada rota" no era una sola cosa** | La auditoría nocturna avisaba de "10 rotas de 54": 8 eran pruebas de madrugada y 2 clientes que colgaron al oír el saludo. Cero averías. `call-outcome.js` separa fallo del sistema de cuelgue del cliente, y descuenta el tráfico interno |
| **Número asignado que no recibe NUNCA una llamada** | El detector de silencio exige ≥3 llamadas previas: un número que nunca recibió ninguna le era invisible. Aviso a los 15 días, crítico al mes |
| **Cuentas internas fuera del recuento** | Las demos de revisión de Meta/Google parecían clientes. Se excluyen **y se dicen**: excluirlas en silencio taparía a un cliente real con el `owner_email` mal puesto |
| **Control de gasto en llamadas ENTRANTES** | `checkUsageLimits` vivía solo en `/api/calls/outbound`. El producto no pasaba por ningún control |
| **Desglose del primer audio** | `llmFirstTokenMs` / `llmFirstFragmentMs` / `firstFragmentTtsMs`, con percentiles |

**Sobre el tope de gasto — se contradice lo que decía este documento.** Aquí se
recomendaba bajar `hardCapMultiplier` de 3 a 2. Al ir a hacerlo se vio que era la
respuesta equivocada: cortarle las llamadas a quien consume 1.000 minutos es
autolesión **si se le está cobrando** el overage. Lo que decide no es cuántos
minutos son, sino **quién los paga**:

- Con suscripción → los extra se facturan. **No se corta nunca**, ni llegando al
  tope. Su contador se resetea con el webhook `invoice.paid`; si ese webhook se
  pierde una vez, `monthly_minutes_used` no vuelve a bajar y colgaríamos las
  llamadas de un cliente al día por un fallo nuestro. Se avisa y decide un humano.
- Sin suscripción → nadie paga esos minutos. Tope estrecho (incluidos + 20%).

Hoy en producción **ninguna org tiene suscripción**, así que el segundo caso no
es el raro: es el único que hay.

### Sigue abierto (no bloqueante para vender)

- **TTS no es streaming**: `streamSynthesize` existe en cuatro proveedores y no
  lo llama nadie. Ya está instrumentado (arriba); **falta el dato de llamadas
  reales** para decidir si el que manda es el TTS o el LLM. Sin ese dato, tocarlo
  sería optimizar a ciegas.
- **Agenda en memoria**: bloquea el multi-réplica. Necesita Redis primero. No
  urge: con 4 llamadas reales al mes no hay nada que repartir entre réplicas.
- **Watchdog externo de uptime**: el servicio sigue monitorizándose a sí mismo.
- **La confirmación por WhatsApp sigue diciendo la hora como definitiva** aunque
  el negocio no haya configurado su horario. Va en plantilla aprobada por Meta
  (`nodeflow_cita_confirmada`) y cambiar el texto exige plantilla nueva y
  revisión. La voz sí avisa de que la hora está por confirmar; el WhatsApp no.
- **Las tipografías siguen viniendo de un tercero.** Ya está declarado (apartado
  09 de privacidad), pero la conexión sigue existiendo: cada visita manda la IP a
  `api.fontshare.com`. **No se puede arreglar auto-alojándolas**: la licencia ITF
  FFL de Satoshi y Clash Display lo prohíbe expresamente (cláusula 02) y concede
  el uso web solo vía su API. La única salida es cambiar a una tipografía con
  licencia que permita alojarla (las OFL sí) — decisión de marca, no técnica.
- **Hueco de 12 s en `worstFragmentGapMs`**: un solo caso, y los comentarios del
  código dicen que en julio se arregló un falso positivo idéntico. Sin reproducir.

### Lo que ninguna de estas correcciones arregla

Verificado contra la base de datos el 30/07: las cuatro organizaciones activas
son cuentas de Unai, ninguna tiene suscripción de Stripe, y en 30 días entraron
**4 llamadas de números desconocidos**. El sistema no está roto: está vacío. Todo
lo anterior protege algo que hoy atiende unas 4 llamadas reales al mes, y el
cuello de botella es de activación y venta, no técnico.
