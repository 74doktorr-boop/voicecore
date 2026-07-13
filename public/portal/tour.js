// ============================================================
// NodeFlow — Tour interactivo del portal (primera vez)
// Autónomo, sin librerías. Pensado para dueños de negocio no
// técnicos (55+): pasos grandes, una idea por paso, lenguaje llano.
// Se lanza solo en el primer login; se puede repetir con el botón "?".
// ============================================================
(function () {
  'use strict';
  var DONE_KEY = 'nf_tour_v1_done';

  var STEPS = [
    { target: null, title: '¡Bienvenido a NodeFlow! 👋',
      body: 'Te enseño tu portal en un minuto, sin líos. Puedes salir cuando quieras pulsando «Saltar». ¿Empezamos?' },
    { target: '#nav-dashboard', title: 'Tu panel de inicio',
      body: 'De un vistazo: cuántas llamadas ha atendido tu asistente, cuántas citas ha reservado y qué tienes pendiente.' },
    { target: '#nav-citas', title: 'Tu agenda',
      body: 'Todas tus citas, ordenadas por día. Puedes ver, añadir o cambiar citas a mano cuando quieras.' },
    { target: '#nav-clientes', title: 'Tus clientes',
      body: 'La ficha de cada cliente, con su historial y sus datos. Tu asistente los va guardando sola según llaman.' },
    { target: '#nav-asistente', title: 'Tu asistente ⭐',
      body: 'Aquí configuras su nombre, su voz, el saludo y tus servicios y precios. Es lo primero que conviene rellenar.' },
    { target: '#nav-conocimiento', title: 'Base de conocimiento',
      body: 'Cuéntale todo de tu negocio: horarios, seguros que aceptas, cómo llegar… Pon solo lo que sea VERDAD: se lo dirá tal cual a tus clientes, y nunca se inventa nada.' },
    { target: '#nav-seguimientos', title: 'Seguimientos',
      body: 'Los avisos automáticos que recuerdan las citas y recuperan a los clientes que hace tiempo que no vienen. Los enciendes y ella se encarga.' },
    { target: '#nav-integraciones', title: 'Integraciones',
      body: 'Conecta tu Google Calendar y tu WhatsApp para que todo funcione junto, con lo que ya usas.' },
    { target: null, title: '¡Ya está! 🎉',
      body: 'Si alguna vez te pierdes, pulsa el botón «?» de abajo a la derecha para ver esto otra vez. Te recomendamos empezar por «Tu asistente» y contarle sobre tu negocio.',
      cta: '¡Empezar!' },
  ];

  var idx = 0, els = null;

  function injectStyles() {
    if (document.getElementById('nf-tour-style')) return;
    var css =
      '#nf-tour-ov{position:fixed;inset:0;z-index:9000;pointer-events:auto}' +
      '#nf-tour-spot{position:absolute;border-radius:12px;box-shadow:0 0 0 9999px rgba(8,12,4,.74);' +
        'outline:4px solid #c4f546;outline-offset:2px;transition:all .28s cubic-bezier(.2,.7,.2,1);pointer-events:none}' +
      '#nf-tour-spot.center{box-shadow:0 0 0 9999px rgba(8,12,4,.8);outline:none;width:2px;height:2px;left:50%;top:44%}' +
      '#nf-tour-card{position:fixed;z-index:9001;max-width:360px;width:calc(100vw - 32px);background:#fff;color:#1a1d16;' +
        'border-radius:18px;padding:22px 22px 18px;box-shadow:0 18px 50px rgba(0,0,0,.4);' +
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;transition:all .28s cubic-bezier(.2,.7,.2,1)}' +
      '#nf-tour-card h3{margin:0 0 8px;font-size:21px;line-height:1.2;letter-spacing:-.01em}' +
      '#nf-tour-card p{margin:0 0 16px;font-size:17px;line-height:1.55;color:#3a4030}' +
      '#nf-tour-dots{display:flex;gap:6px;margin-bottom:14px}' +
      '#nf-tour-dots i{width:8px;height:8px;border-radius:50%;background:#dfe6cf;display:block}' +
      '#nf-tour-dots i.on{background:#8bbf1f;width:20px;border-radius:5px}' +
      '#nf-tour-actions{display:flex;align-items:center;gap:10px;justify-content:space-between}' +
      '#nf-tour-actions .sp{flex:1}' +
      '.nf-tour-btn{border:none;border-radius:999px;padding:12px 22px;font-size:16px;font-weight:800;cursor:pointer;font-family:inherit}' +
      '.nf-tour-btn.pri{background:#c4f546;color:#243100}' +
      '.nf-tour-btn.pri:hover{filter:brightness(.96)}' +
      '.nf-tour-btn.sec{background:#eef1e7;color:#3a4030}' +
      '.nf-tour-skip{background:none;border:none;color:#7a8168;font-size:15px;cursor:pointer;text-decoration:underline;font-family:inherit;padding:6px}' +
      '#nf-tour-help{position:fixed;right:18px;bottom:18px;z-index:8000;width:56px;height:56px;border-radius:50%;' +
        'background:#c4f546;color:#243100;border:none;font-size:26px;font-weight:800;cursor:pointer;box-shadow:0 6px 20px rgba(60,80,20,.35)}' +
      '#nf-tour-help:hover{filter:brightness(.96)}' +
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

  function render() {
    var st = STEPS[idx];
    var tgt = st.target ? document.querySelector(st.target) : null;
    var visible = tgt && tgt.offsetParent !== null && tgt.getBoundingClientRect().width > 0;

    if (visible) { try { tgt.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {} }

    // Reposicionar tras un pequeño margen para que el scroll asiente.
    setTimeout(function () { place(tgt, visible); }, visible ? 180 : 0);

    var last = idx === STEPS.length - 1;
    var first = idx === 0;
    els.card.innerHTML =
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
    var cw = card.offsetWidth || 340, ch = card.offsetHeight || 200, gap = 18;
    var left, top;
    if (r.right + gap + cw < window.innerWidth) { left = r.right + gap; top = r.top; }
    else if (r.bottom + gap + ch < window.innerHeight) { left = Math.max(16, r.left); top = r.bottom + gap; }
    else { left = Math.max(16, r.left - cw - gap); top = r.top; }
    left = Math.min(left, window.innerWidth - cw - 16);
    top = Math.max(16, Math.min(top, window.innerHeight - ch - 16));
    card.style.left = left + 'px'; card.style.top = top + 'px';
  }

  var _onResize = function () { if (els) { var st = STEPS[idx]; var t = st.target ? document.querySelector(st.target) : null; place(t, t && t.offsetParent !== null); } };

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

  // Auto-arranque: espera a que el portal esté logueado (nav visible) y, si es la
  // primera vez en este navegador, lanza el tour. Añade el botón "?" siempre.
  var tries = 0;
  var poll = setInterval(function () {
    tries++;
    var nav = document.getElementById('nav-dashboard');
    var loggedIn = nav && nav.offsetParent !== null;
    if (loggedIn) {
      injectStyles(); helpButton();
      var done = false; try { done = localStorage.getItem(DONE_KEY) === '1'; } catch (e) {}
      if (!done) setTimeout(start, 900);
      clearInterval(poll);
    }
    if (tries > 120) clearInterval(poll); // ~60s tope
  }, 500);
})();
