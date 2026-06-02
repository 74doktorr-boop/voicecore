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
  else if (section === 'clientes')         loadClientes();
  else if (section === 'facturacion')      loadFacturacion();
  else if (section === 'integraciones')    loadIntegraciones();
  else if (section === 'seguimientos')     loadSeguimientos();
  if (section === 'asistente') loadAsistente();
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
      var callBtn = c.callerNumber
        ? '<button class="btn btn-g btn-sm" onclick="callOutbound(\'' + esc(c.callerNumber) + '\',this)" title="Llamar a ' + esc(c.callerNumber) + '">📞</button>'
        : '<span style="color:var(--muted)">—</span>';
      rows += '<tr><td>' + timeAgo(c.startedAt) + '</td><td>' + dur + '</td><td>' + badge + '</td>' +
        '<td>' + c.turnCount + ' turnos' + apt + '</td>' +
        '<td style="color:var(--dim)">' + esc(c.clientEmail || '—') + '</td>' +
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
      '<thead><tr><th>Cuándo</th><th>Duración</th><th>Resultado</th><th>Detalles</th><th>Email cliente</th><th>💬</th><th>📞</th></tr></thead>' +
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
      '<div class="form-section-title">Reseñas de Google</div>' +
      '<div class="form-group"><label class="form-label">URL de tu ficha de Google</label>' +
        '<input class="form-input" id="cfgReviewUrl" type="url" placeholder="https://g.page/r/…/review"' +
          ' value="' + esc(c.reviewUrl || '') + '">' +
        '<small style="color:var(--dim);font-size:11px">Pega el enlace de "Escribe una reseña" de tu Google Business. Se incluirá en los emails automáticos de solicitud de reseña.</small></div>' +
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
    reviewUrl:      (document.getElementById('cfgReviewUrl') || {}).value || '',
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

function renderAsistenteForm() {
  var c = _asisConfig;
  var setVal = function(id, val) { var el = document.getElementById(id); if (el) el.value = val || ''; };

  setVal('asis-name',  c.assistantName || '');
  setVal('asis-lang',  c.language || 'es');
  setVal('asis-first', c.firstMessage || '');
  setVal('asis-extra', c.extraInfo || '');
  setVal('asis-voice', c.voice || 'nova');

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
    toast('Asistente guardado ✓');
  } catch (e) { toast(e.message, 'err'); }
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

async function loadIntegraciones() {
  var sec = document.getElementById('sec-integraciones');
  sec.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⏳</div><div>Cargando webhooks…</div></div>';

  var data;
  try {
    data = await api('/api/portal/webhooks');
  } catch (e) {
    sec.innerHTML = '<div class="empty-state"><div>Error: ' + esc(e.message) + '</div></div>';
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
        '<div style="font-size:12px;color:var(--dim);margin-top:4px">Recibe eventos en tu propio servidor en tiempo real</div>' +
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

async function deleteWebhook(id) {
  if (!confirm('¿Eliminar este webhook? Se dejarán de enviar eventos a esta URL.')) return;
  try {
    await api('/api/portal/webhooks/' + id, 'DELETE');
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
    container.innerHTML = '<p style="color:#888;text-align:center;padding:20px">No hay recordatorios programados en los próximos 30 días</p>';
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
            '<button class="btn btn-accent btn-sm" onclick="sendReminderNow(\'' + esc(r.id) + '\')">Enviar</button>' +
            '<button class="btn btn-d btn-sm" onclick="postponeReminder(\'' + esc(r.id) + '\')">Posponer</button>' +
            '<button class="btn btn-r btn-sm" onclick="cancelReminder(\'' + esc(r.id) + '\')">✕</button>' +
          '</div>' +
        '</div>';
      }).join('') +
    '</div>';
  }).join('');
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

async function postponeReminder(id) {
  var days = prompt('¿Cuántos días posponer?', '7');
  if (!days || isNaN(Number(days))) return;
  try {
    await api('/api/portal/reminders/' + id + '/postpone', 'POST', { days: Number(days) });
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
