# Activación Osakin — integraciones Organízate + StormPlus

Runbook para poner en marcha a Osakin (3 sedes: Andoain · Villabona · Tolosa) el minuto en que
den credenciales. Estado a 2026-07-02.

## Estado actual

| Integración | Estado | Necesita credenciales |
|---|---|---|
| **StormPlus** (psicotécnicos) | ✅ Validado en **las 3 sedes** (dry-run real) | ❌ No (formulario público) |
| **Organízate** (agenda clínicas) | ✅ Ciclo completo validado en la **demo** (alta paciente + cita Fisioterapia 40€) | ✅ Sí (usuario/pass + mapas) |

Grupo Osakin en Storm: `IdGrupoCentros=701`, provincia GIPUZKOA (20). Centros:
`CRC OSAKIN ANDOAIN` (896), `CRC OSAKIN TOLOSA` (911), `CRC OSAKIN VILLABONA` (897).

## StormPlus — ya listo, sin credenciales

Configs por sede en esta carpeta. Dry-run (rellena sin enviar):

```bash
node scripts/booking-run.js --recipe stormplus --config config/osakin/stormplus-andoain.json
node scripts/booking-run.js --recipe stormplus --config config/osakin/stormplus-tolosa.json
node scripts/booking-run.js --recipe stormplus --config config/osakin/stormplus-villabona.json
```

Para crear la cita de verdad: añadir `--live`. Cada ejecución deja captura de evidencia en
`%LOCALAPPDATA%\Temp\nodeflow-rpa-evidence\`.

## Organízate — qué pedir a Osakin

Rellenar `organizate.PLANTILLA.json` (renombrar a `organizate-<sede>.json`) con:

1. **Credenciales** `organizateUser` / `organizatePass` (usuario de cada sede o uno multi-sede).
2. **URL de login real** — la demo usa `organizate.biz`; confirmar la de su cuenta.
3. **Mapa profesional → `id_emp`** por sede. (Demo: Nerea = 279.) Se obtiene una vez, mirando
   la agenda: cada profesional tiene su `id_emp` en la URL del panel de citas.
4. **Mapa servicio → `id_tarifa` / `id_tratamiento`** por sede (Fisioterapia, Podología,
   Nutrición, Psicología… con su precio). Se leen del desplegable de tarifas/tratamientos.
5. **Salas** (`id_sal`) si las usan.

### Secuencia validada (recordatorio, ya en organizate.json `_meta`)

Abrir URL directa de citas → buscar/`#btn_new_paciente` alta paciente (`#nombre` **visible**,
teclado real) → clic **SALA** para abrir el form de tratamiento → `#id_tarifa` → `#tratamiento` +
`tratamiento_add(id)` → **GUARDAR = `enviar_form()`** (NO "Guardar y programar").

### Puesta en marcha

```bash
# 1) dry-run con datos reales (NO crea nada)
node scripts/booking-run.js --recipe organizate --config config/osakin/organizate-tolosa.json
# 2) revisar captura de evidencia; si OK, en vivo:
node scripts/booking-run.js --recipe organizate --config config/osakin/organizate-tolosa.json --live
```

## Garantías (recordar al cliente)

- Modo dry-run por defecto: nada se crea sin `--live`.
- Si falta un dato o cambia la pantalla → **no improvisa**, deriva a persona. No se pierde la cita.
- Cada acción deja captura de evidencia.
- Credenciales cifradas (AES-256), uso conforme a RGPD con consentimiento por escrito.

## Ficha comercial

- Precio cerrado: **80 €/mes** (3 clínicas). Reunión 2026-06-30 hecha; entrega doc + demo en vivo.
- Documento cliente: `Desktop/NodeFlow/Integracion-Osakin.html` (StormPlus 3 sedes + agenda Organízate).
