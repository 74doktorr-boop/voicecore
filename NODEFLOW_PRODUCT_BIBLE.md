# NODEFLOW — PRODUCT BIBLE

> **Documento canónico.** Es la fuente de verdad del producto NodeFlow. **Toda
> decisión futura — de producto, diseño, ingeniería, IA, copy o negocio — debe
> respetar este documento.** Ante cualquier duda o conflicto, gana la Biblia. Si
> algo choca con ella, o se cambia la decisión, o se cambia la Biblia con un
> motivo explícito; nunca se ignora en silencio.
>
> Versión viva: se enmienda con intención, no por capricho. Cada enmienda deja
> claro **qué** cambia y **por qué**.

---

## 0 · Qué es NodeFlow (en una frase)

NodeFlow es el **recepcionista con IA de voz** de los negocios locales de España:
atiende su teléfono 24/7 con voz natural, agenda citas, capta a quien llama y
avisa al dueño — y por debajo es el **cerebro** del negocio (CRM, recuperación de
oportunidades, lista de espera, resumen diario). Convierte llamadas perdidas en
clientes, sin que el dueño cambie su forma de trabajar.

**Para quién:** dueños de negocios locales (clínicas, peluquerías, talleres,
restaurantes, despachos…), muchos en Euskadi, Navarra y Galicia. Gente que
**trabaja con las manos**, revisa el móvil **30 segundos entre cliente y
cliente**, no es técnica y desconfía del software complicado y del humo.

---

## 1 · Visión a 10 años

**Que cualquier negocio local de España tenga, por menos de lo que cuesta una
comida, un empleado de IA que nunca falla: contesta, agenda, recuerda, recupera y
aprende — en su idioma y con su forma de ser.**

En diez años NodeFlow no es "un contestador con IA": es la **capa operativa
invisible** de los negocios de barrio. El dueño sigue haciendo lo que sabe hacer;
NodeFlow se ocupa de todo lo que le hacía perder clientes y horas. La visión se
cumple cuando:

- Un negocio nuevo de **cualquier sector** — uno que nadie ha "programado" antes —
  se da de alta, se describe con sus palabras y en minutos tiene un recepcionista
  que entiende SU vertical. El coste marginal de dar servicio a un sector nuevo
  tiende a **cero**.
- El sistema **mejora solo**: aprende de sus propias llamadas, por sector, y se
  vuelve mejor cada semana sin que nadie lo reprograme.
- NodeFlow habla **castellano, euskera y galego** con naturalidad nativa, y es
  orgullosamente de **Euskal Herria** sin dejar de ser para toda España.
- La palabra "NodeFlow" es sinónimo de **fiable** entre quienes desvían su
  teléfono a una máquina — el mayor acto de confianza que un negocio puede hacer.

No competimos por ser el asistente de IA más "avanzado" de una demo. Competimos
por ser el que un fontanero, una peluquera o un dentista **se atreven a dejar al
mando de su teléfono** — y no se arrepienten.

---

## 2 · Misión

**Que ningún negocio local pierda un cliente por no poder coger el teléfono.**

Hacemos eso con tres compromisos:

1. **Cero llamadas perdidas.** El teléfono se contesta siempre, a cualquier hora,
   en festivos, mientras el dueño trabaja.
2. **Sin complicarle la vida.** Se instala sin cambiar de número, sin permanencia,
   sin manuales, sin ser técnico. Activo en minutos.
3. **Ganándonos la confianza cada día.** Con honestidad radical: nunca prometemos
   lo que no podemos cumplir, nunca inventamos, nunca dejamos que suene a humo.

---

## 3 · Valores

1. **Confianza por encima de todo.** Pedimos el acto de fe más grande de un
   negocio — desviar su teléfono a una IA. Cada decisión se gana esa confianza o
   la traiciona. La honestidad no es una política: es parte del producto.
2. **Honestidad radical.** Cero claims falsos, cero testimonios inventados, cero
   números inflados. Si el asistente no sabe algo, lo dice. Si no puede hacer
   algo, no lo promete. Un catálogo, una voz, un precio: siempre reales.
3. **Del lado del negocio de barrio.** Hablamos su idioma, no el de Silicon
   Valley. Beneficios concretos ("citas mientras trabajas") por encima de la jerga
   tech. Cercanía vasca, no frialdad SaaS.
4. **Extraordinarios y cercanos a la vez.** Debe notarse que es IA de verdad, de
   primera — y a la vez sentirse humano y de fiar. Ni tibio ni de catálogo.
5. **Rigor de ingeniería.** Evidencia antes que opinión. Causa raíz antes que
   parche. Reglas de negocio deterministas, no a merced del LLM. Se instrumenta
   antes de cambiar.
6. **Mejora continua.** El producto y cada asistente aprenden de la realidad —
   por sector — y se vuelven mejores solos, con supervisión humana en el gate.
7. **Simplicidad militante.** Cada elemento que añadimos debe ganarse su sitio. Lo
   que no ayuda al dueño en 30 segundos, sobra.

---

## 4 · Filosofía de diseño

**"Electric Night": lima eléctrica sobre casi-negro frío.** Identidad canónica,
compartida por landing, onboarding y portal. Producto tech premium **nocturno**,
con personalidad fuerte y momentos memorables — nunca genérico.

Principios rectores:

- **Confianza primero.** Si algo huele a plantilla, a humo o a estafa, fuera. La
  credibilidad se diseña, no solo se escribe.
- **Diferénciate o no existes.** Si la pantalla se pudiera confundir con
  cualquier otra "herramienta de IA", está fallada. Rechazamos el look genérico:
  nada de morado-de-stock, nada de texto con gradiente, nada de plantilla SaaS.
- **Demuéstralo, no lo cuentes.** Enseñar el producto funcionando (la voz, la
  conversación, datos reales) en vez de afirmarlo. *Show, don't tell.*
- **Móvil primero, siempre.** El dueño abre NodeFlow desde el móvil entre
  clientes. Cada decisión se valida en móvil antes que en desktop.
- **El fondo drenado ES la marca.** El lima carga todo el protagonismo del
  acento; se usa para acción, selección y estado — nunca de adorno.
- **Una sola fuente de verdad visual.** `nf-design-system.css` manda: tokens,
  componentes y motion. No se añade CSS inline nuevo en el portal: se extiende el
  design system.
- **Tipografía con intención.** Fraunces (display serif) para titulares con
  carácter; Inter para toda la UI. Contraste por peso y tamaño, no por trucos.
- **Motion que comunica estado**, no que decora. Cada animación tiene su
  alternativa con `prefers-reduced-motion`.

---

## 5 · Principios UX

1. **30 segundos o nada.** El dueño mira el móvil entre clientes. Lo importante se
   entiende y se acciona en un vistazo. Si necesita pensar, hemos fallado.
2. **El dashboard es un copiloto, no un cuadro de mandos.** "Hoy NodeFlow ya ha
   trabajado por ti": qué ha hecho, qué recomienda, qué puedes hacer ya — no un
   muro de métricas que hay que interpretar.
3. **Una cosa cada vez.** Progresión clara, sin interrogatorios ni formularios
   infinitos. Perfilado progresivo: pedimos lo justo, cuando toca.
4. **Defaults inteligentes.** El sistema propone lo sensato (sector, servicios,
   modo) desde lo que ya sabe del negocio; el dueño ajusta, no configura de cero.
5. **Estados honestos.** Cargando, vacío, error y éxito se diseñan de verdad. Un
   estado vacío enseña a usar la interfaz; no dice "no hay nada".
6. **El producto se explica solo.** Copy claro en la lengua del dueño, sin jerga.
   Si hace falta un manual, el diseño está mal.
7. **Reversibilidad y seguridad.** Las acciones destructivas o de dinero se
   confirman. El dueño nunca teme "romper algo".
8. **Verificar en real antes de dar por hecho.** Ningún cambio de UI se considera
   listo sin verlo funcionando (preview) con evidencia visual.

---

## 6 · Principios de IA

1. **Las reglas de negocio viven FUERA del LLM.** Cupos, dicción de precios,
   fichaje de leads, candados de reserva, degradación de voz: candados
   deterministas server-side. El margen y la fiabilidad no dependen de que el
   modelo acierte.
2. **El LLM conversa; el sistema decide.** El modelo da naturalidad; las acciones
   con consecuencias (agendar, cobrar, prometer) pasan por lógica verificable.
3. **Honestidad de capacidades.** El asistente **nunca promete lo que no puede
   cumplir**: ni enviar emails/WhatsApps que no envía, ni plazos que no controla
   ("el equipo te llamará muy pronto"), ni datos que no tiene. Registra el lead y
   dice la verdad.
4. **Nada de diagnóstico ni asesoramiento profesional por teléfono.** En salud,
   legal o psicología: triaje y confidencialidad sí; diagnóstico, medicación,
   asesoramiento o terapia, jamás. Deriva siempre al profesional.
5. **Sector-aware de punta a punta.** Cada llamada se juzga, agrupa, mejora y mide
   con la rúbrica de SU vertical. Lo que se aprende en un restaurante no
   contamina a las clínicas.
6. **Aprende, pero con gate humano.** El bucle de mejora saca reglas candidatas de
   las llamadas reales; **un humano aprueba** antes de que toquen producción, y un
   replay contra llamadas reales valida que no empeora. Jamás auto-mutación del
   prompt en producción sin ese candado.
7. **Rápido de verdad.** Presupuesto de latencia por turno estricto (objetivo
   <700 ms de proceso). Una conversación telefónica no espera.
8. **Voz honesta.** La voz que se elige es la que suena. Nada de ofrecer voces que
   no se pueden reproducir o que colapsan todas a una.
9. **Trazable y auto-diagnosticable.** Cada llamada se persiste y se audita sola;
   si algo va mal, NodeFlow lo sabe antes de que el negocio se queje.

---

## 7 · Cómo debe sentirse un usuario al usar NodeFlow

- **Aliviado.** "Ya no pierdo llamadas. Ya no tengo que estar pendiente."
- **En control, sin esfuerzo.** Ve de un vistazo lo que su asistente ha hecho por
  él hoy, y decide con un toque. Nunca abrumado.
- **Impresionado, pero tranquilo.** "Esto es IA de verdad" y a la vez "esto está
  hecho para mí, no para un ingeniero de San Francisco".
- **Confiado.** Nunca teme que el asistente diga una tontería, invente un precio o
  prometa algo imposible. Sabe que suena profesional y honesto.
- **Comprendido.** El sistema habla su idioma (literal: es/eu/gl, y figurado: el
  de su negocio) y entiende su sector sin que él tenga que explicarlo todo.
- **Orgulloso.** De tener algo que suena de primera atendiendo a sus clientes.

Lo que un usuario **nunca** debe sentir: confusión, desconfianza, la sensación de
estar usando "otro software más", o de que le hablan por encima.

---

## 8 · Qué diferencia a NodeFlow de todos sus competidores

1. **Confianza diseñada, honestidad radical.** La mayoría de asistentes de IA
   prometen de más y suenan a demo. NodeFlow se construye para que el dueño se
   atreva a dejarle su teléfono — con capacidades honestas y cero humo.
2. **Adaptación por sector, sin coste por cliente.** No somos un asistente
   genérico con un prompt para todos. Cada vertical tiene sus normas, sus métricas
   y su forma de atender — y el sistema **genera un sector nuevo solo** cuando
   entra un negocio que nadie había cubierto. Escalar a cualquier sector no nos
   cuesta trabajo por cliente.
3. **Mejora sola, por vertical.** El producto aprende de sus propias llamadas y se
   afina por sector, con gate humano. No se queda quieto.
4. **De aquí, en su idioma.** Castellano, euskera y galego con naturalidad nativa.
   Hecho en Euskal Herria, orgulloso de ello. Ningún competidor global habla así.
5. **Cerebro, no solo voz.** No solo contesta: recupera oportunidades perdidas,
   gestiona lista de espera, recuerda citas, resume el día. Vale por un equipo.
6. **Determinismo donde importa.** El margen, los cupos y las promesas no dependen
   del humor del modelo: son candados. Fiable a escala.
7. **Estética que no parece IA.** "Electric Night" — memorable, con personalidad,
   imposible de confundir con la plantilla SaaS morada de turno.

Si algún día NodeFlow se pudiera confundir con "otro asistente de IA", habríamos
perdido nuestra única ventaja que no se copia: **la confianza y la adaptación
real.**

---

## 9 · Principios de simplicidad

1. **Lo por defecto debe ser lo correcto.** El 90% de los dueños no tocan
   configuración: la que sale de fábrica ya funciona bien para su sector.
2. **Cada elemento se gana su sitio.** Si no ayuda al dueño en su realidad de 30
   segundos, se quita. Las tarjetas y las secciones no se acumulan "por si acaso".
3. **Esconde la complejidad, no al usuario.** Por debajo puede haber un sistema
   sofisticado (sector-aware, bucle de mejora, multi-proveedor de voz); por
   arriba, el dueño ve simplicidad.
4. **Menos pasos, menos campos, menos decisiones.** Autodetectar antes que
   preguntar. Proponer antes que exigir configurar.
5. **Una forma de hacer cada cosa.** No dos caminos para lo mismo; no dos fuentes
   de verdad para el mismo dato.
6. **La simplicidad es del usuario, la sofisticación es nuestra.** Nosotros
   asumimos el trabajo difícil para que el dueño no lo vea.

---

## 10 · Principios de automatización

1. **NodeFlow trabaja solo; el dueño supervisa.** El valor está en lo que pasa sin
   que el dueño haga nada: contestar, agendar, recordar, recuperar, avisar.
2. **Automatizar con red, no a ciegas.** Toda automatización tiene su candado
   determinista y su fail-safe: si una vía falla, otra salva el resultado (el lead
   nunca se pierde, la demo nunca se rompe).
3. **El humano en el gate de lo irreversible.** Aprender y proponer, automático.
   Aplicar cambios que afectan a todos (reglas de prompt, sectores nuevos): con
   aprobación humana y validación previa.
4. **Fail-open donde toca, fail-safe donde duele.** Si falta una tabla o un
   proveedor, el sistema sigue con lo que tiene (fail-open). Si hay dinero o una
   promesa de por medio, se es conservador (fail-safe).
5. **Idempotencia y no-duplicación.** Reintentos, webhooks y crons no cobran dos
   veces, no avisan dos veces, no rompen estado.
6. **Automatización honesta.** Nunca automatizamos una promesa que el negocio no
   va a cumplir. Si el asistente dice "te contactamos", detrás hay un lead fichado
   de verdad.

---

## 11 · Principios de accesibilidad

1. **WCAG 2.1 AA como suelo, no como techo.** Contraste de texto ≥ 4.5:1 (large
   ≥ 3:1); los placeholders también. Nada de gris clarito "por elegancia" que no
   se lee al sol en un móvil.
2. **`prefers-reduced-motion` en todas las animaciones.** Siempre hay una
   alternativa (crossfade o instantáneo). El motion no es un requisito para
   entender ni usar la interfaz.
3. **Legible en la calle, en un móvil, con prisa.** Tamaños y contrastes pensados
   para el peor caso real: pantalla pequeña, luz de sol, 30 segundos.
4. **Multiidioma de verdad.** Castellano, euskera y galego — no un
   after-thought. El asistente y la interfaz respetan la lengua del negocio.
5. **Foco, teclado y semántica.** Estados de foco visibles, navegación por
   teclado, HTML semántico. Nada de afordancias inventadas para tareas estándar.
6. **Comprensible para no técnicos.** La accesibilidad también es cognitiva: copy
   claro, sin jerga, en la lengua del dueño.

---

## 12 · Sistema de nomenclatura

**Regla madre: se nombra en el idioma del negocio, no en el de la tecnología.**

- **Producto y funciones:** nombre por el **beneficio**, no por la mecánica.
  "Recepcionista IA", "Recupera y gana", "Base de conocimiento", "Minutos de este
  mes" — no "endpoint", "webhook", "pipeline". Si un dueño no lo entendería, no es
  su nombre.
- **Niveles de voz / planes:** claros y honestos. **Estándar** (incluida),
  **Premium** (+precio). Nunca un nombre que prometa lo que no da.
- **Sectores (verticales):** `slug` en minúsculas, sin tildes, con guion bajo
  (`clinica`, `guarderia_canina`); **etiqueta** legible para humanos ("Clínica
  dental"); **alias** para las variantes que teclea la gente. Los slugs de un
  sector coinciden en todo el sistema (prompt, auditor, agregador, selector): una
  sola fuente.
- **Voces:** nombre humano propio (Blanca, Marcos, Cristina) + su nivel. Cada voz
  apunta a un `providerVoiceId` **real y único** — jamás dos voces que suenan
  igual con distinto nombre.
- **Código:** módulos y funciones descriptivos y en la línea del que rodea. Las
  métricas de sector usan `key` en `minusculas_con_guiones` y una etiqueta-pregunta
  de sí/no que un auditor pueda responder.
- **Copy de UI:** verbos de acción, cortos, en usted por defecto hasta que el
  cliente sea informal. Sin emojis en la voz del asistente ni en llamadas.
- **Marca:** "NodeFlow" (una palabra, N y F mayúsculas). El acento es el lima
  `#c4f546`; el "em" del logo va en lima.

---

## 13 · Reglas de consistencia

1. **Una sola fuente de verdad, siempre.** Un dato, un sitio. El catálogo de
   sectores, el de voces, los tokens de diseño, la config del asistente: cada uno
   tiene su fuente única y todo lo demás la lee. Nada de listas duplicadas
   (p.ej. sectores hardcodeados en el front **y** en el back — prohibido).
2. **El design system es la API pública.** `.card`, `.btn`, `.kpi`, `.badge`… son
   el contrato; el DS los viste. No se reinventan por página.
3. **Misma acción, mismo aspecto y mismo nombre.** Si "Guardar" se ve o se llama
   distinto en dos sitios, uno está mal.
4. **Identidad única en las tres superficies.** Landing, onboarding y portal
   comparten marca, tokens y tono. El dueño no siente que cambia de producto.
5. **Tono coherente.** Directo, humano, honesto, en su idioma — en el copy, en la
   voz del asistente y en los avisos.
6. **Los tests fijan la consistencia.** Lo que debe cumplirse (unicidad de voces,
   cobertura de sectores, honestidad del catálogo, reglas aprendidas) se blinda
   con tests para que no se caiga en silencio.
7. **Deploy coherente con la arquitectura.** Portal/demo por su vía; backend por
   la suya. El sistema se auto-cura según lo que hay configurado (filtro de
   honestidad), no según supuestos.

---

## 14 · Qué NUNCA debe hacerse en NodeFlow

**Confianza y honestidad**
- Nunca hacer un claim falso, inventar un testimonio o inflar un número.
- Nunca prometer, por voz o por UI, algo que el producto no puede cumplir (enviar
  emails/WhatsApps que no envía, plazos que no controla, datos que no tiene).
- Nunca dar diagnóstico, medicación, asesoramiento legal/fiscal o terapia por
  teléfono. Nunca romper la confidencialidad en sectores sensibles.
- Nunca ofrecer una voz, un servicio o un precio que no sea real.

**IA e ingeniería**
- Nunca poner una regla de negocio crítica solo en manos del LLM.
- Nunca auto-mutar el prompt en producción sin aprobación humana + replay que
  valide que no empeora.
- Nunca aplicar a todos los sectores algo aprendido en uno; nunca contaminar
  verticales entre sí.
- Nunca dar un cambio por bueno sin evidencia (tests verdes, verificación real).
- Nunca hardcodear el conocimiento de un sector en varios sitios: el coste de un
  vertical nuevo debe tender a cero.

**Diseño y UX**
- Nunca parecer "otro asistente de IA": ni morado-de-stock, ni texto con
  gradiente, ni hero de número gigante, ni rejillas de tarjetas idénticas, ni
  eyebrows en mayúsculas sobre cada sección, ni glassmorphism de adorno.
- Nunca texto gris clarito ilegible, ni gatear la visibilidad del contenido a una
  animación (que en móvil o headless deja la pantalla en blanco).
- Nunca una secuencia de carga decorativa; el motion comunica estado, no adorna.
- Nunca añadir CSS inline nuevo en el portal en vez de extender el design system.
- Nunca diseñar primero para desktop.

**Negocio y trato**
- Nunca hablar el idioma de Silicon Valley al dueño de barrio; nunca jerga tech.
- Nunca exigir que el usuario sea técnico ni obligarle a leer un manual.
- Nunca pedir datos sensibles por voz cuando hay una vía mejor (p.ej. dictar un
  email por teléfono).
- Nunca sonar frío, corporativo o de catálogo. Nunca ser tibio.

---

### Cierre

NodeFlow gana por **confianza + adaptación real**, no por parecer la IA más
lista de una demo. Cada línea de código, cada pantalla y cada palabra que un
cliente escucha deben ganarse esa confianza y respetar esta Biblia. Si una
decisión no cabe aquí, no es una decisión de NodeFlow.
