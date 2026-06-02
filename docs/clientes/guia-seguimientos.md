# Guía de Seguimientos Automáticos — NodeFlow

Tu asistente de NodeFlow no solo gestiona llamadas. También recuerda automáticamente a tus clientes cuándo es el momento de volver.

---

## ¿Qué son los Seguimientos?

Los **seguimientos automáticos** son recordatorios que NodeFlow envía a tus clientes por WhatsApp, SMS o email en el momento justo:

- A la peluquería: "Han pasado 4 semanas desde tu último corte. ¿Reservamos?"
- Al taller: "La ITV de tu vehículo caduca en 60 días. ¿Te ayudamos?"
- A la veterinaria: "La vacuna anual de Tobi está próxima. ¿Reservamos cita?"

Todo automático, sin que tengas que hacer nada.

---

## Cómo acceder

En tu portal → sección **🔔 Seguimientos** (en el menú lateral).

Verás dos pestañas:
- **Próximos 30 días** — todos los recordatorios que se enviarán próximamente
- **Historial** — los que ya se han enviado (✅), fallado (❌) o cancelado (⛔)

---

## Acciones disponibles

Desde la pestaña "Próximos 30 días" puedes actuar sobre cada recordatorio:

| Botón | Qué hace |
|-------|---------|
| **Enviar** | Envía el recordatorio ahora mismo, sin esperar a la fecha programada |
| **Posponer** | Retrasa el envío X días (tú decides cuántos: 1–90) |
| **✕ Cancelar** | Cancela el recordatorio para este cliente (no se borra el contacto) |

---

## Canal de envío

El sistema intenta enviar por este orden:
1. **WhatsApp** (gratis hasta 1.000 mensajes/mes) — el más efectivo
2. **SMS** — si WhatsApp no está disponible
3. **Email** — último recurso

> ⚠️ Para que funcione WhatsApp necesitas tener configurado WhatsApp Business con NodeFlow. Consulta la guía de activación que te envió el equipo.

---

## ¿Cuándo se programa un recordatorio?

Los recordatorios se crean automáticamente:

- **Después de cada llamada** — el asistente extrae la información relevante (fecha de ITV, nombre de la mascota, etc.) y programa el siguiente recordatorio
- **Manualmente** — puedes rellenar los datos de cada cliente desde la ficha de contacto

Los intervalos por sector ya están configurados por defecto. Puedes ajustarlos desde **Configuración → Recordatorios**.

---

## Personalizar los intervalos

Si quieres cambiar cuándo se envían los recordatorios de tu negocio:

1. Ve a tu portal → **Configuración** → sección **Recordatorios**
2. Cambia los días para cada tipo de servicio
3. Guarda

Por ejemplo, si normalmente tus clientes vuelven cada 3 semanas en vez de 4, puedes cambiarlo a 21 días.

---

## Datos del cliente (sector_data)

Para sectores como talleres, veterinarias o gimnasios, los recordatorios necesitan datos específicos:

| Sector | Dato necesario | Cuándo introducirlo |
|--------|---------------|-------------------|
| Taller | Fecha último cambio aceite | Después de cada cambio |
| Taller | Fecha vencimiento ITV | Al dar de alta al cliente |
| Veterinaria | Nombre mascota + fecha próxima vacuna | Primera consulta |
| Gimnasio | Fecha vencimiento cuota | Al renovar |

**Cómo introducir estos datos:**
1. Portal → **Clientes** → abre la ficha del cliente
2. Sección **Datos de sector** → rellena o edita
3. Guarda — los recordatorios se recalculan automáticamente

También puedes dejar que el asistente los extraiga durante las llamadas. Cuando un cliente menciona la fecha de su ITV o el nombre de su mascota, el sistema lo guarda solo.

---

## Privacidad y desuscripción

Todos los mensajes incluyen un enlace para que el cliente pueda dejar de recibir recordatorios. Si un cliente lo usa:

- Se marca como "no contactar" para ese canal
- **Nunca** se le vuelve a enviar por ese canal, aunque hagas cambios
- Aparece en su ficha de contacto

Si un cliente te pide que lo elimines manualmente: Portal → Clientes → su ficha → edita los datos de contacto o elimina el contacto.

---

## Preguntas frecuentes

**¿Puedo activar/desactivar los recordatorios para todo el negocio?**
Sí, desde Configuración → Recordatorios → activa/desactiva cada tipo de servicio.

**¿Qué pasa si el cliente ya ha reservado cita antes del recordatorio?**
El sistema lo detecta automáticamente y cancela el recordatorio. No recibirá mensajes redundantes.

**¿Cuántos mensajes de WhatsApp puedo enviar?**
Los primeros 1.000 mensajes de utilidad al mes son gratuitos con Meta. Por encima, ~€0.02 por conversación. Con 200 clientes activos al mes el coste es mínimo.

**¿Qué pasa si WhatsApp no está configurado?**
El sistema cae automáticamente a SMS, y si tampoco está disponible, a email. Siempre intenta llegar al cliente.

**¿Puedo ver qué mensaje se envió?**
En la pestaña **Historial** verás el canal usado y el estado. El contenido exacto del mensaje está en el historial de la conversación (sección Llamadas).

---

## Soporte

¿Necesitas ayuda configurando los recordatorios para tu sector?
Escríbenos por WhatsApp o al email de soporte que te dimos al dar de alta.
