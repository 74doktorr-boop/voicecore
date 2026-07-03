# HANDOFF — Sesión de hardening 2026-07-03 (madrugada→mañana)

> Documento de traspaso EXACTO. La próxima sesión (Claude o humano) arranca
> leyendo: (1) la memoria persistente, (2) este doc, (3) el plan
> `2026-07-03-camino-a-produccion.md`. Todo lo de abajo está desplegado en
> producción salvo lo marcado ABIERTO.

## Estado del producto (medido)

- **~35 causas raíz cerradas** esta sesión, cada una con test de regresión.
  **614+ tests en verde** en cada push.
- Nota Release Authority: **62/100 — beta con pilotos supervisados.**
  Camino a 80 en el plan (racha 7 días score>85, WA E2E, monitor uptime, host).
- El sistema **se explica solo**: cada llamada persiste en `nf_calls` con
  transcript, confianza STT por turno, tools con entrada/salida, proveedor
  LLM (A/B), score determinista (`metrics.quality`) y **auditoría IA**
  (`metrics.audit`) + alerta email al fundador si sale mala.

## ABIERTO ahora mismo (primer punto de la próxima sesión)

**Botón "Llámame": Telnyx acepta la llamada (UI "Te estamos llamando") pero
el móvil NO suena.** Progresión ya resuelta: API key ✓ → APP_ID ✓ → Outbound
Voice Profile "Default" asignado ✓ → E.164 normalizado ✓. La llamada se crea
pero el leg muere en Telnyx (no llega fila outbound a nf_calls = su webhook
nunca disparó). Diagnóstico pendiente EN TELNYX: portal → Reporting →
Debugging / Call Events de esa franja. Sospechosos por orden:
1. El perfil "Default" sin España en destinos permitidos.
2. Cuenta Telnyx pendiente de verificación (Level 2) para salientes.
3. El número +34843700849 sin capacidad outbound voice.
Unai tiene acceso al portal Telnyx; la key API nueva SOLO está en EasyPanel
(la local del .env está muerta — 401, no rotada en local).

## Validaciones pendientes de Unai (desbloquean cierres)

1. **Ctrl+Shift+R una última vez** en el portal → recibe la
   auto-actualización (bootId) y nunca más verá versiones viejas.
2. Voces: play en varias (Estándar Azure vs Premium ElevenLabs — 12+6 reales).
3. Modo recados: Asistente→Básico→selector→Guardar→llamar pidiendo info.
   Esperado: sin citas, sin emails prometidos, lead por email, cuelga solo.
4. Tarea #7 se cierra con esa llamada; #9 con la oreja.

## Cola de tareas (TaskList del harness, también válida aquí)

- **#8 Editor único de servicios** ← SIGUIENTE (diseño: una tabla
  nombre·precio·duración·[plazas futuro] que alimenta prompt+tools+scheduler;
  muere el texto libre y la dualidad Asistente/Configuración).
- #6 Landing: add-ons (WA propio +15€, voz Premium +10€, minutos 0,10€) +
  SEO marca (Bing/IndexNow, títulos "NodeFlow — Recepcionista IA").
- #10 Audio de llamadas en portal — BLOQUEADA en decisión de Unai:
  locución "llamada grabada" (AEPD). El análisis IA ya está en el modal.
- Fase billing: gating Stripe del +10€ voz premium y del add-on Crecimiento
  39€. Runner de migraciones automático (DATABASE_URL) apuntado Fase 2.
- A/B Llama vs gpt-4o-mini: HHR corre con `openai/gpt-4o-mini` (assistant_config.model,
  admin-only). Juez: metrics.turns[].llmProvider + audit.score. Veredicto con ≥20 llamadas/brazo.

## Decisiones de negocio tomadas HOY por Unai

- Tiers de voz: **Estándar=Azure incluida · Premium=ElevenLabs +10€/mes ·
  Ultra=Cartesia "próximamente"** (key Cartesia muerta; no se muestra hasta
  activar cuenta). COGS voz: Azure ~0,014€/min vs Eleven ~0,08 → margen ~85%.
- Overage voz: automático 0,10€/min (sin botón de compra — comunicado en Facturación).

## Cómo se trabaja aquí (normas vivas — también en memoria persistente)

1. **Evidencia → causa raíz → cambio mínimo → test → deploy vigilado →
   validación en prod.** Prohibido: "creo que", cambiar modelo/prompt sin
   datos, varios cambios por commit.
2. Formato de bug: Síntoma/Reproducción/Causa/Evidencia/Instrumentación/
   Cambio/Riesgos/Validación.
3. **Instrumentar antes de arreglar** si falta visibilidad.
4. Reglas de negocio deterministas fuera del LLM (candados server-side:
   regla de oro citas, confirmed_with_customer, modo contacto sin tools de citas).
5. UI del portal: verificar EN PREVIEW antes de desplegar (mock-server en el
   scratchpad de sesión; launch config `portal-mock-8378`; SIEMPRE purgar SW
   en el preview). El mock se recrea si no existe (sirve public/ + stubs).
6. Deploy = push a master → Actions → EasyPanel. **Vigilar SIEMPRE en
   background con auto-retry** (EasyPanel se cae). La ventana tranquila del
   CI espera a activeCalls=0. **Tras cada deploy: re-armar captura de audio**
   (POST /api/admin/stt-debug {enabled:true}; token admin caduca con cada
   reinicio → re-login con DASHBOARD_PASSWORD, guardado en /tmp/nf_admin_token).
7. Commits con mensaje largo: SIEMPRE `git commit -F archivo` (las comillas
   rompen los here-strings de PowerShell 5.1).
8. Migraciones BD: yo escribo `db/*.sql` idempotente, Unai pega en Supabase,
   yo verifico contra prod (REST con SUPABASE_SERVICE_KEY del .env local —
   ES el proyecto de producción).
9. Diagnóstico self-service: nf_calls (transcript/metrics/audit),
   /api/calls/history (x-api-key), admin auth POST /api/admin/auth.
   Banco de pruebas STT: TTS→ulaw→Deepgram (bake-off).

## Gotchas descubiertos hoy (no re-aprender)

- Telnyx entrega PCMA (A-law) — el códec se lee del evento start; asumir
  mulaw destrozaba el STT (causa raíz de la "mudez").
- Estado en memoria = se borra en cada deploy (agendas, tokens admin,
  historial). Todo lo importante ya rehidrata/persiste; sospechar SIEMPRE
  de esto ante "funcionaba y ya no".
- assistant_config vs automation_config: servicios/horario del portal
  regeneran serviceList (fuente única); el número asignado: pool/BD, no memoria.
- ElevenLabs premade IDs verificados uno a uno antes de entrar al catálogo.
- Bash del harness pierde el cwd entre llamadas a veces: `cd` explícito
  al repo en cada comando compuesto.
- El .env local NO tiene la TELNYX_API_KEY nueva ni AZURE keys (solo EasyPanel).
