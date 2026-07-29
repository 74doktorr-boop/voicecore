# Migraciones pendientes

> **No te fíes de este fichero. Pregúntale a la base de datos.**
>
> ```bash
> node scripts/check-schema.js
> ```

## Por qué este fichero ya no lleva una lista escrita a mano

Hasta el 2026-07-29 esto era una lista mantenida a mano. Llevaba **dos semanas
sin actualizarse** y declaraba pendientes **cinco migraciones que estaban
aplicadas**. En la auditoría de ese día, dos revisiones independientes
concluyeron a partir de este documento que producción estaba perdiendo *todas*
las llamadas y *todas* las citas.

Era falso. Se comprobó consultando la base de datos: todo lo crítico estaba
aplicado.

Un documento de estado que induce a error es peor que no tenerlo. Hace perder
horas persiguiendo un incendio inexistente y, sobre todo, hace desconfiar de lo
que sí funciona. Así que la lista se sustituye por un comprobador.

## Qué hace `scripts/check-schema.js`

Es **solo lectura**: hace `select <columna> limit 1` sobre cada tabla y columna
que el código necesita, y PostgREST devuelve un error identificable si no
existen. Por cada pieza que falta dice **qué se rompe exactamente**, y separa lo
crítico (rompe la persistencia o una protección) de lo opcional (la feature se
queda en NO-OP limpio). Sale con código 1 si falta algo crítico, así que sirve
para bloquear un despliegue.

## Antes de desplegar

1. `node scripts/check-schema.js`
2. Si sale `✖`, aplica el `.sql` correspondiente de `db/` en el SQL Editor de
   Supabase y vuelve a ejecutarlo.
3. Si sale `!`, decide: son features que se quedan desactivadas de forma limpia.

## Estado a 2026-07-29 (verificado, no declarado)

Todo lo crítico, aplicado. Dos piezas opcionales sin aplicar:

| Falta | Migración | Consecuencia real |
|---|---|---|
| `nf_appointments.staff` | **`db/migration-appointment-staff.sql`** | La cita se guarda sin profesional. Dos profesionales no pueden compartir hueco —la BD lo rechaza con 23P01 **después** de que el bot se lo confirmó al cliente, y el dueño recibe una alerta de doble reserva que es falsa— y, tras reiniciar, la agenda colapsa a 1:1 y el negocio pierde media capacidad. **Aplicar antes de vender reserva por profesional a ninguna peluquería o barbería.** |
| tabla `nf_stays` | `db/migration-stays.sql` | Estancias (hoteles) en NO-OP. Inocuo mientras no haya clientes de ese vertical. |

El código tolera ambas ausencias sin perder datos: si falta `staff`, el store lo
detecta, reintenta sin esa columna y lo grita en los logs. Una migración
pendiente no puede costar una cita, pero tampoco puede pasar desapercibida.

## Correcciones a notas anteriores de este fichero

Todas verificadas contra la BD el 2026-07-29:

- `nf_calls.ai_decisions` — **aplicada**. (Se llegó a temer que su ausencia
  estuviera tirando el upsert completo de cada llamada. No era el caso.)
- `nf_appointments.location` — **aplicada**, igual que el constraint anti-solape
  con `location` para multi-sede.
- `nf_appointments.outlook_event_id` — **aplicada**. La nota anterior la daba por
  pendiente porque la primera versión de la migración fue a la tabla legacy.
- `contact_memory.no_calls` — **aplicada**.
- `nf_campaign_calls` — **aplicada**.
- Pool de números: **hay disponibles**. Una nota anterior decía 0 y bloqueaba
  mentalmente el alta de clientes nuevos.
