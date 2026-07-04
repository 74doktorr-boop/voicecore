# NodeFlow Design System — "Electric Night" · v2.0

> **Fuente de verdad visual.** El sistema vive en
> [`public/portal/nf-design-system.css`](public/portal/nf-design-system.css):
> **tokens → componentes → motion → utilidades**. Este documento es su
> especificación. Rige por encima de él la [Product Bible](NODEFLOW_PRODUCT_BIBLE.md).
>
> **Regla de oro:** no se escribe CSS inline nuevo. Se usan las **clases** (API
> pública) o las **utilidades `u-*`**. Un color, un espacio o un radio se toma
> **siempre de un token** — nunca un valor "a ojo".

Identidad: **lima eléctrica `#c4f546` sobre casi-negro frío `#0a0b0d`**, dark-only.
**Fraunces** (display) + **Inter** (UI). El fondo drenado ES la marca; el lima es
acento de acción/selección/estado, nunca adorno.

---

## 1 · Espaciado

Escala base **4px**. Tokens `--sp-1..16`. Nada de píxeles sueltos.

| token | px | uso |
|---|---|---|
| `--sp-1` | 4 | micro (gap iconos) |
| `--sp-2` | 8 | interno de controles |
| `--sp-3` | 12 | padding de fila/celda |
| `--sp-4` | 16 | padding de tarjeta |
| `--sp-5` | 20 | grupos de formulario |
| `--sp-6` | 24 | secciones |
| `--sp-8/10/12/16` | 32/40/48/64 | bloques grandes |

Utilidades: `.u-gap-1..6`, `.u-mt-*`, `.u-mb-*`, `.u-p-2..6`.

## 2 · Grid & Layout

- Contenido máximo `--content-max: 1240px`, centrado; sidebar `--sidebar-w: 232px`.
- Grids responsivas sin breakpoints: `repeat(auto-fill/auto-fit, minmax(Npx, 1fr))`.
- Flexbox para 1D, Grid para 2D. `.u-flex/.u-grid`, `.u-col`, `.u-items-center`,
  `.u-justify-between`, `.u-flex-1`, `.u-wrap`.
- **Breakpoints** (referencia): ≤767 móvil · 768–1079 tablet · ≥1080 desktop ·
  ≥1440 wide. **Móvil primero.**

## 3 · Tokens & Variables CSS

Todo son variables en `:root`. Familias: paleta (fondo/marca/semántica/texto),
bordes, espaciado, radios, elevación, blur, tipografía, motion, z-index, layout.
Alias legacy conservados (`--card`, `--card2`, `--radius`) para no romper.

## 4 · Tipografía

- **Display:** `--font-display` (Fraunces) — titulares con carácter (`.u-display`).
- **UI:** `--font-ui` (Inter) — todo lo demás.
- Escala fija (no fluida): `--fs-2xs..5xl` (10 → 46px). En UI, contraste por
  **peso y tamaño**, no por trucos. Base 14px, line-height 1.55.
- Datos numéricos: `font-variant-numeric: tabular-nums` (`.u-tabular`, `.num`).

## 5 · Colores

- **Marca:** `--accent #c4f546`, `--accent-l` (hover), `--on-accent #0a0b0d`
  (texto SOBRE lima — nunca blanco), `--cyan` (dato secundario).
- **Semántica** (estado, no marca): `--green` éxito, `--yellow` aviso, `--red`
  error, `--blue` info.
- **Texto** (contraste AA verificado sobre `--bg`): `--white` 16.4:1 titulares ·
  `--text` cuerpo · `--dim` 7.4:1 secundario · `--muted` 4.6:1 terciario.
- Prohibido: morado de stock, texto con gradiente, gris fantasma ilegible.

## 6 · Iconografía

- Estilo **line/stroke** uniforme, grosor consistente, tamaño alineado al texto
  (1em). Monocromo por defecto (heredan `currentColor`); el lima solo para el
  icono activo/seleccionado. Sin iconos multicolor de stock. Emoji permitido en
  la UI del portal como señal cálida (nunca en la voz del asistente ni en copy
  de llamada).

## 7 · Elevaciones & Sombras

Sombra **fría** (`--shadow-1..4`), del sutil (borde de tarjeta) al drop de modal.
El **glow lima** es aparte: `--glow-accent` (acción primaria), `--glow-accent-soft`
(anillo de foco/selección). La elevación sube con la jerarquía, no por decorar.

## 8 · Bordes & Radius

- Bordes: `--border` (hairline), `--border-2` (hover), `--border-accent` (foco/sel).
- Radios: `--r-1` 8 (chips/controles), `--r-2` 10 (botones/inputs), `--r-3` 14
  (filas/tarjetas interiores), `--r-4` 18 (tarjetas/modal), `--r-pill` 999.
  Utilidades `.u-round-2..4`, `.u-pill`.

## 9 · Motion

- Easings: `--ease-out` (estándar), `--ease-out-expo` (entradas/modal),
  `--ease-in-out` (bucles).
- Duraciones: `--dur-1` 120 (micro) · `--dur-2` 200 (controles) · `--dur-3` 320
  (paneles) · `--dur-4` 560 (escena).
- **El motion comunica estado**, no decora. Nada de gatear visibilidad a una
  animación. **`prefers-reduced-motion` obligatorio** en todo (alternativa
  instantánea o crossfade). Sin bounce/elastic.

## 10 · Componentes

Estados canónicos de todo control interactivo: **default · hover · focus · active
· disabled · loading · error**. Foco de teclado SIEMPRE visible (anillo lima).

- **Botones** — `.btn` + `.btn-accent` (primario lima), `.btn-d` (ghost), `.btn-g`
  (éxito), `.btn-r` (destructivo), `.btn-sm`. Estados: `:hover`, `:active`
  (scale .98), `:disabled`, `.is-loading` (spinner). 
- **Inputs** — `.form-input`/`.form-ctrl`. Placeholder legible (`--dim`, ≥4.5:1),
  `:hover`/`:focus` (anillo), `:disabled`, `.is-error` + `.field-error` /
  `.field-help`.
- **Selects** — nativo `.form-ctrl` o `.nf-select` (dentro de `.nf-select-wrap`,
  con chevron propio y foco lima).
- **Cards** — `.card` (+ `:hover`), `.card-title`. Nada de tarjetas anidadas.
- **KPI** — `.kpi-grid`, `.kpi`, `.kpi-label/val/sub`.
- **Chips/Tags** — `.chip` + `.chip-accent/green/red/yellow/solid`, `.chip-sm`,
  `.chip-dot`.
- **Toasts** — `.toast` + `.toast-success/error/info`. z `--z-toast`.
- **Modales** — `.modal-overlay`, `.modal-box`, `.modal-title`, `.modal-actions`.
  Último recurso: agotar inline/progresivo antes de un modal.
- **Sidebars** — `.sidebar`, `.sidebar-logo/biz/nav/footer`. Off-canvas en móvil.
- **Tablas** — `.table-wrap` (o `.nf-table`): cabecera sticky en mayúsculas, hover
  de fila, `.num` (numérico tabular a la derecha), `th.sortable` + `aria-sort`.
- **Formularios** — `.form-group`, `.form-label`, `.form-row` (2 col), 
  `.form-section-title`. Una cosa cada vez; perfilado progresivo.
- **Charts** — primitivos CSS: `.chart`, `.chart-bars`/`.chart-bar` (+ `.muted`),
  `.chart-grid`, `.chart-axis`, `.chart-legend`, `.spark` (sparkline SVG).
- **Skeletons** — `.skeleton` + `.skel-line` (`.sm/.lg`, `.w-40/60/80`),
  `.skel-circle`, `.skel-card`, `.skel-btn`. Shimmer; estático con reduced-motion.
  **Skeleton para cargar, no spinner en mitad del contenido.**
- **Empty states** — `.empty-state` + `-icon/-title/-text`. Enseñan a usar la
  interfaz, no dicen "no hay nada".
- **Segmented/Tabs** — `.segmented` + `button[aria-selected]` / `.btn-subtab`.

## 11 · Utilidades

Prefijo `u-*` (layout, spacing, tipografía, color, superficie, borde, radio,
sombra). Sirven para **migrar los estilos inline de forma mecánica** — pero un
componente recurrente se convierte en clase, no en una ristra de utilidades.

## 12 · Reglas de consistencia

1. Una sola fuente de verdad: los tokens y las clases mandan; no hay valores
   duplicados ni "a ojo".
2. Las clases son el **contrato/API pública**; no se renombran sin migración.
3. Misma acción → mismo aspecto y mismo nombre en todas las superficies (landing,
   onboarding, portal, admin).
4. Todo control tiene sus 7 estados; el foco de teclado siempre visible.
5. Accesibilidad AA como suelo: contraste, `prefers-reduced-motion`, foco,
   semántica, legible en móvil al sol.

## 13 · Migración (inline → sistema)

Objetivo: cero `style="..."` en el portal. Estrategia por pasos verificados:
1. Componentes recurrentes → su **clase** del sistema.
2. Ajustes puntuales de layout → **utilidades `u-*`**.
3. Cada superficie se migra y se **verifica en preview** antes de darla por hecha.
Orden sugerido: portal (dashboard → config → asistente → llamadas/clientes) →
admin → onboarding → landing.
