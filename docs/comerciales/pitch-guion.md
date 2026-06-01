# Guión de Venta NodeFlow

Para WhatsApp inicial, llamada de descubrimiento y cierre.

---

## Mensaje de WhatsApp inicial

*(El script buscar-leads.js genera uno personalizado por sector — esto es el formato base)*

```
Hola [Nombre] 👋 Vi vuestro [negocio] en [ciudad].

Tengo una IA que atiende vuestras llamadas 24h — reservas, consultas, citas — 
sin que tengáis que estar disponibles siempre.

¿5 minutos para verlo?
```

**Tip:** Enviar entre 10h-13h o 16h-19h en días laborables. Evitar lunes por la mañana y viernes por la tarde.

---

## Si responden "¿qué es exactamente?"

```
Es un asistente de voz que atiende las llamadas de tu [negocio] cuando estás 
ocupado o fuera de horario.

Por ejemplo:
— Cliente llama a las 21h para pedir cita → el asistente la gestiona solo
— Estás atendiendo y suena el teléfono → el asistente atiende sin interrumpirte
— Cliente pregunta horarios, precios → respuesta inmediata y correcta

Lo configuro para tu negocio en 24h, sin cambiar tu número.

¿Cuándo tienes 10 minutos para que te lo enseñe?
```

---

## Llamada de descubrimiento (10 minutos)

### Apertura (1 min)
"Hola [Nombre], soy [tu nombre] de NodeFlow. ¿Tienes los 10 minutos?"

### Descubrimiento (3-4 min) — preguntas clave
1. "¿Cuántas llamadas recibís al día aproximadamente?"
2. "¿Qué pasa cuando no podéis coger el teléfono? ¿Tenéis contestador?"
3. "¿Cuántos no-shows tenéis a la semana?"
4. "¿Tenéis llamadas fuera de horario que se pierden?"

*Escuchar. Tomar nota. NO interrumpir.*

### Demo (3 min)
"Te voy a pasar el link de una demo de cómo suena el asistente para [su sector]. Mientras, te lo explico..."

→ Enviar link de demo del sector (ver [demo-links.md](demo-links.md))

"¿Lo has podido escuchar? Así es como sonaría para vuestro negocio, con vuestros servicios y horarios reales."

### Cierre (2 min)

**Si hay interés claro:**
"El plan Negocio son 49€ al mes, sin permanencia. La configuración la hago yo esta semana. ¿Empezamos?"

**Si hay dudas de precio:**
"Mira, la mayoría de nuestros clientes recuperan los 49€ en la primera semana solo con no-shows evitados. Y si en el primer mes no ves el resultado, lo cancelas — sin coste."

**Si necesitan tiempo:**
"Perfecto. Te mando un resumen por WhatsApp con la demo y el precio. ¿Cuándo te viene bien que te llame la semana que viene para cerrarlo?"

---

## Mensaje de seguimiento (si no cierran en la llamada)

```
Hola [Nombre] 👋 Te resumo lo que hablamos:

✅ NodeFlow atiende las llamadas cuando estáis ocupados o fuera de horario
✅ Gestiona citas, responde preguntas, habla en euskera
✅ Configuración en 24h, sin cambiar vuestro número
✅ 49€/mes, sin permanencia

Demo de [su sector]: [link]

Para empezar solo necesito responderte a 10 preguntas rápidas sobre el negocio.
¿Esta semana o la próxima?
```

---

## Proceso de alta (cuando cierran)

1. **Crear la organización** en Admin Panel → New Organization
2. **Asignar plan Negocio** y vincular Stripe
3. **Recoger información de configuración** (usa el form de onboarding o pregunta directamente):
   - Nombre del negocio y sector
   - Horario de apertura
   - Servicios y precios
   - Nombre(s) de los profesionales
   - Protocolo para urgencias (si aplica)
   - ¿Quieren euskera? ¿Qué voz prefieren?
4. **Configurar el asistente** en Admin → su org → Asistente
5. **Enviar magic link** al cliente → Admin → su org → Enviar magic link
6. **Prueba de llamada** con el cliente: llamar al número y verificar que el asistente responde bien
7. **Documentar en** `docs/clientes/[nombre]/README.md`
