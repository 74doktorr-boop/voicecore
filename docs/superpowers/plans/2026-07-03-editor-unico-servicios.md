# Editor único de servicios — Implementation Plan (#8)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Una sola fuente de verdad de servicios (`automation_config.config.serviceList`, la tabla nombre·precio·duración·detalle) que alimenta prompt+tools+scheduler; muere el texto libre y la dualidad Asistente/Configuración.

**Architecture:** La tabla estructurada ya existe (editor en Configuración, `PATCH /api/portal/config`) y ya alimenta tools (executor via session) y scheduler (normalizeServices) — pero (1) guardar la pestaña Asistente la MACHACA regenerándola desde texto libre, (2) guardar la tabla NO sincroniza scheduler ni invalida el asistente cacheado, y (3) el prompt base sigue emitiendo el texto libre (`SERVICIOS:` + `sd.servicios` de sector) en paralelo al bloque estructurado que inyecta voice-pipeline → contradicciones. El plan: helpers testeados en org-config.js (siembra única + sync de runtime), rutas que los usan, prompt base que prefiere la lista estructurada y suprime duplicados, y portal sin textareas de servicios en Asistente.

**Tech Stack:** Node (CommonJS), `node --test`, Supabase (org rows), portal vanilla JS (public/portal/portal.js). Sin dependencias nuevas.

**Reglas de la casa aplicables:** commit por cambio con `git add` de rutas EXPLÍCITAS (hay WIP ajeno sin commitear en el working tree — no arrastrarlo); mensajes largos con `git commit -F archivo`; UI verificada en preview con mock (launch `portal-mock-8378`, purgar SW); deploy = push a master vigilado en background + re-armar stt-debug.

---

### Task 1: Helpers en org-config.js — `seedServiceListFromText` + `syncOrgRuntime`

**Files:**
- Modify: `src/scheduling/org-config.js` (añadir 2 funciones + exports)
- Test: `test/org-config.test.js` (añadir describe al final)

- [x] **Step 1: Escribir los tests que fallan**

Añadir al final de `test/org-config.test.js` (antes ajustar el require de la línea 13-16 para importar también `seedServiceListFromText` y `syncOrgRuntime`):

```js
describe('seedServiceListFromText — la tabla manda, el texto solo siembra', () => {
  const tabla = [{ name: 'Corte de pelo', price: '15€', duration: '30 min' }];

  test('con tabla existente devuelve null (JAMÁS machacar la edición del dueño)', () => {
    assert.strictEqual(seedServiceListFromText(tabla, 'Mechas 60€ 120 min'), null);
  });

  test('con tabla vacía y texto legacy, siembra la lista parseada', () => {
    const out = seedServiceListFromText([], 'Corte 15€ 30 min\nTinte 45€');
    assert.strictEqual(out.length, 2);
    assert.strictEqual(out[0].price, '15€');
  });

  test('sin tabla y sin texto aprovechable devuelve null', () => {
    assert.strictEqual(seedServiceListFromText(undefined, '   '), null);
    assert.strictEqual(seedServiceListFromText(null, ''), null);
  });
});

describe('syncOrgRuntime — guardar la tabla refresca scheduler y asistente', () => {
  test('setBusinessConfig recibe la config traducida y el asistente se invalida', async () => {
    const calls = { sched: null, invalidated: null };
    const fakeDb = {
      enabled: true,
      client: { from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: HHR }) }) }) }) },
    };
    const fakeScheduler = { setBusinessConfig: (id, cfg) => { calls.sched = { id, cfg }; } };
    const ok = await syncOrgRuntime(HHR.id, {
      db: fakeDb, scheduler: fakeScheduler,
      invalidate: (id) => { calls.invalidated = id; },
    });
    assert.strictEqual(ok, true);
    assert.strictEqual(calls.sched.id, HHR.id);
    assert.strictEqual(calls.sched.cfg.services.length, 3); // sale del serviceList
    assert.strictEqual(calls.invalidated, HHR.id);
  });

  test('org inexistente devuelve false y no toca nada', async () => {
    const fakeDb = {
      enabled: true,
      client: { from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: null }) }) }) }) },
    };
    const ok = await syncOrgRuntime('no-existe', {
      db: fakeDb,
      scheduler: { setBusinessConfig: () => { throw new Error('no debía llamarse'); } },
      invalidate: () => { throw new Error('no debía llamarse'); },
    });
    assert.strictEqual(ok, false);
  });
});
```

- [x] **Step 2: Verificar que fallan**

Run: `cd C:\Users\unais\.gemini\antigravity\scratch\voicecore; node --test test/org-config.test.js`
Expected: FAIL — `seedServiceListFromText is not a function` (o ReferenceError).

- [x] **Step 3: Implementación mínima**

En `src/scheduling/org-config.js`, después de `parseServicesText` (línea ~142):

```js
/**
 * Siembra ÚNICA: texto libre legacy → serviceList SOLO si la tabla está
 * vacía. La tabla estructurada es LA fuente de verdad (#8, 2026-07-03):
 * guardar la pestaña Asistente regeneraba serviceList desde el textarea y
 * pisaba lo que el dueño había editado en la tabla de Configuración.
 * @returns {Array|null} lista a escribir, o null = no tocar nada
 */
function seedServiceListFromText(existingList, text) {
  if (Array.isArray(existingList) && existingList.length > 0) return null;
  const parsed = parseServicesText(text);
  return (parsed && parsed.length) ? parsed : null;
}

/**
 * Tras CUALQUIER guardado de config en el portal: re-hidrata la agenda del
 * scheduler y invalida el asistente cacheado. Antes solo lo hacía
 * PUT /assistant — guardar la TABLA de servicios (PATCH /config) no
 * refrescaba las duraciones hasta el siguiente deploy.
 * @returns {Promise<boolean>} true si la org existía y se sincronizó
 */
async function syncOrgRuntime(businessId, deps = {}) {
  const db = deps.db || require('../db/database').getDatabase();
  const scheduler = deps.scheduler || require('./scheduler').scheduler;
  const invalidate = deps.invalidate || require('../assistants/org-assistant').invalidateOrgAssistant;
  if (!db.enabled) return false;
  const { data: org } = await db.client
    .from('organizations').select('id, name, assistant_config, automation_config')
    .eq('id', businessId).single();
  if (!org) return false;
  scheduler.setBusinessConfig(businessId, toSchedulerConfig(org));
  invalidate(businessId);
  return true;
}
```

Y añadir ambas al `module.exports` de la última línea.

- [x] **Step 4: Verificar que pasan**

Run: `node --test test/org-config.test.js`
Expected: PASS (todos, incluidos los preexistentes).

- [x] **Step 5: Commit**

```bash
git add src/scheduling/org-config.js test/org-config.test.js
git commit -F <archivo-mensaje>   # "feat(servicios): siembra única + sync de runtime — la tabla estructurada manda"
```

---

### Task 2: `PUT /api/portal/assistant` deja de machacar la tabla

**Files:**
- Modify: `src/api/routes-portal.js:1398-1434`

- [x] **Step 1: Reemplazar el bloque de regeneración (1398-1418)**

Sustituir el bloque `if (safe.services !== undefined) { ... }` por:

```js
      // UNA sola verdad de servicios (#8): la tabla estructurada
      // (automation_config.serviceList) manda. El texto libre legacy solo
      // SIEMBRA la tabla si aún no existe; jamás la pisa (antes, guardar la
      // pestaña Asistente regeneraba la lista desde el textarea y machacaba
      // los servicios editados en la tabla de Configuración).
      if (safe.services !== undefined) {
        try {
          const { seedServiceListFromText } = require('../scheduling/org-config');
          const { data: orgAuto } = await db.client
            .from('organizations').select('automation_config').eq('id', businessId).single();
          const auto = orgAuto?.automation_config || {};
          const seeded = seedServiceListFromText(auto.config?.serviceList, safe.services);
          if (seeded) {
            auto.config = { ...(auto.config || {}), serviceList: seeded };
            await db.client.from('organizations')
              .update({ automation_config: auto }).eq('id', businessId);
            log.info(`Portal: serviceList SEMBRADO desde texto legacy (${seeded.length} servicios) para ${businessId}`);
          }
        } catch (e) {
          log.error(`Portal: siembra de serviceList falló: ${e.message}`);
        }
      }
```

- [x] **Step 2: Reemplazar el sync inline (1420-1434) por el helper**

Sustituir los DOS bloques try (scheduler sync + invalidateOrgAssistant) por:

```js
      // Scheduler + asistente cacheado en sync — vía helper canónico.
      try {
        const { syncOrgRuntime } = require('../scheduling/org-config');
        await syncOrgRuntime(businessId);
      } catch (_) { /* runtime sync no es crítico para responder */ }
```

- [x] **Step 3: Suite completa en verde**

Run: `npm test`
Expected: PASS (614+).

- [x] **Step 4: Commit**

```bash
git add src/api/routes-portal.js
git commit -F <archivo-mensaje>   # "fix(portal): guardar Asistente ya no pisa la tabla de servicios"
```

---

### Task 3: `PATCH /api/portal/config` sincroniza scheduler + asistente

**Files:**
- Modify: `src/api/routes-portal.js:838-841` (tras el guardado en BD, antes del `res.json`)

- [x] **Step 1: Añadir la llamada al helper**

Después del bloque `if (db.enabled) { ... }` (línea 838) y antes de `const custom = ...`:

```js
    // La tabla de servicios/horario editada aquí debe llegar YA al scheduler
    // (duraciones → huecos) y al prompt (asistente cacheado 60s). Antes esta
    // ruta no sincronizaba nada y los cambios no regían hasta el reinicio.
    try {
      const { syncOrgRuntime } = require('../scheduling/org-config');
      await syncOrgRuntime(businessId);
    } catch (_) { /* no crítico */ }
```

- [x] **Step 2: Suite en verde**

Run: `npm test`
Expected: PASS.

- [x] **Step 3: Commit**

```bash
git add src/api/routes-portal.js
git commit -F <archivo-mensaje>   # "fix(portal): la tabla de servicios rige al instante (scheduler+prompt)"
```

---

### Task 4: El prompt base usa la tabla y suprime el texto libre duplicado

**Files:**
- Modify: `src/assistants/org-assistant.js:57-65`
- Modify: `src/assistants/prompt-generator.js` (sectorBlock + generatePrompt)
- Modify: `src/core/voice-pipeline.js:147-149` (dedupe)
- Test: `test/prompt-services.test.js` (nuevo)

- [x] **Step 1: Test que falla**

Crear `test/prompt-services.test.js`:

```js
// ============================================================
// NodeFlow — #8 Editor único: el prompt dice los servicios de la TABLA
// y calla el texto libre legacy cuando la tabla existe (antes convivían
// "SERVICIOS: solo corte" + sd.servicios de sector + bloque estructurado
// inyectado por voice-pipeline → tres verdades contradictorias).
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { generatePrompt } = require('../src/assistants/prompt-generator');

const LIST = [
  { name: 'Corte de pelo', price: '15€', duration: '30 min', notes: '' },
  { name: 'Mechas', price: '60€', duration: '120 min', notes: '' },
];

describe('generatePrompt con serviceList (tabla estructurada)', () => {
  const cfg = {
    sector: 'peluqueria',
    services: 'solo corte de pelo',                 // texto libre legacy
    sectorData: { servicios: 'Corte 12€ (VIEJO)' }, // duplicado legacy de sector
    serviceList: LIST,
  };
  const prompt = generatePrompt(cfg, 'Peluquería HHR');

  test('incluye el bloque estructurado con los datos exactos', () => {
    assert.match(prompt, /SERVICIOS Y PRECIOS \(datos EXACTOS/);
    assert.match(prompt, /Corte de pelo: 15€ \(30 min\)/);
  });

  test('NO emite el texto libre legacy ni el duplicado de sector', () => {
    assert.doesNotMatch(prompt, /SERVICIOS: solo corte de pelo/);
    assert.doesNotMatch(prompt, /VIEJO/);
  });
});

describe('generatePrompt SIN serviceList (org legacy sin tabla)', () => {
  const prompt = generatePrompt(
    { sector: 'peluqueria', services: 'solo corte', sectorData: { servicios: 'Corte 12€' } },
    'Legacy SL'
  );

  test('conserva el comportamiento anterior (texto libre visible)', () => {
    assert.match(prompt, /SERVICIOS Y PRECIOS:\nCorte 12€/);
  });
});
```

- [x] **Step 2: Verificar que falla**

Run: `node --test test/prompt-services.test.js`
Expected: FAIL en "NO emite el texto libre…" (hoy el prompt emite el bloque de sector aunque haya serviceList).

- [x] **Step 3: prompt-generator — suprimir duplicados**

En `sectorBlock`, cambiar la firma a `function sectorBlock(sector, sectorData = {}, hasStructuredServices = false)` y en los DOS casos que emiten precios en texto libre (peluqueria línea ~68 y podologia línea ~96):

```js
    case 'peluqueria': {
      // Con tabla estructurada, este texto legacy calla (#8): era la 2ª verdad.
      return (!hasStructuredServices && sectorData.servicios)
        ? `SERVICIOS Y PRECIOS:\n${sectorData.servicios}`
        : '';
    }
```

```js
    case 'podologia': {
      return (!hasStructuredServices && sectorData.servicios) ? `SERVICIOS Y PRECIOS:\n${sectorData.servicios}` : '';
    }
```

En `generatePrompt` (línea ~203):

```js
  const sectorStr     = sectorBlock(sector, config.sectorData || {}, !!serviceListStr);
```

(La línea 223 ya prefiere `serviceListStr` sobre `SERVICIOS: ${services}` — no tocar.)

- [x] **Step 4: org-assistant — cargar la tabla en el prompt base**

En `getOrgAssistant`, ampliar el select y pasar la lista:

```js
      .select('id, name, language, assistant_config, automation_config, is_active')
```

y tras `const cfg = org.assistant_config || {};`:

```js
    // La tabla estructurada entra al prompt base (#8). voice-pipeline sigue
    // inyectando la versión fresca de BD como red — con dedupe.
    const structuredList = org.automation_config?.config?.serviceList;
    const cfgConLista = (Array.isArray(structuredList) && structuredList.length)
      ? { ...cfg, serviceList: structuredList }
      : cfg;
```

y usar `cfgConLista` en `generatePrompt(cfgConLista, org.name)` (el resto sigue leyendo `cfg`).

- [x] **Step 5: voice-pipeline — no duplicar el bloque**

En `src/core/voice-pipeline.js` línea ~149, condicionar el append:

```js
            if (priceBlock && !sys.content.includes('SERVICIOS Y PRECIOS (datos EXACTOS')) { sys.content += '\n\n' + priceBlock; log.info(`[${callId}] Precios estructurados inyectados (org ${orgId})`); }
```

- [x] **Step 6: Tests en verde**

Run: `node --test test/prompt-services.test.js` → PASS. Después `npm test` → PASS completo.

- [x] **Step 7: Commit**

```bash
git add src/assistants/prompt-generator.js src/assistants/org-assistant.js src/core/voice-pipeline.js test/prompt-services.test.js
git commit -F <archivo-mensaje>   # "feat(prompt): la tabla de servicios entra al prompt base y calla el texto libre"
```

---

### Task 5: Portal — muere el texto libre de servicios en Asistente

**Files:**
- Modify: `public/portal/portal.js` (renderAsisSectorFields, collectAsisConfig, llamada en render)

- [x] **Step 1: renderAsisSectorFields sin textareas de servicios**

1. Línea ~3036: `renderAsisSectorFields(c.sector || 'generico', c.sectorData || {});` (quitar el 3er argumento `c.services`).
2. Firma línea ~3091: `function renderAsisSectorFields(sector, sd) {` .
3. Eliminar la línea ~3097: `html += _ta('asis-services', 'Servicios generales', services, 3, '…');` — el banner con el CTA "Gestionar servicios y precios →" ya está encima y se queda.
4. Rama `peluqueria || podologia` (~3111-3112): eliminar el `_ta('sd-servicios', …)`; dejar la rama vacía (solo el banner).
5. Rama genérica final (~3190-3192): eliminar el `_ta('sd-servicios', …)`; dejar el fallback sin campo de servicios.
6. NO tocar farmacia/hotel/taller (`sd-servicios` allí es "servicios adicionales/incluidos", contexto sin precios).

- [x] **Step 2: collectAsisConfig deja de enviar texto libre**

1. Eliminar línea ~3223: `c.services = get('asis-services') || '';`
2. Rama `peluqueria || podologia` (~3254-3255): eliminar `sd.servicios = get('sd-servicios');` (dejar rama vacía: `sd = {}` ya lo cubre — eliminar el else-if entero).
3. Rama else genérica (~3313-3316): eliminar la lectura de `sd-servicios` (dejar el else sin cuerpo o quitarlo).

- [x] **Step 3: Suite en verde (el backend tolera la ausencia de `services`)**

Run: `npm test`
Expected: PASS — `safe.services === undefined` simplemente salta la siembra.

- [x] **Step 4: Commit**

```bash
git add public/portal/portal.js
git commit -F <archivo-mensaje>   # "feat(portal): editor único — Asistente sin textareas de servicios"
```

---

### Task 6: Verificación en preview (norma #5)

- [x] **Step 1: Mock + preview**

Arrancar el mock del portal (se recrea si no existe; sirve `public/` + stubs) con la launch config `portal-mock-8378`. Purgar el Service Worker en el preview SIEMPRE.

- [x] **Step 2: Comprobar en el preview**

1. Pestaña **Asistente**: ya no hay textarea "Servicios generales" ni "Servicios y precios" (peluquería); el banner CTA → Configuración sigue.
2. Pestaña **Configuración**: la tabla de servicios renderiza y `saveConfig()` envía `serviceList` (ver preview_network).
3. Guardar Asistente: el payload del PUT ya no lleva `services` (preview_network).
4. Sin errores en consola (preview_console_logs).

- [x] **Step 3: Captura de prueba**

`preview_screenshot` de ambas pestañas como evidencia.

> **Resultado real (2026-07-04, mock en :8379):** verificación por DOM + log del mock, más fuerte que píxeles: (1) Asistente/Contenido sin NINGÚN textarea (622 chars = solo banner+CTA); (2) tabla de Configuración renderiza los 2 servicios exactos del mock; (3) `PUT /assistant` SIN clave `services` y `sectorData:{}`; (4) `PATCH /config` CON `serviceList` completo; (5) 0 errores de consola. Captura de Asistente/Básico obtenida; el resto de screenshots se colgaron (renderer del preview inestable), la evidencia DOM queda arriba.

---

### Task 7: Deploy vigilado (norma #6)

> **Estado (2026-07-04):** PENDIENTE. El push fue denegado por el clasificador
> de permisos (deploy a producción sin instrucción explícita de Unai en la
> sesión). Los 5 commits de #8 están en master LOCAL, por delante de origin.
> Al retomar con GO de Unai: `git push` y seguir los steps 2-4.
> bootId de prod antes del intento: 1783111945699.

- [ ] **Step 1: Push a master** — `git push` → GitHub Actions → EasyPanel.
- [ ] **Step 2: Vigilar el deploy EN BACKGROUND con auto-retry** (EasyPanel se cae; ventana tranquila espera activeCalls=0).
- [ ] **Step 3: Re-armar captura de audio**: re-login admin con DASHBOARD_PASSWORD → `POST /api/admin/stt-debug {enabled:true}` (token en /tmp/nf_admin_token).
- [ ] **Step 4: Validación en prod**: GET /api/portal/config de HHR conserva su serviceList; guardar la pestaña Asistente de HHR y verificar que serviceList NO cambió en BD (REST con SUPABASE_SERVICE_KEY del .env local).

---

## Self-review

- **Cobertura**: (a) machaque de la tabla → Task 2; (b) sync scheduler/asistente al guardar la tabla → Tasks 1+3; (c) triple verdad en el prompt → Task 4; (d) muerte del texto libre en UI → Task 5; verificación → Tasks 6-7. "Plazas" queda explícitamente FUERA (futuro, YAGNI — el diseño de capacidad es Fase 2 del plan maestro y toca el núcleo del scheduler).
- **Sin placeholders**: cada step lleva código o comando concreto.
- **Consistencia de tipos**: `seedServiceListFromText(existingList, text) → Array|null`; `syncOrgRuntime(businessId, deps) → Promise<boolean>`; `sectorBlock(sector, sectorData, hasStructuredServices)` — usados igual en tests y rutas.
- **Riesgo conocido**: orgs legacy con solo texto libre siguen viéndolo en el prompt (rama sin tabla intacta) y la siembra los migra en su próximo guardado. Nada se borra de BD.
