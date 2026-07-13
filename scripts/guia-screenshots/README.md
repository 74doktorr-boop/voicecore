# Capturas de la guía (`public/guia-img/`)

Herramientas para **regenerar los pantallazos reales del portal** que aparecen en
`public/guia.html` (y por tanto en el PDF adjunto del email de bienvenida).

Las capturas se hacen contra un **mock server** que sirve el frontend real del
portal (`public/portal/`) con datos demo neutros (Clínica Dental Bidasoa) — así
nunca se filtran datos de un cliente real y todas las secciones salen llenas.

## Cuándo regenerar

Cuando cambie el **diseño del portal** (`public/portal/`) lo suficiente como para
que las capturas queden desactualizadas. Si solo cambias el texto de `guia.html`,
no hace falta recapturar: basta con regenerar el PDF (`npm run guia:pdf`).

## Cómo regenerar (2 pasos)

Necesitas Google Chrome instalado.

```bash
# 1) Levanta el mock server (déjalo corriendo en una terminal)
node scripts/guia-screenshots/portal-mock-server.js 8378

# 2) En otra terminal, captura las 18 secciones a public/guia-img/*.jpg
node scripts/guia-screenshots/capture-portal.js

# 3) Regenera el PDF con las nuevas capturas
npm run guia:pdf
```

El paso 2 abre Chrome headless vía DevTools Protocol, entra al portal
(`http://localhost:8378/portal?token=demo`, auto-login), recorre cada sección y
guarda un `.jpg` por sección.

## Notas

- `portal-mock-server.js`: sirve `public/` estático + mock de todos los
  `/api/*`. Sin dependencias (solo `http`). Los datos demo están dentro del
  archivo; edítalos ahí si quieres otra persona/negocio.
- `capture-portal.js`: lista de secciones y ajustes (resolución `DSF`, calidad
  JPEG) al principio del archivo. Sube `DSF` si quieres capturas más nítidas (a
  costa de un PDF más pesado).
- El PDF se adjunta en `src/notifications/email.js` → `sendWelcomePortalEmail`
  (además del enlace web a la guía). Ver `scripts/generate-guia-pdf.js`.
