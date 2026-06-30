# NodeFlow — Integraciones con webs sin API (RPA por recetas)

Conecta NodeFlow con software de terceros que **no tiene API** (Organízate,
StormPlus…) automatizando el navegador como lo haría una persona, pero de forma
**declarativa y reutilizable**.

## Idea clave
Cada web NO se programa a pelo. Se describe como una **receta** (JSON) con pasos
declarativos. Añadir un cliente/software nuevo = **una receta**, no código.

```
voz/chat de NodeFlow  →  booking-service  →  recipe-engine  →  driver (Playwright)
                                   │                                  │
                                   │                                  └─ web externa (Organízate/StormPlus)
                                   └─ fallback humano (WhatsApp/email) si algo falla
```

## Piezas
| Fichero | Qué hace |
|---------|----------|
| `recipe-engine.js` | Ejecuta una receta. Plantillas `{{...}}`, **selectores candidatos** (resiliencia), pasos opcionales, captura de evidencia. Driver-agnóstico. |
| `drivers/playwright-driver.js` | Navegador real (Chromium headless). **Lazy-require**: no se carga si no está instalado. |
| `drivers/mock-driver.js` | Driver simulado para tests/dry-run. |
| `booking-service.js` | Orquesta: receta + config del negocio + datos → reserva. Si falla, **fallback humano** (la cita nunca se pierde). |
| `recipes/*.json` | Una receta por software. |

## Diseño que lo hace robusto
- **Resiliente:** cada paso admite varios `selectorCandidates`; si la web cambia un poco, sigue funcionando.
- **Fallback humano:** si el robot falla (CAPTCHA, cambio de UI, caída), NodeFlow avisa a la clínica con todos los datos + captura → la meten a mano. Cero citas perdidas.
- **Evidencia:** captura de pantalla en cada confirmación/error.
- **Seguro:** credenciales del cliente cifradas (AES-256-GCM, como WhatsApp). Datos en la UE. Requiere autorización del cliente (anexo al contrato RGPD).
- **Aislado:** Playwright corre en un **worker aparte**, no en el backend de voz (Chromium consume RAM). El backend solo encola la petición.

## Añadir un cliente nuevo (reutilización)
1. ¿Usa un software ya soportado (Organízate/StormPlus)? → solo su **config** (`bookingUrl` o credenciales). Cero código.
2. ¿Software nuevo? → crear `recipes/<software>.json` con sus pasos. Cero cambios en el motor.

## Pendiente para activar en Osakin (datos a conseguir)
- **Organízate:** enlace/QR de reserva pública de Osakin, o credenciales de prueba → afinar `selectorCandidates` reales.
- **StormPlus:** URL exacta del formulario público de cita previa (o credenciales del CRC).
- Confirmar **CAPTCHA/2FA** (romperían la automatización).
- En el worker: `npm i playwright && npx playwright install chromium`.
- Autorización de Osakin para automatizar sus cuentas (anexo RGPD).

> Estado actual: motor + orquestador + fallback **hechos y testeados** (mock).
> Recetas en plantilla; los selectores reales se cierran al ver las webs.
