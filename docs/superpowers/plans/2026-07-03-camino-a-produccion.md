# Plan — Camino a producción sin margen de error

> Escrito 2026-07-03 tras la noche de hardening (14+ causas raíz cerradas,
> 584 tests, instrumentación completa). Sustituye la improvisación por un
> camino con puertas medibles. Regla: **no se pasa de fase con la puerta
> anterior abierta.** Cada ítem lleva dueño: [U]nai o [C]laude.

## Dónde estamos (medido, no opinado)

- Voice Core oye bien (códec PCMA arreglado: confidence 0,95-0,999), habla
  rápido (~200ms LLM), no inventa disponibilidad (candados server-side),
  cuelga solo, y cada llamada se persiste, se puntúa y se audita sola.
- Nota de Release Authority: **62/100 — beta con pilotos supervisados.**
- El gap a "comercializable" (80) no son features: es RACHA DEMOSTRADA +
  canal de avisos E2E + alerta antes que el cliente + host fiable.

---

## FASE 0 · Validación del paquete de esta noche (HOY)

- [ ] [U] Llamada de validación: reserva + despedida → cuelga solo (~8s)
- [ ] [U] Botón "Llámame" con la key nueva → primera saliente en nf_calls
- [ ] [U] Migración `db/migration-nf-calls-2.sql` en Supabase (follow-ups)
- [ ] [U] Servicios y horarios REALES de HHR en el portal (fin del stress-test)
- [ ] [C] Verificar en datos: fila ended, auditoría poblada, aviso WhatsApp/email de la reserva, teléfono en la cita
- **Puerta:** una llamada completa sin ningún hallazgo nuevo.

## FASE 1 · Certificación (esta semana)

- [ ] [C] **Veredicto A/B** Llama vs gpt-4o-mini: ≥20 llamadas por brazo,
      comparar score auditor + quality + latencia. Decisión documentada.
- [ ] [C] **Vista de certificación** en admin: media diaria de scores,
      nº alertas, racha acumulada ("N días > 85").
- [ ] [U] **WhatsApp E2E**: completar activación Meta → un cliente real
      recibe su confirmación. Sin esto la promesa central no está probada.
- [ ] [U] Monitor de uptime externo (UptimeRobot/BetterStack sobre /health,
      5 min de setup) — que el 843 nunca suene a nada sin que lo sepamos.
- [ ] [C] Checklist de aceptación del plan de campañas: pasarlo entero y
      por escrito (respuesta <1,5s, barge-in, "a la una y media", regla de
      oro, degradación elegante).
- **Puerta: 7 días consecutivos con score medio >85 y 0 llamadas perdidas.**
  Al pasarla: Osakin arranca su piloto gratis supervisado.

## FASE 2 · Fiabilidad estructural (semana 2)

- [ ] [C] **Architecture Review: máquina de estados de conversación**
      (Fase B) — mata la familia de bugs de flags implícitos. Documento →
      discusión → implementación con replay de llamadas reales como test.
- [ ] [C] **Diseño de capacidad/concurrencia** (petición Unai: duración por
      servicio ✓ ya existe + "cuántos se atienden a la vez"): seats por
      negocio/servicio en el scheduler. Se diseña JUNTO al candado de
      atomicidad multi-réplica (hallazgo G3) porque tocan el mismo núcleo.
- [ ] [C] Candado de réplica única (assert al arrancar) hasta que el estado
      caliente esté externalizado.
- [ ] [C] Seguridad: API key solo por header (retirar query param), rotación
      del token EasyPanel expuesto, revisión RLS de tablas legacy.
- [ ] [C] Fallback STT: evaluar con el banco de pruebas (ya construido) y
      decidir con datos si se añade un segundo proveedor.
- [ ] [U+C] **Decisión de hosting**: EasyPanel se cayó 2 veces el día 2.
      Opciones y coste de migración en un doc de una página.
- **Puerta:** review de arquitectura sin hallazgos críticos nuevos.

## FASE 3 · Producto vendible (semanas 3-4)

- [ ] [C] Sprint de portal: calendario interactivo con citas añadibles,
      salto automático a la semana con citas, guía de bienvenida primer
      login, badge de salud del asistente (semilla L5 ya puntúa).
- [ ] [C] Informe técnico por llamada en el admin (todo lo que ya se
      persiste, en una vista: audio, confianza, tools, auditoría, coste).
- [ ] [C] **Ledger de valor (L1)**: "NodeFlow te ha generado X€" — datos ya
      acumulándose en nf_calls/nf_appointments; es agregación + UI. La
      feature más barata con mayor retención de la Vision.
- [ ] [U] **Iniciar verificación OAuth de Google YA** (tarda semanas:
      vídeo, política de privacidad, dominio verificado). [C] prepara el
      checklist y los textos.
- [ ] [C] Gating del add-on Crecimiento 39€/mes (Stripe Meters ya existe).
- [ ] [U] Piloto Osakin en marcha con revisión diaria de auditorías.
- **Puerta:** Osakin 2 semanas sin intervención manual + ledger enseñable.

## FASE 4 · Venta sin supervisión

- Multi-réplica (estado en Redis/BD), onboarding self-service (W3 de la
  Vision), campañas gated con Stripe, y el dashboard de salud como
  argumento de venta ("mira cómo se vigila solo").
- **Puerta = la Release Authority sube la nota a 80+ con evidencia.**

---

## Reglas transversales (del charter, ya en vigor)

1. Un fallo crítico congela las fases: se diagnostica con la
   instrumentación antes de seguir construyendo.
2. Cada fix: evidencia → causa raíz → cambio mínimo → test de regresión →
   deploy vigilado → validación con datos de producción.
3. Todo lo que aprenda el sistema (auditorías, scores, hallazgos) se revisa
   en el ritual semanal y alimenta NODEFLOW-VISION.md si es oportunidad.
