# HANDOFF — Product Bible + Design System + Escalabilidad por sector (2026-07-05)

> Traspaso EXACTO para retomar desde otra ventana sin perder nada. Todo
> commiteado y pusheado. `HEAD = b06aa3b`, `master == origin/master`,
> **815 tests en verde**.

## Cómo retomar (frase para la sesión nueva)
> "Continúa donde lo dejamos — lee el handoff del 5 de julio (sistema y escalabilidad)."
> Carga memoria persistente + este doc + los 3 documentos canónicos de abajo.

---

## 0 · LO PRIMERO QUE HAY QUE LEER (documentos que MANDAN)

1. **`NODEFLOW_PRODUCT_BIBLE.md`** (raíz) — **CANÓNICO.** Toda decisión futura de
   producto/diseño/IA/ingeniería/copy debe respetarlo. Visión, misión, valores,
   filosofía de diseño, principios UX/IA/simplicidad/automatización/accesibilidad,
   nomenclatura, consistencia y "qué NUNCA hacer". Si algo choca con la Biblia, o
   se cambia la decisión o se enmienda la Biblia con motivo — nunca se ignora.
2. **`DESIGN-SYSTEM.md`** (raíz) — spec del design system "Electric Night" v2.0.
   La implementación vive en `public/portal/nf-design-system.css`.
3. **`docs/NODEFLOW-VISION.md`** — visión por features (ritual CPO: al terminar
   cada feature, 9 preguntas + capturar oportunidades, nunca bugs).
4. Memoria persistente (se carga sola): charter de ingeniería, product bible,
   estado de hardening, etc.

---

## 1 · CÓMO SE TRABAJA AQUÍ (normas vivas — respétalas)

1. **Evidencia → causa raíz → cambio mínimo → test → verificación real.** Prohibido
   "creo que". Nada de cambiar modelo/prompt/diseño sin datos.
2. **TDD siempre.** Test que falla → implementación mínima → verde. `npm test`
   (node --test). Hoy **815 tests**. El error `no auth` de smoke.test.js PASA.
3. **Reglas de negocio DETERMINISTAS fuera del LLM** (candados server-side). La
   dicción, cupos, fichaje de leads, degradación de voz, etc. no dependen del LLM.
4. **Honestidad radical (Biblia).** Cero claims falsos; el asistente nunca promete
   lo que no cumple; nunca diagnóstico/terapia/asesoramiento por teléfono. Y **nunca
   cantar un "hecho" que no se puede probar** — si migras media app, dilo.
5. **Commits con `git add` de rutas EXPLÍCITAS.** Hay **WIP ajeno sin commitear**
   en el árbol (`.claude/launch.json`, `docs/RUNBOOK.md`, `docs/owner/whatsapp-setup.md`,
   `public/index.html`, `src/automations/flow-manager.js`, `src/integrations/recipes/organizate.json`,
   `src/referrals/referrals.js`, `config/osakin/`) — **NO lo arrastres.** Firma:
   `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
6. **Verificar UI en PREVIEW antes de dar por hecho.** Mock `preview_start
   portal-mock-8379` (sirve public/). Para screenshots que se atascan por
   animaciones infinitas: congelar con `*{animation:none}`. El admin/portal tienen
   pestañas ocultas (display:none): aislar el HTML renderizado en un host visible.
   Para un design system, la prueba rigurosa es **estilos computados**, no la foto.
7. **Skill de diseño:** para trabajo de UI/design-system se usa la skill
   `impeccable` (registro `product`, identidad Electric Night). No reinventar la
   marca: extender el sistema.

### Deploy — la CI YA despliega sola (gotcha del handoff viejo SUPERADO)
- `git push` a master → workflow `deploy.yml` construye imagen (`:latest` +
  `:<sha>`) en GHCR **y dispara el deploy en EasyPanel** con reintentos
  resilientes. Los runs recientes salen `success` y prod muestra los cambios →
  **el auto-deploy funciona; ya NO hace falta deploy manual** salvo que la CI falle.
- El reinicio recoge las env vars nuevas. Vigilar: `curl https://nodeflow.es/health`
  → `bootId` cambia con cada deploy. Tras deploy: **re-armar stt-debug** (login
  admin con `DASHBOARD_PASSWORD` del .env → `POST /api/admin/stt-debug {enabled:true}`).
- **Portal/demo (public/) van por GitHub RAW** → live en ~1-2 min sin deploy. El
  **backend (src/) necesita el deploy** (que ahora es automático por push).
- `.env` local = credenciales de PRODUCCIÓN (Supabase service key, Stripe LIVE,
  ElevenLabs/Cartesia, DASHBOARD_PASSWORD). En prod van en EasyPanel.
- **Migraciones**: `db/migration-*.sql`, se ejecutan a mano en Supabase → SQL
  Editor. `nf_sectors` YA ejecutada (Unai, success). Todo fail-open sin ella.

---

## 2 · SISTEMAS CONSTRUIDOS ESTA SESIÓN (el "cómo" del producto)

### A · Sistema de voz — overhaul + Azure fuera + previews instantáneas
- **Bug "todas las incluidas suenan igual"** resuelto: Azure no estaba configurado
  y colapsaba las voces. **AZURE ELIMINADO por completo** (motor, router, config).
- Catálogo (`config/voices.json`): **6 Cartesia (incluidas) + 12 ElevenLabs nuevas
  (premium) + 2 euskera local**. `voice-map` deriva del catálogo (fuente única).
- **Filtro de honestidad**: `/api/voices` solo ofrece voces cuyo proveedor está
  ACTIVO — deriva del **router ya construido** (`config.ttsRouter.providers`), NO
  de `config.*` (que no arrastra las keys). GOTCHA importante.
- **Rediseño del selector** (incita a escuchar/comprar) + **previews instantáneas**
  (muestras pre-generadas, `scripts/generate-voice-samples.js`) + **Premium con
  candado** visible aunque no se pueda usar.

### B · Bucle de mejora SECTOR-AWARE (el corazón de la adaptación)
Cada llamada se juzga/agrupa/mejora/mide con la lógica de SU vertical, sin
contaminar a otros. Piezas (`src/sectors/`, `src/lifecycle/`):
- **`sector-registry.js`** — fuente única por sector: `normas[]`, `metricChecks[]`,
  `requiredFields`. 32 sectores curados A FONDO (salud sin diagnóstico, legal/psico
  confidencial, etc.). Ahora es **DATO** (semilla + custom en caliente),
  `resolveSector` síncrono. `defaultModeFor` (citas/contacto).
- **`call-auditor.js`** recibe el sector → juzga con su rúbrica y ESTAMPA
  `audit.sector`. Propagado org-assistant → call-session → auditor.
- **`improvement-aggregator.js`** agrupa `bySector`; informe del fundador POR SECTOR.
- **`replay-gate.js`** valida reglas contra llamadas de ESE sector.
- **KPIs por sector** en admin (`kpis.bySector`, tarjeta "Salud por sector").
- Regla aprendida ya aplicada (evidencia real): quitado del prompt el "el equipo
  te llamará muy pronto" (causaba la "alucinación" que marcaba el auditor).

### C · Escalabilidad a CUALQUIER sector sin trabajo por cliente
Coste marginal de un vertical nuevo ≈ 0:
- **Sectores como DATO** + tabla `nf_sectors` (`sector-store.js`, hidratación en
  boot, fail-open).
- **Auto-borrador** (`sector-drafter.js`): un LLM propone normas/métricas/alias de
  un vertical nuevo → **cola de revisión del fundador** (admin) → aprueba →
  activo en caliente + **auto-vincula** las orgs en generico que encajan.
- **Onboarding self-serve** (`onboarding-profiler.js` + `/api/onboarding/profile`):
  el cliente describe su negocio → sector + modo detectados solos (match
  determinista → LLM si hace falta → si nada encaja, borra uno).
- **Admin**: "🆕 Sectores por revisar" (aprobar/descartar) + "➕ Crear un sector"
  (borrador a mano). `/api/sectors` es la fuente única del selector (muertas las
  listas hardcodeadas del front).

### D · Product Bible + Design System v2.0
- **`NODEFLOW_PRODUCT_BIBLE.md`** — canónico (ver §0).
- **Design System "Electric Night" v2.0** (`public/portal/nf-design-system.css`,
  aditivo sobre v1): rellenados skeletons, tablas, charts, chips, select, progress,
  segmented, toasts semánticos; rigor de estados (focus-visible, is-loading,
  is-error); **capa de utilidades `u-*`** para migrar inline mecánicamente. Spec en
  `DESIGN-SYSTEM.md`.

---

## 3 · MIGRACIÓN al Design System — EN CURSO (por superficies, verificada)

- **HECHO: Dashboard** (commit b06aa3b): dashMinutes 16→2 inline (usa `.progress`),
  dashSetup/dashUpcoming a 0, con tokens y utilidades. Verificado en preview.
- **PENDIENTE, en este orden**: Configuración → Asistente → Llamadas/Clientes →
  admin → onboarding → landing. Regla: inline de DECISIÓN (color/espacio/tipo/
  layout) → utilidades/tokens/componentes; lo DINÁMICO (ancho de barra, grid
  templates, dims de skeleton) se queda inline. Verificar cada superficie en preview.

---

## 4 · PENDIENTES ABIERTOS (además de la migración del DS)

- **Osakin** (dental, primer cliente grande, 3 clínicas): el paso "negocio
  concreto" — acordado PARA EL FINAL, tras el producto. Ahora es trivial: `dental`
  curado, el alta detecta su sector, solo meter sus 3 clínicas + especialidades/
  seguros reales. Kit comercial en Desktop/NodeFlow/04-Comercial (ver memoria).
- **WhatsApp Meta**: 4 env vars (`WA_*`) + aprobar 3 plantillas (`node
  scripts/wa-submit-templates.js`) + frontend Embedded Signup (necesita
  `config_id` de la App Meta). Backend listo.
- **Euskera en el selector**: no sale porque su TTS local no está registrado en
  prod (el filtro de honestidad lo oculta bien). Para ofrecerlo: levantar
  `LOCAL_TTS_URL`.
- **Reactivación por WhatsApp/voz** (add-on Crecimiento): hoy solo email; mismo
  candado growth; WA necesita plantilla aprobada.
- **Veredicto A/B** Llama vs gpt-4o-mini (≥20 llamadas/brazo).
- **Reset mensual de `premiumExtraMinutes`**: decidido "persisten hasta gastarse"
  y aplicado (depletePackOnReset); vigilar en el 1º de mes real.

---

## 5 · GOTCHAS TÉCNICOS (no re-aprender)

- **CI auto-deploy funciona** — no hace falta panel salvo que falle.
- **/api/voices** deriva proveedores del ROUTER, no de config.* (config no
  arrastra cartesiaApiKey/localTtsUrl → si lo lees de ahí, ocultas Cartesia).
- **Auditor marca la promesa falsa como "alucinación"** — no es fabricación de
  datos; es el prompt prometiendo de más. Ya corregido.
- **`esc` no es global en admin/index.html** — usar escaper local.
- **Screenshots de preview** se atascan con animaciones infinitas → `*{animation:none}`.
  Contenido en pestañas display:none → aislar en host visible.
- **`nf-design-system.css` es v2** — aditivo, contrato de clases v1 intacto; NO
  añadir inline nuevo en el portal, extender el sistema (Biblia + DESIGN-SYSTEM.md).
- **Estado en memoria muere en cada deploy** (agendas, tokens admin, cupos runtime).
- **assistant_config vs automation_config**: `organizations` NO tiene columna
  `sector` (vive en assistant_config; el auditor lo estampa en `metrics.audit.sector`).
- **Bash del harness pierde el cwd** entre llamadas: `cd` explícito.

---

## 6 · MAPA DE FICHEROS NUEVOS/CLAVE (esta sesión)

```
NODEFLOW_PRODUCT_BIBLE.md         canónico (todo lo respeta)
DESIGN-SYSTEM.md                  spec del design system v2
public/portal/nf-design-system.css  DS v2 (tokens + componentes + utilidades u-*)
src/sectors/sector-registry.js    fuente única de sectores (dato: semilla+custom)
src/sectors/sector-drafter.js     LLM propone un sector nuevo
src/sectors/sector-store.js       persistencia nf_sectors + cola de revisión + autolink
src/sectors/onboarding-profiler.js  detecta sector en el alta (self-serve)
src/lifecycle/{call-auditor,improvement-aggregator,replay-gate}.js  bucle sector-aware
src/analytics/kpis.js             + bySector (KPIs por vertical)
db/migration-sectors.sql          tabla nf_sectors (YA ejecutada)
scripts/generate-voice-samples.js muestras de voz (previews instantáneas)
```

Relacionado en memoria: [[feedback-product-bible]], [[project-design-system]],
[[hardening-estado-2026-07-03]], [[engineering-charter]], [[feedback-nodeflow-vision]],
[[project-osakin-prospect]].
