# NodeFlow — Auditoría Completa & Plan de Mejoras
**Fecha:** 2026-05-27  
**Alcance:** 6 áreas — Conversión, Auth, Onboarding, Stripe, SEO, Portal

---

## Área A — Flujo de conversión (CRÍTICO)

**Problema:** Los botones "Contratar →" en pricing apuntan a `/onboarding.html` que no existe → 404 → cero conversiones.

**Solución:** Crear `public/onboarding.html` con formulario multi-paso:
1. Plan pre-seleccionado desde URL `?plan=starter|negocio|pro`
2. Datos del negocio: nombre, sector, teléfono, email, cupón (opcional)
3. Resumen del plan + botón "Pagar con Stripe" → `POST /api/registro` → redirect a Stripe

**API:** `POST /api/registro` ya existe. Necesita devolver la URL de Stripe correcta según el plan.

---

## Área B — Auth con Magic Link (sesión 30 días)

**Flujo completo:**
```
Magic link (7 días TTL, multi-uso)
  → GET /api/auth/verify?token=xxx
  → genera session_token JWT (30 días)
  → guarda en localStorage
  → portal carga datos del cliente

Sesión expirada:
  → portal muestra "Solicitar acceso"
  → POST /api/auth/request-link { email }
  → genera nuevo token, envía email
```

**Endpoints nuevos:**
- `GET /api/auth/verify?token=xxx` → devuelve `{ session_token, cliente }`
- `POST /api/auth/request-link` → genera token + envía email
- `GET /api/portal/me` → datos del cliente (requiere session_token)

**Token storage en DB (tabla `magic_tokens`):**
```
id, email, token (hex 32B), registro_id, expires_at, used_count, created_at
```

---

## Área C — Stripe Webhook

**Evento:** `checkout.session.completed`

**Flujo:**
1. Verificar firma con `STRIPE_WEBHOOK_SECRET`
2. Extraer `metadata.registro_id` del checkout session
3. Actualizar `registros` → `status: 'active'`
4. Generar `magic_token` (32 bytes hex, TTL +7 días)
5. Llamar `sendWelcomeEmail(email, magic_token, plan, negocio)`

**Email de bienvenida contiene:**
- Nombre del negocio
- Plan contratado
- Botón "Acceder a mi portal →" → `https://nodeflow.es/portal?token=xxx`
- Instrucciones de configuración (24h de setup)

---

## Área D — onboarding.html (diseño detallado)

**UI:** Dark, consistent con landing v6 (mismas CSS vars).

**Paso 1 — Plan:**
- Muestra el plan pre-seleccionado con precio y features
- Botón "Cambiar plan" si quieren cambiar

**Paso 2 — Tu negocio:**
```
- Nombre completo *
- Nombre del negocio *
- Sector (select: restaurante/clínica/peluquería/farmacia/hotel/consultorio/otro) *
- Teléfono del negocio *
- Email de contacto *
- Código cupón (opcional)
```

**Paso 3 — Resumen y pago:**
- Resumen: plan, precio (con descuento si hay cupón), features
- Botón grande "Pagar con Stripe →"
- Texto: "Pago seguro · Sin permanencia · Cancela cuando quieras"

**JS:** `POST /api/registro` con todos los datos → servidor devuelve `{ stripe_url }` → `window.location.href = stripe_url`

---

## Área E — SEO: Sitemap + WhatsApp float

**Sitemap.xml actualizado** con todas las URLs:
- Landing principal
- 15 páginas de sector: /restaurantes/, /clinicas/, /peluquerias/, /farmacias/, /hoteles/, /gimnasios/, /academias/, /asesorias/, /estetica/, /inmobiliarias/, /veterinarias/, /talleres/, /galiza/
- 5 ciudades: /bilbao/, /donostia/, /vitoria/, /andoain/, /galiza/
- /blog/, /portal/, /aviso-legal/, /privacidad/, /terminos/

**WhatsApp floating button** en todas las páginas públicas:
```html
<a href="https://wa.me/34666351319?text=..." class="wa-float" target="_blank">
  <!-- WhatsApp SVG icon -->
</a>
```

**Meta descriptions:** Revisar y completar en sector pages que falten.

---

## Área F — Portal dashboard (mejoras)

**Tabs actuales (mantener) + mejoras:**

**Tab "Resumen":**
- Stats cards: llamadas este mes, citas agendadas, minutos usados, minutos restantes
- Barra de progreso de minutos del plan
- Alertas: si < 20% minutos → aviso "Considera actualizar tu plan"

**Tab "Llamadas":**
- Lista paginada: fecha, duración, sentimiento (emoji), transcripción (expandible)
- Filtros: fecha, sentimiento

**Tab "Citas":**
- Próximas citas del calendario
- Citas pasadas del mes

**Tab "Configuración":**
- Nombre del negocio / teléfono
- Upload knowledge base (PDF/TXT → `POST /api/portal/knowledge`)
- "Solicitar nuevo link de acceso" (reenvía magic link al email)

**Auth en portal:**
- Si URL tiene `?token=xxx` → llama `/api/auth/verify` → guarda session en localStorage
- Si ya tiene session válida → carga directamente
- Si no → muestra pantalla de solicitar acceso

---

## Prioridad de implementación

1. **Área A + C + D** — onboarding.html + webhook Stripe (desbloquea revenue)
2. **Área B** — magic link auth endpoints
3. **Área F** — portal mejoras
4. **Área E** — sitemap + WhatsApp float (SEO/UX)

---

## Constraints técnicos

- Stack: Node.js + Express, Supabase, Stripe, Resend (email)
- Fallback en memoria si Supabase no configurado
- Sin nuevas dependencias npm
- Compatible con deploy en EasyPanel vía GitHub Actions → GHCR
- Pricing INMUTABLE: Starter gratis / Negocio €49 / Pro €99
