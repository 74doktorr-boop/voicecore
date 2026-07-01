# Design — NodeFlow v6 "Electric Night"

Sistema visual **vigente** de NodeFlow (capturado del código real: `public/index.html`, `public/portal/`, `public/onboarding.html`). La marca es **lima eléctrica sobre casi-negro frío**, con display serif (Fraunces) e Inter para cuerpo. Es la identidad canónica: landing, onboarding y portal comparten estos tokens.

> **Design System del portal (2026-07-02):** `public/portal/nf-design-system.css` es la fuente de verdad de tokens y componentes del portal — espaciado (base 4px), radios, elevación, blur, z-index semántico, escala tipográfica, motion (duraciones + easings), estados (focus/hover/disabled/loading) y componentes (btn, card, kpi, table, tabs, modal, drawer, toast, tooltip, empty state, skeleton, feed, hero copiloto, command palette). Las clases existentes (`.card`, `.kpi`, `.btn`, `.badge`…) son la API pública: portal.js las genera, el DS las viste. **No añadir CSS inline nuevo en el portal: extender el DS.** El dashboard es un copiloto (hero "hoy NodeFlow ya ha trabajado por ti" + IA recomienda + acciones rápidas + feed en directo), no una página de métricas. Ctrl/⌘+K abre la paleta de comandos (`cmdk.js`).

> Nota: el panel legacy `dashboard/` (login por API key, uso interno) sigue en violeta `#6c5ce7` y NO forma parte de esta identidad. No se migra.

## Theme

Oscuro por defecto (dark-only). Fondo casi negro **frío** (`#0a0b0d`), no negro puro. Producto tech premium nocturno. El lima carga todo el protagonismo del acento; el fondo drenado ES la marca. No existe surface claro.

## Color Palette

| Rol | Token | Valor | Nota |
|-----|-------|-------|------|
| Fondo | `--bg` | `#0a0b0d` | casi negro frío |
| Fondo 2 | `--bg-2` | `#0f1216` | secciones alternas / selects |
| Superficie | `--bg-card` | `rgba(255,255,255,.035)` | tarjetas (translúcido) |
| Borde | `--border` | `rgba(232,242,238,.10)` | fino |
| **Acento** | `--accent` | **`#c4f546`** | **lima eléctrica (primario)** |
| Acento claro | `--accent-l` | `#d6ff5c` | lima clara (hover/realces, texto sobre oscuro) |
| Cian | `--cyan` | `#38e1c8` | acento secundario, datos |
| Verde | `--green` | `#2ea96f` | éxito, garantías |
| Amarillo | `--yellow` | `#f6c544` | semántico: aviso / "necesita atención" (no es marca) |
| Texto | `--text` | `rgba(226,232,231,.82)` | cuerpo |
| Texto 2 | `--text-2` | `rgba(226,232,231,.66)` | secundario |
| Blanco | `--white` | `#f4f7f5` | titulares |

**Regla de oro del acento:** el lima es MUY claro → **el texto/iconos SOBRE el acento van en casi-negro `#0a0b0d`**, nunca blancos. Botones primarios = lima sólido/gradiente `linear-gradient(135deg,var(--accent-l),var(--accent))` con glow `rgba(196,245,70,.35–.5)`.

**RGB del lima** (para rgba): `196,245,70` (base), `214,255,92` (claro). Usar siempre estos, nunca ámbar (`224,162,60`/`240,168,48`) ni violeta (`108,92,231`) — ya purgados.

**Anti-patrón:** texto con gradiente (`background-clip:text`). Los realces de titular usan color sólido `--accent-l` o subrayado con glow (`.hl-247`), no gradiente sobre texto.

## Typography

- **Display / titulares:** `Fraunces` (serif óptico), pesos 500–700, `letter-spacing` negativo (≈ −0.02em). Da el contraste diferencial frente al "Inter en todo" genérico.
- **Cuerpo / UI:** `Inter`, pesos 400–900.
- Titulares hero con `clamp()` grande; cap de línea de cuerpo 65–75ch.

## Components

- **Botones:** primario lima con glow; secundario outline translúcido (`btn-outline`), hover que tinta lima suave.
- **Badges/pills:** redondeados, fondo translúcido tintado de lima, borde fino. Estados semánticos con verde/amarillo/rojo (no confundir con marca).
- **Tarjetas:** `--bg-card` + borde fino + `--radius`. Variar (evitar rejillas idénticas).
- **Voice player (onboarding/landing):** botón play circular lima con glow, waveform de barras animadas (`prefers-reduced-motion` obligatorio), transcript en caja lima translúcida.
- **Fondo animado (landing):** orbes con blur + grid enmascarado con `radial-gradient` mask. Material premium.

## Layout

- `--radius` 16px, `--radius-sm` 10px.
- Secciones full-width alternando `--bg` / `--bg-2`.
- `--ease: cubic-bezier(0.4,0,0.2,1)`.
- Móvil primero (la mayoría del tráfico).

## Motion

`fadeInUp` en entradas, palabra del hero rotando por sector, waveforms. **Cada animación DEBE tener `@media (prefers-reduced-motion: reduce)`.**

## Accesibilidad (ya implementada, mantener)

`:focus-visible` con outline lima (`--accent-l`) offset 3px en toda superficie interactiva; `role=alert`/`aria-live` en errores; `aria-label`/`aria-pressed` en controles del voice demo.
