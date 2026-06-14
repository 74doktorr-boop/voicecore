# Design

Sistema visual actual de NodeFlow (capturado del código de `public/index.html`). Punto de partida para iterar — no una jaula. La marca es violeta sobre fondo casi negro; la identidad se preserva, pero el brief pide subir el nivel (ambicioso, diferencial, anti-genérico).

## Theme

Oscuro por defecto. Fondo casi negro con tinte violeta (`#070712`), no negro puro. Sensación de producto tech premium nocturno. El claro no aplica como surface principal de la landing.

## Color Palette

Estrategia actual: **committed/drenched oscuro** — el fondo casi negro ES la marca, el violeta carga el protagonismo.

| Rol | Token | Valor | Nota |
|-----|-------|-------|------|
| Fondo | `--bg` | `#070712` | casi negro, tinte violeta |
| Fondo 2 | `--bg-2` | `#0c0c1a` | secciones alternas |
| Superficie | `--bg-card` | `rgba(255,255,255,.03)` | tarjetas (translúcido) |
| Borde | `--border` | `rgba(255,255,255,.07)` | |
| Acento | `--accent` | `#7c3aed` | violeta-600 (primario) |
| Acento claro | `--accent-l` | `#a855f7` | violeta-500 |
| Cian | `--cyan` | `#22d3ee` | acento secundario, datos |
| Verde | `--green` | `#10b981` | éxito, garantías |
| Texto | `--text` | `rgba(200,200,230,.65)` | ⚠️ revisar contraste (0.65 sobre fondo oscuro puede quedar justo) |
| Blanco | `--white` | `#f0f0ff` | titulares |

**Pendiente de marca:** el portal usa `#6c5ce7` y la landing `#7c3aed` — unificar el violeta primario en algún momento. Evitar **texto con gradiente** (`background-clip:text`), presente hoy en `.gradient-text` y marcado como anti-referencia.

## Typography

- **Familia:** Inter (Google Fonts), pesos 300–900. Una sola familia en múltiples pesos.
- **Titulares:** `clamp()` grande, peso 800–900, `letter-spacing` negativo. Mantener floor ≥ −0.04em.
- **Cuerpo:** Inter regular sobre `--text`. Cap de línea 65–75ch.
- Oportunidad: la marca pide diferenciarse — considerar un segundo tipo con contraste real (display/serif/mono) para titulares o detalles, en vez de solo Inter en todo (que es el default seguro).

## Components

- **Botones:** primario violeta sólido (`--accent`) con glow; secundario outline translúcido.
- **Badges/pills:** redondeados, fondo translúcido tintado, borde fino.
- **Tarjetas:** `--bg-card` translúcido + borde fino + `--radius` 16px. Riesgo: rejillas de tarjetas idénticas = anti-referencia. Variar.
- **Fondo animado:** orbes con blur, grid sutil, ruido. Buen material premium — explotar más (blur, mask, glow) sin caer en "feria".

## Layout

- `--radius` 16px, `--radius-sm` 10px.
- Secciones full-width alternando `--bg` / `--bg-2`.
- `--ease: cubic-bezier(0.4,0,0.2,1)` — base correcta; para "a tope" usar curvas ease-out exponenciales en entradas.
- Móvil primero (la mayoría del tráfico).

## Motion

Hoy: orbes a la deriva, `fadeInUp` en entradas, palabra del hero rotando por sector. Brief = "a tope, sin límites": motion intencional como material (blur, clip-path, mask, scroll-driven), con `@media (prefers-reduced-motion: reduce)` obligatorio en cada animación.
