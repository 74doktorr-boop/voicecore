// ============================================================
// NodeFlow — Tour interactivo del portal (primera vez)
// Autónomo, sin librerías. Pensado para dueños de negocio no
// técnicos (55+): pasos grandes, una idea por paso, lenguaje llano.
// Se lanza solo en el primer login; se puede repetir con el botón "?".
//
// Cada paso ENTRA de verdad en su sección (navigate()) y resalta el
// control importante, para que el dueño vea la sección real mientras se
// la explicamos. Estética dark + lima, a juego con el portal y la landing.
// ============================================================
(function () {
  'use strict';
  var DONE_KEY = 'nf_tour_v1_done';

  // section: a qué sección entrar (navigate). target: qué resaltar dentro
  // (si no existe, cae al item del menú #nav-<section>; si tampoco, centrado).
  // Recorre el portal de arriba abajo, como el menú de la izquierda.
  var STEPS = [
    { section: 'dashboard', target: null, title: '¡Bienvenido a NodeFlow! 👋',
      body: 'Te voy a enseñar tu portal entero, sin prisa y entrando en cada sección para que veas cómo es de verdad. Son un par de minutos y puedes salir cuando quieras con «Saltar». Si solo haces una cosa hoy, que sea «Tu asistente» (lo verás marcado con una ⭐). ¿Empezamos?' },

    // ── RESUMEN ──
    { section: 'dashboard', target: '#nav-dashboard', title: 'Tu panel de inicio',
      body: 'Nada más entrar ves lo que tu asistente ha hecho hoy por ti: llamadas atendidas, citas reservadas y lo que tienes pendiente. Arriba, el copiloto te sugiere qué conviene hacer ahora.' },

    // ── ACTIVIDAD ──
    { section: 'llamadas', target: '#nav-llamadas', title: 'Tus llamadas',
      body: 'El registro de cada llamada que atiende tu asistente. Puedes abrir cualquiera y leer la conversación entera — perfecto para comprobar, cuando quieras, que habla como a ti te gusta.' },

    { section: 'citas', target: '#nav-citas', title: 'Tu agenda',
      body: 'Todas tus citas, ordenadas por día. Las que reserva el asistente aparecen solas; y con el botón «+ Nueva cita» apuntas una a mano en un momento.' },

    { section: 'clientes', target: '#nav-clientes', title: 'Tus clientes',
      body: 'La ficha de cada cliente, con su historial y sus datos. Tu asistente los va guardando sola según llaman, así que tu lista de clientes crece sin que tú hagas nada.' },

    // ── POR HACER ──
    { section: 'oportunidades', target: '#nav-oportunidades', title: 'Oportunidades',
      body: 'Clientes que llamaron pero no llegaron a cerrar cita. Es dinero a punto de escaparse: desde aquí los recuperas con un clic (una llamada o un mensaje del asistente) antes de que se enfríen.' },

    { section: 'espera', target: '#nav-espera', title: 'Lista de espera',
      body: 'Cuando no tienes hueco para alguien, lo apuntas aquí. Si luego se libera un hueco, tu asistente avisa solo a quien estaba esperando. Ninguna cancelación se queda en un hueco vacío.' },

    { section: 'tareas', target: '#nav-tareas', title: 'Mis tareas',
      body: 'Tu lista de pendientes dentro del portal. El asistente añade tareas solo («devuelve la llamada a…», «confirma la cita de…») y tú apuntas las tuyas. Así no se te olvida nada.' },

    { section: 'seguimientos', target: '#nav-seguimientos', title: 'Seguimientos',
      body: 'Los avisos automáticos que recuerdan las citas y recuperan a los clientes que hace tiempo que no vienen. Los enciendes una vez y ella se encarga del resto.' },

    // ── CRECIMIENTO ──
    { section: 'informes', target: '#nav-informes', title: 'Informes',
      body: 'El crecimiento de tu negocio en números: llamadas, reservas, horas que te has ahorrado e ingresos estimados, mes a mes. Y si quieres, te lo descargas en un clic.' },

    { section: 'insights', target: '#nav-insights', title: 'Insights',
      body: 'Lo que tu asistente aprende de las conversaciones: qué te preguntan más, qué no supo responder, a qué horas llaman más… Pistas muy útiles para mejorar tu negocio.' },

    { section: 'referidos', target: '#nav-referidos', title: 'Recomienda y gana',
      body: '¿Conoces otro negocio al que le vendría bien un asistente así? Compártele tu enlace y, si se da de alta, te llevas una recompensa en tu cuota. Todos ganáis.' },

    { section: 'widget', target: '#nav-widget', title: 'Widget para tu web',
      body: 'Un botón para tu página web: quien te visite puede hablar con tu asistente o pedir cita sin llamar. Aquí lo configuras y copias el código — o nos dices y te lo ponemos nosotros.' },

    // ── TU ASISTENTE ──
    { section: 'asistente', target: '#testCallBtn', title: 'Tu asistente ⭐',
      body: 'El corazón de todo. Aquí eliges su nombre, su voz, el saludo y tus servicios y precios. ¿Ves este botón? Con «Llámame ahora» tu asistente te llama al instante para que lo escuches tal y como está. Es lo primero que conviene rellenar.' },

    { section: 'conocimiento', target: '#kbText', title: 'Base de conocimiento',
      body: 'En este cuadro le cuentas todo lo demás de tu negocio: horarios, seguros que aceptas, cómo llegar, promociones… Pon solo lo que sea VERDAD: se lo dirá tal cual a tus clientes, y nunca se inventa nada.' },

    { section: 'automatizaciones', target: '#nav-automatizaciones', title: 'Automatizaciones',
      body: 'Los interruptores finos de todo lo automático: qué avisos manda, cuándo confirma las citas, si pide reseñas en Google… Déjalo a tu gusto. Para la mayoría, lo de fábrica ya va perfecto.' },

    { section: 'integraciones', target: '#nav-integraciones', title: 'Integraciones',
      body: 'Conecta tu Google Calendar y tu WhatsApp para que las citas entren en el calendario que ya usas y todo funcione junto, con lo que tienes.' },

    // ── CUENTA ──
    { section: 'facturacion', target: '#nav-facturacion', title: 'Tu plan y tus facturas',
      body: 'Aquí ves tus minutos del mes, tu plan y todas tus facturas para descargar. Todo claro y en un solo sitio, sin sorpresas.' },

    { section: 'configuracion', target: '#nav-configuracion', title: 'Configuración',
      body: 'Los datos de tu cuenta y de tu negocio: nombre, contacto, contraseña y preferencias. Entra aquí de vez en cuando para tenerlo todo al día.' },

    { section: 'ayuda', target: '#nav-ayuda', title: 'Ayuda',
      body: '¿Te atascas con algo? Aquí tienes ayuda y cómo escribirnos. Y recuerda: el botón «?» de abajo a la derecha repite este tour siempre que lo necesites.' },

    { section: 'dashboard', target: null, title: '¡Ya está! 🎉',
      body: 'Ya conoces tu portal de punta a punta. Nuestro consejo para empezar: entra en «Tu asistente» y cuéntale sobre tu negocio. Lo demás lo vas afinando con calma.',
      cta: '¡Empezar!' },
  ];

  var idx = 0, els = null;

  function injectStyles() {
    if (document.getElementById('nf-tour-style')) return;
    var css =
      // Overlay: dim suave para que la sección real siga viéndose detrás.
      '#nf-tour-ov{position:fixed;inset:0;z-index:9000;pointer-events:auto}' +
      '#nf-tour-spot{position:absolute;border-radius:12px;box-shadow:0 0 0 9999px rgba(5,7,3,.52);' +
        'outline:3px solid #c4f546;outline-offset:3px;transition:all .3s cubic-bezier(.2,.7,.2,1);pointer-events:none}' +
      '#nf-tour-spot.center{box-shadow:0 0 0 9999px rgba(5,7,3,.72);outline:none;width:2px;height:2px;left:50%;top:44%}' +
      // Tarjeta: dark glass + borde lima, a juego con el portal.
      '#nf-tour-card{position:fixed;z-index:9001;max-width:380px;width:calc(100vw - 32px);' +
        'background:linear-gradient(180deg,#161a20,#0f1115);color:#e9ecf3;' +
        'border:1px solid rgba(196,245,70,.30);border-radius:18px;padding:20px 22px 18px;' +
        'box-shadow:0 20px 60px rgba(0,0,0,.6),0 0 44px rgba(196,245,70,.07),inset 0 1px 0 rgba(255,255,255,.04);' +
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;' +
        'transition:all .3s cubic-bezier(.2,.7,.2,1)}' +
      '#nf-tour-eyebrow{display:flex;align-items:center;gap:7px;font-size:11.5px;font-weight:800;' +
        'letter-spacing:.09em;text-transform:uppercase;color:#c4f546;margin-bottom:10px}' +
      '#nf-tour-eyebrow .dot{width:7px;height:7px;border-radius:50%;background:#c4f546;box-shadow:0 0 8px rgba(196,245,70,.7)}' +
      '#nf-tour-card h3{margin:0 0 8px;font-size:21px;line-height:1.22;letter-spacing:-.01em;color:#f3f7ec;font-weight:800}' +
      '#nf-tour-card p{margin:0 0 16px;font-size:16.5px;line-height:1.55;color:#bcc4d0}' +
      '#nf-tour-dots{display:flex;gap:6px;margin-bottom:14px}' +
      '#nf-tour-dots i{width:8px;height:8px;border-radius:50%;background:rgba(255,255,255,.16);display:block;transition:all .3s}' +
      '#nf-tour-dots i.on{background:#c4f546;width:22px;border-radius:5px;box-shadow:0 0 10px rgba(196,245,70,.5)}' +
      '#nf-tour-actions{display:flex;align-items:center;gap:10px;justify-content:space-between}' +
      '#nf-tour-actions .sp{flex:1}' +
      '.nf-tour-btn{border:none;border-radius:999px;padding:12px 22px;font-size:16px;font-weight:800;cursor:pointer;font-family:inherit;transition:all .15s}' +
      '.nf-tour-btn.pri{background:#c4f546;color:#0a0b0d;box-shadow:0 4px 18px rgba(196,245,70,.28)}' +
      '.nf-tour-btn.pri:hover{background:#d6ff5c}' +
      '.nf-tour-btn.sec{background:rgba(255,255,255,.07);color:#e9ecf3;border:1px solid rgba(255,255,255,.13)}' +
      '.nf-tour-btn.sec:hover{background:rgba(255,255,255,.13)}' +
      '.nf-tour-skip{background:none;border:none;color:#8b93a3;font-size:15px;cursor:pointer;text-decoration:underline;font-family:inherit;padding:6px}' +
      '.nf-tour-skip:hover{color:#c2c8d2}' +
      '#nf-tour-help{position:fixed;right:18px;bottom:18px;z-index:8000;width:56px;height:56px;border-radius:50%;' +
        'background:#c4f546;color:#0a0b0d;border:none;font-size:26px;font-weight:800;cursor:pointer;box-shadow:0 6px 20px rgba(196,245,70,.4)}' +
      '#nf-tour-help:hover{background:#d6ff5c}' +
      '@media(max-width:600px){#nf-tour-card{font-size:16px;left:16px!important;right:16px!important;bottom:16px!important;top:auto!important;max-width:none;width:auto}}';
    var s = document.createElement('style'); s.id = 'nf-tour-style'; s.textContent = css;
    document.head.appendChild(s);
  }

  function build() {
    var ov = document.createElement('div'); ov.id = 'nf-tour-ov';
    var spot = document.createElement('div'); spot.id = 'nf-tour-spot';
    var card = document.createElement('div'); card.id = 'nf-tour-card';
    ov.appendChild(spot); document.body.appendChild(ov); document.body.appendChild(card);
    // Clic en el fondo oscuro no cierra (evita salidas accidentales); solo botones.
    return { ov: ov, spot: spot, card: card };
  }

  function dots() {
    var h = '<div id="nf-tour-dots">';
    for (var i = 0; i < STEPS.length; i++) h += '<i class="' + (i === idx ? 'on' : '') + '"></i>';
    return h + '</div>';
  }

  // Entra en la sección del paso y devuelve el elemento a resaltar (control
  // real → item de menú → nada/centrado).
  function resolveTarget(st) {
    if (st.section && typeof window.navigate === 'function') {
      try { window.navigate(st.section); } catch (e) {}
    }
    if (!st.target) return null; // bienvenida / final → card centrada, sin resaltar
    var tgt = document.querySelector(st.target);
    if ((!tgt || tgt.offsetParent === null) && st.section) {
      tgt = document.getElementById('nav-' + st.section); // control no encontrado → item de menú
    }
    return tgt;
  }

  function render() {
    var st = STEPS[idx];
    var tgt = resolveTarget(st);
    var visible = tgt && tgt.offsetParent !== null && tgt.getBoundingClientRect().width > 0;

    if (visible) { try { tgt.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {} }

    // Reposicionar tras un pequeño margen para que el cambio de sección y el
    // scroll asienten antes de medir.
    setTimeout(function () { place(tgt, visible); }, st.section ? 240 : 0);

    var last = idx === STEPS.length - 1;
    var first = idx === 0;
    els.card.innerHTML =
      '<div id="nf-tour-eyebrow"><span class="dot"></span>NodeFlow · Guía rápida</div>' +
      dots() +
      '<h3>' + st.title + '</h3>' +
      '<p>' + st.body + '</p>' +
      '<div id="nf-tour-actions">' +
        (last ? '' : '<button class="nf-tour-skip" id="nf-tour-skip">Saltar</button>') +
        '<span class="sp"></span>' +
        (first || last ? '' : '<button class="nf-tour-btn sec" id="nf-tour-prev">Atrás</button>') +
        '<button class="nf-tour-btn pri" id="nf-tour-next">' + (last ? (st.cta || '¡Listo!') : 'Siguiente') + '</button>' +
      '</div>';

    var skip = document.getElementById('nf-tour-skip'); if (skip) skip.onclick = end;
    var prev = document.getElementById('nf-tour-prev'); if (prev) prev.onclick = function () { idx = Math.max(0, idx - 1); render(); };
    document.getElementById('nf-tour-next').onclick = function () {
      if (last) return end();
      idx = Math.min(STEPS.length - 1, idx + 1); render();
    };
  }

  function place(tgt, visible) {
    var spot = els.spot, card = els.card;
    if (!visible) {
      spot.className = 'center';
      spot.style.width = spot.style.height = '2px';
      // Card centrada
      card.style.left = '50%'; card.style.top = '50%';
      card.style.transform = 'translate(-50%,-50%)';
      return;
    }
    spot.className = '';
    var r = tgt.getBoundingClientRect(), pad = 6;
    spot.style.left = (r.left - pad) + 'px';
    spot.style.top = (r.top - pad) + 'px';
    spot.style.width = (r.width + pad * 2) + 'px';
    spot.style.height = (r.height + pad * 2) + 'px';
    // Colocar la card: a la derecha del elemento (nav va a la izquierda); si no cabe, debajo.
    card.style.transform = 'none';
    var cw = card.offsetWidth || 360, ch = card.offsetHeight || 200, gap = 18;
    var left, top;
    if (r.right + gap + cw < window.innerWidth) { left = r.right + gap; top = r.top; }
    else if (r.bottom + gap + ch < window.innerHeight) { left = Math.max(16, r.left); top = r.bottom + gap; }
    else { left = Math.max(16, r.left - cw - gap); top = r.top; }
    left = Math.min(left, window.innerWidth - cw - 16);
    top = Math.max(16, Math.min(top, window.innerHeight - ch - 16));
    card.style.left = left + 'px'; card.style.top = top + 'px';
  }

  var _onResize = function () { if (els) { var st = STEPS[idx]; var t = st.target ? document.querySelector(st.target) : (st.section ? document.getElementById('nav-' + st.section) : null); place(t, t && t.offsetParent !== null); } };

  function start() {
    injectStyles();
    if (els) return; // ya abierto
    idx = 0; els = build();
    window.addEventListener('resize', _onResize);
    render();
  }

  function end() {
    try { localStorage.setItem(DONE_KEY, '1'); } catch (e) {}
    window.removeEventListener('resize', _onResize);
    if (els) { els.ov.remove(); els.card.remove(); els = null; }
    // Dejar al dueño en su panel de inicio, listo para empezar.
    if (typeof window.navigate === 'function') { try { window.navigate('dashboard'); } catch (e) {} }
  }

  function helpButton() {
    if (document.getElementById('nf-tour-help')) return;
    var b = document.createElement('button'); b.id = 'nf-tour-help';
    b.textContent = '?'; b.title = 'Ver guía del portal';
    b.setAttribute('aria-label', 'Ver guía del portal');
    b.onclick = start; document.body.appendChild(b);
  }

  // Exponer para el resto del portal (p.ej. un botón "Ver tour" en Ayuda).
  window.startPortalTour = start;

  // ¿Hay un modal abierto? (crear/cambiar contraseña del primer acceso,
  // confirmaciones…). El tour NO debe lanzarse encima: lo taparía y dejaría al
  // usuario sin poder crear su contraseña ni usar el portal (la tarjeta va a
  // z-index 9000; el modal, a 300). Bug real detectado en un alta nueva.
  function isModalOpen() {
    // Ojo: los overlays son position:fixed → offsetParent es null aunque sean
    // visibles. Comprobamos display + ancho renderizado en su lugar.
    var ids = ['modalOverlay', 'confirmOverlay', 'promptOverlay'];
    for (var i = 0; i < ids.length; i++) {
      var el = document.getElementById(ids[i]);
      if (el && getComputedStyle(el).display !== 'none' && el.offsetWidth > 0) return true;
    }
    return false;
  }

  // Auto-arranque: espera a estar logueado (nav visible) Y a que no haya ningún
  // modal abierto. Así el «Crea tu contraseña» del primer acceso va SIEMPRE
  // primero; el tour arranca solo cuando el usuario lo cierra. El botón "?" se
  // añade en cuanto hay sesión, para poder repetir el tour a mano.
  var tries = 0, loggedInTicks = 0, helpAdded = false;
  var poll = setInterval(function () {
    tries++;
    if (tries > 600) { clearInterval(poll); return; } // ~5 min tope de seguridad
    var nav = document.getElementById('nav-dashboard');
    var loggedIn = nav && nav.offsetParent !== null;
    if (!loggedIn) return;
    if (!helpAdded) { injectStyles(); helpButton(); helpAdded = true; }
    var done = false; try { done = localStorage.getItem(DONE_KEY) === '1'; } catch (e) {}
    if (done || els) { clearInterval(poll); return; }
    loggedInTicks++;
    // Gracia de ~1s: da tiempo a que showApp abra el modal de contraseña
    // (lo lanza ~400ms tras el login) antes de que decidamos arrancar.
    if (loggedInTicks < 2) return;
    if (isModalOpen()) return; // hay un modal → seguir esperando a que se cierre
    clearInterval(poll);
    start();
  }, 500);
})();
