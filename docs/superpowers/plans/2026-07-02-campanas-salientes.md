# Plan — Campañas salientes ("NodeFlow Crecimiento") y estado de la plataforma

> Escrito 2026-07-02. Fuente de verdad del siguiente gran desarrollo y del estado
> en que queda todo tras el rediseño + fixes de hoy. Leer entero antes de tocar código.

---

## 1 · Estado actual (qué hay desplegado hoy)

Ocho deploys en producción el 2026-07-02, en este orden:

| Commit | Qué |
|---|---|
| `17ba1b3` | Design System v1 "Electric Night" (`public/portal/nf-design-system.css`), dashboard copiloto, Ctrl+K + IA contextual (`cmdk.js`, `POST /api/portal/assistant-command`), "Llámame y pruébalo", Citas semana, Clientes tarjetas, admin migrado, SW v10 |
| `dfb3be0` | Bucle de conocimiento (preguntas sin respuesta → KB 1 clic), "🤖 Que le llame" en Oportunidades, + cita clicando día, nudge ticket medio |
| `c939915` | Fix: pdf.js self-hosted (subida de PDF a KB estaba rota en prod — 404) |
| `e30c0ea` | Firma de marca: onda de voz (`.nf-wave`) en loaders/live/login; emojis fuera de titulares |
| `117de70` | Salientes vía **Telnyx** (TeXML `POST /v2/texml/calls/{app_id}`) — antes solo Vonage/Twilio y el botón moría |
| `0b850eb` | Hotfix: Asistente/Seguimientos en blanco (utilidad `.hidden` del DS pisaba `.section.active`) |
| `644e221` | Multi-tenant entrante (webhook resuelve asistente por número llamado, matching normalizado) + avisos WhatsApp por niveles en Integraciones |

Tests: **419 en verde** en cada push. EasyPanel se cayó 2 veces durante los deploys
(el servicio nunca); el workflow deja la imagen en GHCR y basta `gh run rerun <id> --failed`.

### Arquitectura de números (decidido hoy)

- **1-2 números Telnyx POR negocio.** Se compran en Telnyx, se apuntan a la TeXML App
  compartida (`VoiceCore TeXML`, App ID `2993386102682813476`), se añaden al pool del
  admin y se asignan a la org (eso escribe `automation_config.config.outboundNumber`).
- **Entrantes:** `/voice/telnyx` resuelve el asistente por el número llamado
  (`assistantManager.getByPhoneNumber`, normalizado) — server-side, determinista.
- **Salientes:** `POST /api/portal/calls/outbound` usa `outboundNumber` de la org
  primero; `TELNYX_PHONE_NUMBER` global solo como fallback.

### Avisos WhatsApp por niveles (decidido e implementado hoy)

- **Incluido en el plan:** número compartido de NodeFlow (`WA_PHONE_NUMBER_ID`/`WA_ACCESS_TOKEN`
  en EasyPanel). Las plantillas (`scripts/wa-submit-templates.js`) ya nombran al negocio
  en el cuerpo. Cascada en `src/notifications/reminders.js`: creds de la org → globales.
- **Premium (número propio, +15-19€/mes sugerido):** el negocio lo solicita desde
  Integraciones ("Quiero mi número" → email a unai@). El alta la hace NodeFlow
  white-glove con `POST /api/admin/whatsapp/connect-meta` (ya existe, cifrado).
- El flujo 360dialog está **eliminado** (cancelado por caro).

---

## 2 · Checklist de Unai (bloquea la validación E2E — nada de esto es código)

1. ☐ **Rotar** la API key de Telnyx (la anterior se pegó en un chat).
2. ☐ EasyPanel → voicecore-api → `TELNYX_API_KEY` (la nueva), `TELNYX_APP_ID=2993386102682813476`, `TELNYX_PHONE_NUMBER=+34843…`.
3. ☐ Telnyx → My Numbers → asignar el 843 a la Connection "VoiceCore TeXML".
4. ☐ Portal → Asistente → **"Llámame ahora"** a tu móvil → descolgar → verla transcrita en Llamadas. *(Esto valida TODA la cadena saliente.)*
5. ☐ Confirmar las 4 vars `WA_*` del canal WhatsApp compartido (activación de hoy) → la card de Integraciones pasará sola de "⏳ Activándose" a "✅ Incluido".
6. ☐ Probar 4-5 frases en Ctrl+K con el LLM real ("cita para X el viernes a las 10", "recuérdame…", "busca a…", "llámame").
7. ☐ Subir un PDF a la Base de conocimiento (confirma el fix `c939915`).

---

## 3 · Cola de campañas salientes — diseño

### Principios (no negociables)

1. **Solo primera-parte.** Se llama únicamente a personas con relación previa con el
   negocio (clientes con historial, gente que llamó, lista de espera). **Nada de puerta
   fría a desconocidos**: las llamadas automatizadas de marketing sin consentimiento
   previo violan ePrivacy/LSSI (lista Robinson, sanciones AEPD) y queman el número.
2. **El LLM no decide a quién llamar ni cuándo.** Las campañas son deterministas
   (reglas + datos); el asistente solo conversa dentro de la llamada.
3. **Cada llamada respeta:** `do_not_contact` (el analyzer ya lo marca), ventana
   horaria (10:00-20:00 laborables, configurable), máx. 2 intentos por contacto y
   campaña, y ritmo (1 llamada concurrente por org, pausa entre llamadas).
4. **Resultados en €** o la feature no existe: cada campaña reporta contactados,
   citas conseguidas y valor estimado (citas × ticket medio).

### Tipos de campaña (v1 → v2)

| Tipo | Disparo | Audiencia | Fase |
|---|---|---|---|
| **Anti no-show** | Cron diario ~18h: citas de mañana sin confirmar | Citas `pending` de mañana | **v1** |
| **Recuperación** | Manual desde Oportunidades/Clientes ("Llamar a los N") | `nfNeedsAttention` / oportunidades | **v1** |
| Lista de espera | Al cancelarse una cita | Waitlist `waiting` | v2 |
| Fechas de sector (ITV, vacunas…) | Cron diario sobre `sector_data` | Contactos con fecha próxima | v2 |

### Modelo de datos (cero migraciones si es posible; si no, UNA tabla)

Preferencia: tabla nueva `nf_campaign_calls` (id, org_id, campaign_type, contact_id/phone,
scheduled_at, attempts, status: queued|calling|done|failed|skipped, outcome, call_sid,
created_at). Es una cola: Supabase la soporta sin fricción. Migración única en `db/`.
*(Alternativa sin migración: JSONB en automation_config — descartada, la cola necesita
consultas por estado y no debe vivir en config.)*

### Motor (`src/campaigns/dispatcher.js`, nuevo)

- Tick cada 60s (registrarlo en `src/scheduling/cron.js` como los demás crons):
  coge `queued` dentro de ventana horaria, 1 por org como máximo en vuelo.
- Llama reutilizando la lógica de `/api/portal/calls/outbound` (extraer a helper
  `src/telephony/outbound.js` para no duplicar Telnyx).
- **Contexto de campaña al asistente:** la Url del TeXML lleva
  `?campaign=recordatorio&ref=<campaignCallId>`; `/voice/telnyx/:assistantId` lo pasa
  como Parameter del stream, y el pipeline inyecta un bloque al systemPrompt:
  *"LLAMAS TÚ en nombre de {negocio} para {recordar la cita de mañana a las X /
  ofrecer una cita porque hace tiempo que no viene}. Preséntate, sé breve, si no
  interesa despídete con amabilidad y no insistas."* — junto con los datos de la cita.
- Al terminar: `status=done` + outcome del call-session; el transcript-analyzer ya
  corre y alimenta contact_memory (`do_not_contact` incluido).

### Portal (nueva sección "Campañas" o pestaña en Automatizaciones — decidir con Unai)

- Toggle por campaña (anti no-show ON/OFF) + ventana horaria.
- Lanzador de recuperación: "Vas a llamar a 12 clientes. Ventana 10-20h, máx. 2
  intentos. ¿Lanzar?" → progreso en vivo en el feed del dashboard
  ("✓ IA recuperó a Ane — cita el jueves").
- Resultados: contactados / citas / € — misma regla de € que Informes.

### Gating y precio

- Flag `automations.config.growthAddon: true` (lo activa el admin al cobrar).
- **39€/mes, 200 min salientes incluidos**, overage 0,15€/min por Stripe Meters
  (infra ya existente del overage de voz). Piloto: **gratis 1 mes con Osakin**
  (anti no-show en 3 clínicas) para tener datos reales antes de vender el precio.

### Orden de ejecución (cuando la llamada de prueba E2E esté validada)

1. Helper `src/telephony/outbound.js` + refactor del endpoint del portal (sin cambio funcional).
2. Migración `nf_campaign_calls` + dispatcher con tests (cola, ventana, reintentos, do_not_contact).
3. Contexto de campaña en TeXML → pipeline (prompt de saliente).
4. Anti no-show (cron) end-to-end con la org de prueba.
5. UI de Campañas en el portal + feed en vivo.
6. Recuperación manual en lote desde Oportunidades.
7. Gating + Stripe + piloto Osakin.

Estimación honesta: 2-3 sesiones de trabajo, la primera entera para 1-3.

---

## 3b · Calidad de conversación (del testing real 2026-07-02 — ANTES que campañas)

### Voz v2 (HECHO — `8deab6f`)
Pacer de frames 20ms, reloj de reproducción (adiós marks), ulaw_8000 nativo,
utteranceEndMs 800, dicción telefónica en el prompt. Validar con llamada real.

### Criterios de aceptación de la llamada real (checklist del cofundador)
La validación no es "funciona": es que TODO esto pase de forma repetible:
- [ ] Responde consistentemente <~500ms tras terminar de hablar el usuario
- [ ] Sin silencios largos ni respuestas truncadas
- [ ] Barge-in correcto sin perder el contexto; ruido de fondo NO le corta
- [ ] Entiende "a la una y media", "el martes que viene"
- [ ] Saluda por el nombre cuando corresponde; contexto estable toda la llamada
- [ ] JAMÁS ofrece cita sin validar con el motor de disponibilidad
- [ ] Si falla un servicio externo, degrada con elegancia (nunca silencio)
Cuando pase repetible → el Voice Core queda certificado como componente
reutilizable para cualquier producto futuro.

### Voz v3 (si tras validar v2 sigue >1,5s por turno)
1. Verificar en logs que el LLM enruta a groq (org assistant va sin model).
2. TTS streaming: ElevenLabs stream endpoint → frames al pacer según llegan
   (hoy se espera la frase completa). Baja el primer audio ~300-500ms.
3. Barge-in por contenido: interrumpir solo con transcript interim ≥2 palabras
   (Deepgram interim ya llega), no con VAD pelado — inmune a ruido de fondo.

### Reservas deterministas (bug real: ofreció viernes CERRADO y rechazó "a la una")
- Regla: la IA NUNCA inventa disponibilidad. `check_availability` SIEMPRE antes
  de ofrecer; el prompt prohíbe proponer huecos sin haberlo llamado en el turno.
- Parser de hora natural en el tool (server-side, determinista): "a la una" →
  13:00 (contexto laboral: 1-8 sin am/pm = tarde salvo sector madrugador),
  "y media/menos cuarto", "después de comer" → 15:00-16:00, "por la mañana" →
  rango. Tests exhaustivos con frases reales.
- El schedule del negocio (días cerrados) se inyecta YA en el prompt (verificar
  que llega — el bug del viernes sugiere que no llegaba o que la IA lo ignoró
  → reforzar: lista explícita "CERRADO: viernes" + validación dura en el tool).

### CRM progresivo (la IA nunca pregunta el nombre)
- El prompt de org-assistant debe instruir: en reservas, pedir SIEMPRE nombre y
  teléfono de contacto (natural, no interrogatorio); si cliente conocido
  (memoria en vivo ya inyectada), saludar por nombre y NO volver a pedirlo.
- Enriquecimiento post-llamada ya existe (transcript-analyzer → contact_memory
  + sector_data); añadir extracción de email/consentimiento cuando se mencione.

### Provisioning de número (estado "pendiente" con número asignado)
- El dashboard lee `nodeflowNumber` de flowManager (memoria) — misma fuente
  desincronizada que el outbound (ya parcheado ahí vía pool). Unificar: TODAS
  las lecturas de número van a nf_phone_pool; automation_config solo caché.
- Estados visibles: comprado → conectado a TeXML → asignado → verificado
  (primera llamada OK). Wizard de desvío por operadora: fase posterior.

## 4 · Backlog menor (no bloquea nada)

- Identidad fase 2: ilustración propia, og-images, onda en la landing.
- Ctrl+K en el admin.
- Informes: "ledger" acumulado (cuánto ha generado NodeFlow desde el día 1).
- Migración de hosting (EasyPanel se cayó 2 veces hoy — ver project_nodeflow_startup).
- Sidebar del portal: badge contextual con nº de oportunidades/tareas pendientes.
