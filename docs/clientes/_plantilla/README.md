# [Nombre del Negocio] — Ficha de Cliente

> Copia esta carpeta a `docs/clientes/[nombre-slug]/` para cada cliente nuevo.

---

## Datos básicos

| Campo | Valor |
|-------|-------|
| **Nombre** | |
| **Sector** | |
| **Ciudad** | |
| **Teléfono negocio** | |
| **Email contacto** | |
| **Nombre contacto** | |
| **Plan** | Negocio / Pro |
| **Fecha de alta** | |
| **Estado** | activo / pausado / cancelado |

---

## Acceso al portal

| Campo | Valor |
|-------|-------|
| **Email de acceso** | |
| **org_id en Supabase** | |
| **business_id (para llamadas)** | |

Para enviar un nuevo magic link:  
Admin Panel → Organizaciones → su org → "Enviar magic link"

---

## Configuración del asistente

| Campo | Valor |
|-------|-------|
| **Nombre del asistente** | ej. "Asistente de Clínica Sol" |
| **Voz** | openai-nova / elevenlabs-[id] / f5-[id] |
| **Idioma** | castellano / euskera / bilingüe |
| **Saludo personalizado** | |

### Servicios configurados
- 
- 

### Horario de atención
Lunes–Viernes: 
Sábados: 
Domingos/festivos: 

### Protocolo especial
*(urgencias, derivaciones, etc.)*

---

## Número de teléfono

| Campo | Valor |
|-------|-------|
| **Número NodeFlow asignado** | +34 |
| **Número original del negocio** | |
| **Configuración** | desvío / redirección completa |
| **Proveedor** | Vonage / Twilio |

---

## Historial de notas

| Fecha | Nota |
|-------|------|
| | Alta inicial |

---

## Checklist de onboarding

- [ ] Organización creada en Admin Panel
- [ ] Plan asignado y Stripe vinculado
- [ ] Información de negocio recopilada
- [ ] Asistente configurado y probado
- [ ] Número de teléfono asignado
- [ ] Magic link enviado al cliente
- [ ] Llamada de prueba con el cliente
- [ ] Cliente confirmó que funciona correctamente
- [ ] Ficha completada en `docs/clientes/[nombre]/README.md`
