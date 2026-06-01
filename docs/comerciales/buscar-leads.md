# Guía de Leads — NodeFlow

Cómo conseguir contactos de negocios reales listos para hacer outreach por WhatsApp.

---

## Requisitos

Solo necesitas tener acceso a la carpeta del proyecto NodeFlow y Node.js instalado.  
Las API keys ya están configuradas — no necesitas tocar nada.

---

## Cómo buscar leads

Abre una terminal en la carpeta del proyecto y ejecuta:

```bash
node scripts/buscar-leads.js --sector=SECTOR --ciudad=CIUDAD
```

**Ejemplos prácticos:**

```bash
# Clínicas dentales en Bilbao
node scripts/buscar-leads.js --sector=dentistas --ciudad=bilbao

# Peluquerías en Donostia
node scripts/buscar-leads.js --sector=peluquerias --ciudad=donostia

# Restaurantes en Madrid (hasta 100 resultados)
node scripts/buscar-leads.js --sector=restaurantes --ciudad=madrid --max=100

# Gimnasios en Sevilla — sin subir al Sheet todavía
node scripts/buscar-leads.js --sector=gimnasios --ciudad=sevilla --no-sheet
```

El script busca en Google Maps, obtiene teléfonos reales y sube los leads al Sheet compartido automáticamente. Todo en un comando.

---

## Sectores disponibles

| Slug (lo que escribes) | Tipo de negocio |
|------------------------|-----------------|
| `dentistas` | Clínicas dentales |
| `veterinarios` | Clínicas veterinarias |
| `peluquerias` | Peluquerías y salones de belleza |
| `estetica` | Centros de estética |
| `gimnasios` | Gimnasios y centros deportivos |
| `restaurantes` | Restaurantes |
| `farmacias` | Farmacias |
| `hoteles` | Hoteles |
| `academias` | Academias y centros de formación |
| `asesoria` | Asesorías y gestorías |
| `inmobiliarias` | Inmobiliarias |
| `talleres` | Talleres mecánicos |
| `clinicas` | Clínicas médicas generales |
| `fisioterapeutas` | Centros de fisioterapia |

---

## Qué hace el script paso a paso

1. **Busca en Google Maps** por sector + ciudad
2. **Obtiene los detalles** de cada negocio: teléfono, dirección, rating, web
3. **Complementa con Páginas Amarillas** si hay pocos resultados con teléfono
4. **Genera el mensaje de WhatsApp** personalizado por sector (ya listo para enviar)
5. **Sube al Sheet compartido** sin duplicados — si el negocio ya estaba, lo ignora
6. **Guarda un CSV** en la carpeta del proyecto como copia de seguridad

---

## El Sheet compartido

Los leads aparecen en Google Sheets con estas columnas:

| Columna | Qué es |
|---------|--------|
| `nombre` | Nombre del negocio |
| `sector` | Sector buscado |
| `ciudad` | Ciudad |
| `telefono` | Teléfono directo |
| `address` | Dirección completa |
| `rating` | Valoración Google (1–5 ⭐) |
| `reviews` | Número de reseñas |
| `website` | Web del negocio |
| `maps_url` | Link a Google Maps |
| `wa_link` | **🔗 Link WhatsApp directo** — solo pulsar y enviar |
| `wa_mensaje` | Mensaje personalizado ya redactado |
| `estado` | Rellena tú: `contactado` / `interesado` / `demo` / `cliente` / `no interesa` |
| `notas` | Tus anotaciones |
| `fecha_contacto` | Cuándo contactaste |
| `fecha_añadido` | Cuándo se añadió el lead |

---

## Flujo de trabajo recomendado

```
1. Buscar leads
   node scripts/buscar-leads.js --sector=dentistas --ciudad=bilbao

2. Abrir el Sheet → filtrar por ciudad o sector

3. Pulsar wa_link → WhatsApp se abre con el mensaje ya escrito

4. Enviar el mensaje → actualizar estado a "contactado"

5. Si responde con interés → "interesado"
   Anotar próximo paso en "notas", actualizar "fecha_contacto"

6. Agendar demo → actualizar estado a "demo"

7. Cierra → "cliente" 🎉
```

---

## Opciones avanzadas

```bash
# Sin coste Google — usa Páginas Amarillas (gratis, algo menos de datos)
node scripts/buscar-leads.js --sector=dentistas --ciudad=bilbao --solo-pa

# Solo CSV local, sin subir al Sheet
node scripts/buscar-leads.js --sector=dentistas --ciudad=bilbao --no-sheet

# Cambiar el máximo de resultados (default: 60)
node scripts/buscar-leads.js --sector=restaurantes --ciudad=madrid --max=100

# Ver toda la ayuda
node scripts/buscar-leads.js --help
```

---

## Solución de problemas

| Error | Qué hacer |
|-------|-----------|
| `GOOGLE_PLACES_API_KEY no configurada` | Avisa al técnico para configurar el .env |
| `Sector no reconocido` | Revisa la tabla de sectores y usa el slug exacto |
| `Cuota Google agotada` | El script cambia a Páginas Amarillas automáticamente |
| `No se pudo subir al Sheet` | El CSV se guarda igualmente; avisa al técnico |
| PA bloqueado temporalmente | Espera 30 min y vuelve a intentar, o usa `--solo-pa --delay=3000` |
| Sin resultados en ninguna fuente | Prueba otra ciudad o un sector más amplio |

---

## Coste (para referencia)

- Cada búsqueda de 60 leads cuesta ~$1.12 en créditos de Google
- Google da **$200 de crédito gratuito cada mes** → cubre ~178 búsquedas/mes (~10.700 leads)
- Para búsquedas sin coste usa `--solo-pa` (Páginas Amarillas, ilimitado y gratis)
