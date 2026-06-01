# NodeFlow — Mapa del Proyecto

Guía de navegación para el equipo. Dónde está cada cosa y quién la usa.

---

## Para comerciales

| Recurso | Ruta | Para qué |
|---------|------|---------|
| Buscar leads | `node scripts/buscar-leads.js --help` | Generar leads por sector + ciudad → Sheet |
| Guía de leads | `docs/comerciales/buscar-leads.md` | Cómo usar el buscador de leads |
| Guión de venta | `docs/comerciales/pitch-guion.md` | WhatsApp inicial, llamada y cierre |
| Links de demo | `docs/comerciales/demo-links.md` | Links por sector para enviar al cliente |

---

## Para el dueño

| Recurso | Ruta | Para qué |
|---------|------|---------|
| Panel admin | `https://nodeflow.es/admin` | Ver MRR, clientes, llamadas, enviar magic links |
| KPIs | `docs/owner/kpis.md` | Qué medir, queries Supabase, alertas |
| Infraestructura | `docs/owner/infra.md` | EasyPanel, env vars, deploy, arquitectura |
| Pricing | `docs/owner/pricing.md` | Reglas de pricing (INMUTABLE) |

---

## Clientes

| Cliente | Ruta | Estado |
|---------|------|--------|
| Lumina Estética | `docs/clientes/lumina/README.md` | Demo/early adopter |
| Hementxe | `docs/clientes/hementxe/README.md` | Activo |
| _Plantilla_ | `docs/clientes/_plantilla/README.md` | Copiar para cada cliente nuevo |

---

## Estructura del código

```
nodeflow/
├── server.js                  ← Punto de entrada del servidor
├── src/
│   ├── api/                   ← Rutas HTTP (admin, portal, auth, etc.)
│   ├── core/                  ← Motor de llamadas (STT, LLM, TTS)
│   ├── automations/           ← Cron: rebooking, recordatorios, fechas críticas
│   ├── billing/               ← Stripe webhooks
│   ├── db/                    ← Cliente Supabase
│   ├── telephony/             ← Vonage / Twilio WebSocket
│   ├── tts/                   ← TTS (OpenAI, ElevenLabs, F5-TTS)
│   ├── stt/                   ← STT (Deepgram)
│   ├── llm/                   ← OpenAI (GPT-4o-mini)
│   ├── notifications/         ← Email (SendGrid), WhatsApp
│   └── utils/                 ← Utilidades compartidas (leads-utils, etc.)
│
├── scripts/                   ← Scripts operacionales
│   ├── buscar-leads.js        ← 🔍 Buscador de leads (Google + PA → Sheet)
│   ├── scrape-leads.js        ← Páginas Amarillas (usado por buscar-leads)
│   ├── sheets-appscript.gs    ← Apps Script del Google Sheet (ya desplegado)
│   ├── blog-gen.js            ← Generador de artículos de blog
│   ├── push-assistant.js      ← Sube config de asistente
│   └── gen-demo-audio.js      ← Genera audio de demo
│
├── public/                    ← Web pública (landing, portal, admin)
│   ├── index.html             ← Landing principal
│   ├── portal/                ← Portal de cliente (SPA)
│   ├── admin/                 ← Panel de administración
│   ├── [sector]/              ← Landing pages por sector (SEO)
│   └── [ciudad]/              ← Landing pages por ciudad (SEO)
│
├── db/                        ← Migraciones SQL
│   ├── schema.sql             ← Schema completo inicial
│   └── schema-migration-*.sql ← Migraciones incrementales
│
├── docs/
│   ├── comerciales/           ← Guías para el equipo comercial
│   ├── owner/                 ← Recursos del dueño (KPIs, infra, pricing)
│   ├── clientes/              ← Ficha de cada cliente
│   └── superpowers/           ← Specs y planes de implementación (IA)
│
├── config/                    ← Configuraciones
│   ├── voices.json            ← Voces disponibles
│   └── voice_profiles.json    ← Perfiles de voz por sector
│
├── assistants/                ← Configs JSON de asistentes demo/cliente
└── voices/                    ← Guías de grabación de voces vascas
```

---

## Scripts de uso frecuente

```bash
# Buscar leads para un sector + ciudad
node scripts/buscar-leads.js --sector=dentistas --ciudad=bilbao

# Generar páginas SEO de sector
node gen_sectors.js

# Generar artículos de blog
python generate_articles.py

# Test de envío de email
node scripts/test-email.js

# Generar audio de demo
node scripts/gen-demo-audio.js

# Ver health del servidor
curl https://nodeflow.es/health
```

---

## Pendientes importantes

| Tarea | Estado | Urgencia |
|-------|--------|---------|
| Migración SQL webhooks | ⚠️ Manual en Supabase SQL Editor | Alta |
| Configurar TWILIO_PHONE_NUMBER | ⚠️ Vacío en .env | Alta (números llegan esta semana) |
| Activar LOCAL_TTS_URL (F5-TTS) | ⚠️ Comentado en .env | Media (voces vascas esta semana) |
| Push a producción (PWA + llamadas salientes) | ⏳ Commits locales | Alta |
