# NodeFlow — Unified Lead Scraper Design

**Fecha:** 2026-06-02  
**Estado:** Aprobado

---

## Objetivo

Reemplazar los tres scripts de scraping fragmentados (`find-leads.js`, `find-targets.js`, `scrape-leads.js`) con un único comando que cualquier comercial pueda ejecutar para obtener leads por sector + ciudad, enviándolos automáticamente al Google Sheet compartido.

---

## Arquitectura

### Ficheros

| Fichero | Acción | Responsabilidad |
|---------|--------|-----------------|
| `scripts/buscar-leads.js` | ✨ Crear | Punto de entrada único — CLI, orquestación |
| `src/utils/leads-utils.js` | ✨ Crear | WA templates, dedup, CSV writer, push al Sheet |
| `scripts/scrape-leads.js` | ✏️ Mantener | PA scraper — llamado internamente por buscar-leads.js |
| `scripts/sheets-appscript.gs` | ✅ Sin cambios | Ya desplegado, URL en `.env` |
| `scripts/find-leads.js` | 🗑️ Eliminar | Reemplazado |
| `scripts/find-targets.js` | 🗑️ Eliminar | Roto (import faltante) + reemplazado |
| `docs/comerciales/buscar-leads.md` | ✨ Crear | Guía para comerciales |

### Flujo de datos

```
CLI: node scripts/buscar-leads.js --sector=dentistas --ciudad=bilbao

  1. Google Places Text Search
       query: "dentistas en Bilbao"
       hasta 3 páginas × 20 = 60 resultados
       ↓ por cada resultado sin teléfono (= todos desde Text Search)
       Google Places Details
         fields: name, formatted_phone_number, website, url,
                 rating, user_ratings_total, formatted_address
         delay: 150ms entre llamadas (respetar rate limit)

  2. Umbral mínimo: si leads con teléfono < 15
       → lanzar scrape-leads.js (Páginas Amarillas) para complementar
       → merge con resultados de Google

  3. Deduplicación
       clave: normalizar(nombre) + "|" + normalizar(ciudad)
       normalizar = .toLowerCase().trim().replace(/\s+/g,' ')

  4. Enriquecer cada lead con teléfono
       → generar wa_link + wa_mensaje personalizado por sector

  5. Push al Google Sheet
       POST GOOGLE_APPS_SCRIPT_URL
       body: { leads: [...] }
       respuesta: { ok, added, skipped }

  6. Guardar CSV backup
       leads_[sector]_[ciudad]_[fecha].csv en raíz del proyecto

  7. Imprimir resumen
```

---

## CLI

### Sintaxis
```bash
node scripts/buscar-leads.js [opciones]

Opciones:
  --sector=<slug>      Sector a buscar (requerido)
  --ciudad=<nombre>    Ciudad (requerido)
  --max=<número>       Máximo de leads (default: 60)
  --solo-pa            Forzar solo Páginas Amarillas (sin coste Google)
  --no-sheet           No subir al Sheet, solo CSV local
  --help               Mostrar ayuda con lista de sectores
```

### Sectores disponibles
```
dentistas          → "clínica dental"
veterinarios       → "clínica veterinaria"
peluquerias        → "peluquería"
estetica           → "centro de estética"
gimnasios          → "gimnasio"
restaurantes       → "restaurante"
farmacias          → "farmacia"
hoteles            → "hotel"
academias          → "academia"
asesoria           → "asesoría"
inmobiliarias      → "inmobiliaria"
talleres           → "taller mecánico"
clinicas           → "clínica médica"
fisioterapeutas    → "fisioterapia"
```

---

## Módulo leads-utils.js

### Funciones exportadas

```javascript
// Deduplica array de leads por nombre+ciudad
dedup(leads: Lead[]): Lead[]

// Genera link y mensaje WhatsApp para un lead
buildWALink(lead: { nombre, sector, ciudad, telefono }): { wa_link, wa_mensaje }

// Escribe CSV en ruta dada
writeCSV(leads: Lead[], filepath: string): void

// Push al Google Apps Script Sheet
// Usa GOOGLE_APPS_SCRIPT_URL del .env
pushToSheet(leads: Lead[]): Promise<{ ok, added, skipped, error? }>
```

### Tipo Lead (campos en Sheet)
```
nombre, sector, ciudad, telefono, address,
rating, reviews, website, maps_url,
wa_link, wa_mensaje,
estado, notas, fecha_contacto, fecha_añadido
```

### Templates WA por sector
Heredados de `find-targets.js` — 7 sectores específicos + fallback `default`.  
Añadir: `farmacias`, `clinicas`, `fisioterapeutas`, `inmobiliarias`, `academias` (ahora usan `default`).

---

## Gestión del crédito Google

| Operación | Coste |
|-----------|-------|
| Text Search (página 20 resultados) | $0.032 |
| Place Details | $0.017 |
| Crédito mensual gratuito | $200 |
| **60 leads completos** | ~$1.12 |
| **Búsquedas gratis/mes** | ~178 (≈10.700 leads) |

**Estrategia de ahorro:**
- No pedir Details si Text Search devuelve `ZERO_RESULTS` → saltar a PA directamente
- `--solo-pa` disponible para búsquedas de alto volumen sin consumir crédito

---

## Manejo de errores

| Error | Comportamiento |
|-------|---------------|
| `GOOGLE_PLACES_API_KEY` no configurada | Error claro con instrucciones setup |
| Cuota Google agotada (`OVER_QUERY_LIMIT`) | Fallback automático a PA, aviso en consola |
| Google devuelve `REQUEST_DENIED` | Error con instrucciones para activar Places API |
| PA bloqueado (CAPTCHA) | Warning + continúa con lo que tenga de Google |
| Sheet push falla (red/timeout) | CSV guardado igualmente, mostrar URL para subir manualmente |
| Ningún resultado en ninguna fuente | Sugerir variantes del sector o ciudad |

---

## Tests

```bash
# Test 1: Google Places funciona
node scripts/buscar-leads.js --sector=dentistas --ciudad=bilbao --max=5 --no-sheet

# Test 2: Fallback a PA
node scripts/buscar-leads.js --sector=dentistas --ciudad=bilbao --solo-pa --max=10 --no-sheet

# Test 3: Push al Sheet
node scripts/buscar-leads.js --sector=peluquerias --ciudad=donostia --max=5
# Verificar en https://docs.google.com/spreadsheets/ que aparecen los leads

# Test 4: Deduplicación (ejecutar dos veces el mismo comando)
# El segundo run debe mostrar "0 añadidos, N ya existían"

# Test 5: --help muestra sectores y opciones
node scripts/buscar-leads.js --help
```

---

## Documentación para comerciales

Ver `docs/comerciales/buscar-leads.md` — guía paso a paso, sin tecnicismos, con ejemplos de cada sector.
