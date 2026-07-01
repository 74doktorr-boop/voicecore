// public/portal/cmdk.js
// NodeFlow — Command Palette (Ctrl/⌘+K)
// Depende de portal.js (navigate, openNewCita, logout ya son globales).
'use strict';

(function () {
  var SECTIONS = [
    { id: 'dashboard',        label: 'Dashboard',                icon: 'i-dashboard',        kw: 'inicio resumen hoy' },
    { id: 'llamadas',         label: 'Llamadas',                 icon: 'i-llamadas',         kw: 'historial transcripcion telefono' },
    { id: 'citas',            label: 'Citas',                    icon: 'i-citas',            kw: 'agenda calendario reservas' },
    { id: 'clientes',         label: 'Clientes',                 icon: 'i-clientes',         kw: 'contactos crm personas' },
    { id: 'oportunidades',    label: 'Oportunidades',            icon: 'i-oportunidades',    kw: 'recuperar perdidas leads' },
    { id: 'espera',           label: 'Lista de espera',          icon: 'i-espera',           kw: 'huecos cancelaciones' },
    { id: 'tareas',           label: 'Mis tareas',               icon: 'i-tareas',           kw: 'pendientes todo' },
    { id: 'seguimientos',     label: 'Seguimientos',             icon: 'i-seguimientos',     kw: 'recordatorios campañas' },
    { id: 'informes',         label: 'Informes',                 icon: 'i-informes',         kw: 'estadisticas metricas reportes' },
    { id: 'insights',         label: 'Insights',                 icon: 'i-insights',         kw: 'recomendaciones analisis ia' },
    { id: 'referidos',        label: 'Recomienda y gana',        icon: 'i-referidos',        kw: 'referidos invitar amigo' },
    { id: 'widget',           label: 'Widget para tu web',       icon: 'i-widget',           kw: 'web boton embed' },
    { id: 'asistente',        label: 'Asistente',                icon: 'i-asistente',        kw: 'voz ia idioma configurar prompt' },
    { id: 'conocimiento',     label: 'Base de conocimiento',     icon: 'i-conocimiento',     kw: 'rag documentos pdf faq' },
    { id: 'automatizaciones', label: 'Automatizaciones',         icon: 'i-automatizaciones', kw: 'flujos recordatorio whatsapp' },
    { id: 'integraciones',    label: 'Integraciones',            icon: 'i-integraciones',    kw: 'calendar whatsapp conectar' },
    { id: 'facturacion',      label: 'Facturación',              icon: 'i-facturacion',      kw: 'pagos plan stripe recibos' },
    { id: 'configuracion',    label: 'Configuración',            icon: 'i-configuracion',    kw: 'ajustes negocio horarios desvio' },
    { id: 'ayuda',            label: 'Ayuda',                    icon: 'i-ayuda',            kw: 'faq soporte contacto' },
  ];

  var ACTIONS = [
    { label: 'Pruébalo: que me llame mi asistente', icon: 'i-llamadas', kw: 'test prueba llamame demo escuchar telefono',
      run: function () {
        navigate('asistente');
        setTimeout(function () {
          var el = document.getElementById('testCallPhone');
          if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.focus(); }
        }, 450);
      } },
    { label: 'Nueva cita', icon: 'i-citas', kw: 'crear reserva agendar',
      run: function () { navigate('citas'); setTimeout(function () { if (typeof openNewCita === 'function') openNewCita(); }, 350); } },
    { label: 'Nueva tarea', icon: 'i-tareas', kw: 'crear apuntar recordar',
      run: function () { navigate('tareas'); setTimeout(function () { var i = document.getElementById('newTaskTitle'); if (i) i.focus(); }, 400); } },
    { label: 'Cambiar voz del asistente', icon: 'i-asistente', kw: 'voz locutor idioma',
      run: function () { navigate('asistente'); } },
    { label: 'Lanzar campaña de recuperación', icon: 'i-oportunidades', kw: 'recuperar clientes inactivos campaña',
      run: function () { navigate('oportunidades'); } },
    { label: 'Subir documento a la base de conocimiento', icon: 'i-conocimiento', kw: 'pdf subir rag',
      run: function () { navigate('conocimiento'); } },
    { label: 'Invitar / recomendar a un negocio', icon: 'i-referidos', kw: 'referido gana 25',
      run: function () { navigate('referidos'); } },
    { label: 'Ver códigos de desvío', icon: 'i-configuracion', kw: 'desvio telefono activar numero',
      run: function () { navigate('configuracion'); } },
    { label: 'Cerrar sesión', icon: 'i-configuracion', kw: 'salir logout',
      run: function () { if (typeof logout === 'function') logout(); } },
  ];

  var _open = false, _sel = 0, _results = [];

  function norm(s) {
    return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  // Fuzzy: todas las palabras de la query deben aparecer en label+keywords
  function match(q, item) {
    var hay = norm(item.label + ' ' + (item.kw || ''));
    return norm(q).split(/\s+/).every(function (w) { return !w || hay.indexOf(w) !== -1; });
  }

  function icon(id) {
    return '<span class="qa-ico" aria-hidden="true"><svg class="ico" width="17" height="17"><use href="#' + id + '"/></svg></span>';
  }

  function render() {
    var q = document.getElementById('cmdkInput').value;
    var list = document.getElementById('cmdkList');
    var actions  = ACTIONS.filter(function (a) { return match(q, a); });
    var sections = SECTIONS.filter(function (s) { return match(q, s); });
    _results = actions.concat(sections);

    // Modo natural: pedírselo al copiloto con la frase tal cual
    var ask = null;
    if (q.trim().length > 2) {
      ask = { ask: true, query: q.trim() };
      _results = _results.concat([ask]);
    }
    if (_sel >= _results.length) _sel = 0;

    if (!_results.length) {
      list.innerHTML = '<div class="cmdk-empty">Nada por aquí. Prueba con "citas", "voz" o escríbeme qué necesitas.</div>';
      return;
    }
    var html = '';
    if (actions.length) {
      html += '<div class="cmdk-group">Acciones</div>';
      actions.forEach(function (a, i) {
        html += '<div class="cmdk-item' + (i === _sel ? ' sel' : '') + '" data-i="' + i + '" role="option">' +
          icon(a.icon) + '<span>' + a.label + '</span><span class="cmdk-item-hint">↵</span></div>';
      });
    }
    if (sections.length) {
      html += '<div class="cmdk-group">Ir a</div>';
      sections.forEach(function (s, j) {
        var i = actions.length + j;
        html += '<div class="cmdk-item' + (i === _sel ? ' sel' : '') + '" data-i="' + i + '" role="option">' +
          icon(s.icon) + '<span>' + s.label + '</span><span class="cmdk-item-hint">↵</span></div>';
      });
    }
    if (ask) {
      var ai = _results.length - 1;
      html += '<div class="cmdk-group">Copiloto</div>' +
        '<div class="cmdk-item' + (ai === _sel ? ' sel' : '') + '" data-i="' + ai + '" role="option">' +
        '<span class="qa-ico">✨</span><span>Pedir a NodeFlow: “' + escHtml(ask.query) + '”</span>' +
        '<span class="cmdk-item-hint">↵</span></div>';
    }
    list.innerHTML = html;

    list.querySelectorAll('.cmdk-item').forEach(function (el) {
      el.addEventListener('mouseenter', function () { _sel = +el.getAttribute('data-i'); paintSel(); });
      el.addEventListener('click', function () { exec(+el.getAttribute('data-i')); });
    });
  }

  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function paintSel() {
    document.querySelectorAll('#cmdkList .cmdk-item').forEach(function (el) {
      el.classList.toggle('sel', +el.getAttribute('data-i') === _sel);
    });
  }

  function exec(i) {
    var item = _results[i];
    if (!item) return;
    if (item.ask) { askNodeflow(item.query); return; }
    cmdkClose();
    if (item.run) item.run(); else navigate(item.id);
  }

  // ── IA contextual: interpreta la frase en el servidor y ejecuta aquí ──
  var _asking = false;
  async function askNodeflow(query) {
    if (_asking) return;
    _asking = true;
    var list = document.getElementById('cmdkList');
    list.innerHTML = '<div class="cmdk-empty"><div class="spin" style="width:22px;height:22px;border-width:2px;margin-bottom:10px"></div>Pensando…</div>';
    var resp = null;
    try {
      resp = await api('/api/portal/assistant-command', 'POST', {
        query: query,
        context: (typeof _currentSection !== 'undefined' ? _currentSection : 'dashboard'),
      });
    } catch (e) { resp = null; }
    _asking = false;

    if (!resp || !resp.ok || !resp.action) {
      var msg = resp && resp.error === 'ai_unavailable'
        ? 'El copiloto no está disponible ahora mismo. Usa los comandos de la lista.'
        : 'No lo he entendido. Prueba algo como “cita para María el viernes a las 10”, “recuérdame llamar a Ana” o “busca a Jon”.';
      list.innerHTML = '<div class="cmdk-empty">' + msg + '</div>';
      return;
    }
    runAiAction(resp.action, query);
  }

  async function runAiAction(a, query) {
    var list = document.getElementById('cmdkList');
    switch (a.type) {
      case 'navigate':
        cmdkClose(); navigate(a.section); return;

      case 'search_clients':
        cmdkClose(); navigate('clientes');
        setTimeout(function () {
          if (typeof loadClientes === 'function') loadClientes(a.q);
        }, 350);
        return;

      case 'filter_calls':
        cmdkClose(); navigate('llamadas');
        setTimeout(function () {
          if (typeof loadCalls === 'function') loadCalls(a.outcome);
        }, 350);
        return;

      case 'new_task':
        try {
          await api('/api/portal/tasks', 'POST', { title: a.title });
          cmdkClose();
          if (typeof toast === 'function') toast('✅ Tarea creada: ' + a.title);
          navigate('tareas');
        } catch (e) {
          list.innerHTML = '<div class="cmdk-empty">No pude crear la tarea: ' + escHtml(e.message || e) + '</div>';
        }
        return;

      case 'new_cita':
        cmdkClose(); navigate('citas');
        setTimeout(function () {
          if (typeof openNewCita !== 'function') return;
          openNewCita();
          var set = function (id, v) { var el = document.getElementById(id); if (el && v) el.value = v; };
          set('mPatientName', a.patientName);
          set('mService', a.service);
          set('mDate', a.date);
          set('mTime', a.time);
          set('mPhone', a.phone);
          if (typeof toast === 'function') toast('He preparado la cita — revisa y guarda');
        }, 450);
        return;

      case 'test_call':
        cmdkClose(); navigate('asistente');
        setTimeout(function () {
          var el = document.getElementById('testCallPhone');
          if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.focus(); }
        }, 450);
        return;

      case 'answer':
        list.innerHTML = '<div style="padding:18px 16px;font-size:14px;line-height:1.6;color:var(--text)">' +
          '<span style="color:var(--accent-l);margin-right:6px">✨</span>' + escHtml(a.text) + '</div>';
        return;

      default:
        list.innerHTML = '<div class="cmdk-empty">No lo he entendido. Prueba algo como “cita para María el viernes a las 10”.</div>';
    }
  }

  window.cmdkOpen = function () {
    // Solo con sesión iniciada (el app visible)
    var app = document.getElementById('app');
    if (!app || app.style.display === 'none' || !app.style.display && getComputedStyle(app).display === 'none') return;
    _open = true; _sel = 0;
    var ov = document.getElementById('cmdkOverlay');
    ov.classList.add('open');
    var inp = document.getElementById('cmdkInput');
    inp.value = '';
    render();
    setTimeout(function () { inp.focus(); }, 30);
  };

  window.cmdkClose = function () {
    _open = false;
    document.getElementById('cmdkOverlay').classList.remove('open');
  };

  document.addEventListener('keydown', function (e) {
    var mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      _open ? cmdkClose() : cmdkOpen();
      return;
    }
    if (!_open) return;
    if (e.key === 'Escape') { e.preventDefault(); cmdkClose(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); _sel = Math.min(_sel + 1, _results.length - 1); paintSel(); scrollSel(); }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); _sel = Math.max(_sel - 1, 0); paintSel(); scrollSel(); }
    else if (e.key === 'Enter')     { e.preventDefault(); exec(_sel); }
  });

  function scrollSel() {
    var el = document.querySelector('#cmdkList .cmdk-item.sel');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }

  document.addEventListener('input', function (e) {
    if (e.target && e.target.id === 'cmdkInput') { _sel = 0; render(); }
  });
})();
