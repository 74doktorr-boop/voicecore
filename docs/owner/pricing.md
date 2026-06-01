# Pricing NodeFlow — REGLA INMUTABLE

> ⚠️ **NUNCA cambiar estos precios sin consulta explícita al dueño.**  
> Esta regla aplica a toda IA, comercial o sistema automatizado.

---

## Planes activos

| Plan | Precio | DB value | Descripción |
|------|--------|----------|-------------|
| **Starter** | **Gratis** | `starter` | Prueba limitada, sin llamadas salientes |
| **Negocio** | **€49/mes** | `negocio` | Asistente completo, llamadas salientes |
| **Pro** | **€99/mes** | `pro` | Todo Negocio + multiasistente, webhooks |

---

## Reglas de acceso por plan

| Función | Starter | Negocio | Pro |
|---------|---------|---------|-----|
| Portal de cliente | ✅ | ✅ | ✅ |
| Llamadas entrantes | ✅ | ✅ | ✅ |
| CRM + transcripciones | ✅ | ✅ | ✅ |
| Configurar asistente | ✅ | ✅ | ✅ |
| **Llamadas salientes** | ❌ | ✅ | ✅ |
| **Webhooks** | ❌ | ❌ | ✅ |
| **Multi-asistente** | ❌ | ❌ | ✅ |

---

## Implementación técnica

Los planes se almacenan en Supabase en `organizations.plan` como texto `starter` / `negocio` / `pro`.

El gate de llamadas salientes está en `src/api/routes-portal.js`:
```javascript
const plan = (flowConfig.plan || 'starter').toLowerCase();
if (!['negocio', 'pro'].includes(plan)) {
  return res.status(403).json({ error: '...', upgrade: true });
}
```

El billing con Stripe usa el campo `stripe_subscription_id` en `organizations`.

---

## Historial de cambios

| Fecha | Cambio | Motivo |
|-------|--------|--------|
| 2026-05-24 | Lanzamiento inicial con estos precios | — |
