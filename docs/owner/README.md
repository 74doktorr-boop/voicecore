# NodeFlow — Documentación del Dueño

Recursos para gestionar el negocio: infraestructura, métricas, pricing, roadmap.

---

## Índice

| Doc | Qué contiene |
|-----|-------------|
| [infra.md](infra.md) | EasyPanel, deploy, variables de entorno, dominios |
| [kpis.md](kpis.md) | Qué medir, cómo leer el panel admin, alertas |
| [pricing.md](pricing.md) | Reglas de pricing (INMUTABLE) |

---

## Accesos rápidos

| Panel | URL |
|-------|-----|
| Admin NodeFlow | `https://nodeflow.es/admin` |
| EasyPanel | `https://panel.tu-servidor.com` |
| Supabase | `https://supabase.com/dashboard/project/fmqhreiumahjpdmeyooh` |
| Google Sheet leads | Busca "NodeFlow Leads" en Drive |
| Google Search Console | `https://search.google.com/search-console` |
| Plausible Analytics | `https://plausible.io` |

---

## Comandos de gestión rápida

```bash
# Ver logs en producción (desde EasyPanel o SSH)
docker service logs nodeflow_app --follow --tail=100

# Buscar leads para un comercial
node scripts/buscar-leads.js --sector=dentistas --ciudad=bilbao

# Generar audio demo
node scripts/gen-demo-audio.js

# Regenerar páginas de sector SEO
node gen_sectors.js

# Test de emails
node scripts/test-email.js

# Ver estado del cron de automaciones
# → Admin panel → sección Automaciones → estado del cron
```
