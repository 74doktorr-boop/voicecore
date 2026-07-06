# 🏥 Osakin — esqueleto del asistente (PREPARADO)

> Estado: **esqueleto listo**. Cuando lleguen los datos pendientes (precios + horarios/direcciones por sede + export de caducidades), es rellenar y activar. Este doc NO crea nada en producción — es la plantilla de configuración.
> La **integración de reservas** (Organízate + StormPlus por RPA) vive aparte en `config/osakin/` (WIP, no tocar desde aquí).

---

## 1. Quiénes son
Grupo de **3 clínicas** en Tolosaldea (Gipuzkoa), comarca euskaldun · atención en **castellano** · horario base **9–20h** · WhatsApp propio **688 76 07 60**.

| Sede | Centro (StormPlus) | Dirección | Teléfono |
|---|---|---|---|
| Andoain | CRC OSAKIN ANDOAIN | Kale Zumea 9, 20140 Andoain | 688 76 07 60 |
| Tolosa | CRC OSAKIN TOLOSA | **TODO** | **TODO** |
| Villabona | CRC OSAKIN VILLABONA | **TODO** | **TODO** |

**5 servicios:** Fisioterapia · Podología · Nutrición · Psicología · **Psicotécnicos (CRC)**.

**Decisión tomada:** **UN asistente para las 3 sedes**. Como es uno solo, tiene que saber de qué sede habla cada llamada. Dos opciones (elegir en activación):
- **A (recomendada):** cada sede desvía a un número distinto → el asistente resuelve la sede por el número llamado. Cero fricción para el cliente.
- **B:** comparten número → el asistente pregunta *"¿a qué sede: Andoain, Villabona o Tolosa?"*.

---

## 2. Configuración del asistente (lista para aplicar)

`assistant_config` (rellenar los `TODO`; el resto ya está decidido):

```jsonc
{
  "language": "es",
  "sector": "clinica",           // centro médico multi-servicio; psicotécnicos se cubre en la base de conocimiento
  "mode": "citas",               // agenda de verdad (no solo recados)
  "voice": "blanca-ca",          // incluida, femenina recepcionista (confirmar por oído; premium si la quieren)
  "assistantName": "Osakin"
}
```

**Servicios (`automation_config.config.serviceList`)** — precios pendientes de Osakin:

```jsonc
[
  { "name": "Fisioterapia",  "price": "TODO €/sesión (¿bono?)", "duration": "45 min", "notes": "sesión o bono" },
  { "name": "Podología",     "price": "TODO €",                 "duration": "30 min", "notes": "quiropodia / revisión; ojo diabéticos" },
  { "name": "Nutrición",     "price": "TODO € (1ª) / TODO € (seguimiento)", "duration": "60 min", "notes": "primera + controles" },
  { "name": "Psicología",    "price": "TODO €/sesión",          "duration": "50 min", "notes": "trato discreto; ¿lista de espera?" },
  { "name": "Reconocimientos (psicotécnicos)", "price": "TODO € por tipo", "duration": "20 min", "notes": "carnet B/C/D, armas, náutica, seguridad, certificados" }
]
```

**Horario (`schedule`, 1=lunes … 5=viernes)** — base 9–20h; **confirmar si es continuo o partido, y si difiere por sede**:

```jsonc
{
  "1": { "open": "09:00", "close": "20:00" },
  "2": { "open": "09:00", "close": "20:00" },
  "3": { "open": "09:00", "close": "20:00" },
  "4": { "open": "09:00", "close": "20:00" },
  "5": { "open": "09:00", "close": "20:00" }
}
```

**Dirección** (para que el asistente sepa decir "dónde estáis"): se guarda en `automation_config.config.address`. Con 3 sedes, o una por número (opción A) o el asistente da la de la sede que pida el cliente.

---

## 3. Guion específico (base de conocimiento del asistente)

Además de las normas del sector `clinica` (pregunta especialidad, ante urgencia deriva a 112/urgencias, **nunca diagnostica**), añadir a su base de conocimiento:

**Psicotécnicos / reconocimientos:**
- Preguntar **qué tipo** necesita: carnet de conducir (y permiso: B, C, D…), armas, náutica, seguridad privada, grúa, o certificado.
- Aclarar si es **renovación** o **primera vez** (si no lo sabe, no insistir: se confirma en el centro).
- Qué **traer**: DNI, y **gafas/lentillas** si las usa.
- Muchos centros atienden **por orden de llegada** para psicotécnicos; ofrecer cita solo si esa sede la usa.
- **NUNCA valorar la salud del cliente ni anticipar si pasará las pruebas** — lo decide el personal médico en el centro.

**Multi-sede:** identificar/confirmar la sede (Andoain / Villabona / Tolosa) antes de dar dirección u horario.

---

## 4. Seguimientos — el "oro" (motor de caducidad) 🪙

**Esto es lo que cierra el trato.** La renovación de psicotécnicos = un **seguimiento** del motor de recall (`reminder-engine`): cada cliente con `sector_data.caducidad` (fecha de fin de su carnet) → el asistente le **llama ~1 mes antes** a renovar con Osakin.

- **Cómo se alimenta:** subiendo su base de clientes con las fechas → **importación masiva** (pieza que se está montando; ver `docs/estado` / seguimientos). El **export** que pide el onboarding = ese fichero.
- **Formato del export** (lo que pedirles): `Nombre, Teléfono, Caduca_el (YYYY-MM-DD), Tipo (permiso B / armas / …)`.
- Sin ese export, el motor arranca vacío y se llena a cuentagotas (cada renovación registra la siguiente caducidad). Con el export, arranca dando los **3.000–5.000 €/año** del pitch desde el día 1.

---

## 5. Reserva real en SUS agendas (integración RPA — WIP aparte)
El asistente **captura la intención** (servicio, sede, cliente); la cita se crea en:
- **Organízate** (fisio/podo/nutri/psico) — `config/osakin/organizate.PLANTILLA.json`.
- **StormPlus** (psicotécnicos, formulario público) — `config/osakin/stormplus-{andoain,tolosa,villabona}.json`. URL: `https://stormplus.lndeter.es/citapreviaonline/osakin`.
- Ambas por automatización de pantallas, con red de seguridad (deriva a persona si falta un dato). Pendiente de Osakin: usuarios de Organízate + mapa profesional/servicio por sede.

---

## 6. Checklist de datos pendientes (de Osakin)
- [ ] **Precios y duración** de los 5 servicios (← "cuando vuelva el chico de vacaciones").
- [ ] **Dirección + horario exactos** de Villabona y Tolosa (y confirmar continuo/partido).
- [ ] **Un número por sede** (opción A) o confirmar número compartido (opción B).
- [ ] **Export de caducidades** de psicotécnicos (Nombre, Teléfono, Caduca_el, Tipo).
- [ ] Credenciales de Organízate + mapa profesional/servicio por sede (para la integración RPA).
- [ ] Voz elegida (por oído) — castellano.

## 7. Activar (cuando estén los datos)
1. Crear org **Osakin** en el Admin (plan Negocio; 3 sedes = assistants ilimitados).
2. Aplicar el `assistant_config` + `serviceList` + `schedule` de arriba.
3. Dar de alta el enrutado de número por sede (opción A/B).
4. Importar el export de caducidades → el motor programa las renovaciones.
5. Activar WhatsApp (688 76 07 60) para confirmaciones/recordatorios.
6. Magic link del portal al responsable + **llamada de prueba a cada sede**.
7. Mes de prueba gratis + revisión a 30 días con números reales.
