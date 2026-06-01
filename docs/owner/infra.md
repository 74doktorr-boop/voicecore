# NodeFlow — Infraestructura

Cómo está desplegado el sistema, cómo hacer cambios y dónde está cada cosa.

---

## Stack

```
GitHub (código fuente)
  ↓ push a master
GitHub Actions (.github/workflows/)
  ↓ build + push Docker image
GHCR (GitHub Container Registry)
  ↓ pull automático
EasyPanel (servidor VPS)
  ↓ Docker Swarm
nodeflow.es (dominio principal)
```

---

## Deploy

**Proceso automático:** Cada `git push origin master` lanza el pipeline de GitHub Actions:
1. Build Docker image
2. Push a GHCR
3. EasyPanel detecta la nueva imagen y redeploy automático (~2-3 min)

**Deploy manual (urgencias):**
```bash
# En EasyPanel → tu app → "Redeploy"
# O via API:
curl -X POST https://panel.tu-servidor.com/api/v1/apps/redeploy \
  -H "Authorization: Bearer $EASYPANEL_TOKEN"
```

---

## Variables de entorno (.env)

Las variables de producción se configuran en EasyPanel → tu app → Environment.  
**Nunca** commitear el `.env` al repositorio (está en `.gitignore`).

### Críticas (sin estas el servidor no arranca)
| Variable | Valor |
|----------|-------|
| `SUPABASE_URL` | URL del proyecto Supabase |
| `SUPABASE_SERVICE_KEY` | Service role key (NO la anon key) |
| `OPENAI_API_KEY` | OpenAI API key |
| `JWT_SECRET` | String largo aleatorio para firmar JWTs del portal |

### Telefonía (necesaria para llamadas)
| Variable | Estado |
|----------|--------|
| `VONAGE_API_KEY` | Configurado (recuperando cuenta) |
| `VONAGE_API_SECRET` | Configurado |
| `TWILIO_ACCOUNT_SID` | Alternativa si Vonage no funciona |
| `TWILIO_AUTH_TOKEN` | Alternativa |
| `TWILIO_PHONE_NUMBER` | ⚠️ VACÍO — asignar cuando lleguen los números esta semana |

### Scraping / leads
| Variable | Estado |
|----------|--------|
| `GOOGLE_PLACES_API_KEY` | ✅ Configurado |
| `GOOGLE_APPS_SCRIPT_URL` | ✅ Configurado (URL del Sheet desplegado) |

### Emails
| Variable | Estado |
|----------|--------|
| `SENDGRID_API_KEY` | Configurado |
| `FROM_EMAIL` | Configurado |

### TTS personalizado (voces vascas)
| Variable | Estado |
|----------|--------|
| `LOCAL_TTS_URL` | ⚠️ Comentado — activar cuando llegue F5-TTS esta semana |

### Billing
| Variable | Estado |
|----------|--------|
| `STRIPE_SECRET_KEY` | Configurado |
| `STRIPE_WEBHOOK_SECRET` | Configurado |

---

## Base de datos

**Supabase:** `fmqhreiumahjpdmeyooh.supabase.co`  
Panel: https://supabase.com/dashboard/project/fmqhreiumahjpdmeyooh

### Tablas principales
| Tabla | Qué almacena |
|-------|-------------|
| `organizations` | Clientes (plan, config, billing) |
| `call_sessions` | Llamadas + transcripciones |
| `contacts` | CRM de contactos por org |
| `appointments` | Citas por org |
| `assistant_config` | Config del asistente por org |
| `webhook_configs` | Webhooks por org (**pendiente de migración manual**) |

### Migraciones pendientes
- `db/schema-migration-webhooks.sql` — **EJECUTAR MANUALMENTE en Supabase SQL Editor**

---

## Dominios

| Dominio | Destino |
|---------|---------|
| `nodeflow.es` | Servidor EasyPanel (landing + portal + API) |
| `www.nodeflow.es` | Redirect a nodeflow.es |

**DNS:** Gestionar en tu proveedor de dominio.  
**SSL:** Automático vía Let's Encrypt en EasyPanel.

---

## Monitoring

- **Logs:** EasyPanel → app → Logs, o `docker service logs nodeflow_app`
- **Health:** `GET https://nodeflow.es/health` → debe devolver `{ ok: true }`
- **Analytics:** Plausible → nodeflow.es

---

## Arquitectura de la llamada telefónica

```
Teléfono del cliente
  ↓ llamada entrante
Vonage/Twilio (número +34)
  ↓ WebSocket media stream
server.js (VoiceCore)
  ├── Deepgram → STT (transcripción en tiempo real)
  ├── OpenAI GPT-4o-mini → LLM (respuesta + herramientas)
  └── OpenAI/ElevenLabs/F5-TTS → TTS (voz de respuesta)
  ↓ audio de vuelta
Vonage/Twilio → Teléfono del cliente
  ↓ al colgar
post-call-handler.js
  ├── Guarda llamada en Supabase
  ├── Upsert contacto en CRM
  └── Lanza automaciones (rebooking, etc.)
```
