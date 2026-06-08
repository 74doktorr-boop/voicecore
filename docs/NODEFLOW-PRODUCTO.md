# NodeFlow IA — Asistente de Voz para Negocios Locales
**Documentación del producto · v2.0 · 2026**

---

## ¿Qué es NodeFlow?

NodeFlow es un asistente telefónico con inteligencia artificial que atiende las llamadas de tu negocio cuando tú no puedes. Habla en español natural, conoce tu negocio, gestiona citas, recuerda a tus clientes y les pide reseñas — todo sin que tú intervengas.

No es un bot con menús. Es una voz que conversa, entiende y actúa.

---

## Cómo funciona

```
Cliente llama → NodeFlow contesta → Habla con naturalidad → Actúa
                                                              │
                              ┌───────────────────────────────┤
                              │                               │
                         Agenda cita                  Manda WhatsApp
                         Recoge datos                 al dueño
                         Calcula urgencia             Actualiza CRM
                         Pide reseña                  Programa recordatorio
```

1. **El cliente llama** al número de tu negocio (el mismo de siempre, sin cambiarlo).
2. **NodeFlow contesta** con el nombre de tu negocio y el nombre del asistente que hayas elegido.
3. **Habla y actúa**: agenda citas, responde preguntas frecuentes, recoge datos, detecta urgencias.
4. **Te notifica**: recibes un WhatsApp con el resumen de cada llamada en tiempo real.
5. **Automatiza lo demás**: recordatorios al cliente, solicitud de reseña, seguimiento de fidelización.

---

## Funcionalidades principales

### 🎙️ Voz con IA — Atención 24/7

- Atiende llamadas fuera de horario, en hora punta, y cuando estás ocupado.
- Voz natural en español de España — sin acento robótico.
- Tiempo de respuesta < 1 segundo.
- Capaz de gestionar interrupciones, cambios de tema y respuestas largas del cliente.

### 📅 Gestión de citas

- Consulta disponibilidad en tiempo real.
- Ofrece huecos concretos: *"Tengo el martes a las diez, ¿le viene bien?"*
- Confirma, modifica y cancela citas.
- Recoge nombre, teléfono, servicio y cualquier dato que necesites.
- Integración con Google Calendar, Calendly y sistemas propios vía API.

### 🧠 Memoria persistente de clientes

Cada cliente que llama queda registrado. El asistente recuerda:
- Nombre y teléfono.
- Historial de visitas y servicios.
- Preferencias y observaciones.
- Cuándo fue la última vez que vino.
- Si pidió no recibir mensajes.

En la siguiente llamada, el asistente reconoce al cliente y adapta la conversación.

### 📲 Recordatorios automáticos por WhatsApp

NodeFlow sabe cuándo tiene que recordarle algo a cada cliente según su sector:

| Sector | Qué recuerda |
|--------|-------------|
| Dental | Revisión anual, limpieza semestral, siguiente sesión de ortodoncia |
| Peluquería | Corte (cada 24 días), tinte (cada 35 días), tratamiento (cada 28 días) |
| Taller | Cambio de aceite (cada 11 meses), ITV (60 días antes del vencimiento) |
| Estética | Cada sesión del ciclo de tratamiento, según la frecuencia pactada |
| Veterinaria | Vacunas anuales, desparasitaciones, revisiones |
| Gimnasio | Recordatorio de clase reservada, renovación de cuota |

Los recordatorios se envían automáticamente por WhatsApp sin que el negocio tenga que hacer nada.

### ⭐ Reseñas en Google — Automático

Tras cada visita, el asistente detecta el momento adecuado y envía por WhatsApp el enlace de reseña de Google con un mensaje personalizado.

> *"Ha sido un placer atenderle. Si le ha gustado el servicio, nos ayudaría mucho una reseña en Google. ¿Le mando el enlace ahora mismo?"*

Los negocios que usan este sistema multiplican por 3-4 su ritmo de reseñas nuevas en los primeros 30 días.

### 🚨 Alertas de urgencia en tiempo real

El asistente detecta situaciones urgentes y alerta inmediatamente al dueño o al profesional responsable por WhatsApp:

- **Taller**: avería en carretera, humo, frenos que fallan.
- **Veterinaria**: convulsiones, atropello, sangrado, no respira.
- **Asesoría**: plazo fiscal inminente, sanción de Hacienda, embargo.
- **Inmobiliaria**: lead con alta intención de compra o urgencia de tiempo.

### 💬 Notificaciones WhatsApp al negocio

Cada llamada genera un resumen automático por WhatsApp:
```
📞 Nueva reserva — Clínica Dental Benta Berri
━━━━━━━━━━━━
👤 Amaia Urrutia
📋 Limpieza dental
📅 Martes 10 junio · 10:00h
📞 +34 600 123 456
━━━━━━━━━━━━
Gestionado por NodeFlow IA
```

### 🔄 Fidelización de clientes

NodeFlow no solo coge llamadas — mantiene viva la relación con cada cliente:

1. **Detecta** cuándo un cliente no ha vuelto según los patrones de su sector.
2. **Contacta** proactivamente por WhatsApp con un mensaje personalizado.
3. **Ofrece** volver a reservar con un solo mensaje de respuesta.

Ejemplo para una peluquería:
> *"¡Hola Marta! Han pasado 5 semanas desde tu último corte en Golden Barbers. ¿Te reservamos hueco esta semana?"*

---

## Sectores disponibles

| Sector | Asistente | Especialidades |
|--------|-----------|----------------|
| Clínicas dentales | María | Citas, cancelaciones, recordatorios revisión/ortodoncia |
| Restaurantes | Laura | Reservas, grupos, alergias, horarios |
| Peluquerías | Sara | Citas, recordatorios por servicio, reseñas |
| Talleres mecánicos | Iñaki | Citas, presupuestos, ITV, urgencias carretera |
| Veterinarias | Ane | Citas, urgencias 24h, vacunas, recordatorios |
| Gimnasios | Mikel | Clases, socios nuevos, congelación cuota, leads |
| Centros de estética | Leire | Citas, ciclos de tratamiento, fidelización, reseñas |
| Farmacias | — | Horario guardia, stock, reserva medicamentos |
| Asesorías | Aritz | Citas, urgencias fiscales, gestión casos, prospects |
| Inmobiliarias | Jon | Compradores, vendedores, visitas, hot leads |
| Academias | — | Matriculaciones, consultas fuera de horario |
| Hoteles | — | Disponibilidad, reservas directas sin comisiones |

---

## Instalación

1. Nos das el número de teléfono de tu negocio (o te damos uno nuevo).
2. En 24 horas configuramos tu asistente con el nombre de tu negocio.
3. Empezamos con un periodo de prueba de 7 días — sin compromiso.
4. Si te convence, activamos el plan mensual. Sin permanencia.

**No necesitas cambiar nada en tu negocio. El asistente trabaja en paralelo.**

---

## Precio

**49€/mes** — todo incluido:
- Asistente de voz personalizado para tu sector
- Gestión de citas 24/7
- Recordatorios automáticos por WhatsApp
- Solicitud de reseñas Google
- Notificaciones al dueño en tiempo real
- Fidelización automática de clientes
- Soporte y ajustes incluidos

Sin costes de instalación. Sin permanencia. Cancela cuando quieras.

---

## Preguntas frecuentes

**¿Cambia mi número de teléfono?**
No. Redireccionas las llamadas perdidas a NodeFlow, o te damos un número nuevo — tú eliges.

**¿Habla de verdad o es un menú de opciones?**
Habla de verdad. El cliente puede decir lo que quiera y el asistente lo entiende y responde.

**¿Qué pasa con las llamadas urgentes?**
El asistente detecta urgencias y te avisa inmediatamente por WhatsApp con todos los datos.

**¿Puedo personalizar lo que dice?**
Sí. Configuramos el nombre del asistente, el saludo, los servicios, los precios y el tono.

**¿En qué idioma habla?**
Español de España por defecto. También disponible en euskera, gallego e inglés.

**¿Qué pasa si el cliente habla muy rápido o con acento?**
Usamos el motor de reconocimiento de voz más avanzado del mercado (Deepgram Nova-3), optimizado para español con acento vasco, andaluz, catalán y latinoamericano.

---

## Contacto

**Unai Sánchez · NodeFlow Inteligencia Artificial SLU**
Donostia-San Sebastián, País Vasco

📧 unai@nodeflow.es
📱 WhatsApp: 666 351 319
🌐 nodeflow.es
