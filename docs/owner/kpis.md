# NodeFlow — KPIs y Métricas

Qué medir, cómo leerlo y cuándo actuar.

---

## Dashboard Admin — Cómo leerlo

Acceso: `https://nodeflow.es/admin` (requiere login admin)

### Tarjetas superiores

| Métrica | Qué significa | Señal de alarma |
|---------|--------------|-----------------|
| **MRR** | Ingresos recurrentes mensuales confirmados | Baja mes a mes |
| **Clientes activos** | Orgs con plan Negocio o Pro | Churn > 5%/mes |
| **Llamadas hoy** | Volumen del día actual | 0 durante horario laboral |
| **Leads este mes** | Nuevos registros en el Sheet | Si no se usa la herramienta |
| **Minutos totales** | Minutos de llamadas procesados en el mes | Útil para calcular coste |

### Sección Organizaciones

Muestra todos los clientes con su plan, fecha de alta y último acceso al portal.

**Acciones clave:**
- `Enviar magic link` → si un cliente pierde acceso al portal
- Editar plan → upgrade/downgrade manual
- Ver llamadas por cliente → soporte

### Sección Automaciones / Cron

El cron de automaciones corre cada noche. Verifica que:
- Estado: `running` o `last ran: hace X horas`
- Sin errores en los últimos 7 días

---

## KPIs de negocio — Revisión semanal

### MRR objetivo

| Clientes | MRR estimado |
|----------|-------------|
| 10 × Negocio | €490/mes |
| 20 × Negocio | €980/mes |
| 10 × Pro | €990/mes |
| 20 × Negocio + 5 × Pro | €1.475/mes |

**Punto de equilibrio:** ~10 clientes Negocio cubre costes de infra básicos.

### Métricas de ventas (Google Sheet leads)

Revisar semanalmente:
- Leads con estado `contactado` esta semana
- Leads en estado `interesado` → ¿cuántos han pasado a `demo`?
- Leads en `demo` → ¿cuántos han cerrado como `cliente`?
- Tasa de conversión: leads → clientes (objetivo: >5%)

### Métricas de producto (panel admin)

Revisar mensualmente:
- Llamadas por cliente → clientes con 0 llamadas en 30 días = riesgo de churn
- Minutos totales → coste de infra vs MRR
- Ratio llamadas/cliente → uso real del producto

---

## Alertas manuales a configurar

Estas revisiones deben hacerse periódicamente:

| Revisión | Frecuencia | Qué hacer si hay problema |
|----------|-----------|--------------------------|
| Health check `/health` | Diaria | Revisar logs en EasyPanel |
| Clientes sin llamadas en 30 días | Semanal | Contactar proactivamente |
| Cuota Google Places ($200) | Mensual | Reducir búsquedas o `--solo-pa` |
| Vonage/Twilio balance | Semanal | Recargar si < €20 |
| Stripe pagos fallidos | Semanal | Contactar cliente |

---

## Supabase — Queries útiles

Pega en Supabase SQL Editor:

```sql
-- MRR actual
SELECT 
  COUNT(*) FILTER (WHERE plan = 'negocio') * 49 +
  COUNT(*) FILTER (WHERE plan = 'pro') * 99 AS mrr_eur,
  COUNT(*) FILTER (WHERE plan = 'negocio') AS clientes_negocio,
  COUNT(*) FILTER (WHERE plan = 'pro') AS clientes_pro,
  COUNT(*) FILTER (WHERE plan = 'starter') AS clientes_starter
FROM organizations;

-- Llamadas esta semana
SELECT 
  DATE_TRUNC('day', started_at) AS dia,
  COUNT(*) AS llamadas,
  ROUND(SUM(EXTRACT(EPOCH FROM (ended_at - started_at))/60)::numeric, 1) AS minutos
FROM call_sessions
WHERE started_at > NOW() - INTERVAL '7 days'
GROUP BY 1 ORDER BY 1;

-- Clientes sin llamadas en 30 días (riesgo churn)
SELECT o.name, o.plan, o.email
FROM organizations o
WHERE o.plan IN ('negocio', 'pro')
AND NOT EXISTS (
  SELECT 1 FROM call_sessions c
  WHERE c.business_id = o.id
  AND c.started_at > NOW() - INTERVAL '30 days'
);

-- Top 5 clientes por llamadas este mes
SELECT o.name, COUNT(*) AS llamadas
FROM call_sessions c
JOIN organizations o ON o.id = c.business_id
WHERE c.started_at > DATE_TRUNC('month', NOW())
GROUP BY o.name ORDER BY 2 DESC LIMIT 5;
```
