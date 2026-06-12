# NodeFlow — Lead Finder 🔎

Encuentra negocios locales para venderles NodeFlow, usando la **API oficial de
Google Places**. Filtra el lead ideal: **negocios con teléfono pero SIN web**
(los que más llamadas pierden = tu cliente perfecto).

Exporta a **CSV** → lo abres en Google Sheets o Airtable y a contactar.

## Por qué Google Places y no scraping con IA

| | Scraping con LLM (lo que sugería tu amigo) | Google Places API (esto) |
|---|---|---|
| Datos | El LLM **inventa** teléfonos/emails | Datos **reales** de Google Maps |
| Legalidad | Zona gris (ToS de webs) | API oficial, datos públicos B2B ✅ |
| Coste | Tokens por cada búsqueda | $200/mes **gratis** de Google |
| Velocidad | Lento | Rápido |
| Fiabilidad | Baja (alucina) | Alta |

> Datos públicos de negocios para prospección B2B: legítimo bajo RGPD (interés
> legítimo). Aun así, al contactar respeta el derecho de oposición y no insistas
> si te piden parar.

## Setup (10 min, una vez)

### 1. Crear la clave de Google Places API
1. Entra en **https://console.cloud.google.com**
2. Crea un proyecto (o usa el que ya tienes para NodeFlow)
3. Menú → **APIs y servicios → Biblioteca** → busca **"Places API (New)"** → **Habilitar**
4. Menú → **APIs y servicios → Credenciales → Crear credenciales → Clave de API**
5. Copia la clave. (Recomendado: restríngela a "Places API (New)" en la misma pantalla)
6. Para el tramo gratis necesitas **activar facturación** en el proyecto, pero Google
   regala **$200/mes** — más que suficiente para miles de búsquedas. No te cobran
   si no pasas de ahí.

### 2. Ejecutar
Necesitas Node 18 o superior. Desde la carpeta `tools/lead-finder/`:

```bash
GOOGLE_PLACES_API_KEY=tu_clave_aqui node find-leads.js
```

En Windows (PowerShell):
```powershell
$env:GOOGLE_PLACES_API_KEY="tu_clave_aqui"; node find-leads.js
```

Genera un archivo `leads-AAAA-MM-DD.csv` en esta carpeta.

## Personalizar (sectores, ciudades, filtros)

Copia `sectors-cities.example.json` a `mi-config.json`, edítalo y ejecútalo así:

```bash
GOOGLE_PLACES_API_KEY=tu_clave node find-leads.js --config mi-config.json
```

Opciones de `filters`:
- `onlyWithoutWebsite` (true/false) — solo negocios SIN web (el filtro estrella)
- `requirePhone` — solo con teléfono
- `minRatingCount` — mínimo de reseñas (negocios establecidos)
- `onlyOperational` — descartar cerrados

## Importar a Google Sheets
Sheets → **Archivo → Importar → Subir** → el CSV → "Insertar hoja nueva". Listo.

## Importar a Airtable
Airtable → **Add or import → CSV file** → sube el CSV.
