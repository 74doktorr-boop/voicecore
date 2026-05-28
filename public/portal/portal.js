// public/portal/portal.js
// NodeFlow — Portal de Negocio client-side JS
'use strict';

const SESSION_KEY = 'nf_session';

// ── Global state ─────────────────────────────────────────────
let _token          = null;
let _orgInfo        = null;  // { id, name, plan, owner_email, phone, ... }
let _currentSection = 'dashboard';

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
}

// ── Auth flow ─────────────────────────────────────────────────
async function initAuth() {
  var params     = new URLSearchParams(window.location.search);
  var magicToken = params.get('token');

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

  var upcomingRows = '';
  if (d.upcoming && d.upcoming.length > 0) {
    for (var i = 0; i < d.upcoming.length; i++) {
      var a = d.upcoming[i];
      upcomingRows += '<tr><td>' + fmtDate(a.date) + '</td><td><strong>' + esc(a.time) + '</strong></td>' +
        '<td>' + esc(a.patientName) + '</td><td>' + esc(a.service) + '</td>' +
        '<td><span class="badge bg">✓ Confirmada</span></td></tr>';
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
      '<div class="kpi"><div class="kpi-label">Llamadas</div><div class="kpi-val" style="color:var(--accent-l)">' + (d.today.callCount || 0) + '</div><div class="kpi-sub">hoy</div></div>' +
      '<div class="kpi"><div class="kpi-label">Reservas</div><div class="kpi-val" style="color:var(--green2)">' + (d.today.bookedToday || 0) + '</div><div class="kpi-sub">' + (d.today.convRate || 0) + '% conversión</div></div>' +
      '<div class="kpi"><div class="kpi-label">Emails enviados</div><div class="kpi-val" style="color:var(--accent-l)">' + (d.today.emailsSent || 0) + '</div><div class="kpi-sub">confirmaciones</div></div>' +
      '<div class="kpi"><div class="kpi-label">Horas ahorradas</div><div class="kpi-val" style="color:#60a5fa">' + (d.today.hoursSaved || 0) + 'h</div><div class="kpi-sub">vs atención manual</div></div>' +
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
      rows += '<tr><td>' + timeAgo(c.startedAt) + '</td><td>' + dur + '</td><td>' + badge + '</td>' +
        '<td>' + c.turnCount + ' turnos' + apt + '</td>' +
        '<td style="color:var(--dim)">' + esc(c.clientEmail || '—') + '</td></tr>';
    }
  } else {
    rows = '<tr class="empty-row"><td colspan="5">No hay llamadas con estos filtros</td></tr>';
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
      '<thead><tr><th>Cuándo</th><th>Duración</th><th>Resultado</th><th>Detalles</th><th>Email cliente</th></tr></thead>' +
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
async function loadCitas() {
  var sec = document.getElementById('sec-citas');
  sec.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⏳</div><div>Cargando citas…</div></div>';

  var data;
  try {
    data = await api('/api/portal/appointments');
  } catch (e) {
    sec.innerHTML = '<div class="empty-state"><div>Error: ' + esc(e.message) + '</div></div>';
    return;
  }

  var STATUS_BADGE = {
    confirmed: '<span class="badge bg">✓ Confirmada</span>',
    cancelled: '<span class="badge br">✕ Cancelada</span>',
    pending:   '<span class="badge by">Pendiente</span>',
  };

  var rows = '';
  if (data.appointments && data.appointments.length > 0) {
    for (var i = 0; i < data.appointments.length; i++) {
      var a = data.appointments[i];
      var badge   = STATUS_BADGE[a.status] || STATUS_BADGE.pending;
      var safeId  = esc(a.id);
      var safeName = esc(a.patientName).replace(/'/g, "\\'");
      var actions = a.status !== 'cancelled'
        ? '<button class="btn btn-d btn-sm" onclick="openEditCita(\'' + safeId + '\')">✏️</button> ' +
          '<button class="btn btn-r btn-sm" onclick="cancelCitaConfirm(\'' + safeId + '\',\'' + safeName + '\')">✕</button>'
        : '';
      rows += '<tr>' +
        '<td>' + fmtDate(a.date) + '</td>' +
        '<td><strong>' + esc(a.time) + '</strong></td>' +
        '<td>' + esc(a.patientName) + '</td>' +
        '<td>' + esc(a.phone || '—') + '</td>' +
        '<td>' + esc(a.service) + '</td>' +
        '<td>' + badge + '</td>' +
        '<td style="white-space:nowrap">' + actions + '</td></tr>';
    }
  } else {
    rows = '<tr class="empty-row"><td colspan="7">No hay citas registradas</td></tr>';
  }

  sec.innerHTML =
    '<div class="section-header">' +
      '<div class="section-title">🗓️ Citas</div>' +
      '<button class="btn btn-accent" onclick="openNewCita()">+ Nueva cita</button>' +
    '</div>' +
    '<div class="table-wrap"><table>' +
      '<thead><tr><th>Fecha</th><th>Hora</th><th>Cliente</th><th>Teléfono</th><th>Servicio</th><th>Estado</th><th>Acciones</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>';
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
  };
  if (!body.patientName || !body.service || !body.date || !body.time) {
    toast('Rellena todos los campos obligatorios', 'err');
    return;
  }
  try {
    await api('/api/portal/appointments', 'POST', body);
    closeModal();
    toast('Cita creada correctamente');
    loadCitas();
  } catch (e) {
    toast('Error: ' + e.message, 'err');
  }
}

async function openEditCita(id) {
  var data;
  try {
    data = await api('/api/portal/appointments');
  } catch (e) {
    toast('Error al cargar cita: ' + e.message, 'err');
    return;
  }
  var apt = null;
  for (var i = 0; i < data.appointments.length; i++) {
    if (data.appointments[i].id === id) { apt = data.appointments[i]; break; }
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
  };
  if (!body.patientName || !body.service || !body.date || !body.time) {
    toast('Rellena todos los campos obligatorios', 'err');
    return;
  }
  try {
    await api('/api/portal/appointments/' + id, 'PATCH', body);
    closeModal();
    toast('Cita actualizada');
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
        '<div class="auto-desc">Email al cliente antes de su cita</div>' +
      '</div><label class="toggle"><input type="checkbox" id="togReminders" ' + (rem.enabled !== false ? 'checked' : '') +
        ' onchange="patchAuto(\'reminders\',{enabled:this.checked})"><span class="slider"></span></label></div>' +
      '<div class="auto-footer"><span class="auto-label">Horas antes:</span><div class="auto-hours">' +
        '<input type="number" id="hoursReminders" value="' + (rem.hoursBefore || 24) + '" min="1" max="72"' +
        ' onchange="patchAuto(\'reminders\',{hoursBefore:parseInt(this.value)})"></div></div></div>' +
      // Reviews card
      '<div class="auto-card"><div class="auto-row"><div>' +
        '<div class="auto-name">⭐ Solicitud de reseña</div>' +
        '<div class="auto-desc">Email pidiendo reseña Google tras la cita</div>' +
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
  var SECTORS = ['peluqueria','barberia','estetica','clinica','dental','veterinaria','restaurante',
    'taller','gimnasio','academia','farmacia','asesoria','hotel','inmobiliaria','otro'];
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
      '<div style="display:flex;gap:12px;margin-top:24px">' +
        '<button class="btn btn-accent" onclick="saveConfig()">Guardar cambios</button>' +
        '<a href="https://wa.me/34666351319?text=Necesito%20ayuda%20con%20mi%20portal" target="_blank"' +
           ' class="btn btn-d" style="text-decoration:none">Contactar soporte</a>' +
      '</div>' +
    '</div>';
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

// ── Boot ──────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', initAuth);
