# HANDOFF — Sesión voz + billing + WhatsApp (2026-07-04, madrugada)

> Traspaso EXACTO para arrancar una ventana de contexto nueva sin perder nada.
> La sesión nueva arranca leyendo: (1) memoria persistente, (2) este doc,
> (3) `docs/NODEFLOW-VISION.md`. Todo commiteado y pusheado; `HEAD = e7f57f7`,
> master == origin/master, **717 tests en verde**.

## Cómo retomar (frase para la sesión nueva)
> "Continúa donde lo dejamos — lee el handoff del 4 de julio (voz/billing/whatsapp)."
> Cargará memoria + este doc y sigue punto por punto.

---

## 1 · CÓMO SE TRABAJA AQUÍ (normas vivas — respétalas)

1. **Evidencia → causa raíz → cambio mínimo → test → deploy vigilado → validación
   en prod.** Prohibido "creo que"; nada de cambiar modelo/prompt sin datos.
2. **TDD siempre**: test que falla → implementación mínima → verde. Suite con
   `npm test` (node --test). El error `no auth` de smoke.test.js es un test que
   PASA (error capturado) — no te asustes.
3. **Reglas de negocio DETERMINISTAS fuera del LLM** (candados server-side). La
   dicción, los cupos, el fichaje de leads, etc. no dependen de que el LLM acierte.
4. **Commits**: `git add` de rutas EXPLÍCITAS. **Hay WIP ajeno sin commitear en el
   working tree** (stripe.js applyCredit, docs, referrals, onboarding.html, etc.)
   — NO lo arrastres. Mensajes largos con `git commit -F archivo` o `-m` con
   here-string (PowerShell 5.1 rompe comillas).
5. **Verificar UI en PREVIEW antes de dar por hecho**: mock-server en el
   scratchpad de sesión (`portal-mock-8379`, sirve public/ + stubs de /api/*).
   SIEMPRE purgar el Service Worker en el preview. El mock se amplía con stubs
   según haga falta. Screenshot para evidencia visual.
6. **Firma de commits**: acabar con `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

### Deploy — DOS vías según el archivo (CRÍTICO)
- **Portal y demo (HTML/JS de `public/`) van por GitHub RAW** → un `git push`
  los pone LIVE en ~30-90s SIN rebuild (el server hace fetch a
  `raw.githubusercontent.com/.../master/public`, TTL 60s; el CDN de raw a veces
  tarda hasta ~5 min por archivo). Verificar con
  `curl https://nodeflow.es/portal/portal.js | grep <marcador>`.
- **El BACKEND (`src/`, server.js) necesita rebuild Docker + deploy en EasyPanel.**
- **GOTCHA EasyPanel**: bloquea a los runners de GitHub (HTTP 000), así que el paso
  "Deploy to EasyPanel" de la workflow SIEMPRE falla. La imagen sí llega a GHCR.
  **Desplegar A MANO desde el panel**: EasyPanel → proyecto voicecore → servicio
  voicecore-api → cambiar la imagen a `ghcr.io/74doktorr-boop/voicecore:<SHA>`
  (o `:latest`) → Deploy. La workflow fija la imagen por SHA, así que el panel
  apunta al último deploy EXITOSO, no a :latest.
- **Tras CADA deploy del backend: re-armar la captura de audio** →
  re-login admin (POST /api/admin/auth con `DASHBOARD_PASSWORD` del .env, token a
  /tmp) → `POST /api/admin/stt-debug {enabled:true}`.
- Vigilar el boot: `curl https://nodeflow.es/health` → `bootId` cambia con cada
  reinicio. Boot actual visto: `1783148723135`.

### Datos self-service (diagnóstico)
- `.env` local = credenciales de PRODUCCIÓN (SUPABASE_SERVICE_KEY, STRIPE_SECRET_KEY
  LIVE, ELEVENLABS/CARTESIA keys, DASHBOARD_PASSWORD, DEMO_TOKEN…). En prod, las
  vars van en EasyPanel.
- nf_calls (transcript/metrics/audit), /api/calls/history (x-api-key),
  /api/portal/*, /api/admin/* (admin auth), /api/demo/tts (DEMO_TOKEN).
- **En prod solo existe UNA org**: NODEFLOW INTELIGENCIA ARTIFICIAL
  (`74746a30-02c2-474f-8a47-7a0a716b45d1`). "Peluquería HHR" era la persona del
  stress-test sobre esa org.

---

## 2 · QUÉ SE HIZO HOY (todo LIVE salvo lo que diga "necesita deploy")

### Voz — catálogo, Cartesia, cupos, dicción
- **Cartesia ACTIVADO** (tier Ultra-rápida). Clave nueva verificada 200 + síntesis
  real probada en prod (`X-Tts-Provider: cartesia`, voz Blanca). Motor ya existía
  (`src/tts/cartesia.js` sonic-2); se cableó org-assistant (provider cartesia→
  ttsProvider). **Catálogo: 39 voces** (azure 6, elevenlabs 19, cartesia 12, local 2).
- **3 tiers** (`config/voices.json` → `.tiers`): Estándar (Azure, incluida) ·
  Premium (ElevenLabs, +10€/mes) · Ultra-rápida (Cartesia, +10€/mes). **Premium y
  Ultra comparten el MISMO add-on `voice_premium`** (voiceChangeAllowed trata
  ambos igual).
- **Cupo de voz** (`src/tts/voice-quota.js`): plan básico 40 min/mes de voz
  cara, add-on 200, packs comprados suman. Superado → degrada a Azure del mismo
  género (org-assistant). Lee `monthly_minutes_used` + `automation_config.config
  .premiumExtraMinutes`.
- **Packs de compra** (`src/billing/voice-packs.js`): Premium 50min/5€, Ultra
  100min/5€. Checkout `POST /api/portal/voice-pack/:kind/checkout`, webhook
  `checkout.session.completed` → `applyVoicePack` (IDEMPOTENTE por sessionId).
- **Dicción determinista** (`src/tts/speakable.js` — **NECESITA DEPLOY**):
  toSpeakable() antes del TTS → €→euros, "1 hora"/"un horas"→"una hora". Aplicado
  en voice-pipeline._speakText y /api/demo/tts.
- **360dialog BORRADO** del código (todo WhatsApp/voz por proveedor directo).

### Demo pública (nodeflow.es/demo) — LIVE por raw
- Selector carga 37 voces castellanas de /api/voices agrupadas por nivel con
  precio; badge en vivo del nivel de la voz seleccionada. Preview honesto: cada
  voz suena por su proveedor real (arreglado en /api/demo/tts).
- **GOTCHA**: /api/voices normaliza SIN campo `language` (usa `accent`) → filtrar
  por `provider!=='local'`, NO por language.

### Dashboard del portal — LIVE por raw
- Widget "📞 Minutos de este mes" (incluidos/usados/disponibles + barra + 0,15€/min
  extra), reutiliza /api/billing/usage. Botones: "Comprar más minutos"→Facturación,
  "Ver modelos de voz"→modal comparativo de los 3 niveles con precio, nº voces y
  **la voz ACTUAL marcada** ("🔊 usa X · Nivel" + badge "TU VOZ AHORA").

### Billing / Stripe (LIVE en la cuenta Stripe)
- Overage a **0,15€/min** en todas partes (antes 0,10; el viejo price desactivado).
- Add-ons: voice_premium 10€, growth 39€, wa_own_number 15€ (gating server-side).

### WhatsApp — número propio (Fase 2, backend COMPLETO, espera Meta)
- Camino **Meta directo** (NodeFlow Tech Provider), 360dialog descartado.
- Backend listo y testeado: `src/whatsapp/meta-connect.js` (exchangeCodeForToken
  → registerNumber → subscribeAppToWaba → submitTemplates → connectMetaNumber),
  `src/whatsapp/templates.js`, rutas portal (GET /whatsapp/status, POST
  /whatsapp/connect-meta con gating 402, DELETE /whatsapp/connect). Webhook
  multi-WABA ya resolvía por phone_number_id.
- **Confirmación al cliente al reservar** (sendWaConfirmation, plantilla
  nodeflow_cita_confirmada, cableada en post-call-handler) + recordatorio + reseña,
  todo con la regla de oro (si el número propio falla, sale por el compartido).
- **Vía provisional YA operativa**: `POST /api/admin/whatsapp/connect-meta` (admin
  pega credenciales de un número a mano — testeado).

### Bucle de mejora continua — LIVE
- Auditor con contexto (modo+catálogo) + campo `info_gap`; agregador (cron lunes
  9h + POST /api/admin/improvement-cycle) → WA accionable al dueño + banner de
  huecos en Configuración + email al fundador con reglas candidatas; recurrencia
  (⟲); replay gate (`scripts/run-replay-gate.js`) valida reglas antes de desplegar.
- Red de seguridad de leads server-side (si el LLM verbaliza register_lead sin
  ejecutarlo, el post-call ficha el nombre y recupera el lead).

---

## 3 · DATOS CLAVE (IDs, credenciales pendientes)

### Stripe price IDs (LIVE, ya creados)
```
STRIPE_ADDON_VOICE_PRICE_ID   = price_1TpHMtJA7wUpVWZFZrdogCsQ   (Voz Premium 10€/mes)
STRIPE_ADDON_GROWTH_PRICE_ID  = price_1TpHMuJA7wUpVWZFWGPIGzJ8   (Crecimiento 39€/mes)
STRIPE_ADDON_WA_PRICE_ID      = price_1TpJJCJA7wUpVWZFyD2OUTaO   (WhatsApp nº propio 15€/mes)
STRIPE_OVERAGE_PRICE_ID       = price_1TpHMvJA7wUpVWZFXYnVtjxH   (overage 0,15€/min, meter existente)
STRIPE_PACK_PREMIUM_PRICE_ID  = price_1TpKb8JA7wUpVWZFY3mXLGe3   (pack 50 min Premium, 5€ pago único)
STRIPE_PACK_ULTRA_PRICE_ID    = price_1TpKb9JA7wUpVWZFxIspdjKS   (pack 100 min Ultra, 5€ pago único)
```
Meter overage: `mtr_61UxB18xRUM8CYCL541JA7wUpVWZFXOy` (event `nodeflow_overage_minutes`).

### Voces Cartesia añadidas (ES España, tier ultra)
Blanca, Nuria, Isabel, Gonzalo, Marcos, Iker, Rosa, Carolina, Alondra, Javier,
Manuel, Luis. (Hay 46 ES en Cartesia por si se quieren más — incl. latinas.)

---

## 4 · PASOS PENDIENTES (priorizados)

### 🔴 De Unai (desbloquean cosas) — hazlos primero
1. **DEPLOY del backend** (SHA `e7f57f7` o `:latest`) desde el panel EasyPanel.
   Esto activa: la **dicción** (euros/horas) en llamadas y demo, el cupo de voz, el
   gate de Crecimiento, la red de leads, la confirmación WhatsApp, el auditor con
   contexto, el replay gate, los packs. **Tras el deploy: re-armar stt-debug.**
2. **Env vars en EasyPanel** (en el mismo deploy): las 6 de Stripe de arriba +
   `CARTESIA_API_KEY` (la nueva) + las 4 de WhatsApp (`WA_PHONE_NUMBER_ID`,
   `WA_ACCESS_TOKEN`, `WA_APP_SECRET`, `WA_WEBHOOK_VERIFY_TOKEN`).
3. **⚠️ Clave de AZURE en EasyPanel** — CRÍTICO: en la demo la voz Azure (elvira-az)
   sonó por ElevenLabs → Azure NO está registrado en el router de prod (falta la
   key/config). Como el CUPO DEGRADA A AZURE, si Azure no está, degradaría a
   ElevenLabs (¡lo caro que queríamos evitar!). REVISAR que Azure esté configurado.
4. **WhatsApp Meta**: cuando Meta desbloquee el registro de desarrollador (bloqueo
   temporal de seguridad; dijeron ~24h el 2026-07-04) → crear la App → dar a Claude
   `WA_APP_ID`, `WA_APP_SECRET`, `config_id` del Embedded Signup → Claude monta el
   FRONTEND del botón "Conectar mi WhatsApp" y se valida E2E.
5. **Dar de alta las 3 plantillas WhatsApp en Meta**: `node scripts/wa-submit-templates.js`
   con WA_ACCESS_TOKEN + WA_BUSINESS_ACCOUNT_ID (aprobación Meta ~1-24h).
6. **Botón Llámame (Telnyx)**: apuntar el error de Telnyx portal → Reporting →
   Debugging/Call Events (el móvil no suena; sospechosos: perfil Default sin España
   en Allowed Destinations / cuenta sin verificar salientes / número sin voz saliente).

### 🟡 De Claude (construibles) — cuando Unai desbloquee o dé el dato
- **Frontend Embedded Signup** de WhatsApp (necesita config_id de la App Meta).
- **UI del cupo restante de voz** en el portal ("te quedan X min premium este mes").
- **Reset mensual** de premiumExtraMinutes (decidir: ¿se consume con el ciclo o
  persiste hasta gastarse?).
- **Reactivación por WhatsApp y voz** (canales nuevos del add-on Crecimiento; hoy
  solo email; usan el mismo candado growth; WA necesita plantilla Meta aprobada).
- **Gate funcional de Crecimiento** ya está en rebooking-cron; ampliar a los nuevos
  canales cuando existan.

### 🟢 Esperando datos
- Veredicto A/B Llama vs gpt-4o-mini (≥20 llamadas/brazo). HHR corre con
  gpt-4o-mini vía `assistant_config.model` (admin-only).
- Primeras reglas candidatas del informe del agregador (lunes 9h) para aprobar +
  pasar el replay gate.

---

## 5 · GOTCHAS TÉCNICOS (no re-aprender)
- **EasyPanel bloquea runners GitHub** → deploy manual por panel fijando el SHA.
- **Portal/demo por raw (sin deploy), backend por Docker (con deploy).**
- **/api/voices** normaliza sin `language` → filtrar por `provider`.
- **Telnyx entrega PCMA (A-law)** — el códec se lee del evento start (asumir mulaw
  destrozaba el STT).
- **Estado en memoria = se borra en cada deploy** (agendas, tokens admin, cupos en
  runtime). Todo lo importante rehidrata/persiste; sospechar de esto ante
  "funcionaba y ya no".
- **assistant_config vs automation_config**: servicios/horario del portal regeneran
  serviceList (fuente única). `organizations` NO tiene columna `sector` (vive en
  automation_config.config).
- **Bash del harness pierde el cwd** entre llamadas a veces: `cd` explícito.
- **El .env local NO tiene AZURE keys** (solo EasyPanel) — de ahí la duda del punto 3.

---

## 6 · Estado de las TAREAS del harness (al cerrar)
Completadas hoy: #5 bucle mejora, #6 presupuesto, #7 horarios, #8 copiloto, #12
Cartesia, #13 cupo+packs. En curso/pendiente: #9 billing add-ons (env EasyPanel),
#10 plantillas WhatsApp Meta, #11 Fase 2 WhatsApp (frontend, espera Meta), #3 audio
portal (GO locución), #4 Telnyx Llámame.
