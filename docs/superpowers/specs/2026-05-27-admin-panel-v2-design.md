# Admin Panel v2 — Diseño
**Fecha:** 2026-05-27  
**Alcance:** Bug fixes, KPI expansion, Clientes actions, Citas fix, Flujos mejoras, Automatizaciones mejoras, tab Llamadas

---

## Bugs críticos

### Bug 1 — MRR incorrecto (`src/api/routes-admin.js:87`)
```js
// ACTUAL (incorrecto)
o.plan === 'pro' ? 49 : o.plan === 'business' ? 99 : 0

// CORRECTO — planes reales son negocio=49€ y pro=99€
o.plan === 'negocio' ? 49 : o.plan === 'pro' ? 99 : 0
```
Afecta también al badge de plan en `loadOrgs()` del frontend, y en `loadFlows()` (`f.plan==='business'`).

### Bug 2 — Selector de citas hardcodeado (`public/admin/index.html`)
El `<select id="citasBusiness">` tiene `demo-clinic` y `lumina-estetica` en HTML estático. Debe cargarse dinámicamente desde `/api/admin/orgs` al hacer clic en el tab Citas.

### Bug 3 — Plan 'business' fantasma en Flujos
`f.plan==='business'?'Pro':...` — el plan `business` no existe en producción. Corrección: `f.plan==='pro'?'Pro 99€':f.plan==='negocio'?'Negocio 49€':'...'`

---

## KPIs — Resumen tab

### Layout actual (6 KPIs, 1 fila)
MRR · Clientes activos · Leads totales · Citas próximas · Reminders · Reseñas

### Layout nuevo (8 KPIs, 2 filas de 4)
```
Fila 1: MRR | ARR | Clientes activos | Conversión %
Fila 2: Leads este mes | Minutos usados | Llamadas hoy | Citas próximas
```

**Cálculos:**
- `ARR` = MRR × 12 (se calcula en frontend con el mismo dato de MRR)
- `Conversión %` = `(activeOrgs / totalLeads × 100).toFixed(1)` — requiere que el backend devuelva `totalLeads` y `activeOrgs` (ya lo hace)
- `Leads este mes` = filtrar `registros` por `created_at >= primer día del mes` — añadir a `/api/admin/stats`
- `Minutos usados` = suma de `monthly_minutes_used` de todos los orgs activos — añadir a `/api/admin/stats`
- `Llamadas hoy` = `GET /api/analytics/dashboard` → `today.calls` — añadir como endpoint con `adminAuth`

### Backend — cambios en `/api/admin/stats`
Añadir al response:
```js
{
  // existentes
  totalLeads, activeLeads, totalOrgs, activeOrgs, mrr,
  // nuevos
  leadsThisMonth,   // registros con created_at >= primer día del mes actual
  totalMinutes,     // suma monthly_minutes_used de orgs activos (ya existe pero arreglar cálculo)
  callsToday,       // analytics.getDashboard().today.calls
}
```

---

## Tab Clientes — mejoras

### Columnas actuales
Negocio · Email · Teléfono · Plan · Minutos · Activo · Desde

### Columnas nuevas
Negocio · Email · Plan · Minutos (con barra) · Activo · Acciones

**Acciones por fila:**
- `🔗 Enviar acceso` → `POST /api/admin/send-magic-link` `{ orgId }` → genera token → `sendMagicLinkEmail` → toast "✓ Enviado a email@..."
- (Teléfono se mueve a tooltip/title del nombre para ahorrar espacio)

**Barra de minutos:** inline en la celda Minutos, mismo estilo que el portal cliente — barra de progreso CSS con color warning si >80%.

**Plan badge fix:** `negocio` → `Negocio 49€`, `pro` → `Pro 99€`

### Nuevo endpoint: `POST /api/admin/send-magic-link`
```
Body: { orgId: string }
Auth: adminAuth
Flow:
  1. Buscar org por id → obtener owner_email
  2. generateMagicToken(owner_email, orgId)
  3. sendMagicLinkEmail(owner_email, token)
  4. return { ok: true, sentTo: owner_email }
```
Archivo: `src/api/routes-admin.js` — añadir después de `/api/admin/orgs/:id`

---

## Tab Citas — fix selector dinámico

Al hacer clic en tab Citas (`switchTab('citas', ...)`), llamar a `/api/admin/orgs` y poblar el `<select id="citasBusiness">` con los orgs activos. Formato de cada option: `value=orgId, text=org.name`.

Si no hay orgs, mostrar mensaje "Sin clientes activos aún".

---

## Tab Flujos — mejoras

### Columnas actuales
Negocio · Plan · Sector · Reminders · Reseñas · Google Place ID · Acciones

### Columnas nuevas
Negocio (con idioma badge) · Plan · Reminders (on/off + horas) · Reseñas (on/off + horas) · WA Confirm (on/off) · Google Place ID · Acciones

**waConfirm toggle:** el `FlowManager` ya tiene `waConfirm.enabled` con `DEFAULTS.waConfirm = { enabled: true }`. El endpoint `POST /api/flows/:id/toggle/waConfirm` existe vía `toggleFlow`. Solo hay que añadirlo en la UI igual que reminders/reseñas.

**Horas en tabla:** mostrar `${f.automations.reminders.hoursBefore}h antes` y `${f.automations.reviews.hoursAfter}h después` junto a cada badge.

---

## Tab Automatizaciones — mejoras

### Historial de ejecuciones
`getCronStats()` ya devuelve `totals.runs`, `totals.reminders`, `totals.reviews`. Añadir a la respuesta de `/api/automations/stats` los `lastRuns[]` — últimas 10 ejecuciones con timestamp + emails enviados.

**Cambio en `src/scheduling/cron.js`:** mantener array `_history[]` (máx 10) que se rellena en cada `runAutomations()`:
```js
_history.unshift({ 
  runAt: new Date().toISOString(), 
  reminders: N, 
  reviews: M 
});
if (_history.length > 10) _history.pop();
```
Exponer en `getCronStats()` → incluir en `/api/automations/stats` response.

**UI:** tabla "Últimas ejecuciones" con columnas: Fecha/hora · Reminders enviados · Reseñas enviadas.

---

## Tab nuevo: Llamadas

### Datos
El `AnalyticsEngine` mantiene `callLog[]` (hasta 1000 llamadas) con:
```js
{ callId, assistantId, callerNumber, direction, duration, turnCount,
  cost, startedAt, endedAt, avgLatency, sentiment, outcome, toolsUsed }
```

### Exponer para admin
Añadir endpoint en `routes-admin.js`:
```
GET /api/admin/calls — adminAuth
Devuelve: analytics.getDashboard() completo
  { realtime, today, thisMonth, recentCalls[] }
```
Necesita importar `getAnalytics` de `../analytics/engine`.

### UI — Tab "📞 Llamadas"
**KPI mini-grid (3 cards):**
- Llamadas hoy · Minutos hoy · Llamadas este mes

**Tabla últimas 50 llamadas:**
| Hora | Duración | Sentimiento | Resultado | Latencia avg | Herramientas |
|------|----------|-------------|-----------|--------------|--------------|
| 14:32 | 2m 14s | 😊 positivo | completada | 820ms | 3 |

**Sentimiento → emoji:** `positive`→😊 `negative`→😔 `neutral`→😐

---

## Spec self-review

**Placeholders:** ninguno — todos los campos y endpoints son concretos.

**Consistencia interna:** 
- `send-magic-link` requiere `generateMagicToken` (exportado desde routes-auth.js ✅) y `sendMagicLinkEmail` (exportado desde email.js ✅)
- `GET /api/admin/calls` usa `getAnalytics()` — disponible globalmente como singleton ✅
- `getCronStats()` ya exportado desde cron.js — solo añadir `lastRuns[]` ✅

**Scope:** todos los cambios son en `public/admin/index.html`, `src/api/routes-admin.js`, `src/api/routes-automations.js`, y `src/scheduling/cron.js`. Ningún cambio en otros módulos salvo imports.

**Ambigüedad resuelta:**
- "Minutos usados" en KPI = suma de todos los orgs activos (no total histórico)
- "Llamadas hoy" = del AnalyticsEngine en memoria (se reinicia con el servidor, suficiente para dashboard)
- Tab Llamadas no incluye transcripciones completas (las calls en memoria no las tienen) — solo metadata

---

## Archivos afectados

| Archivo | Tipo | Cambio |
|---------|------|--------|
| `src/api/routes-admin.js` | Modify | Fix MRR calc, add send-magic-link, add /admin/calls, expand stats |
| `src/scheduling/cron.js` | Modify | Add _history[] tracking to getCronStats |
| `src/api/routes-automations.js` | Modify | Include lastRuns in stats response |
| `public/admin/index.html` | Modify | Todo lo demás: KPIs, tabs, fixes, tab Llamadas |

---

## Prioridad de implementación

1. Bug fixes (MRR, citas selector, plan names) — impacto inmediato
2. Nuevo endpoint send-magic-link + admin/calls
3. KPIs expandidos (requiere backend primero)
4. Tab Clientes con acciones + barras de minutos
5. Tab Flujos waConfirm + horas
6. Tab Automatizaciones historial (requiere cron.js cambio)
7. Tab Llamadas
