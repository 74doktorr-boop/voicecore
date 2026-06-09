// public/portal/portal.js
// NodeFlow — Portal de Negocio client-side JS
'use strict';

const SESSION_KEY = 'nf_session';

// ── Global state ─────────────────────────────────────────────
let _token          = null;
let _orgInfo        = null;  // { id, name, plan, owner_email, phone, ... }
let _currentSection = 'dashboard';

var _wizardContacts = [];  // cache of contacts loaded for the wizard
var _wizardFields   = [];  // cache of sector fields for the wizard

// ── API helper ────────────────────────────────────────────────
async function api(path, method, body) {
  method = method || 'GET';
  var opts = {
    method: method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + _token,
    },
  };
  if (body !== undefined && body !== null) opts.body = JSON.stringify(body);
  var res = await fetch(path, opts);
  var data = await res.json().catch(function() { return {}; });
  if (!res.ok) throw new Error(data.error || 'HTTP ' + res.status);
  return data;
}

// ── Toast ─────────────────────────────────────────────────────
function toast(msg, type) {
  type = type || 'ok';
  var el = document.getElementById('toast');
  el.textContent = msg;
  el.className   = 'show ' + type;
  clearTimeout(el._timer);
  el._timer = setTimeout(function() { el.className = ''; }, 3500);
}

// ── Modal ─────────────────────────────────────────────────────
function openModal(html) {
  document.getElementById('modalBox').innerHTML = html;
  document.getElementById('modalOverlay').style.display = 'flex';
}
function closeModal() {
  document.getElementById('modalOverlay').style.display = 'none';
  document.getElementById('modalBox').innerHTML = '';
}

// ── Mobile sidebar ────────────────────────────────────────────
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('backdrop').classList.toggle('open');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('backdrop').classList.remove('open');
}

// ── Section navigation ────────────────────────────────────────
function navigate(section) {
  document.querySelectorAll('.section').forEach(function(el) { el.classList.remove('active'); });
  document.querySelectorAll('.nav-item').forEach(function(el) { el.classList.remove('active'); });

  var secEl = document.getElementById('sec-' + section);
  var navEl = document.getElementById('nav-' + section);
  if (secEl) secEl.classList.add('active');
  if (navEl) navEl.classList.add('active');

  _currentSection = section;
  closeSidebar();

  if (section === 'dashboard')        loadDashboard();
  else if (section === 'llamadas')    loadCalls();
  else if (section === 'citas')       loadCitas();
  else if (section === 'informes')    loadInformes();
  else if (section === 'automatizaciones') loadAutomatizaciones();
  else if (section === 'configuracion')    loadConfig();
  else if (section === 'clientes')         loadClientes();
  else if (section === 'facturacion')      loadFacturacion();
  else if (section === 'integraciones')    loadIntegraciones();
  else if (section === 'seguimientos')     loadSeguimientos();
  else if (section === 'ayuda')            loadAyuda();
  if (section === 'asistente') loadAsistente();
}

// ── Auth flow ─────────────────────────────────────────────────
async function initAuth() {
  var params     = new URLSearchParams(window.location.search);
  var magicToken = params.get('token');

  // ── WhatsApp callback (360dialog Embedded Signup redirect) ────────────────
  // Cuando el negocio completa el Embedded Signup, 360dialog redirige al backend
  // que a su vez redirige aquí con ?client_id=...&state=...
  // Si hay client_id en la URL, intercambiar el código con el backend.
  var waClientId = params.get('client_id');
  var waState    = params.get('state');
  if (waClientId) {
    window.history.replaceState({}, '', '/portal');
    _token = localStorage.getItem(SESSION_KEY);
    if (_token) {
      // Completar la conexión WA en background, luego navegar a Integraciones
      (async function() {
        try {
          toast('⏳ Conectando WhatsApp…');
          var r = await api('/api/portal/whatsapp/connect', {
            method: 'POST',
            body: JSON.stringify({ client_id: waClientId }),
          });
          if (r.ok) {
            toast('✅ WhatsApp conectado: ' + (r.phoneNumber || ''));
          } else {
            toast('⚠️ Error al conectar WhatsApp: ' + (r.error || 'desconocido'), 'warn');
          }
        } catch (e) {
          toast('⚠️ Error al conectar WhatsApp: ' + e.message, 'warn');
        }
        navigate('integraciones');
      })();
      // Continuar con el flujo normal de autenticación (token ya en localStorage)
      // El callback WA se procesa en background — no interrumpir el login
    }
  }

  if (magicToken) {
    try {
      var resp = await fetch('/api/auth/verify?token=' + encodeURIComponent(magicToken));
      var data = await resp.json();
      if (!data.session_token) throw new Error(data.error || 'Enlace inválido');
      localStorage.setItem(SESSION_KEY, data.session_token);
      window.history.replaceState({}, '', '/portal');
      _token = data.session_token;
    } catch (e) {
      return showLogin('Enlace inválido o expirado: ' + e.message);
    }
  } else {
    _token = localStorage.getItem(SESSION_KEY);
  }

  if (!_token) return showLogin();

  try {
    _orgInfo = await api('/api/portal/me');
    if (!_orgInfo || !_orgInfo.id) throw new Error('Sin negocio asociado');
  } catch (e) {
    localStorage.removeItem(SESSION_KEY);
    return showLogin('Sesión expirada. Inicia sesión de nuevo.');
  }

  showApp();
}

function showLogin(errorMsg) {
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('app').style.display         = 'none';
  var msgEl = document.getElementById('loginMsg');
  if (errorMsg) {
    msgEl.style.color   = '#e74c3c';
    msgEl.textContent   = errorMsg;
    msgEl.style.display = 'block';
  } else {
    msgEl.style.display = 'none';
  }
}

function showApp() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('app').style.display         = 'block';

  document.getElementById('sidebarBiz').textContent = _orgInfo.name || '—';
  var planMap = { starter: 'Plan Starter', negocio: 'Plan Negocio', pro: 'Plan Pro' };
  document.getElementById('sidebarPlan').textContent    = planMap[_orgInfo.plan] || 'Plan —';
  var planPrice = _orgInfo.plan === 'negocio' ? '€49' : _orgInfo.plan === 'pro' ? '€99' : 'Gratis';
  document.getElementById('sidebarPlanSub').textContent = planPrice + '/mes · Activo';

  // Show upgrade CTA: starter → Negocio, Negocio → Pro
  var upgradeEl = document.getElementById('upgradeCtaBox');
  if (upgradeEl) {
    if (_orgInfo.plan === 'starter') {
      upgradeEl.innerHTML =
        '<div style="font-size:11px;font-weight:700;color:var(--accent-l);margin-bottom:4px">🚀 Activa tu AI ahora</div>' +
        '<div style="font-size:10px;color:var(--dim);margin-bottom:8px;line-height:1.4">Atiende llamadas 24/7 y elimina las perdidas por €49/mes</div>' +
        '<a href="https://nodeflow.es/#precios" target="_blank" style="display:block;text-align:center;background:var(--accent);color:#fff;border-radius:6px;padding:7px;font-size:11px;font-weight:700;text-decoration:none">Ver planes →</a>';
      upgradeEl.style.display = 'block';
    } else if (_orgInfo.plan === 'negocio') {
      upgradeEl.innerHTML =
        '<div style="font-size:11px;font-weight:700;color:var(--accent-l);margin-bottom:4px">⚡ Pasa a Plan Pro</div>' +
        '<div style="font-size:10px;color:var(--dim);margin-bottom:8px;line-height:1.4">2.000 min/mes, llamadas salientes y account manager dedicado</div>' +
        '<a href="https://nodeflow.es/#precios" target="_blank" style="display:block;text-align:center;background:var(--accent);color:#fff;border-radius:6px;padding:7px;font-size:11px;font-weight:700;text-decoration:none">Ver Plan Pro €99/mes →</a>';
      upgradeEl.style.display = 'block';
    } else {
      upgradeEl.style.display = 'none';
    }
  }

  navigate('dashboard');
}

function logout() {
  localStorage.removeItem(SESSION_KEY);
  _token   = null;
  _orgInfo = null;
  showLogin();
}

// ── Login screen helpers ──────────────────────────────────────
async function requestAccess() {
  var email = document.getElementById('loginEmail').value.trim();
  var msgEl = document.getElementById('loginMsg');
  if (!email || !email.includes('@')) {
    msgEl.style.color   = '#e74c3c';
    msgEl.textContent   = 'Introduce un email válido.';
    msgEl.style.display = 'block';
    return;
  }
  msgEl.style.color   = 'var(--dim)';
  msgEl.textContent   = 'Enviando…';
  msgEl.style.display = 'block';
  try {
    await fetch('/api/auth/request-link', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email: email }),
    });
    msgEl.style.color = 'var(--green2)';
    msgEl.textContent = '✓ Si tu email está registrado, recibirás un enlace en breve.';
  } catch (_) {
    msgEl.style.color = '#e74c3c';
    msgEl.textContent = 'Error al enviar. Inténtalo de nuevo.';
  }
}

// ── Relative time helper ──────────────────────────────────────
function timeAgo(isoStr) {
  if (!isoStr) return '—';
  var diff = Date.now() - new Date(isoStr).getTime();
  var min  = Math.floor(diff / 60000);
  if (min < 1)  return 'ahora';
  if (min < 60) return 'hace ' + min + 'm';
  var h = Math.floor(min / 60);
  if (h  < 24)  return 'hace ' + h + 'h';
  return 'hace ' + Math.floor(h / 24) + 'd';
}

// ── KPI trend arrow ───────────────────────────────────────────
function kpiTrend(current, prev) {
  var style = 'font-size:11px;margin-top:3px;';
  if (prev === undefined || prev === null || prev === false) {
    return '<div style="' + style + 'color:var(--dim)">— vs sem. anterior</div>';
  }
  current = Number(current) || 0;
  prev    = Number(prev)    || 0;
  if (prev === 0 && current === 0) {
    return '<div style="' + style + 'color:var(--dim)">— vs sem. anterior</div>';
  }
  if (current >= prev) {
    var diff = current - prev;
    return '<div style="' + style + 'color:var(--green2)">↑ +' + diff + ' vs sem. anterior</div>';
  } else {
    var diff2 = prev - current;
    return '<div style="' + style + 'color:var(--red)">↓ -' + diff2 + ' vs sem. anterior</div>';
  }
}

// ── Format date DD/MM/YYYY ────────────────────────────────────
function fmtDate(str) {
  if (!str) return '—';
  var parts = str.split('-');
  return parts[2] + '/' + parts[1] + '/' + parts[0];
}

// ── Escape HTML ───────────────────────────────────────────────
function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Dashboard ─────────────────────────────────────────────────
async function loadDashboard() {
  var sec = document.getElementById('sec-dashboard');
  sec.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⏳</div><div class="empty-state-text">Cargando…</div></div>';
  var d;
  try {
    d = await api('/api/portal/dashboard');
  } catch (e) {
    sec.innerHTML = '<div class="empty-state"><div class="empty-state-text">Error al cargar: ' + esc(e.message) + '</div></div>';
    return;
  }

  var hour   = new Date().getHours();
  var greet  = hour < 14 ? 'Buenos días' : hour < 20 ? 'Buenas tardes' : 'Buenas noches';
  var dateStr = new Date().toLocaleDateString('es-ES', { weekday:'long', day:'numeric', month:'long' });

  var today = new Date().toLocaleDateString('sv-SE');
  var dashStatusBadge = {
    confirmed: '<span class="badge bg">✓ Confirmada</span>',
    pending:   '<span class="badge by">Pendiente</span>',
    cancelled: '<span class="badge br">✕ Cancelada</span>',
  };
  var upcomingRows = '';
  if (d.upcoming && d.upcoming.length > 0) {
    for (var i = 0; i < d.upcoming.length; i++) {
      var a = d.upcoming[i];
      var isToday = a.date === today;
      upcomingRows += '<tr' + (isToday ? ' style="background:rgba(108,92,231,0.08)"' : '') + '>' +
        '<td>' + (isToday ? '<strong style="color:var(--accent-l)">Hoy</strong>' : fmtDate(a.date)) + '</td>' +
        '<td><strong>' + esc(a.time) + '</strong></td>' +
        '<td>' + esc(a.patientName) + '</td><td>' + esc(a.service) + '</td>' +
        '<td>' + (dashStatusBadge[a.status] || dashStatusBadge.pending) + '</td></tr>';
    }
  } else {
    upcomingRows = '<tr class="empty-row"><td colspan="5">No hay citas próximas</td></tr>';
  }

  var activityRows = '';
  if (d.recentActivity && d.recentActivity.length > 0) {
    for (var j = 0; j < d.recentActivity.length; j++) {
      var ev = d.recentActivity[j];
      var bClass = ev.type === 'reserva' ? 'bg' : ev.type === 'info' ? 'binfo' : 'bd';
      activityRows += '<div class="activity-item">' +
        '<span class="activity-badge badge ' + bClass + '">' + esc(ev.type) + '</span>' +
        '<div><div class="activity-text">' + esc(ev.text) + '</div>' +
        '<div class="activity-time">' + timeAgo(ev.time) + '</div></div></div>';
    }
  } else {
    activityRows = '<div style="color:var(--dim);font-size:13px">Sin actividad reciente</div>';
  }

  sec.innerHTML =
    '<div class="section-header">' +
      '<div>' +
        '<div class="section-title">' + greet + ', ' + esc(d.businessName) + ' 👋</div>' +
        '<div style="font-size:13px;color:var(--dim);margin-top:4px">' + dateStr + ' · Tu AI lleva activo ' + (d.daysActive || 0) + ' días</div>' +
      '</div>' +
      '<span class="ai-status">● AI ACTIVO</span>' +
    '</div>' +
    '<div style="font-size:11px;color:var(--dim);text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">Hoy</div>' +
    '<div class="kpi-grid">' +
      '<div class="kpi"><div class="kpi-label">Llamadas</div><div class="kpi-val" style="color:var(--accent-l)">' + (d.today.callCount || 0) + '</div><div class="kpi-sub">hoy</div>' + kpiTrend(d.today.callCount, d.prevWeek && d.prevWeek.callCount) + '</div>' +
      '<div class="kpi"><div class="kpi-label">Reservas</div><div class="kpi-val" style="color:var(--green2)">' + (d.today.bookedToday || 0) + '</div><div class="kpi-sub">' + (d.today.convRate || 0) + '% conversión</div>' + kpiTrend(d.today.bookedToday, d.prevWeek && d.prevWeek.bookedToday) + '</div>' +
      '<div class="kpi"><div class="kpi-label">Notificaciones</div><div class="kpi-val" style="color:var(--accent-l)">' + (d.today.emailsSent || 0) + '</div><div class="kpi-sub">email + WhatsApp</div>' + kpiTrend(d.today.emailsSent, d.prevWeek && d.prevWeek.emailsSent) + '</div>' +
      '<div class="kpi"><div class="kpi-label">Horas ahorradas</div><div class="kpi-val" style="color:#60a5fa">' + (d.today.hoursSaved || 0) + 'h</div><div class="kpi-sub">vs atención manual</div>' + kpiTrend(d.today.hoursSaved, d.prevWeek && d.prevWeek.hoursSaved) + '</div>' +
    '</div>' +
    '<div class="two-col">' +
      '<div class="card"><div class="card-title">🗓️ Próximas citas</div>' +
        '<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Hora</th><th>Cliente</th><th>Servicio</th><th>Estado</th></tr></thead>' +
        '<tbody>' + upcomingRows + '</tbody></table></div>' +
        '<button class="btn btn-d btn-sm" style="margin-top:12px" onclick="navigate(\'citas\')">Ver todas →</button>' +
      '</div>' +
      '<div class="card"><div class="card-title">⚡ Actividad reciente</div>' +
        '<div class="activity-list">' + activityRows + '</div>' +
        '<button class="btn btn-d btn-sm" style="margin-top:12px" onclick="navigate(\'llamadas\')">Ver llamadas →</button>' +
      '</div>' +
    '</div>';

  // ── Setup checklist banner (show when 0 total historical calls and not dismissed) ──
  if (localStorage.getItem('nf_banner_dismissed') !== '1') {
    if ((d.totalCalls || 0) === 0) {
      var bannerHTML =
        '<div id="setup-banner" style="background:linear-gradient(135deg,rgba(108,92,231,.12),rgba(0,206,201,.06));border:1px solid rgba(108,92,231,.25);border-radius:14px;padding:20px 24px;margin-bottom:24px;">' +
          '<div style="font-size:13px;font-weight:700;color:#a29bfe;text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px;">🚀 Primeros pasos</div>' +
          '<div style="display:flex;flex-direction:column;gap:10px;" id="setup-steps">' +
            '<div class="setup-step done" data-step="1">✅ Pago confirmado — tu cuenta está activa</div>' +
            '<div class="setup-step" data-step="2" onclick="navigate(\'asistente\')" style="cursor:pointer;">⚙️ <strong>Configura tu asistente IA</strong> — nombre, voz, idioma y servicios → <span style="color:#a29bfe;text-decoration:underline">Ir ahora →</span></div>' +
            '<div class="setup-step" data-step="3" onclick="navigate(\'configuracion\')" style="cursor:pointer;">📋 <strong>Completa los datos del negocio</strong> — dirección, horarios, tu WhatsApp → <span style="color:#a29bfe;text-decoration:underline">Ir ahora →</span></div>' +
            '<div class="setup-step" data-step="4" onclick="navigate(\'configuracion\')" style="cursor:pointer">📞 <strong>Activa el desvío de llamadas</strong> — los códigos están en Configuración → <span style="color:#a29bfe;text-decoration:underline">Ver códigos →</span></div>' +
          '</div>' +
          '<button onclick="document.getElementById(\'setup-banner\').style.display=\'none\';localStorage.setItem(\'nf_banner_dismissed\',\'1\')" style="margin-top:14px;background:none;border:1px solid rgba(255,255,255,.15);color:rgba(255,255,255,.4);border-radius:8px;padding:5px 14px;font-size:12px;cursor:pointer;">Ocultar</button>' +
        '</div>';
      sec.insertAdjacentHTML('afterbegin', bannerHTML);
    }
  }
}

// ── Llamadas ──────────────────────────────────────────────────
async function loadCalls(outcome, from, to) {
  var sec = document.getElementById('sec-llamadas');
  sec.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⏳</div><div>Cargando llamadas…</div></div>';

  var params = new URLSearchParams();
  if (outcome && outcome !== 'todas') params.set('outcome', outcome);
  if (from) params.set('from', from);
  if (to)   params.set('to', to);

  var data;
  try {
    data = await api('/api/portal/calls?' + params.toString());
  } catch (e) {
    sec.innerHTML = '<div class="empty-state"><div>Error: ' + esc(e.message) + '</div></div>';
    return;
  }

  var OUTCOME_BADGE = {
    booked:    '<span class="badge bg">reserva</span>',
    info:      '<span class="badge binfo">info</span>',
    abandoned: '<span class="badge bd">abandonada</span>',
  };

  var rows = '';
  if (data.calls && data.calls.length > 0) {
    for (var i = 0; i < data.calls.length; i++) {
      var c = data.calls[i];
      var dur = c.duration >= 60
        ? Math.floor(c.duration / 60) + 'm ' + (c.duration % 60) + 's'
        : c.duration + 's';
      var badge = OUTCOME_BADGE[c.outcome] || OUTCOME_BADGE.abandoned;
      var apt = c.appointment
        ? '<br><small style="color:var(--dim)">' + esc(c.appointment.date) + ' ' + esc(c.appointment.time) + ' · ' + esc(c.appointment.service) + '</small>'
        : '';
      var waNum   = c.callerNumber ? c.callerNumber.replace(/[^0-9]/g,'') : '';
      var callBtn = c.callerNumber
        ? '<button class="btn btn-g btn-sm" onclick="callOutbound(\'' + esc(c.callerNumber) + '\',this)" title="Llamar">📞</button>' +
          '<a class="btn btn-sm" style="background:#25d366;color:#fff;text-decoration:none" href="https://wa.me/' + waNum + '" target="_blank" title="WhatsApp">💬</a>'
        : '<span style="color:var(--muted)">—</span>';
      rows += '<tr><td>' + timeAgo(c.startedAt) + '</td><td>' + dur + '</td><td>' + badge + '</td>' +
        '<td>' + c.turnCount + ' turnos' + apt + '</td>' +
        '<td style="color:var(--dim)">' + (c.callerNumber ? '<div style="font-size:12px">' + esc(c.callerNumber) + '</div>' : '') + esc(c.clientEmail || (c.callerNumber ? '' : '—')) + '</td>' +
        '<td><button class="btn btn-d btn-sm" onclick="openTranscriptModal(\'' + esc(c.callId || '') + '\')">💬</button></td>' +
        '<td>' + callBtn + '</td></tr>';
    }
  } else {
    rows = '<tr class="empty-row"><td colspan="7">No hay llamadas con estos filtros</td></tr>';
  }

  sec.innerHTML =
    '<div class="section-header"><div class="section-title">📞 Llamadas</div></div>' +
    '<div class="filter-bar">' +
      '<label style="font-size:12px;color:var(--dim)">Resultado:</label>' +
      '<select id="fOutcome" onchange="loadCalls(this.value,document.getElementById(\'fFrom\').value,document.getElementById(\'fTo\').value)">' +
        '<option value="todas">Todas</option>' +
        '<option value="booked">Reserva</option>' +
        '<option value="info">Informativas</option>' +
        '<option value="abandoned">Abandonadas</option>' +
      '</select>' +
      '<label style="font-size:12px;color:var(--dim)">Desde:</label>' +
      '<input type="date" id="fFrom" onchange="loadCalls(document.getElementById(\'fOutcome\').value,this.value,document.getElementById(\'fTo\').value)">' +
      '<label style="font-size:12px;color:var(--dim)">Hasta:</label>' +
      '<input type="date" id="fTo" onchange="loadCalls(document.getElementById(\'fOutcome\').value,document.getElementById(\'fFrom\').value,this.value)">' +
      '<button class="btn btn-d btn-sm" onclick="loadCalls()">Limpiar</button>' +
    '</div>' +
    '<div class="table-wrap"><table>' +
      '<thead><tr><th>Cuándo</th><th>Duración</th><th>Resultado</th><th>Detalles</th><th>Contacto</th><th>Transcript</th><th>Acciones</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>' +
    '<div style="font-size:12px;color:var(--dim);margin-top:12px">Total: ' + (data.count || 0) + ' llamadas</div>';

  if (outcome && outcome !== 'todas') {
    var sel = document.getElementById('fOutcome');
    if (sel) sel.value = outcome;
  }
  if (from) { var fFrom = document.getElementById('fFrom'); if (fFrom) fFrom.value = from; }
  if (to)   { var fTo   = document.getElementById('fTo');   if (fTo)   fTo.value   = to;   }
}

// ── Citas ─────────────────────────────────────────────────────
var _citasData = [];
var _citasFilterStatus = 'todas';
var _citasSearch = '';

async function loadCitas(statusFilter, search) {
  _citasFilterStatus = statusFilter || _citasFilterStatus || 'todas';
  _citasSearch       = (search !== undefined) ? search : (_citasSearch || '');

  var sec = document.getElementById('sec-citas');
  if (!_citasData.length) {
    sec.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⏳</div><div>Cargando citas…</div></div>';
  }

  try {
    var data = await api('/api/portal/appointments');
    _citasData = data.appointments || [];
  } catch (e) {
    sec.innerHTML = '<div class="empty-state"><div>Error: ' + esc(e.message) + '</div></div>';
    return;
  }

  renderCitas();
}

function renderCitas() {
  var sec = document.getElementById('sec-citas');
  if (!sec) return;

  var today = new Date().toLocaleDateString('sv-SE');

  var STATUS_BADGE = {
    confirmed: '<span class="badge bg">✓ Confirmada</span>',
    cancelled: '<span class="badge br">✕ Cancelada</span>',
    pending:   '<span class="badge by">Pendiente</span>',
  };

  var filtered = _citasData.filter(function(a) {
    if (_citasFilterStatus !== 'todas' && a.status !== _citasFilterStatus) return false;
    if (_citasSearch) {
      var q = _citasSearch.toLowerCase();
      if (!(a.patientName || '').toLowerCase().includes(q) &&
          !(a.phone || '').includes(q) &&
          !(a.service || '').toLowerCase().includes(q)) return false;
    }
    return true;
  });

  var rows = '';
  if (filtered.length > 0) {
    for (var i = 0; i < filtered.length; i++) {
      var a = filtered[i];
      var isToday = a.date === today;
      var badge   = STATUS_BADGE[a.status] || STATUS_BADGE.pending;
      var safeId  = esc(a.id);
      var safeName = esc(a.patientName).replace(/'/g, "\\'");
      var actions = a.status !== 'cancelled'
        ? '<button class="btn btn-d btn-sm" onclick="openEditCita(\'' + safeId + '\')">✏️</button> ' +
          '<button class="btn btn-r btn-sm" onclick="cancelCitaConfirm(\'' + safeId + '\',\'' + safeName + '\')">✕</button>'
        : '';
      rows += '<tr' + (isToday ? ' style="background:rgba(108,92,231,0.08)"' : '') + '>' +
        '<td>' + (isToday ? '<strong style="color:var(--accent-l)">Hoy</strong>' : fmtDate(a.date)) + '</td>' +
        '<td><strong>' + esc(a.time) + '</strong></td>' +
        '<td>' + esc(a.patientName) + '</td>' +
        '<td>' + esc(a.phone || '—') + '</td>' +
        '<td>' + esc(a.service) + (a.notes ? '<div style="font-size:11px;color:var(--dim);margin-top:2px">📝 ' + esc(a.notes) + '</div>' : '') + '</td>' +
        '<td>' + badge + '</td>' +
        '<td style="white-space:nowrap">' + actions + '</td></tr>';
    }
  } else {
    rows = '<tr class="empty-row"><td colspan="7">' + (_citasSearch || _citasFilterStatus !== 'todas' ? 'Sin resultados con este filtro' : 'No hay citas registradas') + '</td></tr>';
  }

  sec.innerHTML =
    '<div class="section-header">' +
      '<div class="section-title">🗓️ Citas</div>' +
      '<button class="btn btn-accent" onclick="openNewCita()">+ Nueva cita</button>' +
    '</div>' +
    '<div class="filter-bar">' +
      '<input class="search-input" id="citasSearch" placeholder="Buscar cliente, teléfono o servicio…" value="' + esc(_citasSearch) + '"' +
        ' oninput="_citasSearch=this.value;renderCitas()" style="flex:1;min-width:180px">' +
      '<label style="font-size:12px;color:var(--dim)">Estado:</label>' +
      '<select id="citasStatus" onchange="_citasFilterStatus=this.value;renderCitas()">' +
        '<option value="todas"' + (_citasFilterStatus==='todas'?' selected':'') + '>Todas</option>' +
        '<option value="confirmed"' + (_citasFilterStatus==='confirmed'?' selected':'') + '>Confirmadas</option>' +
        '<option value="pending"' + (_citasFilterStatus==='pending'?' selected':'') + '>Pendientes</option>' +
        '<option value="cancelled"' + (_citasFilterStatus==='cancelled'?' selected':'') + '>Canceladas</option>' +
      '</select>' +
    '</div>' +
    '<div class="table-wrap"><table>' +
      '<thead><tr><th>Fecha</th><th>Hora</th><th>Cliente</th><th>Teléfono</th><th>Servicio</th><th>Estado</th><th>Acciones</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>' +
    '<div style="font-size:12px;color:var(--dim);margin-top:12px">' + filtered.length + ' citas' + (_citasData.length !== filtered.length ? ' (de ' + _citasData.length + ' total)' : '') + '</div>';
}

function openNewCita() {
  var today = new Date().toISOString().slice(0, 10);
  openModal(
    '<div class="modal-title">+ Nueva cita</div>' +
    '<div class="form-group"><label class="form-label">Nombre del cliente *</label>' +
      '<input class="form-input" id="mPatientName" placeholder="Ana García"></div>' +
    '<div class="form-group"><label class="form-label">Teléfono</label>' +
      '<input class="form-input" id="mPhone" type="tel" placeholder="+34 600 000 000"></div>' +
    '<div class="form-group"><label class="form-label">Email</label>' +
      '<input class="form-input" id="mEmail" type="email" placeholder="cliente@email.com"></div>' +
    '<div class="form-group"><label class="form-label">Servicio *</label>' +
      '<input class="form-input" id="mService" placeholder="Corte de pelo"></div>' +
    '<div class="form-group"><label class="form-label">Fecha *</label>' +
      '<input class="form-input" id="mDate" type="date" value="' + today + '"></div>' +
    '<div class="form-group"><label class="form-label">Hora *</label>' +
      '<input class="form-input" id="mTime" type="time"></div>' +
    '<div class="form-group"><label class="form-label">Notas internas</label>' +
      '<textarea class="form-input" id="mNotes" rows="2" placeholder="Primera visita, alergias, observaciones…"></textarea></div>' +
    '<div class="modal-actions">' +
      '<button class="btn btn-d" onclick="closeModal()">Cancelar</button>' +
      '<button class="btn btn-accent" onclick="submitNewCita()">Guardar cita</button>' +
    '</div>'
  );
}

async function submitNewCita() {
  var body = {
    patientName: document.getElementById('mPatientName').value.trim(),
    phone:       document.getElementById('mPhone').value.trim(),
    email:       document.getElementById('mEmail').value.trim(),
    service:     document.getElementById('mService').value.trim(),
    date:        document.getElementById('mDate').value,
    time:        document.getElementById('mTime').value,
    notes:       document.getElementById('mNotes').value.trim() || undefined,
  };
  if (!body.patientName || !body.service || !body.date || !body.time) {
    toast('Rellena todos los campos obligatorios', 'err');
    return;
  }
  try {
    await api('/api/portal/appointments', 'POST', body);
    closeModal();
    toast('Cita creada correctamente');
    _citasData = [];
    loadCitas();
  } catch (e) {
    toast('Error: ' + e.message, 'err');
  }
}

async function openEditCita(id) {
  var apt;
  try {
    var res = await api('/api/portal/appointments/' + id);
    apt = res.appointment || res;
  } catch (e) {
    // Fallback: buscar en la lista completa
    try {
      var data = await api('/api/portal/appointments');
      apt = null;
      for (var i = 0; i < data.appointments.length; i++) {
        if (data.appointments[i].id === id) { apt = data.appointments[i]; break; }
      }
    } catch (e2) { toast('Error al cargar cita: ' + e2.message, 'err'); return; }
  }
  if (!apt) { toast('Cita no encontrada', 'err'); return; }

  openModal(
    '<div class="modal-title">✏️ Editar cita</div>' +
    '<div class="form-group"><label class="form-label">Nombre del cliente *</label>' +
      '<input class="form-input" id="ePatientName" value="' + esc(apt.patientName || '') + '"></div>' +
    '<div class="form-group"><label class="form-label">Teléfono</label>' +
      '<input class="form-input" id="ePhone" type="tel" value="' + esc(apt.phone || '') + '"></div>' +
    '<div class="form-group"><label class="form-label">Email</label>' +
      '<input class="form-input" id="eEmail" type="email" value="' + esc(apt.email || '') + '"></div>' +
    '<div class="form-group"><label class="form-label">Servicio *</label>' +
      '<input class="form-input" id="eService" value="' + esc(apt.service || '') + '"></div>' +
    '<div class="form-group"><label class="form-label">Fecha *</label>' +
      '<input class="form-input" id="eDate" type="date" value="' + esc(apt.date || '') + '"></div>' +
    '<div class="form-group"><label class="form-label">Hora *</label>' +
      '<input class="form-input" id="eTime" type="time" value="' + esc(apt.time || '') + '"></div>' +
    '<div class="form-group"><label class="form-label">Notas internas</label>' +
      '<textarea class="form-input" id="eNotes" rows="2" placeholder="Primera visita, alergias, observaciones…">' + esc(apt.notes || '') + '</textarea></div>' +
    '<div class="modal-actions">' +
      '<button class="btn btn-d" onclick="closeModal()">Cancelar</button>' +
      '<button class="btn btn-accent" onclick="submitEditCita(\'' + esc(id) + '\')">Guardar cambios</button>' +
    '</div>'
  );
}

async function submitEditCita(id) {
  var body = {
    patientName: document.getElementById('ePatientName').value.trim(),
    phone:       document.getElementById('ePhone').value.trim(),
    email:       document.getElementById('eEmail').value.trim(),
    service:     document.getElementById('eService').value.trim(),
    date:        document.getElementById('eDate').value,
    time:        document.getElementById('eTime').value,
    notes:       document.getElementById('eNotes')?.value?.trim() || undefined,
  };
  if (!body.patientName || !body.service || !body.date || !body.time) {
    toast('Rellena todos los campos obligatorios', 'err');
    return;
  }
  try {
    await api('/api/portal/appointments/' + id, 'PATCH', body);
    closeModal();
    toast('Cita actualizada');
    _citasData = [];
    loadCitas();
  } catch (e) {
    toast('Error: ' + e.message, 'err');
  }
}

function cancelCitaConfirm(id, name) {
  openModal(
    '<div class="modal-title">Cancelar cita</div>' +
    '<p style="color:var(--dim);margin-bottom:20px">¿Seguro que quieres cancelar la cita de ' +
      '<strong style="color:var(--text)">' + esc(name) + '</strong>? ' +
      'Si tiene email registrado, se le enviará un aviso.</p>' +
    '<div class="modal-actions">' +
      '<button class="btn btn-d" onclick="closeModal()">No, volver</button>' +
      '<button class="btn btn-r" onclick="submitCancelCita(\'' + esc(id) + '\')">Sí, cancelar</button>' +
    '</div>'
  );
}

async function submitCancelCita(id) {
  try {
    await api('/api/portal/appointments/' + id, 'DELETE');
    closeModal();
    toast('Cita cancelada');
    _citasData = [];
    loadCitas();
  } catch (e) {
    toast('Error: ' + e.message, 'err');
  }
}

// ── Informes ──────────────────────────────────────────────────
async function loadInformes(period) {
  period = period || 'month';
  var sec = document.getElementById('sec-informes');
  sec.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⏳</div><div>Cargando informes…</div></div>';

  var data;
  try {
    data = await api('/api/portal/reports?period=' + period);
  } catch (e) {
    sec.innerHTML = '<div class="empty-state"><div>Error: ' + esc(e.message) + '</div></div>';
    return;
  }

  var s = data.summary || {};
  var t = data.allTime || {};
  var PERIOD_LABEL = { week: 'Esta semana', month: 'Este mes', quarter: 'Últimos 3 meses' };

  // CSS bar chart
  var dow    = data.callsByDayOfWeek || [];
  var maxVal = 1;
  for (var i = 0; i < dow.length; i++) { if (dow[i].value > maxVal) maxVal = dow[i].value; }
  var bars = '';
  for (var i = 0; i < dow.length; i++) {
    var pct = Math.round((dow[i].value / maxVal) * 100);
    bars += '<div class="bar-wrap">' +
      '<div class="bar-val">' + (dow[i].value > 0 ? dow[i].value : '') + '</div>' +
      '<div class="bar" style="height:' + Math.max(pct, 5) + '%" title="' + esc(dow[i].label) + ': ' + dow[i].value + '"></div>' +
      '<div class="bar-label">' + esc(dow[i].label) + '</div></div>';
  }

  var periodBtns = ['week','month','quarter'].map(function(p) {
    return '<button class="btn ' + (p === period ? 'btn-accent' : 'btn-d') + ' btn-sm" onclick="loadInformes(\'' + p + '\')">' + PERIOD_LABEL[p] + '</button>';
  }).join('');

  sec.innerHTML =
    '<div class="section-header">' +
      '<div class="section-title">📈 Informes</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap">' + periodBtns + '</div>' +
    '</div>' +
    '<div style="font-size:12px;color:var(--dim);margin-bottom:12px">' + (PERIOD_LABEL[period] || period) + '</div>' +
    '<div class="kpi-grid">' +
      '<div class="kpi"><div class="kpi-label">Llamadas</div><div class="kpi-val" style="color:var(--accent-l)">' + (s.totalCalls || 0) + '</div></div>' +
      '<div class="kpi"><div class="kpi-label">Reservas</div><div class="kpi-val" style="color:var(--green2)">' + (s.bookings || 0) + '</div></div>' +
      '<div class="kpi"><div class="kpi-label">Conversión</div><div class="kpi-val" style="color:var(--yellow)">' + (s.convRate || 0) + '%</div></div>' +
      '<div class="kpi"><div class="kpi-label">Horas ahorradas</div><div class="kpi-val" style="color:#60a5fa">' + (s.hoursSaved || 0) + 'h</div></div>' +
      '<div class="kpi"><div class="kpi-label">Ingresos estimados</div><div class="kpi-val" style="color:var(--green2)">€' + (s.revenueEst || 0) + '</div><div class="kpi-sub">reservas × precio medio</div></div>' +
    '</div>' +
    '<div class="two-col">' +
      '<div class="card"><div class="card-title">📊 Llamadas por día de la semana</div>' +
        '<div class="bar-chart">' + (bars || '<div style="color:var(--dim);font-size:12px">Sin datos</div>') + '</div>' +
      '</div>' +
      '<div class="card"><div class="card-title">🏆 Desde que activaste NodeFlow</div>' +
        '<div style="display:flex;flex-direction:column;gap:12px;margin-top:8px">' +
          '<div style="display:flex;justify-content:space-between"><span style="color:var(--dim)">Total llamadas</span><strong>' + (t.totalCalls || 0) + '</strong></div>' +
          '<div style="display:flex;justify-content:space-between"><span style="color:var(--dim)">Reservas generadas</span><strong style="color:var(--green2)">' + (t.bookings || 0) + '</strong></div>' +
          '<div style="display:flex;justify-content:space-between"><span style="color:var(--dim)">Horas ahorradas</span><strong style="color:#60a5fa">' + (t.hoursSaved || 0) + 'h</strong></div>' +
          '<div style="display:flex;justify-content:space-between"><span style="color:var(--dim)">Ingresos atribuidos</span><strong style="color:var(--green2)">€' + (t.revenueEst || 0) + '</strong></div>' +
        '</div>' +
      '</div>' +
    '</div>';
}

// ── Automatizaciones ──────────────────────────────────────────
async function loadAutomatizaciones() {
  var sec = document.getElementById('sec-automatizaciones');
  sec.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⏳</div><div>Cargando…</div></div>';

  var autoData, critData;
  try {
    autoData = await api('/api/portal/automations');
    critData = await api('/api/critical-dates/' + _orgInfo.id);
  } catch (e) {
    sec.innerHTML = '<div class="empty-state"><div>Error: ' + esc(e.message) + '</div></div>';
    return;
  }

  var auto = autoData.automations || {};
  var rem  = auto.reminders || {};
  var rev  = auto.reviews   || {};
  var reb  = auto.rebooking || {};

  var critRows = '';
  if (critData.entries && critData.entries.length > 0) {
    for (var i = 0; i < critData.entries.length; i++) {
      var e = critData.entries[i];
      var days = Math.ceil((new Date(e.dueDate) - new Date()) / 86400000);
      var urgClass = days <= 7 ? 'br' : days <= 15 ? 'by' : 'bp';
      var daysText = days > 0 ? 'en ' + days + 'd' : days === 0 ? 'hoy' : 'hace ' + (-days) + 'd';
      critRows += '<div class="crit-item">' +
        '<div><div class="crit-name">' + esc(e.clientName) + '</div>' +
          '<div class="crit-meta"><span class="badge ' + urgClass + '">' + esc(e.type) + '</span>' + (e.notes ? ' · ' + esc(e.notes) : '') + '</div></div>' +
        '<div><div class="crit-date">' + fmtDate(e.dueDate) + '</div><div class="crit-days">' + daysText + '</div></div>' +
        '<button class="btn btn-r btn-sm" onclick="deleteCritDate(\'' + esc(e.id) + '\')">✕</button>' +
        '</div>';
    }
  } else {
    critRows = '<div class="empty-state" style="padding:24px"><div class="empty-state-text">No hay fechas críticas activas</div></div>';
  }

  sec.innerHTML =
    '<div class="section-header"><div class="section-title">🤖 Automatizaciones</div></div>' +
    '<div class="auto-grid">' +
      // Reminders card
      '<div class="auto-card"><div class="auto-row"><div>' +
        '<div class="auto-name">🔔 Recordatorios de cita</div>' +
        '<div class="auto-desc">WhatsApp + email al cliente antes de su cita</div>' +
      '</div><label class="toggle"><input type="checkbox" id="togReminders" ' + (rem.enabled !== false ? 'checked' : '') +
        ' onchange="patchAuto(\'reminders\',{enabled:this.checked})"><span class="slider"></span></label></div>' +
      '<div class="auto-footer"><span class="auto-label">Horas antes:</span><div class="auto-hours">' +
        '<input type="number" id="hoursReminders" value="' + (rem.hoursBefore || 24) + '" min="1" max="72"' +
        ' onchange="patchAuto(\'reminders\',{hoursBefore:parseInt(this.value)})"></div></div></div>' +
      // Reviews card
      '<div class="auto-card"><div class="auto-row"><div>' +
        '<div class="auto-name">⭐ Solicitud de reseña</div>' +
        '<div class="auto-desc">WhatsApp + email pidiendo reseña Google tras la cita</div>' +
      '</div><label class="toggle"><input type="checkbox" id="togReviews" ' + (rev.enabled !== false ? 'checked' : '') +
        ' onchange="patchAuto(\'reviews\',{enabled:this.checked})"><span class="slider"></span></label></div>' +
      '<div class="auto-footer"><span class="auto-label">Horas después:</span><div class="auto-hours">' +
        '<input type="number" id="hoursReviews" value="' + (rev.hoursAfter || 24) + '" min="1" max="72"' +
        ' onchange="patchAuto(\'reviews\',{hoursAfter:parseInt(this.value)})"></div></div></div>' +
      // Rebooking card
      '<div class="auto-card"><div class="auto-row"><div>' +
        '<div class="auto-name">🔄 Rebooking automático</div>' +
        '<div class="auto-desc">Recordatorio cuando un cliente lleva tiempo sin venir</div>' +
      '</div><label class="toggle"><input type="checkbox" id="togRebooking" ' + (reb.enabled !== false ? 'checked' : '') +
        ' onchange="patchAuto(\'rebooking\',{enabled:this.checked})"><span class="slider"></span></label></div>' +
      '<div class="auto-footer"><span class="auto-label">Días sin venir:</span><div class="auto-hours">' +
        '<input type="number" id="daysRebooking" value="' + (reb.daysThreshold || 42) + '" min="7" max="365"' +
        ' onchange="patchAuto(\'rebooking\',{daysThreshold:parseInt(this.value)})"></div></div></div>' +
    '</div>' +
    '<div class="card"><div class="card-title" style="justify-content:space-between">' +
      '<span>📅 Fechas críticas</span>' +
      '<button class="btn btn-accent btn-sm" onclick="openNewCritDate()">+ Añadir</button>' +
    '</div><div id="critDatesList">' + critRows + '</div></div>';
}

async function patchAuto(type, patch) {
  var body = {};
  body[type] = patch;
  try {
    await api('/api/portal/automations', 'PATCH', body);
    toast('Configuración guardada');
  } catch (e) {
    toast('Error: ' + e.message, 'err');
  }
}

async function deleteCritDate(id) {
  try {
    await api('/api/critical-dates/' + id, 'DELETE');
    toast('Fecha crítica eliminada');
    loadAutomatizaciones();
  } catch (e) {
    toast('Error: ' + e.message, 'err');
  }
}

function openNewCritDate() {
  var TYPES = ['itv_expiry','vaccine_due','tax_filing','quarterly_vat','insurance_renewal',
    'license_renewal','contract_renewal','pregnancy_due','treatment_cycle','follow_up',
    'birthday','annual_review','mortgage_payment','warranty_expiry','subscription_renewal','other'];
  var typeOpts = TYPES.map(function(t) {
    return '<option value="' + t + '">' + t.replace(/_/g,' ') + '</option>';
  }).join('');

  openModal(
    '<div class="modal-title">📅 Nueva fecha crítica</div>' +
    '<div class="form-group"><label class="form-label">Nombre del cliente *</label>' +
      '<input class="form-input" id="cdName" placeholder="Ana García"></div>' +
    '<div class="form-group"><label class="form-label">Tipo *</label>' +
      '<select class="form-input" id="cdType">' + typeOpts + '</select></div>' +
    '<div class="form-group"><label class="form-label">Fecha crítica *</label>' +
      '<input class="form-input" id="cdDate" type="date"></div>' +
    '<div class="form-group"><label class="form-label">Email</label>' +
      '<input class="form-input" id="cdEmail" type="email" placeholder="cliente@email.com"></div>' +
    '<div class="form-group"><label class="form-label">Teléfono</label>' +
      '<input class="form-input" id="cdPhone" type="tel"></div>' +
    '<div class="form-group"><label class="form-label">Notas</label>' +
      '<input class="form-input" id="cdNotes" placeholder="Vacuna rabia, perro Max…"></div>' +
    '<div class="modal-actions">' +
      '<button class="btn btn-d" onclick="closeModal()">Cancelar</button>' +
      '<button class="btn btn-accent" onclick="submitCritDate()">Guardar</button>' +
    '</div>'
  );
}

async function submitCritDate() {
  var body = {
    businessId:  _orgInfo.id,
    clientName:  document.getElementById('cdName').value.trim(),
    type:        document.getElementById('cdType').value,
    dueDate:     document.getElementById('cdDate').value,
    clientEmail: document.getElementById('cdEmail').value.trim() || null,
    clientPhone: document.getElementById('cdPhone').value.trim() || null,
    notes:       document.getElementById('cdNotes').value.trim() || null,
  };
  if (!body.clientName || !body.dueDate) {
    toast('Rellena nombre y fecha', 'err');
    return;
  }
  try {
    await api('/api/critical-dates', 'POST', body);
    closeModal();
    toast('Fecha crítica añadida');
    loadAutomatizaciones();
  } catch (e) {
    toast('Error: ' + e.message, 'err');
  }
}

// ── Configuración ─────────────────────────────────────────────
async function loadConfig() {
  var sec = document.getElementById('sec-configuracion');
  sec.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⏳</div><div>Cargando…</div></div>';

  var data;
  try {
    data = await api('/api/portal/config');
  } catch (e) {
    sec.innerHTML = '<div class="empty-state"><div>Error: ' + esc(e.message) + '</div></div>';
    return;
  }

  var c = data.config || {};
  var SECTORS = ['generico','restaurante','fisioterapia','clinica','dental','peluqueria','barberia',
    'estetica','gimnasio','academia','veterinaria','farmacia','asesoria','taller','hotel',
    'inmobiliaria','optica','psicologia','coaching','nutricion','podologia','autoescuela',
    'estetica_avanzada','yoga','pilates','guarderia_canina','abogados','notaria',
    'agencia_viajes','reformas','otro'];
  var sectorOpts = SECTORS.map(function(s) {
    return '<option value="' + s + '" ' + (c.sector === s ? 'selected' : '') + '>' +
      s.charAt(0).toUpperCase() + s.slice(1) + '</option>';
  }).join('');

  sec.innerHTML =
    '<div class="section-header"><div class="section-title">⚙️ Configuración</div></div>' +
    '<div class="card" style="max-width:640px">' +
      '<div class="form-section-title">Información general</div>' +
      '<div class="form-group"><label class="form-label">Nombre del negocio</label>' +
        '<input class="form-input" id="cfgName" value="' + esc(c.name || '') + '"></div>' +
      '<div class="form-group"><label class="form-label">Email del propietario</label>' +
        '<input class="form-input" readonly value="' + esc(c.ownerEmail || '') + '">' +
        '<small style="color:var(--dim);font-size:11px">Para cambiar el email, contacta con soporte</small></div>' +
      '<div class="form-group"><label class="form-label">Teléfono del negocio</label>' +
        '<input class="form-input" readonly value="' + esc(c.phone || '—') + '">' +
        '<small style="color:var(--dim);font-size:11px">Número provisionado — no editable</small></div>' +
      '<div class="form-group"><label class="form-label">Idioma del AI</label>' +
        '<select class="form-input" id="cfgLang">' +
          '<option value="es" ' + (c.language === 'es' ? 'selected' : '') + '>Español</option>' +
          '<option value="eu" ' + (c.language === 'eu' ? 'selected' : '') + '>Euskera</option>' +
          '<option value="gl" ' + (c.language === 'gl' ? 'selected' : '') + '>Gallego</option>' +
        '</select></div>' +
      '<div class="form-group"><label class="form-label">Sector</label>' +
        '<select class="form-input" id="cfgSector">' + sectorOpts + '</select></div>' +
      '<div class="form-section-title">Servicios y horarios</div>' +
      '<div class="form-group"><label class="form-label">Servicios (uno por línea o separados por comas)</label>' +
        '<textarea class="form-input" id="cfgServices" rows="4" placeholder="Corte de pelo, Tinte, Mechas…">' + esc(c.services || '') + '</textarea></div>' +
      '<div class="form-group"><label class="form-label">Horarios</label>' +
        '<textarea class="form-input" id="cfgSchedule" rows="3" placeholder="L-V 9:00-20:00, Sáb 9:00-14:00">' + esc(c.schedule || '') + '</textarea></div>' +
      '<div class="form-section-title">Configuración del AI</div>' +
      '<div class="form-group"><label class="form-label">Mensaje de bienvenida</label>' +
        '<textarea class="form-input" id="cfgWelcome" rows="3" placeholder="Hola, has llamado a…">' + esc(c.welcomeMessage || '') + '</textarea></div>' +
      '<div class="form-group"><label class="form-label">Precio medio por servicio (€)</label>' +
        '<input class="form-input" id="cfgAvgTicket" type="number" min="1" max="9999" value="' + (c.avgTicket || 35) + '"></div>' +
      '<div class="form-section-title">Dirección</div>' +
      '<div class="form-group"><label class="form-label">Dirección del negocio</label>' +
        '<input class="form-input" id="cfgAddress" placeholder="Calle Mayor 12, 20140 Andoain"' +
          ' value="' + esc(c.address || '') + '">' +
        '<small style="color:var(--dim);font-size:11px">Usada en fichas de Google, facturas y comunicaciones a clientes.</small></div>' +

      '<div class="form-section-title">Reseñas de Google</div>' +
      '<div class="form-group"><label class="form-label">URL de tu ficha de Google</label>' +
        '<input class="form-input" id="cfgReviewUrl" type="url" placeholder="https://g.page/r/…/review"' +
          ' value="' + esc(c.reviewUrl || '') + '">' +
        '<small style="color:var(--dim);font-size:11px">Enlace de "Escribe una reseña" de Google Business. Se incluye en recordatorios automáticos post-cita.</small></div>' +

      '<div class="form-section-title">Notificaciones al propietario</div>' +
      '<div class="form-group"><label class="form-label">Tu WhatsApp personal <span style="color:var(--dim);font-weight:400">(alertas de confirmaciones y cancelaciones)</span></label>' +
        '<input class="form-input" id="cfgAlertPhone" type="tel" placeholder="+34 612 345 678"' +
          ' value="' + esc(c.alertPhone || '') + '">' +
        '<small style="color:var(--dim);font-size:11px">Recibirás un WhatsApp cuando un cliente confirme o cancele su cita. Debe ser diferente al número del negocio.</small></div>' +
      '<div class="form-group"><label class="form-label">Email para notificaciones <span style="color:var(--dim);font-weight:400">(resumen diario y alertas)</span></label>' +
        '<input class="form-input" id="cfgNotifyEmail" type="email" placeholder="tu@email.com"' +
          ' value="' + esc(c.notifyEmail || '') + '"></div>' +

      '<div style="display:flex;gap:12px;margin-top:24px">' +
        '<button class="btn btn-accent" onclick="saveConfig()">Guardar cambios</button>' +
        '<a href="https://wa.me/34666351319?text=Necesito%20ayuda%20con%20mi%20portal" target="_blank"' +
           ' class="btn btn-d" style="text-decoration:none">Contactar soporte</a>' +
      '</div>' +
    '</div>' +
    (c.phone ? renderDesvioGuide(c.phone) : '');
}

async function saveConfig() {
  var body = {
    name:           document.getElementById('cfgName').value.trim(),
    language:       document.getElementById('cfgLang').value,
    sector:         document.getElementById('cfgSector').value,
    services:       document.getElementById('cfgServices').value.trim(),
    schedule:       document.getElementById('cfgSchedule').value.trim(),
    welcomeMessage: document.getElementById('cfgWelcome').value.trim(),
    avgTicket:      parseFloat(document.getElementById('cfgAvgTicket').value) || 35,
    reviewUrl:      document.getElementById('cfgReviewUrl')?.value?.trim()   || '',
    alertPhone:     document.getElementById('cfgAlertPhone')?.value?.trim()  || '',
    notifyEmail:    document.getElementById('cfgNotifyEmail')?.value?.trim() || '',
    address:        document.getElementById('cfgAddress')?.value?.trim()     || '',
  };
  if (!body.name) { toast('El nombre no puede estar vacío', 'err'); return; }
  try {
    await api('/api/portal/config', 'PATCH', body);
    document.getElementById('sidebarBiz').textContent = body.name;
    toast('Configuración guardada');
  } catch (e) {
    toast('Error: ' + e.message, 'err');
  }
}

// ── Guía de desvío de llamadas ────────────────────────────────
function renderDesvioGuide(phone) {
  // Normalizar: solo dígitos, sin + ni espacios, con 34 si no lo tiene
  var digits = String(phone).replace(/[^0-9]/g, '');
  if (!digits.startsWith('34')) digits = '34' + digits;

  var tipos = [
    {
      icon: '🔄',
      label: 'Desvío incondicional',
      desc: 'Todas las llamadas van al asistente IA (recomendado fuera de horario o si no quieres atender tú)',
      activate:   '**21*' + digits + '#',
      deactivate: '##21#',
    },
    {
      icon: '⏱️',
      label: 'Por no contestar',
      desc: 'Si no coges en ~15 segundos, la IA atiende. Ideal como backup durante el horario laboral',
      activate:   '**61*' + digits + '#',
      deactivate: '##61#',
    },
    {
      icon: '📵',
      label: 'Por línea ocupada',
      desc: 'La IA atiende cuando estás hablando con otro cliente',
      activate:   '**67*' + digits + '#',
      deactivate: '##67#',
    },
    {
      icon: '📴',
      label: 'Por no disponible',
      desc: 'Cuando el móvil está apagado o sin cobertura',
      activate:   '**62*' + digits + '#',
      deactivate: '##62#',
    },
  ];

  var rows = tipos.map(function(t) {
    var actId  = 'code-act-'  + t.activate.replace(/[^0-9]/g,'').slice(-4);
    var deactId = 'code-deact-' + t.deactivate.replace(/[^0-9]/g,'').slice(-4);
    return '<div style="border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:10px">' +
      '<div style="display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap">' +
        '<div style="font-size:20px;line-height:1;margin-top:2px">' + t.icon + '</div>' +
        '<div style="flex:1;min-width:200px">' +
          '<div style="font-weight:700;font-size:13px;margin-bottom:2px">' + t.label + '</div>' +
          '<div style="font-size:11px;color:var(--dim);margin-bottom:10px;line-height:1.5">' + t.desc + '</div>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
            '<div style="display:flex;align-items:center;gap:6px;background:rgba(0,206,201,.07);border:1px solid rgba(0,206,201,.2);border-radius:8px;padding:6px 12px">' +
              '<span style="font-size:10px;color:var(--green);font-weight:700;text-transform:uppercase">Activar</span>' +
              '<code id="' + actId + '" style="font-size:13px;font-weight:700;color:var(--green2);letter-spacing:.02em">' + t.activate + '</code>' +
              '<button onclick="copyCode(\'' + actId + '\')" style="background:none;border:none;cursor:pointer;font-size:14px;padding:0 0 0 4px;color:var(--green)" title="Copiar">📋</button>' +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:6px;background:rgba(255,255,255,.03);border:1px solid var(--border);border-radius:8px;padding:6px 12px">' +
              '<span style="font-size:10px;color:var(--dim);font-weight:700;text-transform:uppercase">Desactivar</span>' +
              '<code id="' + deactId + '" style="font-size:13px;color:var(--dim)">' + t.deactivate + '</code>' +
              '<button onclick="copyCode(\'' + deactId + '\')" style="background:none;border:none;cursor:pointer;font-size:14px;padding:0 0 0 4px;color:var(--dim)" title="Copiar">📋</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');

  return '<div class="card" style="max-width:640px;margin-top:20px">' +
    '<div class="card-title">📞 Códigos de desvío de llamadas</div>' +
    '<div style="font-size:12px;color:var(--dim);margin-bottom:14px;line-height:1.5">' +
      'Marca el código desde el teléfono del negocio y pulsa la tecla de llamada. ' +
      'Tu número de NodeFlow: <strong style="color:var(--accent-l);font-family:monospace">+' + digits + '</strong>' +
    '</div>' +
    rows +
    '<div style="margin-top:12px;padding:10px 12px;background:rgba(249,202,36,.06);border:1px solid rgba(249,202,36,.15);border-radius:8px;font-size:11px;color:#f9ca24;line-height:1.5">' +
      '⚠️ Los códigos <strong>**21#</strong> son estándar para Movistar, Vodafone, Jazztel, Yoigo, MásMóvil y Euskaltel. ' +
      'Orange usa <strong>*21#</strong> (sin el primer asterisco extra). ' +
      'Para centralitas fijas contacta con soporte.' +
    '</div>' +
  '</div>';
}

function copyCode(elementId) {
  var el = document.getElementById(elementId);
  if (!el) return;
  var text = el.textContent.trim();
  navigator.clipboard.writeText(text).then(function() {
    toast('📋 Copiado: ' + text);
  }).catch(function() {
    // Fallback para navegadores sin clipboard API
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    toast('📋 Copiado: ' + text);
  });
}

// ── Clientes ──────────────────────────────────────────────────
var _clientesSearchTimer = null;

function onClientesSearch() {
  clearTimeout(_clientesSearchTimer);
  _clientesSearchTimer = setTimeout(function() {
    var q = document.getElementById('clientesSearch');
    loadClientes(q ? q.value.trim() : '');
  }, 300);
}

async function loadClientes(q) {
  q = q || '';
  var sec = document.getElementById('sec-clientes');
  sec.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⏳</div><div>Cargando clientes…</div></div>';

  var data;
  try {
    var qs = q ? '?q=' + encodeURIComponent(q) : '';
    data = await api('/api/portal/contacts' + qs);
  } catch (e) {
    sec.innerHTML = '<div class="empty-state"><div>Error: ' + esc(e.message) + '</div></div>';
    return;
  }

  var rows = '';
  if (data.contacts && data.contacts.length > 0) {
    for (var i = 0; i < data.contacts.length; i++) {
      var c = data.contacts[i];
      rows += '<tr onclick="openContactProfile(\'' + esc(c.id) + '\')" style="cursor:pointer">' +
        '<td><strong>' + esc(c.displayName) + '</strong>' +
          (c.name ? '<div style="font-size:11px;color:var(--dim)">' + esc(c.phone) + '</div>' : '') + '</td>' +
        '<td>' + esc(c.email || '—') + '</td>' +
        '<td style="text-align:center"><span class="badge bp">' + (c.callCount || 0) + '</span></td>' +
        '<td style="color:var(--dim);font-size:12px">' + (c.lastCallAt ? timeAgo(c.lastCallAt) : '—') + '</td>' +
        '<td><button class="btn btn-d btn-sm" onclick="event.stopPropagation();openContactProfile(\'' + esc(c.id) + '\')">Ver →</button></td>' +
        '</tr>';
    }
  } else {
    rows = '<tr class="empty-row"><td colspan="5">' +
      (q ? 'Sin resultados para "' + esc(q) + '"' : 'Aún no hay clientes registrados. Aparecerán tras las primeras llamadas.') +
      '</td></tr>';
  }

  sec.innerHTML =
    '<div class="section-header">' +
      '<div class="section-title">👥 Clientes</div>' +
      '<div style="font-size:13px;color:var(--dim)">' + (data.count || 0) + ' contactos</div>' +
    '</div>' +
    '<div class="search-bar">' +
      '<input class="search-input" id="clientesSearch" placeholder="Buscar por nombre, teléfono o email…"' +
        ' value="' + esc(q) + '" oninput="onClientesSearch()">' +
    '</div>' +
    '<div class="table-wrap"><table>' +
      '<thead><tr><th>Cliente</th><th>Email</th><th>Llamadas</th><th>Última llamada</th><th></th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>';
}

async function openContactProfile(id) {
  openModal('<div class="modal-title">👤 Perfil de cliente</div>' +
    '<div style="color:var(--dim);font-size:13px">Cargando…</div>');

  var data;
  try {
    data = await api('/api/portal/contacts/' + id);
  } catch (e) {
    openModal('<div class="modal-title">👤 Perfil de cliente</div>' +
      '<p style="color:var(--dim)">Error: ' + esc(e.message) + '</p>' +
      '<div class="modal-actions"><button class="btn btn-d" onclick="closeModal()">Cerrar</button></div>');
    return;
  }

  var c = data.contact;
  var initial = (c.displayName || c.phone).charAt(0).toUpperCase();

  // Calls table rows
  var callRows = '';
  var OUTCOME_BADGE = {
    booked: '<span class="badge bg">reserva</span>',
    info:   '<span class="badge binfo">info</span>',
    abandoned: '<span class="badge bd">abandonada</span>',
  };
  if (data.calls && data.calls.length > 0) {
    for (var i = 0; i < data.calls.length; i++) {
      var cl = data.calls[i];
      var dur = cl.durationMs ? Math.round(cl.durationMs / 1000) + 's' : '—';
      callRows += '<tr>' +
        '<td>' + (cl.startedAt ? new Date(cl.startedAt).toLocaleDateString('es-ES') : '—') + '</td>' +
        '<td>' + dur + '</td>' +
        '<td>' + (OUTCOME_BADGE[cl.outcome] || '<span class="badge bd">' + esc(cl.outcome) + '</span>') + '</td>' +
        '<td><button class="btn btn-d btn-sm" onclick="openTranscriptModal(\'' + esc(cl.callSid) + '\')">💬</button></td>' +
        '</tr>';
    }
  } else {
    callRows = '<tr class="empty-row"><td colspan="4">Sin llamadas registradas</td></tr>';
  }

  // Appointments table rows
  var aptRows = '';
  if (data.appointments && data.appointments.length > 0) {
    for (var j = 0; j < data.appointments.length; j++) {
      var a = data.appointments[j];
      var statusBadge = a.status === 'cancelled'
        ? '<span class="badge br">Cancelada</span>'
        : '<span class="badge bg">✓ Confirmada</span>';
      aptRows += '<tr>' +
        '<td>' + fmtDate(a.date) + '</td>' +
        '<td>' + esc(a.time || '—') + '</td>' +
        '<td>' + esc(a.service || '—') + '</td>' +
        '<td>' + statusBadge + '</td>' +
        '</tr>';
    }
  } else {
    aptRows = '<tr class="empty-row"><td colspan="4">Sin citas registradas</td></tr>';
  }

  openModal(
    '<div class="profile-header">' +
      '<div class="profile-avatar">' + initial + '</div>' +
      '<div>' +
        '<div class="profile-name">' + esc(c.displayName) + '</div>' +
        '<div class="profile-meta">' + esc(c.phone) +
          (c.email ? ' · ' + esc(c.email) : '') + '</div>' +
        '<div style="font-size:12px;color:var(--dim);margin-top:4px">' +
          (c.callCount || 0) + ' llamadas · Cliente desde ' + fmtDate((c.createdAt || '').slice(0,10)) +
        '</div>' +
      '</div>' +
    '</div>' +

    '<div class="profile-section-title">Nombre y notas</div>' +
    '<div class="form-group">' +
      '<label class="form-label">Nombre</label>' +
      '<input class="form-input" id="cpName" value="' + esc(c.name || '') + '" placeholder="' + esc(c.phone) + '">' +
    '</div>' +
    '<div class="form-group">' +
      '<label class="form-label">Email</label>' +
      '<input class="form-input" id="cpEmail" type="email" value="' + esc(c.email || '') + '">' +
    '</div>' +
    '<div class="form-group">' +
      '<label class="form-label">Notas</label>' +
      '<textarea class="form-input" id="cpNotes" rows="3" onblur="saveContactNotes(\'' + esc(id) + '\')">' + esc(c.notes || '') + '</textarea>' +
      '<small style="color:var(--dim);font-size:11px">Se guarda automáticamente al salir del campo</small>' +
    '</div>' +
    '<div style="display:flex;gap:8px;margin-bottom:8px">' +
      '<button class="btn btn-accent btn-sm" onclick="saveContactNotes(\'' + esc(id) + '\', true)">Guardar datos</button>' +
      '<button class="btn btn-r btn-sm" onclick="deleteContact(\'' + esc(id) + '\')">Eliminar contacto</button>' +
    '</div>' +

    '<div class="profile-section-title">Historial de llamadas</div>' +
    '<div class="table-wrap" style="margin-bottom:16px"><table>' +
      '<thead><tr><th>Fecha</th><th>Duración</th><th>Resultado</th><th>Transcript</th></tr></thead>' +
      '<tbody>' + callRows + '</tbody></table></div>' +

    '<div class="profile-section-title">Historial de citas</div>' +
    '<div class="table-wrap"><table>' +
      '<thead><tr><th>Fecha</th><th>Hora</th><th>Servicio</th><th>Estado</th></tr></thead>' +
      '<tbody>' + aptRows + '</tbody></table></div>' +

    '<div class="modal-actions" style="margin-top:20px">' +
      (c.phone ? '<button class="btn btn-g" onclick="callOutbound(\'' + esc(c.phone) + '\',this)">📞 Llamar</button>' : '') +
      (c.phone ? '<a class="btn" style="background:#25d366;color:#fff;text-decoration:none" href="https://wa.me/' + esc(c.phone.replace(/[^0-9]/g,'')) + '" target="_blank">💬 WhatsApp</a>' : '') +
      '<button class="btn btn-d" onclick="closeModal()">Cerrar</button>' +
    '</div>'
  );
}

async function saveContactNotes(id, withNameEmail) {
  var patch = {
    notes: (document.getElementById('cpNotes') || {}).value || '',
  };
  if (withNameEmail) {
    var nameEl  = document.getElementById('cpName');
    var emailEl = document.getElementById('cpEmail');
    if (nameEl)  patch.name  = nameEl.value.trim()  || null;
    if (emailEl) patch.email = emailEl.value.trim()  || null;
  }
  try {
    await api('/api/portal/contacts/' + id, 'PATCH', patch);
    toast(withNameEmail ? 'Contacto actualizado' : 'Notas guardadas');
    // Refresh clientes list if visible
    if (_currentSection === 'clientes') loadClientes();
  } catch (e) {
    toast('Error al guardar: ' + e.message, 'err');
  }
}

function deleteContact(id) {
  openModal(
    '<div class="modal-title">Eliminar contacto</div>' +
    '<p style="color:var(--dim);margin-bottom:20px">¿Seguro que quieres eliminar este contacto? Se eliminarán sus notas y datos editados, pero el historial de llamadas permanece en el sistema.</p>' +
    '<div class="modal-actions">' +
      '<button class="btn btn-d" onclick="closeModal()">Cancelar</button>' +
      '<button class="btn btn-r" onclick="confirmDeleteContact(\'' + esc(id) + '\')">Sí, eliminar</button>' +
    '</div>'
  );
}

async function confirmDeleteContact(id) {
  try {
    await api('/api/portal/contacts/' + id, 'DELETE');
    closeModal();
    toast('Contacto eliminado');
    if (_currentSection === 'clientes') loadClientes();
  } catch (e) {
    toast('Error: ' + e.message, 'err');
  }
}

// ── Transcript modal ──────────────────────────────────────────
async function openTranscriptModal(callSid) {
  if (!callSid) {
    openModal('<div class="modal-title">💬 Transcripción</div>' +
      '<p style="color:var(--dim)">ID de llamada no disponible. Actualiza la sección Llamadas.</p>' +
      '<div class="modal-actions"><button class="btn btn-d" onclick="closeModal()">Cerrar</button></div>');
    return;
  }
  openModal('<div class="modal-title">💬 Transcripción</div>' +
    '<div style="color:var(--dim);font-size:13px;padding:12px 0">Cargando…</div>');
  var data;
  try {
    data = await api('/api/portal/calls/' + callSid + '/transcript');
  } catch (e) {
    openModal('<div class="modal-title">💬 Transcripción</div>' +
      '<p style="color:var(--dim)">No disponible: ' + esc(e.message) + '</p>' +
      '<div class="modal-actions"><button class="btn btn-d" onclick="closeModal()">Cerrar</button></div>');
    return;
  }

  var dateStr = data.startedAt ? new Date(data.startedAt).toLocaleDateString('es-ES', {day:'numeric',month:'long'}) : '';
  var durStr  = data.durationMs ? Math.round(data.durationMs / 1000) + 's' : '';

  var rows = '';
  if (data.transcript && data.transcript.length > 0) {
    for (var i = 0; i < data.transcript.length; i++) {
      var t = data.transcript[i];
      var isAI = t.role === 'assistant';
      rows += '<div class="transcript-row ' + (isAI ? 'ai' : 'user') + '">' +
        '<span class="transcript-role">' + (isAI ? '🤖 AI' : '👤 Cliente') + '</span>' +
        '<span class="transcript-text">' + esc(t.content || '') + '</span>' +
        '</div>';
    }
  } else {
    rows = '<div style="color:var(--dim);font-size:13px;padding:12px 0">Sin transcripción disponible para esta llamada.</div>';
  }

  openModal(
    '<div class="modal-title">💬 Transcripción' + (dateStr ? ' · ' + dateStr : '') + '</div>' +
    (durStr ? '<div style="font-size:12px;color:var(--dim);margin-bottom:12px">' + durStr + ' · ' + data.transcript.length + ' turnos</div>' : '') +
    '<div class="transcript-list">' + rows + '</div>' +
    '<div class="modal-actions"><button class="btn btn-d" onclick="closeModal()">Cerrar</button></div>'
  );
}

// ── Boot ──────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', initAuth);

// ── Asistente section ─────────────────────────────────────────────
var _asisConfig = {};
var _asisOrgName = '';
var _DAYS = ['mon','tue','wed','thu','fri','sat','sun'];
var _DAY_LABELS = { mon:'Lun', tue:'Mar', wed:'Mié', thu:'Jue', fri:'Vie', sat:'Sáb', sun:'Dom' };

async function loadAsistente() {
  try {
    var data = await api('/api/portal/assistant');
    _asisConfig  = data.config  || {};
    _asisOrgName = data.orgName || '';
    renderAsistenteForm();
  } catch (e) { toast('Error cargando asistente: ' + e.message, 'err'); }
}

function switchAsistenteTab(tab) {
  document.querySelectorAll('.btn-subtab').forEach(function(b) {
    b.classList.toggle('active', b.dataset.subtab === tab);
  });
  document.querySelectorAll('.asis-panel').forEach(function(p) {
    p.classList.toggle('hidden', p.id !== 'asis-' + tab);
  });
}

// ── Voice preview ──────────────────────────────────────────────
var _voicePreviewAudio = null;

function _onVoiceChange() {
  var voiceEl = document.getElementById('asis-voice');
  if (!voiceEl) return;
  var voice = voiceEl.value;
  var statusEl = document.getElementById('portal-demo-status');
  if (statusEl) {
    statusEl.textContent = '⏳ Cargando vista previa de voz…';
  }
  if (_voicePreviewAudio) { _voicePreviewAudio.pause(); _voicePreviewAudio = null; }

  var previewText = 'Hola, soy tu asistente virtual. Puedo ayudarte con reservas, información y mucho más.';
  fetch('/api/demo/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + _token },
    body: JSON.stringify({ text: previewText, voice: voice }),
  })
  .then(function(res) {
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.blob();
  })
  .then(function(blob) {
    _voicePreviewAudio = new Audio(URL.createObjectURL(blob));
    if (statusEl) statusEl.textContent = '🔊 Reproduciendo voz ' + voice + '…';
    _voicePreviewAudio.onended = function() {
      if (statusEl) statusEl.textContent = 'Pulsa para probar tu asistente';
    };
    _voicePreviewAudio.play().catch(function() {
      if (statusEl) statusEl.textContent = 'Escucharás la voz en la prueba de llamada';
    });
  })
  .catch(function() {
    if (statusEl) statusEl.textContent = 'Escucharás la voz en la prueba de llamada';
  });
}

function renderAsistenteForm() {
  var c = _asisConfig;
  var setVal = function(id, val) { var el = document.getElementById(id); if (el) el.value = val || ''; };

  setVal('asis-name',  c.assistantName || '');
  setVal('asis-lang',  c.language || 'es');
  setVal('asis-first', c.firstMessage || '');
  setVal('asis-extra', c.extraInfo || '');
  setVal('asis-voice', c.voice || 'nova');

  // Attach voice preview listener (remove old one first to avoid duplicates)
  var voiceEl = document.getElementById('asis-voice');
  if (voiceEl) {
    voiceEl.removeEventListener('change', _onVoiceChange);
    voiceEl.addEventListener('change', _onVoiceChange);
  }

  // Schedule grid
  var sched = c.schedule || {};
  var schedHtml = _DAYS.map(function(d) {
    var slot = sched[d];
    return '<div style="display:grid;grid-template-columns:80px 1fr;gap:10px;align-items:center;margin-bottom:8px">' +
      '<label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--dim);cursor:pointer">' +
      '<input type="checkbox" id="asis-day-' + d + '"' + (slot ? ' checked' : '') + ' onchange="toggleAsisDayClosed(\'' + d + '\')">' +
      ' ' + _DAY_LABELS[d] + '</label>' +
      '<div id="asis-slots-' + d + '" style="display:' + (slot?'flex':'none') + ';gap:8px;align-items:center">' +
      '<input type="time" class="form-ctrl" id="asis-open-' + d + '" value="' + (slot?slot.open:'09:00') + '" style="width:90px">' +
      '<span style="color:var(--dim);font-size:11px">–</span>' +
      '<input type="time" class="form-ctrl" id="asis-close-' + d + '" value="' + (slot?slot.close:'18:00') + '" style="width:90px">' +
      '</div>' +
      '</div>';
  }).join('');
  document.getElementById('asis-schedule-grid').innerHTML = schedHtml;

  // Contenido
  renderAsisSectorFields(c.sector || 'generico', c.sectorData || {}, c.services || '');

  // Generated prompt preview
  var genPrompt = document.getElementById('asis-generated-prompt');
  if (genPrompt) genPrompt.textContent = '(Guarda primero para ver el prompt generado)';
}

function toggleAsisDayClosed(day) {
  var checked = document.getElementById('asis-day-' + day).checked;
  document.getElementById('asis-slots-' + day).style.display = checked ? 'flex' : 'none';
}

// ── Sector field helpers ──────────────────────────────────────
function _ta(id, label, value, rows, ph) {
  return '<div class="form-group"><label class="form-label">' + label + '</label>' +
    '<textarea class="form-ctrl" id="' + id + '" rows="' + (rows||3) + '" placeholder="' + (ph||'') + '">' +
    esc(value||'') + '</textarea></div>';
}
function _inp(id, label, value, ph) {
  return '<div class="form-group"><label class="form-label">' + label + '</label>' +
    '<input class="form-ctrl" id="' + id + '" value="' + esc(value||'') + '" placeholder="' + (ph||'') + '"></div>';
}
function _chk(id, label, checked) {
  return '<div class="form-group" style="display:flex;align-items:center;gap:8px;margin-top:4px">' +
    '<input type="checkbox" id="' + id + '"' + (checked ? ' checked' : '') +
    ' style="width:16px;height:16px;accent-color:var(--accent)">' +
    '<label for="' + id + '" class="form-label" style="margin:0;cursor:pointer">' + label + '</label></div>';
}
function _segurosBlock(arr) {
  return '<div class="form-group"><label class="form-label">Seguros aceptados</label>' +
    '<div id="asis-seguros-chips" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px">' +
    (arr||[]).map(function(s) {
      return '<span style="background:rgba(108,92,231,.12);border:1px solid rgba(108,92,231,.2);border-radius:20px;padding:3px 10px;font-size:11px;display:flex;align-items:center;gap:4px">' +
        esc(s) + ' <span style="cursor:pointer" onclick="this.parentElement.remove()">×</span></span>';
    }).join('') +
    '</div><input class="form-ctrl" id="asis-seguro-input" placeholder="+ Seguro (Enter para añadir)" ' +
    'style="width:200px" onkeydown="if(event.key===\'Enter\'){addAsisSeguro();event.preventDefault()}"></div>';
}
function _getChips(chipsId) {
  var el = document.getElementById(chipsId);
  if (!el) return [];
  return Array.from(el.querySelectorAll('span')).map(function(s) {
    return s.textContent.replace('×', '').trim();
  }).filter(Boolean);
}

function renderAsisSectorFields(sector, sd, services) {
  var html = _ta('asis-services', 'Servicios generales', services, 3, 'Describe los servicios que ofrece el negocio…');

  if (sector === 'fisioterapia' || sector === 'clinica' || sector === 'dental') {
    html += _segurosBlock(sd.seguros);
    html += _ta('asis-espec', 'Especialidades', sd.especialidades, 2, 'Ej: Rehabilitación, Osteopatía…');

  } else if (sector === 'restaurante') {
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
      _inp('asis-horComida', 'Horario comidas', sd.horarioComida, '13:00-15:30') +
      _inp('asis-horCena',   'Horario cenas',   sd.horarioCena,   '20:30-23:00') + '</div>';
    html += _ta('asis-carta', 'Carta (nombre – precio por línea)',
      (sd.cartaItems||[]).map(function(i){ return i.name + (i.price ? ' - ' + i.price : ''); }).join('\n'),
      5, 'Chuletón - 28€');

  } else if (sector === 'peluqueria' || sector === 'podologia') {
    html += _ta('sd-servicios', 'Servicios y precios', sd.servicios, 4, 'Ej: Corte pelo - 25€, Manicura - 18€');

  } else if (sector === 'gimnasio') {
    html += _ta('sd-clases', 'Clases disponibles', sd.clases, 3, 'Ej: Yoga, Pilates, Spinning…');

  } else if (sector === 'spa' || sector === 'estetica_avanzada' || sector === 'laser') {
    html += _ta('sd-tratamientos', 'Tratamientos disponibles', sd.tratamientos, 4, 'Ej: Masaje relajante, Depilación láser…');

  } else if (sector === 'optica') {
    html += _segurosBlock(sd.seguros);
    html += _inp('sd-marcas', 'Marcas disponibles', sd.marcas, 'Ej: Ray-Ban, Oakley, Silhouette');

  } else if (sector === 'psicologia' || sector === 'coaching') {
    html += _ta('sd-espec', 'Especialidades', sd.especialidades, 2, 'Ej: Ansiedad, Terapia de pareja…');
    html += _inp('sd-duracion', 'Duración de sesión', sd.duracionSesion, 'Ej: 50 min');

  } else if (sector === 'nutricion' || sector === 'dietetica') {
    html += _ta('sd-programas', 'Programas disponibles', sd.programas, 3, 'Ej: Pérdida de peso, Nutrición deportiva…');
    html += _ta('sd-metodo', 'Metodología', sd.metodo, 2, 'Describe tu enfoque…');

  } else if (sector === 'autoescuela') {
    html += _inp('sd-carnets', 'Carnets disponibles', sd.carnets, 'Ej: B, A1, A2, C, D…');
    html += _inp('sd-precPrac', 'Precio clase práctica', sd.precioPractica, 'Ej: 45€/hora');

  } else if (sector === 'yoga' || sector === 'pilates') {
    html += _ta('sd-tipos', 'Tipos de clase', sd.tiposClase, 3, 'Ej: Hatha yoga, Pilates mat…');
    html += _ta('sd-packs', 'Packs disponibles', sd.packs, 2, 'Ej: Bono 10 clases - 90€');

  } else if (sector === 'guarderia_canina' || sector === 'residencia_mascotas') {
    html += _ta('sd-razas', 'Razas admitidas', sd.razasAdmitidas, 2, 'Ej: Todas las razas, máx 30 kg…');
    html += _inp('sd-plazas', 'Plazas disponibles', sd.plazas, 'Ej: 15 plazas');

  } else if (sector === 'abogado' || sector === 'abogados' || sector === 'notaria') {
    html += _ta('sd-espec', 'Especialidades legales', sd.especialidades, 2, 'Ej: Divorcios, Herencias, Laboral…');
    html += _inp('sd-consul', 'Consulta inicial', sd.consultaInicial, 'Ej: Gratuita, 50€…');

  } else if (sector === 'agencia_viajes') {
    html += _ta('sd-destinos', 'Destinos principales', sd.destinos, 3, 'Ej: Caribe, Europa, Asia…');

  } else if (sector === 'reformas' || sector === 'arquitectura') {
    html += _ta('sd-tiposObra', 'Tipos de obra/reforma', sd.tiposObra, 3, 'Ej: Baños, cocinas, obra nueva…');

  } else if (sector === 'veterinaria') {
    html += _ta('sd-espec', 'Especialidades', sd.especialidades, 2, 'Ej: Cirugía, Dermatología, Nutrición…');
    html += _inp('sd-vacunas', 'Campañas de vacunación', sd.vacunas, 'Ej: Antirrábica anual…');
    html += _chk('sd-urgencias', 'Servicio de urgencias 24 h', sd.urgencias24h);

  } else if (sector === 'farmacia') {
    html += _ta('sd-servicios', 'Servicios adicionales', sd.servicios, 3, 'Ej: Análisis, tensión, dermocosmética…');
    html += _segurosBlock(sd.seguros);

  } else if (sector === 'hotel') {
    html += _inp('sd-tipo', 'Tipo de alojamiento', sd.tipo, 'Ej: Hotel 4*, Hostal, Apartamento…');
    html += _ta('sd-servicios', 'Servicios incluidos', sd.servicios, 3, 'Ej: Desayuno, parking, spa…');
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
      _inp('sd-checkin',  'Check-in',  sd.checkIn,  'Ej: 14:00') +
      _inp('sd-checkout', 'Check-out', sd.checkOut, 'Ej: 12:00') + '</div>';

  } else if (sector === 'taller') {
    html += _ta('sd-marcas',    'Marcas que trabaja', sd.marcas,   2, 'Ej: Toyota, BMW, Volkswagen…');
    html += _ta('sd-servicios', 'Servicios',          sd.servicios, 3, 'Ej: Cambio aceite, frenos, ITV…');
    html += _chk('sd-citaPrevia', 'Cita previa necesaria', sd.citaPrevia);

  } else if (sector === 'academia') {
    html += _ta('sd-cursos', 'Cursos / Clases', sd.cursos, 3, 'Ej: Inglés, Matemáticas, Programación…');
    html += _inp('sd-niveles', 'Niveles', sd.niveles, 'Ej: Principiante, Intermedio, Avanzado');
    html += _inp('sd-precio',  'Precio clase', sd.precio, 'Ej: 30€/hora, 100€/mes');

  } else if (sector === 'asesoria') {
    html += _ta('sd-espec',    'Especialidades', sd.especialidades, 2, 'Ej: Fiscal, Laboral, Contable…');
    html += _inp('sd-software', 'Software contable', sd.software, 'Ej: A3, Contaplus, Holded…');
    html += _chk('sd-online', 'Servicio online disponible', sd.servicioOnline);

  } else if (sector === 'inmobiliaria') {
    html += _inp('sd-zona',  'Zona de actuación', sd.zona,  'Ej: Bilbao centro, Gipuzkoa…');
    html += _ta('sd-tipos',  'Tipos de inmueble', sd.tipos, 2, 'Ej: Pisos, locales, naves…');
    html += _chk('sd-alquiler', 'También gestionamos alquileres', sd.alquiler);

  } else {
    // Generic fallback (otro, generico, etc.)
    html += _ta('sd-servicios', 'Servicios y precios', sd.servicios || services, 4, 'Lista tus servicios…');
  }

  document.getElementById('asis-contenido-body').innerHTML = html;
}

function addAsisSeguro() {
  var input = document.getElementById('asis-seguro-input');
  var val = input.value.trim(); if (!val) return;
  var span = document.createElement('span');
  span.style.cssText = 'background:rgba(108,92,231,.12);border:1px solid rgba(108,92,231,.2);border-radius:20px;padding:3px 10px;font-size:11px;display:flex;align-items:center;gap:4px';
  // Use DOM API (not innerHTML) to avoid XSS from user-typed insurer name
  span.appendChild(document.createTextNode(val + ' '));
  var x = document.createElement('span');
  x.style.cursor = 'pointer';
  x.textContent = '×';
  x.onclick = function() { span.remove(); };
  span.appendChild(x);
  document.getElementById('asis-seguros-chips').appendChild(span);
  input.value = '';
}

function collectAsisConfig() {
  var c = {};
  var get = function(id) { var el = document.getElementById(id); return el ? el.value : ''; };
  c.assistantName = get('asis-name');
  c.language      = get('asis-lang');
  c.firstMessage  = get('asis-first');
  c.extraInfo     = get('asis-extra');
  c.voice         = get('asis-voice');
  c.services      = get('asis-services') || '';

  c.schedule = {};
  _DAYS.forEach(function(d) {
    var cb = document.getElementById('asis-day-' + d);
    c.schedule[d] = (cb && cb.checked) ? { open: get('asis-open-' + d)||'09:00', close: get('asis-close-' + d)||'18:00' } : null;
  });

  var sector = _asisConfig.sector || 'generico';
  c.sector = sector;
  var sd = {};
  var getChk = function(id) { var el = document.getElementById(id); return el ? el.checked : false; };

  if (sector === 'fisioterapia' || sector === 'clinica' || sector === 'dental') {
    sd.seguros        = _getChips('asis-seguros-chips');
    sd.especialidades = get('asis-espec');
  } else if (sector === 'restaurante') {
    sd.horarioComida  = get('asis-horComida');
    sd.horarioCena    = get('asis-horCena');
    sd.cartaItems     = get('asis-carta').split('\n').filter(Boolean).map(function(l) {
      var p = l.split(' - '); return { name: p[0].trim(), price: p[1] ? p[1].trim() : null };
    });
  } else if (sector === 'peluqueria' || sector === 'podologia') {
    sd.servicios      = get('sd-servicios');
  } else if (sector === 'gimnasio') {
    sd.clases         = get('sd-clases');
  } else if (sector === 'spa' || sector === 'estetica_avanzada' || sector === 'laser') {
    sd.tratamientos   = get('sd-tratamientos');
  } else if (sector === 'optica') {
    sd.seguros        = _getChips('asis-seguros-chips');
    sd.marcas         = get('sd-marcas');
  } else if (sector === 'psicologia' || sector === 'coaching') {
    sd.especialidades = get('sd-espec');
    sd.duracionSesion = get('sd-duracion');
  } else if (sector === 'nutricion' || sector === 'dietetica') {
    sd.programas      = get('sd-programas');
    sd.metodo         = get('sd-metodo');
  } else if (sector === 'autoescuela') {
    sd.carnets        = get('sd-carnets');
    sd.precioPractica = get('sd-precPrac');
  } else if (sector === 'yoga' || sector === 'pilates') {
    sd.tiposClase     = get('sd-tipos');
    sd.packs          = get('sd-packs');
  } else if (sector === 'guarderia_canina' || sector === 'residencia_mascotas') {
    sd.razasAdmitidas = get('sd-razas');
    sd.plazas         = get('sd-plazas');
  } else if (sector === 'abogado' || sector === 'abogados' || sector === 'notaria') {
    sd.especialidades  = get('sd-espec');
    sd.consultaInicial = get('sd-consul');
  } else if (sector === 'agencia_viajes') {
    sd.destinos        = get('sd-destinos');
  } else if (sector === 'reformas' || sector === 'arquitectura') {
    sd.tiposObra       = get('sd-tiposObra');
  } else if (sector === 'veterinaria') {
    sd.especialidades  = get('sd-espec');
    sd.vacunas         = get('sd-vacunas');
    sd.urgencias24h    = getChk('sd-urgencias');
  } else if (sector === 'farmacia') {
    sd.servicios       = get('sd-servicios');
    sd.seguros         = _getChips('asis-seguros-chips');
  } else if (sector === 'hotel') {
    sd.tipo            = get('sd-tipo');
    sd.servicios       = get('sd-servicios');
    sd.checkIn         = get('sd-checkin');
    sd.checkOut        = get('sd-checkout');
  } else if (sector === 'taller') {
    sd.marcas          = get('sd-marcas');
    sd.servicios       = get('sd-servicios');
    sd.citaPrevia      = getChk('sd-citaPrevia');
  } else if (sector === 'academia') {
    sd.cursos          = get('sd-cursos');
    sd.niveles         = get('sd-niveles');
    sd.precio          = get('sd-precio');
  } else if (sector === 'asesoria') {
    sd.especialidades  = get('sd-espec');
    sd.software        = get('sd-software');
    sd.servicioOnline  = getChk('sd-online');
  } else if (sector === 'inmobiliaria') {
    sd.zona            = get('sd-zona');
    sd.tipos           = get('sd-tipos');
    sd.alquiler        = getChk('sd-alquiler');
  } else {
    var sdServEl = document.getElementById('sd-servicios');
    if (sdServEl) sd.servicios = sdServEl.value.trim();
  }
  c.sectorData = sd;
  return c;
}

async function saveAsistente() {
  var config = collectAsisConfig();
  try {
    var data = await api('/api/portal/assistant', 'PUT', config);
    _asisConfig = Object.assign(_asisConfig, config);
    var genEl = document.getElementById('asis-generated-prompt');
    if (genEl && data.prompt) genEl.textContent = data.prompt;
    // Update sidebar assistant name if changed
    if (config.assistantName) {
      var bizEl = document.getElementById('sidebarBiz');
      if (bizEl && _orgInfo) {
        // Keep business name in sidebar, not assistant name
      }
    }
    toast('✅ Configuración guardada');
  } catch (e) { toast('❌ Error al guardar: ' + e.message, 'err'); }
}

// ── Portal voice demo ──────────────────────────────────────────────
var _portalDemoActive = false;
var _portalMediaRecorder = null;
var _portalMessages = [];
var _portalBotSpeaking = false;
var _portalAudio = null;

async function togglePortalDemo() {
  if (_portalDemoActive) {
    _portalDemoActive = false;
    if (_portalMediaRecorder && _portalMediaRecorder.state !== 'inactive') _portalMediaRecorder.stop();
    if (_portalAudio) { _portalAudio.pause(); _portalAudio = null; }
    document.getElementById('portal-mic-btn').style.background = 'rgba(108,92,231,.15)';
    document.getElementById('portal-demo-status').textContent = 'Pulsa para probar tu asistente';
  } else {
    try {
      var stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      _portalDemoActive = true;
      _portalMessages = [];
      document.getElementById('portal-demo-transcript').innerHTML = '';
      document.getElementById('portal-mic-btn').style.background = '#e74c3c';
      document.getElementById('portal-demo-status').textContent = 'Escuchando...';
      portalCaptureChunk(stream);
    } catch (e) { toast('No se puede acceder al micrófono', 'err'); }
  }
}

function portalCaptureChunk(stream) {
  if (!_portalDemoActive || _portalBotSpeaking) return;
  var chunks = [];
  _portalMediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
  _portalMediaRecorder.ondataavailable = function(e) { if (e.data.size > 0) chunks.push(e.data); };
  _portalMediaRecorder.onstop = async function() {
    if (!_portalDemoActive) return;
    var blob = new Blob(chunks, { type: 'audio/webm' });
    var reader = new FileReader();
    reader.onload = async function() {
      var base64 = reader.result.split(',')[1];
      try {
        var sttData = await api('/api/demo/stt', 'POST', { audio: base64, mimeType: 'audio/webm' });
        var transcript = (sttData.transcript || '').trim();
        if (transcript) {
          var t = document.getElementById('portal-demo-transcript');
          t.innerHTML += '<div style="margin-bottom:6px;font-size:12px"><strong style="color:var(--dim)">Tú:</strong> ' + esc(transcript) + '</div>';
          _portalMessages.push({ role: 'user', content: transcript });
          document.getElementById('portal-demo-status').textContent = 'Pensando...';
          _portalBotSpeaking = true;
          var chatData = await api('/api/demo/chat', 'POST', { messages: _portalMessages });
          var reply = chatData.reply || '';
          if (reply) {
            t.innerHTML += '<div style="margin-bottom:6px;font-size:12px"><strong style="color:var(--accent-l)">Bot:</strong> ' + esc(reply) + '</div>';
            t.scrollTop = t.scrollHeight;
            _portalMessages.push({ role: 'assistant', content: reply });
            var res = await fetch('/api/demo/tts', { method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+_token}, body:JSON.stringify({text:reply,voice:_asisConfig.voice||'nova'}) });
            var audioBlob = await res.blob();
            _portalAudio = new Audio(URL.createObjectURL(audioBlob));
            await new Promise(function(resolve) { _portalAudio.onended = resolve; _portalAudio.onerror = resolve; _portalAudio.play(); });
          }
        }
      } catch(e) { toast('Error demo: ' + e.message, 'err'); }
      finally {
        _portalBotSpeaking = false;
        if (_portalDemoActive) {
          document.getElementById('portal-mic-btn').style.background = '#e74c3c';
          document.getElementById('portal-demo-status').textContent = 'Escuchando...';
          portalCaptureChunk(stream);
        }
      }
    };
    reader.readAsDataURL(blob);
  };
  _portalMediaRecorder.start();
  setTimeout(function() { if (_portalMediaRecorder && _portalMediaRecorder.state==='recording') _portalMediaRecorder.stop(); }, 3000);
}

// ── Facturación section ───────────────────────────────────────
async function loadFacturacion() {
  var sec = document.getElementById('sec-facturacion');
  sec.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⏳</div><div class="empty-state-text">Cargando facturación…</div></div>';
  try {
    var results  = await Promise.all([
      api('/api/billing/usage'),
      api('/api/billing/invoices'),
    ]);
    var usage    = results[0];
    var invoices = results[1].invoices || [];
    renderFacturacion(sec, usage, invoices);
  } catch (e) {
    sec.innerHTML =
      '<div class="empty-state"><div class="empty-state-icon">❌</div>' +
      '<div class="empty-state-text">Error al cargar facturación: ' + esc(e.message) + '</div></div>';
  }
}

function renderFacturacion(sec, usage, invoices) {
  var planNames  = { starter: 'Starter', negocio: 'Negocio', pro: 'Pro' };
  var planPrices = { starter: 'Gratis', negocio: '€49/mes', pro: '€99/mes' };
  var planName   = planNames[usage.plan]  || usage.plan;
  var planPrice  = planPrices[usage.plan] || '';
  var pct        = usage.percentUsed || 0;
  var barColor   = pct >= 90 ? '#e74c3c' : pct >= 70 ? '#f39c12' : 'var(--accent)';

  // Overage warning
  var overageWarn = '';
  if (usage.overage > 0) {
    overageWarn =
      '<div style="background:rgba(231,76,60,.1);border:1px solid rgba(231,76,60,.25);border-radius:8px;padding:10px 12px;font-size:11px;color:#e74c3c;margin-top:10px">' +
        '⚠️ Has superado tu límite de minutos en <strong>' + usage.overage.toFixed(1) + ' min</strong>. ' +
        'Cargo adicional estimado: <strong>€' + usage.overageCost.toFixed(2) + '</strong>.' +
      '</div>';
  }

  // Pro upsell (only for negocio users)
  var proUpsell = '';
  if (usage.plan === 'negocio') {
    proUpsell =
      '<div class="card" style="padding:20px;margin-top:16px;background:linear-gradient(135deg,rgba(108,92,231,.12),rgba(162,155,254,.05));border:1px solid rgba(108,92,231,.3)">' +
        '<div style="font-size:14px;font-weight:700;margin-bottom:6px">⚡ ¿Necesitas más capacidad?</div>' +
        '<div style="font-size:12px;color:var(--dim);margin-bottom:14px;line-height:1.5">' +
          'El <strong>Plan Pro</strong> incluye 2.000 min/mes, llamadas salientes, ' +
          'integraciones avanzadas y un account manager dedicado por solo €99/mes.' +
        '</div>' +
        '<a href="https://nodeflow.es/#precios" target="_blank" class="btn btn-accent" ' +
          'style="font-size:12px;text-decoration:none;display:inline-block">' +
          'Ver Plan Pro €99/mes →' +
        '</a>' +
      '</div>';
  }

  // Invoices table rows
  var invRows = '';
  if (invoices.length === 0) {
    invRows =
      '<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--dim);font-size:12px">' +
        'No hay facturas aún.' +
      '</td></tr>';
  } else {
    invoices.forEach(function(inv) {
      var d       = new Date(inv.date * 1000);
      var dateStr = d.toLocaleDateString('es-ES', { year: 'numeric', month: 'short', day: 'numeric' });
      var symbol  = inv.currency === 'eur' ? '€' : inv.currency.toUpperCase() + ' ';
      var amt     = symbol + Number(inv.amount).toFixed(2);
      var statusLabel = inv.status === 'paid'
        ? '<span style="color:var(--green2)">Pagada</span>'
        : '<span style="color:#f39c12">' + inv.status + '</span>';
      var pdfLink = inv.pdf
        ? '<a href="' + inv.pdf + '" target="_blank" style="color:var(--accent-l);font-size:11px;margin-left:8px">PDF ↓</a>'
        : '';
      invRows +=
        '<tr style="border-bottom:1px solid var(--border)">' +
          '<td style="padding:10px 8px;font-size:12px;color:var(--dim)">' + dateStr + '</td>' +
          '<td style="padding:10px 8px;font-size:12px;font-family:monospace">' + (inv.number || inv.id) + '</td>' +
          '<td style="padding:10px 8px;font-size:12px;font-weight:600">' + amt + '</td>' +
          '<td style="padding:10px 8px;font-size:12px">' + statusLabel + pdfLink + '</td>' +
        '</tr>';
    });
  }

  var manageBtn = usage.plan !== 'starter'
    ? '<button class="btn btn-d" style="font-size:12px" onclick="openStripePortal()">Gestionar suscripción →</button>'
    : '<a href="https://nodeflow.es/#precios" target="_blank" class="btn btn-accent" style="font-size:12px;text-decoration:none">Activar plan →</a>';

  sec.innerHTML =
    '<div class="section-header">' +
      '<h2 class="section-title">💳 Facturación</h2>' +
      '<p class="section-sub">Gestiona tu plan y consulta tus facturas</p>' +
    '</div>' +

    // Plan card + usage bar
    '<div class="card" style="padding:20px">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;flex-wrap:wrap;gap:10px">' +
        '<div>' +
          '<div style="font-size:11px;color:var(--dim);margin-bottom:2px;text-transform:uppercase;letter-spacing:.06em">Plan actual</div>' +
          '<div style="font-size:20px;font-weight:700">' + planName +
            '<span style="font-size:13px;font-weight:400;color:var(--dim);margin-left:8px">' + planPrice + '</span>' +
          '</div>' +
        '</div>' +
        manageBtn +
      '</div>' +
      '<div style="font-size:12px;color:var(--dim);margin-bottom:6px">' +
        'Minutos este mes: <strong style="color:var(--fg)">' +
        (usage.minutesUsed || 0).toFixed(1) + ' / ' + (usage.minutesLimit || 0) +
        '</strong>' +
      '</div>' +
      '<div style="background:var(--card2);border-radius:6px;height:10px;overflow:hidden;margin-bottom:6px">' +
        '<div style="height:100%;width:' + Math.min(pct, 100) + '%;background:' + barColor +
          ';border-radius:6px;transition:width .4s"></div>' +
      '</div>' +
      '<div style="font-size:11px;color:var(--dim)">' +
        pct + '% utilizado · ' + Math.floor(usage.minutesRemaining || 0) + ' min restantes' +
      '</div>' +
      overageWarn +
    '</div>' +

    proUpsell +

    // Invoice history
    '<div class="card" style="padding:20px;margin-top:16px">' +
      '<div style="font-size:13px;font-weight:700;margin-bottom:14px">🧾 Historial de facturas</div>' +
      '<div style="overflow-x:auto">' +
        '<table style="width:100%;border-collapse:collapse">' +
          '<thead>' +
            '<tr style="border-bottom:1px solid var(--border)">' +
              '<th style="text-align:left;padding:8px;font-size:11px;color:var(--dim);font-weight:600">Fecha</th>' +
              '<th style="text-align:left;padding:8px;font-size:11px;color:var(--dim);font-weight:600">Nº Factura</th>' +
              '<th style="text-align:left;padding:8px;font-size:11px;color:var(--dim);font-weight:600">Importe</th>' +
              '<th style="text-align:left;padding:8px;font-size:11px;color:var(--dim);font-weight:600">Estado</th>' +
            '</tr>' +
          '</thead>' +
          '<tbody>' + invRows + '</tbody>' +
        '</table>' +
      '</div>' +
    '</div>';
}

// ── Integraciones (Webhooks) ──────────────────────────────────
var _ALL_EVENTS = [
  'call.completed', 'call.missed',
  'appointment.booked', 'appointment.cancelled',
  'reminder.sent', 'review_request.sent',
];
var _EVENT_LABELS = {
  'call.completed':        '📞 Llamada completada',
  'call.missed':           '📵 Llamada perdida',
  'appointment.booked':    '✅ Cita reservada',
  'appointment.cancelled': '❌ Cita cancelada',
  'reminder.sent':         '🔔 Recordatorio enviado',
  'review_request.sent':   '⭐ Petición de reseña',
};

// ── WhatsApp Connect (360dialog Embedded Signup) ────────────────────────────

async function loadWaStatus() {
  try {
    var r = await api('/api/portal/whatsapp/status');
    return r; // { connected, phoneNumber?, wabaId? }
  } catch (e) {
    return { connected: false, error: e.message };
  }
}

function openWaSignup() {
  var partnerId = 'srMmqpPA';
  var redirectUrl = encodeURIComponent(window.location.origin + '/api/portal/whatsapp/connect');
  var state = encodeURIComponent((_orgInfo && _orgInfo.id) || '');
  var url = 'https://hub.360dialog.com/dashboard/app/' + partnerId +
    '/permissions?redirect_url=' + redirectUrl + '&state=' + state;
  var popup = window.open(url, 'wa-connect', 'width=700,height=600,scrollbars=yes,resizable=yes');
  if (!popup) {
    toast('⚠️ Permite ventanas emergentes para conectar WhatsApp', 'warn');
    return;
  }
  // Escuchar cuando el popup se cierre (el backend ya procesó el redirect)
  var poll = setInterval(function() {
    if (!popup || popup.closed) {
      clearInterval(poll);
      // Recargar la sección para ver si se conectó
      setTimeout(function() { loadIntegraciones(); }, 800);
    }
  }, 600);
}

function disconnectWa() {
  openModal(
    '<div class="modal-title">Desconectar WhatsApp</div>' +
    '<p style="color:var(--dim);margin-bottom:20px">Los mensajes automáticos dejarán de enviarse desde tu número de WhatsApp Business. Podrás volver a conectarlo en cualquier momento.</p>' +
    '<div class="modal-actions">' +
      '<button class="btn btn-d" onclick="closeModal()">Cancelar</button>' +
      '<button class="btn btn-r" onclick="confirmDisconnectWa()">Sí, desconectar</button>' +
    '</div>'
  );
}

async function confirmDisconnectWa() {
  try {
    await api('/api/portal/whatsapp/connect', 'DELETE');
    closeModal();
    toast('WhatsApp desconectado');
    loadIntegraciones();
  } catch (e) {
    toast('Error al desconectar: ' + e.message, 'err');
  }
}

function renderWaCard(waStatus) {
  var connected = waStatus && waStatus.connected;
  var phoneNumber = connected ? esc(waStatus.phoneNumber || '—') : '';

  var statusBadge = connected
    ? '<span class="badge bg" style="font-size:11px">✅ Conectado</span>'
    : '<span class="badge br" style="font-size:11px">⭕ No conectado</span>';

  var actionBtn = connected
    ? '<button class="btn btn-d btn-sm" onclick="disconnectWa()" style="margin-left:8px">Desconectar</button>'
    : '<button class="btn btn-accent" onclick="openWaSignup()" style="background:linear-gradient(135deg,#25d366,#128c7e);border:none">'+
        '<span style="margin-right:6px">💬</span>Conectar WhatsApp' +
      '</button>';

  var connectedInfo = connected
    ? '<div style="margin-top:12px;font-size:12px;color:var(--dim)">' +
        '<span style="color:var(--text);font-weight:600">' + phoneNumber + '</span>' +
        ' · WABA ID: <code style="font-size:11px">' + esc(waStatus.wabaId || '—') + '</code>' +
      '</div>'
    : '<div style="margin-top:10px;font-size:12px;color:var(--dim);line-height:1.6">' +
        'Conecta tu número de WhatsApp Business para enviar confirmaciones, recordatorios y reseñas ' +
        '<strong style="color:var(--text)">directamente desde tu número</strong> — no del número genérico de NodeFlow.' +
      '</div>';

  return '<div class="card" style="margin-bottom:20px;border-color:' + (connected ? 'rgba(37,211,102,.3)' : 'var(--border)') + '">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">' +
      '<div style="display:flex;align-items:center;gap:12px">' +
        '<div style="width:40px;height:40px;border-radius:10px;background:linear-gradient(135deg,#25d366,#128c7e);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">💬</div>' +
        '<div>' +
          '<div style="font-weight:700;font-size:14px">WhatsApp Business</div>' +
          '<div style="font-size:11px;color:var(--dim);margin-top:2px">Notificaciones a clientes desde tu número</div>' +
        '</div>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:8px">' +
        statusBadge + actionBtn +
      '</div>' +
    '</div>' +
    connectedInfo +
    (connected ? '' :
      '<div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border);display:flex;gap:16px;font-size:11px;color:var(--dim)">' +
        '<span>✅ Requiere número con WhatsApp Business activo</span>' +
        '<span>✅ Se configura en &lt; 3 minutos</span>' +
        '<span>✅ Los 3 templates se envían automáticamente</span>' +
      '</div>'
    ) +
  '</div>';
}

async function loadIntegraciones() {
  var sec = document.getElementById('sec-integraciones');
  sec.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⏳</div><div>Cargando integraciones…</div></div>';

  // Cargar estado WA y webhooks en paralelo
  var waStatus;
  try { waStatus = await loadWaStatus(); } catch(e) { waStatus = { connected: false }; }

  var data;
  try {
    data = await api('/api/portal/webhooks');
  } catch (e) {
    sec.innerHTML = renderWaCard(waStatus) +
      '<div class="empty-state"><div>Error al cargar webhooks: ' + esc(e.message) + '</div></div>';
    return;
  }

  var rows = '';
  if (data.webhooks && data.webhooks.length > 0) {
    data.webhooks.forEach(function(wh) {
      var eventsText = wh.events && wh.events.includes('*')
        ? '<span class="badge bg">Todos los eventos</span>'
        : (wh.events || []).map(function(e) {
            return '<span class="badge bp" style="margin:1px 2px;font-size:10px">' + esc(_EVENT_LABELS[e] || e) + '</span>';
          }).join('');
      var enabledBadge = wh.enabled
        ? '<span class="badge bg">Activo</span>'
        : '<span class="badge br">Pausado</span>';
      rows +=
        '<tr>' +
        '<td style="max-width:220px;word-break:break-all;font-size:12px">' + esc(wh.url) + '</td>' +
        '<td>' + eventsText + '</td>' +
        '<td>' + enabledBadge + '</td>' +
        '<td style="white-space:nowrap">' +
          '<button class="btn btn-d btn-sm" title="Enviar ping de prueba" onclick="testWebhook(\'' + esc(wh.id) + '\',this)">🧪 Test</button> ' +
          '<button class="btn btn-d btn-sm" title="' + (wh.enabled ? 'Pausar' : 'Activar') + '" onclick="toggleWebhook(\'' + esc(wh.id) + '\',' + (!wh.enabled) + ')">' +
            (wh.enabled ? '⏸' : '▶️') +
          '</button> ' +
          '<button class="btn btn-r btn-sm" title="Eliminar" onclick="deleteWebhook(\'' + esc(wh.id) + '\')">🗑</button>' +
        '</td>' +
        '</tr>';
    });
  } else {
    rows = '<tr class="empty-row"><td colspan="4" style="text-align:center;padding:20px;color:var(--dim);font-size:13px">' +
      'Aún no has configurado ningún webhook.' +
      '</td></tr>';
  }

  sec.innerHTML =
    '<div class="section-header">' +
      '<div>' +
        '<div class="section-title">🔗 Integraciones</div>' +
        '<div style="font-size:12px;color:var(--dim);margin-top:4px">Conecta tu WhatsApp Business y recibe eventos en tu servidor</div>' +
      '</div>' +
    '</div>' +

    // ── Tarjeta WhatsApp ─────────────────────────────────────────
    renderWaCard(waStatus) +

    // ── Webhooks ─────────────────────────────────────────────────
    '<div class="section-header" style="margin-top:8px">' +
      '<div>' +
        '<div style="font-size:15px;font-weight:800">🌐 Webhooks</div>' +
        '<div style="font-size:12px;color:var(--dim);margin-top:2px">Recibe eventos en tu propio servidor en tiempo real</div>' +
      '</div>' +
      '<button class="btn btn-accent" onclick="openNewWebhookModal()">+ Nuevo webhook</button>' +
    '</div>' +

    // Info box
    '<div style="background:rgba(108,92,231,.08);border:1px solid rgba(108,92,231,.2);border-radius:10px;padding:14px 16px;margin-bottom:20px;font-size:12px;color:var(--dim);line-height:1.6">' +
      '📡 <strong style="color:var(--text)">¿Para qué sirve esto?</strong> Cada vez que ocurra un evento en NodeFlow (llamada, cita, recordatorio…) ' +
      'te haremos una petición <code>POST</code> firmada con HMAC-SHA256 a la URL que configures. ' +
      'Perfecta para sincronizar con tu CRM, Zapier, Make o cualquier sistema propio.' +
    '</div>' +

    '<div class="table-wrap"><table>' +
      '<thead><tr><th>URL del endpoint</th><th>Eventos</th><th>Estado</th><th>Acciones</th></tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
    '</table></div>' +

    // Signature docs card
    '<div class="card" style="padding:16px;margin-top:20px">' +
      '<div style="font-size:13px;font-weight:700;margin-bottom:8px">🔐 Verificar la firma</div>' +
      '<div style="font-size:12px;color:var(--dim);line-height:1.7">' +
        'Cada petición incluye la cabecera <code>X-NodeFlow-Signature: sha256=&lt;hex&gt;</code>.<br>' +
        'Verifica con: <code>HMAC-SHA256(secret, body) === signature</code>' +
      '</div>' +
      '<pre style="background:var(--card2);border-radius:6px;padding:12px;margin-top:10px;font-size:11px;overflow-x:auto;color:#a29bfe">' +
'// Node.js\n' +
'const sig = req.headers[\'x-nodeflow-signature\'];\n' +
'const expected = \'sha256=\' + crypto\n' +
'  .createHmac(\'sha256\', whsec_YOUR_SECRET)\n' +
'  .update(req.body).digest(\'hex\');\n' +
'const ok = crypto.timingSafeEqual(\n' +
'  Buffer.from(sig), Buffer.from(expected));' +
      '</pre>' +
    '</div>';
}

function openNewWebhookModal() {
  var evtCheckboxes = _ALL_EVENTS.map(function(e) {
    return '<label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer;padding:4px 0">' +
      '<input type="checkbox" class="wh-evt-chk" value="' + esc(e) + '" style="accent-color:var(--accent)">' +
      esc(_EVENT_LABELS[e] || e) +
    '</label>';
  }).join('');

  openModal(
    '<div class="modal-title">+ Nuevo webhook</div>' +
    '<div class="form-group">' +
      '<label class="form-label">URL del endpoint *</label>' +
      '<input class="form-input" id="wh-url" type="url" placeholder="https://mi-servidor.com/webhooks/nodeflow">' +
    '</div>' +
    '<div class="form-group">' +
      '<label class="form-label">Eventos a recibir</label>' +
      '<label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer;padding:4px 0;margin-bottom:6px;border-bottom:1px solid var(--border)">' +
        '<input type="checkbox" id="wh-evt-all" style="accent-color:var(--accent)" onchange="toggleAllWebhookEvents(this.checked)">' +
        '<strong>Todos los eventos (*)</strong>' +
      '</label>' +
      '<div id="wh-evt-list">' + evtCheckboxes + '</div>' +
    '</div>' +
    '<div class="modal-actions">' +
      '<button class="btn btn-d" onclick="closeModal()">Cancelar</button>' +
      '<button class="btn btn-accent" onclick="submitNewWebhook()">Crear webhook</button>' +
    '</div>'
  );
}

function toggleAllWebhookEvents(checked) {
  document.querySelectorAll('.wh-evt-chk').forEach(function(chk) {
    chk.checked = checked;
    chk.disabled = checked;
  });
}

async function submitNewWebhook() {
  var url = (document.getElementById('wh-url') || {}).value || '';
  if (!url) { toast('Introduce una URL', 'err'); return; }
  try { new URL(url); } catch (_) { toast('URL no válida', 'err'); return; }

  var allEvts = document.getElementById('wh-evt-all');
  var events;
  if (allEvts && allEvts.checked) {
    events = ['*'];
  } else {
    events = Array.from(document.querySelectorAll('.wh-evt-chk:checked')).map(function(c) { return c.value; });
    if (!events.length) events = ['*'];
  }

  try {
    var data = await api('/api/portal/webhooks', 'POST', { url: url, events: events });
    closeModal();
    // Show secret — only shown once
    openModal(
      '<div class="modal-title">✅ Webhook creado</div>' +
      '<p style="font-size:13px;color:var(--dim);margin-bottom:12px">' +
        '⚠️ <strong style="color:#f59e0b">Guarda este secreto ahora.</strong> No se volverá a mostrar.' +
      '</p>' +
      '<div style="background:var(--card2);border-radius:8px;padding:12px;font-family:monospace;font-size:12px;word-break:break-all;color:#a29bfe">' +
        esc(data.webhook.secret) +
      '</div>' +
      '<button class="btn btn-accent" style="width:100%;margin-top:10px" onclick="navigator.clipboard.writeText(\'' + esc(data.webhook.secret) + '\').then(function(){toast(\'Secreto copiado ✓\')});closeModal();loadIntegraciones()">' +
        '📋 Copiar y cerrar' +
      '</button>'
    );
  } catch (e) {
    toast('Error: ' + esc(e.message), 'err');
  }
}

async function toggleWebhook(id, enabled) {
  try {
    await api('/api/portal/webhooks/' + id, 'PATCH', { enabled: enabled });
    toast(enabled ? 'Webhook activado' : 'Webhook pausado');
    loadIntegraciones();
  } catch (e) {
    toast('Error: ' + esc(e.message), 'err');
  }
}

function deleteWebhook(id) {
  openModal(
    '<div class="modal-title">Eliminar webhook</div>' +
    '<p style="color:var(--dim);margin-bottom:20px">¿Eliminar este webhook? Se dejarán de enviar eventos a esta URL.</p>' +
    '<div class="modal-actions">' +
      '<button class="btn btn-d" onclick="closeModal()">Cancelar</button>' +
      '<button class="btn btn-r" onclick="confirmDeleteWebhook(\'' + esc(id) + '\')">Eliminar</button>' +
    '</div>'
  );
}

async function confirmDeleteWebhook(id) {
  try {
    await api('/api/portal/webhooks/' + id, 'DELETE');
    closeModal();
    toast('Webhook eliminado');
    loadIntegraciones();
  } catch (e) {
    toast('Error: ' + esc(e.message), 'err');
  }
}

async function testWebhook(id, btn) {
  if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
  try {
    var res = await api('/api/portal/webhooks/' + id + '/test', 'POST');
    if (res.ok) {
      toast('✅ Ping recibido — HTTP ' + res.status);
    } else {
      toast('⚠️ Entregado pero HTTP ' + res.status, 'err');
    }
  } catch (e) {
    toast('❌ No se pudo conectar: ' + esc(e.message), 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🧪 Test'; }
  }
}

// ── Stripe portal ─────────────────────────────────────────────
async function openStripePortal() {
  try {
    var data = await api('/api/billing/portal', 'POST');
    if (data.url) {
      window.open(data.url, '_blank');
    } else {
      toast('No se pudo abrir el portal de Stripe.', 'err');
    }
  } catch (e) {
    toast('Error: ' + e.message, 'err');
  }
}

// ── Llamadas salientes ────────────────────────────────────────
async function callOutbound(phone, btn) {
  if (!phone) { toast('Número no disponible', 'err'); return; }
  if (!confirm('¿Iniciar llamada saliente a ' + phone + '?\n\nEl asistente AI llamará a este número.')) return;
  if (btn) { btn.disabled = true; var origText = btn.textContent; btn.textContent = '⏳'; }
  try {
    await api('/api/portal/calls/outbound', 'POST', { to: phone });
    toast('📞 Llamada iniciada a ' + phone + '. El asistente marcará en breve.');
  } catch (e) {
    var msg = e.message || 'Error al iniciar llamada';
    if (msg.toLowerCase().includes('negocio') || msg.toLowerCase().includes('upgrade') || msg.toLowerCase().includes('plan')) {
      toast('Esta función requiere el plan Negocio o Pro — actualiza en Facturación', 'err');
    } else {
      toast('Error: ' + msg, 'err');
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = origText || '📞'; }
  }
}

// ============================================================
// Seguimientos (Lifecycle Reminders)
// ============================================================

async function loadSeguimientos() {
  checkSectorBanner();  // Non-blocking: check if wizard banner should show

  // Wire up tab switching
  document.querySelectorAll('#sec-seguimientos .tab-btn').forEach(function(btn) {
    btn.onclick = function() {
      document.querySelectorAll('#sec-seguimientos .tab-btn').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      var tab = btn.dataset.tab;
      document.getElementById('tab-proximos').style.display  = tab === 'proximos'  ? '' : 'none';
      document.getElementById('tab-historial').style.display = tab === 'historial' ? '' : 'none';
      if (tab === 'historial') loadReminderHistory();
    };
  });
  await loadUpcomingReminders();
}

// ── Sector Onboarding Wizard ──────────────────────────────────

async function checkSectorBanner() {
  var bannerEl = document.getElementById('wizard-banner');
  if (!bannerEl) return;
  try {
    var data = await api('/api/portal/contacts/sector-completion');
    if (!data.wizardNeeded || data.pendingCount === 0) {
      bannerEl.style.display = 'none';
      return;
    }
    var n = data.pendingCount;
    bannerEl.innerHTML =
      '<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:14px 18px;display:flex;align-items:center;gap:14px">' +
        '<div style="font-size:22px">💡</div>' +
        '<div style="flex:1">' +
          '<div style="font-weight:700;color:#1d4ed8;font-size:14px">Activa los recordatorios automáticos</div>' +
          '<div style="color:#3b82f6;font-size:13px;margin-top:2px">Completa los datos de ' + n + ' cliente' + (n !== 1 ? 's' : '') + ' para que el sistema empiece a funcionar</div>' +
        '</div>' +
        '<button onclick="openSectorWizard()" style="background:#2563eb;color:#fff;border:none;border-radius:8px;padding:8px 16px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap">Completar →</button>' +
      '</div>';
    bannerEl.style.display = 'block';
  } catch (e) {
    bannerEl.style.display = 'none';
  }
}

async function openSectorWizard() {
  openModal('<div class="modal-title">Cargando...</div>');
  try {
    var data = await api('/api/portal/contacts/sector-completion');
    if (!data.wizardNeeded) { closeModal(); return; }
    _wizardContacts = data.contacts.slice();
    _wizardFields   = data.fields;
    renderWizardModal(data.sector);
  } catch (e) {
    openModal('<div class="modal-title">Error</div><p style="color:#ef4444">' + esc(e.message) + '</p><div class="modal-actions"><button class="btn" onclick="closeModal()">Cerrar</button></div>');
  }
}

function renderWizardModal(sectorSlug) {
  var total = _wizardContacts.length;
  var done  = _wizardContacts.filter(function(c) { return c._saved || c.status === 'complete'; }).length;
  var pct   = total > 0 ? Math.round((done / total) * 100) : 0;
  var sectorLabels = { taller:'Taller', veterinaria:'Veterinaria', gimnasio:'Gimnasio', fisioterapia:'Fisioterapia', psicologia:'Psicología', optica:'Óptica', hotel:'Hotel', academia:'Academia' };
  var sectorLabel  = sectorLabels[sectorSlug] || sectorSlug;

  var html =
    '<div>' +
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">' +
      '<div>' +
        '<div class="modal-title" style="margin-bottom:2px">Datos de sector — ' + esc(sectorLabel) + '</div>' +
        '<div style="color:#6b7280;font-size:13px">Completa los datos de tus clientes para activar los recordatorios</div>' +
      '</div>' +
      '<button onclick="closeWizardModal()" style="background:none;border:none;font-size:20px;color:#9ca3af;cursor:pointer;padding:0 0 0 12px">✕</button>' +
    '</div>' +
    '<div style="margin:14px 0 4px">' +
      '<div style="background:#e5e7eb;border-radius:8px;height:8px;overflow:hidden">' +
        '<div id="wizard-progress-bar" style="background:#2563eb;height:8px;border-radius:8px;transition:width 0.3s;width:' + pct + '%"></div>' +
      '</div>' +
      '<div id="wizard-progress-text" style="color:#6b7280;font-size:12px;margin-top:4px">' + done + ' de ' + total + ' completados</div>' +
    '</div>' +
    '<div id="wizard-contact-list" style="margin-top:12px;max-height:50vh;overflow-y:auto">' +
      renderWizardContactList() +
    '</div>' +
    '</div>';

  openModal(html);

  var firstIncomplete = null;
  for (var i = 0; i < _wizardContacts.length; i++) {
    var c = _wizardContacts[i];
    if (!c._saved && c.status !== 'complete') { firstIncomplete = c; break; }
  }
  if (firstIncomplete) {
    setTimeout(function() { expandWizardContact(firstIncomplete.id); }, 50);
  } else {
    setTimeout(function() { showWizardComplete(); }, 50);
  }
}

function renderWizardContactList() {
  return _wizardContacts.map(function(c) {
    var isComplete = c._saved || c.status === 'complete';
    var label = esc(c.name || c.phone || c.id);
    var statusBadge, rowBg;
    if (isComplete) {
      statusBadge = '<span style="color:#16a34a;font-size:12px">✓ completo</span>';
      rowBg = '#f0fdf4';
    } else if (c._skipped) {
      statusBadge = '<span style="color:#9ca3af;font-size:12px">omitido</span>';
      rowBg = '#f9fafb';
    } else {
      statusBadge = '<span style="color:#6b7280;font-size:12px">toca para completar ▸</span>';
      rowBg = '#fff';
    }
    return '<div id="wc-row-' + c.id + '" onclick="expandWizardContact(\'' + c.id + '\')" ' +
      'style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:' + rowBg + ';border:1px solid #e5e7eb;border-radius:8px;margin-bottom:6px;cursor:pointer">' +
      '<span style="font-weight:500;flex:1;font-size:13px">' + label + '</span>' +
      statusBadge +
      '</div>' +
      '<div id="wc-form-' + c.id + '" style="display:none"></div>';
  }).join('');
}

function expandWizardContact(contactId) {
  _wizardContacts.forEach(function(c) {
    var formEl = document.getElementById('wc-form-' + c.id);
    if (formEl && c.id !== contactId) formEl.style.display = 'none';
  });

  var contact = null;
  for (var i = 0; i < _wizardContacts.length; i++) {
    if (_wizardContacts[i].id === contactId) { contact = _wizardContacts[i]; break; }
  }
  if (!contact) return;
  if (contact._saved || contact.status === 'complete') return;

  var formEl = document.getElementById('wc-form-' + contactId);
  if (!formEl) return;

  var sectorData = contact._localData || contact.sectorData || {};
  var fieldsHtml = _wizardFields.map(function(f) {
    var currentVal = sectorData[f.key] || '';
    if (f.type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(currentVal)) {
      var parts = currentVal.split('-');
      currentVal = parts[2] + '/' + parts[1] + '/' + parts[0];
    }
    return '<div style="margin-bottom:8px">' +
      '<label style="display:block;font-size:11px;color:#6b7280;font-weight:600;margin-bottom:3px">' + esc(f.label) + (f.optional ? ' <span style="color:#9ca3af;font-weight:400">(opcional)</span>' : '') + '</label>' +
      '<input id="wf-' + contactId + '-' + f.key + '" type="' + (f.type === 'date' ? 'text' : f.type) + '" ' +
        'placeholder="' + esc(f.placeholder) + '" value="' + esc(currentVal) + '" ' +
        'style="width:100%;border:1px solid #93c5fd;border-radius:6px;padding:7px 10px;font-size:13px;box-sizing:border-box">' +
    '</div>';
  }).join('');

  formEl.innerHTML =
    '<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:12px 14px;margin-bottom:6px">' +
    fieldsHtml +
    '<div id="wf-err-' + contactId + '" style="color:#ef4444;font-size:12px;display:none;margin-bottom:6px"></div>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:4px">' +
      '<button onclick="skipWizardContact(\'' + contactId + '\')" style="background:#f3f4f6;border:none;border-radius:6px;padding:7px 14px;font-size:12px;color:#6b7280;cursor:pointer">Omitir</button>' +
      '<button onclick="saveWizardContact(\'' + contactId + '\')" style="background:#2563eb;color:#fff;border:none;border-radius:6px;padding:7px 14px;font-size:13px;font-weight:600;cursor:pointer">Guardar →</button>' +
    '</div>' +
    '</div>';
  formEl.style.display = 'block';

  var rowEl = document.getElementById('wc-row-' + contactId);
  if (rowEl) rowEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function saveWizardContact(contactId) {
  var contact = null;
  for (var i = 0; i < _wizardContacts.length; i++) {
    if (_wizardContacts[i].id === contactId) { contact = _wizardContacts[i]; break; }
  }
  if (!contact) return;

  var sectorData = {};
  _wizardFields.forEach(function(f) {
    var inputEl = document.getElementById('wf-' + contactId + '-' + f.key);
    if (!inputEl) return;
    var val = inputEl.value.trim();
    if (!val) return;
    if (f.type === 'date' && /^\d{2}\/\d{2}\/\d{4}$/.test(val)) {
      var parts = val.split('/');
      val = parts[2] + '-' + parts[1] + '-' + parts[0];
    }
    sectorData[f.key] = val;
  });

  var requiredMissing = _wizardFields.filter(function(f) {
    return !f.optional && (!sectorData[f.key] || String(sectorData[f.key]).trim() === '');
  });
  if (requiredMissing.length > 0) {
    var errEl = document.getElementById('wf-err-' + contactId);
    if (errEl) {
      errEl.textContent = 'Rellena los campos obligatorios: ' + requiredMissing.map(function(f) { return f.label; }).join(', ');
      errEl.style.display = 'block';
    }
    return;
  }

  try {
    await api('/api/portal/contacts/' + contactId + '/sector-data', 'PUT', { sectorData: sectorData });
  } catch (e) {
    var errEl = document.getElementById('wf-err-' + contactId);
    if (errEl) { errEl.textContent = 'Error al guardar: ' + esc(e.message); errEl.style.display = 'block'; }
    return;
  }

  contact._saved     = true;
  contact._localData = sectorData;
  contact.status     = 'complete';

  var formEl = document.getElementById('wc-form-' + contactId);
  if (formEl) formEl.style.display = 'none';
  var rowEl = document.getElementById('wc-row-' + contactId);
  if (rowEl) {
    rowEl.style.background = '#f0fdf4';
    rowEl.style.cursor     = 'default';
    rowEl.onclick          = null;
    rowEl.innerHTML = '<span style="font-weight:500;flex:1;font-size:13px">' + esc(contact.name || contact.phone || contact.id) + '</span><span style="color:#16a34a;font-size:12px">✓ guardado</span>';
  }

  updateWizardProgress();
  advanceWizardToNext(contactId);
}

function skipWizardContact(contactId) {
  var contact = null;
  for (var i = 0; i < _wizardContacts.length; i++) {
    if (_wizardContacts[i].id === contactId) { contact = _wizardContacts[i]; break; }
  }
  if (contact) contact._skipped = true;

  var formEl = document.getElementById('wc-form-' + contactId);
  if (formEl) formEl.style.display = 'none';
  var rowEl = document.getElementById('wc-row-' + contactId);
  if (rowEl) {
    rowEl.style.background = '#f9fafb';
    rowEl.onclick = null;
    rowEl.innerHTML = '<span style="font-weight:500;flex:1;font-size:13px">' + esc(contact ? (contact.name || contact.phone || contact.id) : contactId) + '</span><span style="color:#9ca3af;font-size:12px">omitido</span>';
  }

  advanceWizardToNext(contactId);
}

function advanceWizardToNext(currentId) {
  var currentIndex = -1;
  for (var i = 0; i < _wizardContacts.length; i++) {
    if (_wizardContacts[i].id === currentId) { currentIndex = i; break; }
  }
  var next = null;
  for (var j = currentIndex + 1; j < _wizardContacts.length; j++) {
    var c = _wizardContacts[j];
    if (!c._saved && !c._skipped && c.status !== 'complete') { next = c; break; }
  }
  if (next) {
    setTimeout(function() { expandWizardContact(next.id); }, 100);
  } else {
    var anyPending = false;
    for (var k = 0; k < _wizardContacts.length; k++) {
      var ck = _wizardContacts[k];
      if (!ck._saved && !ck._skipped && ck.status !== 'complete') { anyPending = true; break; }
    }
    if (!anyPending) showWizardComplete();
  }
}

function updateWizardProgress() {
  var total  = _wizardContacts.length;
  var done   = _wizardContacts.filter(function(c) { return c._saved || c.status === 'complete'; }).length;
  var pct    = total > 0 ? Math.round((done / total) * 100) : 0;
  var barEl  = document.getElementById('wizard-progress-bar');
  var textEl = document.getElementById('wizard-progress-text');
  if (barEl)  barEl.style.width  = pct + '%';
  if (textEl) textEl.textContent = done + ' de ' + total + ' completados';
}

function showWizardComplete() {
  var listEl = document.getElementById('wizard-contact-list');
  if (listEl) {
    listEl.innerHTML =
      '<div style="text-align:center;padding:24px 0">' +
        '<div style="font-size:48px;margin-bottom:12px">✅</div>' +
        '<div style="font-weight:700;font-size:16px;color:#111827;margin-bottom:6px">¡Todo listo!</div>' +
        '<div style="color:#6b7280;font-size:14px">Los recordatorios se calcularán automáticamente en los próximos minutos.</div>' +
      '</div>' +
      '<div class="modal-actions"><button class="btn" onclick="closeWizardModal()">Cerrar</button></div>';
  }
  var total  = _wizardContacts.length;
  var barEl  = document.getElementById('wizard-progress-bar');
  var textEl = document.getElementById('wizard-progress-text');
  if (barEl)  barEl.style.width  = '100%';
  if (textEl) textEl.textContent = total + ' de ' + total + ' completados';
}

function closeWizardModal() {
  closeModal();
  checkSectorBanner();
}

async function loadUpcomingReminders() {
  var container = document.getElementById('reminders-upcoming-list');
  container.innerHTML = '<div class="loading-msg">Cargando...</div>';

  var res;
  try {
    res = await api('/api/portal/reminders/upcoming');
  } catch (e) {
    container.innerHTML = '<p style="color:#888;text-align:center;padding:20px">Error al cargar: ' + esc(e.message) + '</p>';
    return;
  }

  if (!res || !res.reminders || !res.reminders.length) {
    container.innerHTML =
      '<div class="empty-state" style="padding:48px 24px">' +
        '<div class="empty-state-icon">🔄</div>' +
        '<div style="font-size:16px;font-weight:700;color:var(--text);margin-bottom:8px">Seguimientos automáticos</div>' +
        '<div class="empty-state-text" style="max-width:480px;margin:0 auto">Cuando tus clientes lleven más días sin visitar tu negocio que el umbral de tu sector, NodeFlow les enviará automáticamente un mensaje personalizado para invitarles a volver. Los seguimientos aparecerán aquí.</div>' +
        '<div style="margin-top:14px;font-size:12px;color:var(--muted)">El sistema se activa automáticamente según los umbrales de tu sector</div>' +
      '</div>';
    return;
  }

  // Group reminders by date
  var byDate = {};
  res.reminders.forEach(function(r) {
    var d = new Date(r.scheduled_for).toLocaleDateString('es-ES', { weekday:'long', day:'numeric', month:'long' });
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(r);
  });

  container.innerHTML = Object.entries(byDate).map(function(entry) {
    var date = entry[0];
    var reminders = entry[1];
    return '<div class="reminder-group" style="margin-bottom:16px">' +
      '<h4 style="color:#6b7280;font-size:13px;font-weight:600;text-transform:uppercase;margin-bottom:8px">📅 ' + esc(date) + '</h4>' +
      reminders.map(function(r) {
        return '<div class="reminder-row" id="reminder-' + esc(r.id) + '" style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--card);border-radius:8px;border:1px solid var(--border);margin-bottom:6px">' +
          '<span style="flex:1;font-weight:500">' + esc((r.contacts && r.contacts.name) || '—') + '</span>' +
          '<span style="color:var(--dim);font-size:13px">' + esc(r.service_key.replace(/_/g,' ')) + '</span>' +
          '<span class="badge bp" style="font-size:12px">' + esc(r.channel) + '</span>' +
          '<div style="display:flex;gap:6px">' +
            '<button class="btn btn-accent btn-sm" data-reminder-id="' + esc(r.id) + '" data-action="send">Enviar</button>' +
            '<button class="btn btn-d btn-sm" data-reminder-id="' + esc(r.id) + '" data-action="postpone">Posponer</button>' +
            '<button class="btn btn-r btn-sm" data-reminder-id="' + esc(r.id) + '" data-action="cancel">✕</button>' +
          '</div>' +
        '</div>';
      }).join('') +
    '</div>';
  }).join('');

  container.querySelectorAll('[data-reminder-id]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var id = btn.getAttribute('data-reminder-id');
      var action = btn.getAttribute('data-action');
      if (action === 'send')     sendReminderNow(id);
      if (action === 'postpone') postponeReminder(id);
      if (action === 'cancel')   cancelReminder(id);
    });
  });
}

async function loadReminderHistory() {
  var container = document.getElementById('reminders-history-list');
  container.innerHTML = '<div class="loading-msg">Cargando...</div>';

  var res;
  try {
    res = await api('/api/portal/reminders?status=all&limit=50');
  } catch (e) {
    container.innerHTML = '<p style="color:var(--dim);text-align:center;padding:20px">Error: ' + esc(e.message) + '</p>';
    return;
  }

  var past = (res && res.reminders ? res.reminders : []).filter(function(r) {
    return ['sent','failed','cancelled'].indexOf(r.status) !== -1;
  });

  if (!past.length) {
    container.innerHTML = '<p style="color:var(--dim);text-align:center;padding:20px">Sin historial aún</p>';
    return;
  }

  var STATUS_ICONS = { sent: '✅', failed: '❌', cancelled: '⛔' };
  var rows = past.map(function(r) {
    return '<tr style="border-bottom:1px solid var(--border)">' +
      '<td style="padding:8px">' + (STATUS_ICONS[r.status] || '') + '</td>' +
      '<td style="padding:8px">' + new Date(r.sent_at || r.updated_at).toLocaleDateString('es-ES') + '</td>' +
      '<td style="padding:8px">' + esc((r.contacts && r.contacts.name) || '—') + '</td>' +
      '<td style="padding:8px">' + esc(r.service_key.replace(/_/g,' ')) + '</td>' +
      '<td style="padding:8px">' + esc(r.channel) + '</td>' +
      '<td style="padding:8px;color:var(--dim);font-size:12px">' + esc(r.failed_reason || '') + '</td>' +
    '</tr>';
  }).join('');

  container.innerHTML = '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:14px">' +
    '<thead><tr style="border-bottom:2px solid var(--border)">' +
      '<th style="padding:8px;text-align:left"></th>' +
      '<th style="padding:8px;text-align:left">Fecha</th>' +
      '<th style="padding:8px;text-align:left">Cliente</th>' +
      '<th style="padding:8px;text-align:left">Servicio</th>' +
      '<th style="padding:8px;text-align:left">Canal</th>' +
      '<th style="padding:8px;text-align:left;color:var(--dim)">Motivo</th>' +
    '</tr></thead>' +
    '<tbody>' + rows + '</tbody>' +
  '</table></div>';
}

async function sendReminderNow(id) {
  if (!confirm('¿Enviar este recordatorio ahora?')) return;
  try {
    await api('/api/portal/reminders/' + id + '/send-now', 'POST', {});
    toast('Recordatorio enviado ✓');
    loadUpcomingReminders();
  } catch (e) {
    toast('Error al enviar: ' + e.message, 'err');
  }
}

function postponeReminder(id) {
  openModal(
    '<div class="modal-title">⏰ Posponer recordatorio</div>' +
    '<div class="form-group"><label class="form-label">¿Cuántos días posponer?</label>' +
      '<input class="form-input" id="postponeDays" type="number" min="1" max="90" value="7"></div>' +
    '<div class="modal-actions">' +
      '<button class="btn btn-d" onclick="closeModal()">Cancelar</button>' +
      '<button class="btn btn-accent" onclick="submitPostponeReminder(\'' + esc(id) + '\')">Posponer</button>' +
    '</div>'
  );
}

async function submitPostponeReminder(id) {
  var daysEl = document.getElementById('postponeDays');
  var days = daysEl ? parseInt(daysEl.value) : 7;
  if (!days || days < 1) { toast('Introduce un número de días válido', 'err'); return; }
  try {
    await api('/api/portal/reminders/' + id + '/postpone', 'POST', { days });
    closeModal();
    toast('Pospuesto ' + days + ' días ✓');
    loadUpcomingReminders();
  } catch (e) {
    toast('Error al posponer: ' + e.message, 'err');
  }
}

async function cancelReminder(id) {
  if (!confirm('¿Cancelar este recordatorio?')) return;
  try {
    await api('/api/portal/reminders/' + id + '/cancel', 'POST', {});
    toast('Cancelado ✓');
    loadUpcomingReminders();
  } catch (e) {
    toast('Error al cancelar: ' + e.message, 'err');
  }
}

// ── Ayuda / FAQ ───────────────────────────────────────────────
var FAQ_DATA = [
  {
    group: '📲 Desvío de llamadas',
    items: [
      {
        q: '¿Cómo activo el desvío para que mi asistente coja las llamadas?',
        a: '<p>Ve a <strong>Configuración</strong> en el menú lateral y baja hasta "Códigos de desvío". Verás los 4 tipos de desvío con tu número de NodeFlow ya incluido en el código — solo tienes que copiarlo y marcarlo desde tu teléfono.</p>' +
           '<p>Los tipos más usados:</p>' +
           '<ul>' +
           '<li><strong>Incondicional</strong> — todas las llamadas van al asistente (ideal fuera de horario)</li>' +
           '<li><strong>Por no contestar</strong> — si no coges en ~15 segundos, la IA atiende (ideal como backup de día)</li>' +
           '</ul>' +
           '<p>Para Orange el código empieza por <code>*21</code> en lugar de <code>**21</code>. Para centralitas fijas, escríbenos.</p>',
      },
      {
        q: '¿Cómo desactivo el desvío para recibir yo las llamadas?',
        a: '<p>Desde tu teléfono, marca: <code>##21#</code> y pulsa llamar.</p>' +
           '<p>Las llamadas volverán a llegar directamente a tu teléfono. Puedes activar y desactivar el desvío tantas veces como quieras, sin coste.</p>',
      },
      {
        q: 'Tengo centralita o teléfono fijo de empresa. ¿Cómo lo configuro?',
        a: '<p>Las centralitas (DECT, Grandstream, Panasonic, Asterisk...) no usan los códigos GSM estándar. La configuración se hace desde el menú web de la centralita.</p>' +
           '<p>Escríbenos por WhatsApp indicando la marca y modelo de tu centralita y te ayudamos en 5 minutos.</p>',
      },
      {
        q: '¿Qué pasa si el asistente no puede contestar?',
        a: '<p>Si por algún motivo técnico el asistente no está disponible, la llamada no queda sin contestar — se redirige de vuelta a tu número habitual de forma automática.</p>',
      },
    ],
  },
  {
    group: '🤖 Configuración del asistente',
    items: [
      {
        q: '¿Puedo cambiar lo que dice el asistente al contestar?',
        a: '<p>Sí, desde el portal ve a <strong>Asistente → Básico</strong> y modifica el campo "Mensaje de bienvenida". Los cambios se aplican en menos de 5 minutos sin reiniciar nada.</p>',
      },
      {
        q: '¿Cómo añado información sobre mi negocio (precios, servicios, horario)?',
        a: '<p>En <strong>Asistente → Contenido</strong> puedes añadir toda la información adicional que quieras que el asistente conozca: precios, servicios disponibles, cómo llegar, parking, seguros aceptados, etc.</p>' +
           '<p>Cuanta más información añadas, mejor y más preciso será el asistente con tus clientes.</p>',
      },
      {
        q: '¿Puedo cambiar el horario de atención?',
        a: '<p>Sí, en <strong>Asistente → Horario</strong> configuras los días y horas en que quieres que el asistente esté activo. Fuera de ese horario puedes elegir si coge las llamadas igualmente o las deja pasar.</p>',
      },
      {
        q: '¿Puedo cambiar la voz del asistente?',
        a: '<p>Sí, en <strong>Asistente → Voz</strong> puedes escuchar las voces disponibles y cambiar la que suena en las llamadas. El cambio tarda menos de 5 minutos en aplicarse.</p>',
      },
      {
        q: '¿El asistente habla en euskera?',
        a: '<p>Sí. Si tu negocio es del País Vasco puedes activar el modo bilingüe español+euskera en <strong>Asistente → Básico → Idioma</strong>. El asistente detecta automáticamente el idioma del llamante y responde en el mismo.</p>',
      },
    ],
  },
  {
    group: '📞 Llamadas y transcripciones',
    items: [
      {
        q: '¿Dónde veo el historial de llamadas?',
        a: '<p>En el menú lateral, sección <strong>Llamadas</strong>. Verás todas las llamadas con fecha, duración, resultado y si se gestionó una cita.</p>' +
           '<p>Haz clic en el icono 💬 de cualquier llamada para leer la transcripción completa de la conversación.</p>',
      },
      {
        q: '¿Las transcripciones son exactas?',
        a: '<p>El asistente usa tecnología de reconocimiento de voz de alta precisión. En condiciones normales de llamada la precisión supera el 95%.</p>' +
           '<p>En llamadas con mucho ruido de fondo o acentos muy marcados puede haber pequeños errores en la transcripción, aunque el asistente sigue funcionando correctamente.</p>',
      },
      {
        q: '¿El asistente puede reservar citas directamente?',
        a: '<p>Sí, si tienes Google Calendar conectado el asistente puede consultar disponibilidad y reservar citas directamente durante la llamada. Las citas aparecen automáticamente en tu calendario y en el portal.</p>' +
           '<p>Para conectar Google Calendar ve a <strong>Integraciones</strong> en el menú lateral.</p>',
      },
      {
        q: '¿Qué pasa si el llamante quiere hablar con una persona real?',
        a: '<p>Si el llamante pide explícitamente hablar con una persona, el asistente le indica que en ese momento no es posible pero que puede dejar un mensaje o reservar una llamada de vuelta. Tú recibirás una notificación inmediata.</p>',
      },
    ],
  },
  {
    group: '💳 Facturación y suscripción',
    items: [
      {
        q: '¿Cuándo se cobra la suscripción?',
        a: '<p>El cobro es mensual, el mismo día del mes en que activaste el servicio. Recibirás un email de factura cada mes en la dirección con la que te registraste.</p>',
      },
      {
        q: '¿Puedo cancelar en cualquier momento?',
        a: '<p>Sí, sin permanencia ni penalización. Puedes cancelar desde <strong>Facturación</strong> en el portal o escribiéndonos por WhatsApp. El servicio seguirá activo hasta el final del período pagado.</p>',
      },
      {
        q: '¿Qué incluye el plan Negocio (49€/mes)?',
        a: '<ul>' +
           '<li>Hasta 500 minutos de llamadas atendidas al mes</li>' +
           '<li>Asistente de voz personalizado con tu información</li>' +
           '<li>Recordatorios automáticos de citas</li>' +
           '<li>Emails post-llamada y recuperación de no-shows</li>' +
           '<li>Portal con historial de llamadas y transcripciones</li>' +
           '<li>Soporte directo por WhatsApp</li>' +
           '</ul>',
      },
      {
        q: '¿Qué pasa si supero los 500 minutos del plan Negocio?',
        a: '<p>Te avisaremos cuando te acerques al límite. Si lo superas, el asistente seguirá funcionando y te contactaremos para ajustar el plan al volumen real de llamadas de tu negocio.</p>',
      },
    ],
  },
  {
    group: '🔧 Problemas y soporte',
    items: [
      {
        q: 'El asistente no suena cuando alguien llama. ¿Qué hago?',
        a: '<p>Comprueba estos puntos en orden:</p>' +
           '<ul>' +
           '<li>¿Está activo el desvío? Llama a tu propio número desde otro teléfono para verificar.</li>' +
           '<li>¿El número de NodeFlow que tienes en el código de desvío coincide con el que te enviamos?</li>' +
           '<li>Si tienes centralita, ¿está configurado el desvío desde el panel de la centralita?</li>' +
           '</ul>' +
           '<p>Si nada de esto resuelve el problema, escríbenos por WhatsApp con tu nombre de negocio y lo miramos en el momento.</p>',
      },
      {
        q: 'El asistente dice cosas incorrectas sobre mi negocio.',
        a: '<p>Ve a <strong>Asistente → Contenido</strong> y corrige o amplía la información. Los cambios se aplican en menos de 5 minutos.</p>' +
           '<p>Cuanto más detallada sea la información que añadas (precios exactos, servicios con nombres concretos, horarios especiales), más preciso será el asistente.</p>',
      },
      {
        q: '¿Cómo contacto con soporte?',
        a: '<p>La forma más rápida es WhatsApp al <strong>+34 666 351 319</strong>. Unai responde en menos de 2 horas en horario laboral (L-V 9h-19h).</p>' +
           '<p>También puedes escribir a <a href="mailto:unai@nodeflow.es" style="color:var(--accent-l)">unai@nodeflow.es</a> si prefieres email.</p>',
      },
    ],
  },
];

function loadAyuda() {
  var container = document.getElementById('faq-list');
  if (!container) return;

  var html = '';
  for (var g = 0; g < FAQ_DATA.length; g++) {
    var group = FAQ_DATA[g];
    html += '<div class="faq-group">';
    html += '<div class="faq-group-title">' + group.group + '</div>';
    for (var i = 0; i < group.items.length; i++) {
      var item = group.items[i];
      var id = 'faq-' + g + '-' + i;
      html += '<div class="faq-item" id="' + id + '">' +
        '<button class="faq-q" onclick="toggleFaq(\'' + id + '\')">' +
          '<span>' + esc(item.q) + '</span>' +
          '<span class="faq-icon">+</span>' +
        '</button>' +
        '<div class="faq-a"><div>' + item.a + '</div></div>' +
        '</div>';
    }
    html += '</div>';
  }
  container.innerHTML = html;
}

function toggleFaq(id) {
  var el = document.getElementById(id);
  if (!el) return;
  var isOpen = el.classList.contains('open');
  // Cerrar todos
  document.querySelectorAll('.faq-item.open').forEach(function(x) { x.classList.remove('open'); });
  // Abrir el pulsado si estaba cerrado
  if (!isOpen) el.classList.add('open');
}

// ── Service Worker (PWA) ──────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function() {
    navigator.serviceWorker.register('/sw.js')
      .then(function(reg) {
        console.log('[NodeFlow SW] Registered, scope:', reg.scope);
      })
      .catch(function(err) {
        console.warn('[NodeFlow SW] Registration failed:', err);
      });
  });
}
