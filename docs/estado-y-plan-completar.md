# NodeFlow / VoiceCore — Estado real y plan para "completar el proyecto"

> **Fecha:** 2026-06-30
> **Auditado en vivo** (nodeflow.es) + lectura de código.
> **Restricción dura:** producto en producción → cambios aditivos, sin romper datos/usuarios.

---

## 1. Qué es el producto (realidad verificada)

**VoiceCore** (`scratch/voicecore`) es el producto NodeFlow real y en producción. Tres frontends live sobre un backend Node.js grande:

| Frontend | URL live | Estado |
|---|---|---|
| Panel dueño | `nodeflow.es/dashboard/` | ✅ funciona (asistentes, llamadas, billing) |
| **Portal cliente (CRM)** | `nodeflow.es/portal/` | ✅ funciona (login por enlace mágico) |
| Admin | `nodeflow.es/admin/` | ✅ funciona |
| Marketing | `nodeflow.es` + ~100 posts blog + landings sector×ciudad | ✅ live |

**El portal/CRM tiene 18 secciones, todas implementadas** (`portal.js`, 3.604 líneas, una función `load*` por sección, ~70 llamadas a API): dashboard, llamadas, citas, **clientes (CRM)**, informes, automatizaciones, asistente, facturación, integraciones, seguimientos, referidos, widget, tareas, oportunidades, lista de espera, insights, ayuda, configuración.

**Backend (`/api/portal/*`, `routes-portal.js` 1.438 líneas): sin stubs ni TODOs.** Telefonía Twilio/Vonage/Telnyx; STT Deepgram/AssemblyAI/Google; TTS OpenAI/ElevenLabs/Cartesia/Azure; LLM OpenAI/Anthropic/Groq; Stripe; Google Calendar; recordatorios, automatizaciones, referidos, informes, backup, error-tracker.

## 2. El `nodeflow-dashboard` (Next.js) es redundante

Reimplementación parcial, peor y **sin desplegar** (`app.nodeflow.es` no existe en DNS) de lo que VoiceCore ya hace. Tiene mocks y guardado falso. **Recomendación: archivarlo**, no portar nada de él. Las funciones "que faltaban" ya existen en VoiceCore.

## 3. Qué falta DE VERDAD para "completar"

Según `db/pending-migrations.md` (la sección "Ya aplicadas ✅" del 2026-06-10 es la autoritativa) y la auditoría:

| Prioridad | Tarea | Detalle |
|---|---|---|
| 🔴 P0 | **Aplicar migración de escalado pendiente** | `db/schema-migration-lifecycle-patch2-scale.sql`: índices `idx_reminders_due` y `idx_nf_appointments_org_phone`. Sin esto, la cola de recordatorios se degrada con miles de clientes. Usar `CREATE INDEX CONCURRENTLY` si las tablas ya son grandes. Es la ÚNICA migración marcada ⏳ pendiente. |
| 🟠 P1 | **Click-through en vivo del portal** | Loguear un usuario de prueba y recorrer las 18 secciones para detectar gaps de runtime/UX (no detectables solo por código). |
| 🟡 P2 | Pulido incremental | Mejoras puntuales que salgan del click-through. |
| 🟢 P3 | Limpieza | Archivar `nodeflow-dashboard`, consolidar zips duplicados, etc. |

## 4. Conclusión

"Completar el proyecto" NO es construir un CRM: **ya está construido y live**. Es (1) aplicar la migración de escalado pendiente, (2) verificar en vivo para encontrar pulidos reales, y (3) limpiar lo redundante. El grueso del trabajo ya estaba hecho.
