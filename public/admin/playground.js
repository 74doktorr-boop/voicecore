// public/admin/playground.js
'use strict';

const ADMIN_TOKEN_KEY = 'nf_admin_token';
var _token = null;
var _selectedOrgId = null;
var _selectedBotId = null;
var _orgs = [];
var _bots = [];
var _assistantConfig = {};
var _currentOrgName = '';

// ── API helper ────────────────────────────────────────────────────
async function api(path, method, body) {
  method = method || 'GET';
  var opts = { method, headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + _token } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  var res = await fetch(path, opts);
  var data = await res.json().catch(function() { return {}; });
  if (!res.ok) throw new Error(data.error || 'HTTP ' + res.status);
  return data;
}

function toast(msg, type) {
  var el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'show ' + (type || 'ok');
  clearTimeout(el._t);
  el._t = setTimeout(function() { el.className = ''; }, 3000);
}

function openModal(html) {
  document.getElementById('modalBox').innerHTML = html;
  document.getElementById('modalOverlay').style.display = 'flex';
}
function closeModal() {
  document.getElementById('modalOverlay').style.display = 'none';
}

// ── Login ──────────────────────────────────────────────────────────
async function doLogin() {
  var pass = document.getElementById('loginPass').value;
  try {
    var data = await fetch('/api/admin/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pass }),
    }).then(function(r) { return r.json(); });
    if (!data.token) throw new Error(data.error || 'Login failed');
    _token = data.token;
    sessionStorage.setItem(ADMIN_TOKEN_KEY, _token);
    showApp();
  } catch (e) { toast(e.message, 'err'); }
}

function showApp() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  loadSidebar();
}

// ── Sidebar ────────────────────────────────────────────────────────
async function loadSidebar() {
  try {
    var [orgData, botData] = await Promise.all([
      api('/api/admin/orgs'),
      api('/api/admin/demo-bots'),
    ]);
    _orgs = orgData.orgs || [];
    _bots = botData.bots || [];
    renderSidebar();
  } catch (e) { toast('Error cargando sidebar: ' + e.message, 'err'); }
}

function renderSidebar() {
  var orgList = document.getElementById('orgList');
  orgList.innerHTML = _orgs.map(function(o) {
    var active = o.id === _selectedOrgId ? ' active' : '';
    var badgeClass = o.plan === 'pro' ? 'badge-pro' : o.plan === 'negocio' ? 'badge-negocio' : 'badge-starter';
    return '<div class="org-item' + active + '" onclick="selectOrg(\'' + o.id + '\')">' +
      '<div class="org-name">' + esc(o.name) + '</div>' +
      '<div class="org-badges"><span class="badge ' + badgeClass + '">' + esc(o.plan) + '</span></div>' +
      '</div>';
  }).join('');
  var botList = document.getElementById('botList');
  botList.innerHTML = _bots.map(function(b) {
    var active = b.id === _selectedBotId ? ' active' : '';
    return '<div class="org-item' + active + '" onclick="selectBot(\'' + b.id + '\')">' +
      '<div class="org-name">' + esc(b.name) + '</div>' +
      '<div class="org-badges"><span class="badge badge-test">test</span></div>' +
      '</div>';
  }).join('');
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Org selection ───────────────────────────────────────────────────
async function selectOrg(orgId) {
  _selectedOrgId = orgId;
  _selectedBotId = null;
  var org = _orgs.find(function(o) { return o.id === orgId; });
  if (!org) return;
  _currentOrgName = org.name;
  renderSidebar();
  document.getElementById('detailTitle').textContent = org.name;
  var badge = org.plan === 'pro' ? 'badge-pro' : org.plan === 'negocio' ? 'badge-negocio' : 'badge-starter';
  document.getElementById('topActions').innerHTML =
    '<span class="badge ' + badge + '" style="margin-right:8px">' + esc(org.plan) + '</span>' +
    '<button class="btn btn-outline btn-sm" onclick="sendMagicLink(\'' + orgId + '\')">💌 Magic link</button> ' +
    '<button class="btn btn-danger btn-sm" onclick="deleteOrg(\'' + orgId + '\')">🗑</button>';
  document.getElementById('tabNav').style.display = 'flex';
  showTab('config');
  renderConfigForm(org);
  await loadAssistantConfig(orgId);
}

function renderConfigForm(org) {
  document.getElementById('configForm').innerHTML =
    '<div class="form-group"><label>Nombre</label><input class="form-input" id="cfg-name" value="' + esc(org.name) + '"></div>' +
    '<div class="form-group"><label>Email propietario</label><input class="form-input" id="cfg-email" value="' + esc(org.owner_email) + '"></div>' +
    '<div class="form-group"><label>Plan</label><select class="form-select" id="cfg-plan">' +
      ['negocio','enterprise'].map(function(p){ return '<option value="' + p + '"' + (org.plan===p?' selected':'') + '>' + p + '</option>'; }).join('') +
    '</select></div>' +
    '<div class="form-group"><label>Sector</label><input class="form-input" id="cfg-sector" value="' + esc(org.sector || '') + '"></div>' +
    '<div class="form-group"><label>Teléfono</label><input class="form-input" id="cfg-phone" value="' + esc(org.phone || '') + '"></div>' +
    '<div class="form-group"><label>Estado</label><select class="form-select" id="cfg-status">' +
      ['active','paused','deleted'].map(function(s){ return '<option value="' + s + '"' + (org.status===s?' selected':'') + '>' + s + '</option>'; }).join('') +
    '</select></div>';
}

async function saveOrgConfig() {
  var body = {
    name:   document.getElementById('cfg-name').value.trim(),
    plan:   document.getElementById('cfg-plan').value,
    sector: document.getElementById('cfg-sector').value.trim(),
    phone:  document.getElementById('cfg-phone').value.trim(),
    status: document.getElementById('cfg-status').value,
  };
  try {
    await api('/api/admin/orgs/' + _selectedOrgId, 'PATCH', body);
    toast('Cambios guardados');
    loadSidebar();
  } catch (e) { toast(e.message, 'err'); }
}

async function sendMagicLink(orgId) {
  try {
    await api('/api/admin/send-magic-link', 'POST', { orgId });
    toast('Magic link enviado ✉️');
  } catch (e) { toast(e.message, 'err'); }
}

async function deleteOrg(orgId) {
  if (!confirm('¿Eliminar esta org? (soft-delete)')) return;
  try {
    await api('/api/admin/orgs/' + orgId, 'DELETE');
    toast('Org eliminada');
    _selectedOrgId = null;
    document.getElementById('tabNav').style.display = 'none';
    document.getElementById('detailTitle').textContent = 'Selecciona un negocio';
    document.getElementById('topActions').innerHTML = '';
    loadSidebar();
  } catch (e) { toast(e.message, 'err'); }
}

// ── Bot selection ──────────────────────────────────────────────────
async function selectBot(botId) {
  _selectedBotId = botId;
  _selectedOrgId = null;
  var bot = _bots.find(function(b) { return b.id === botId; });
  if (!bot) return;
  _currentOrgName = bot.name;
  renderSidebar();
  document.getElementById('detailTitle').textContent = bot.name;
  document.getElementById('topActions').innerHTML =
    '<span class="badge badge-test" style="margin-right:8px">test bot</span>' +
    '<button class="btn btn-danger btn-sm" onclick="deleteBot(\'' + botId + '\')">🗑</button>';
  document.getElementById('tabNav').style.display = 'flex';
  showTab('asistente');
  _assistantConfig = bot.config || {};
  renderAssistantSubTabs();
}

async function deleteBot(botId) {
  if (!confirm('¿Eliminar este bot de prueba?')) return;
  try {
    await api('/api/admin/demo-bots/' + botId, 'DELETE');
    toast('Bot eliminado');
    _selectedBotId = null;
    document.getElementById('tabNav').style.display = 'none';
    document.getElementById('detailTitle').textContent = 'Selecciona un negocio';
    loadSidebar();
  } catch (e) { toast(e.message, 'err'); }
}

// ── Tabs ────────────────────────────────────────────────────────────
function showTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(function(b) { b.classList.remove('active'); });
  document.querySelectorAll('.tab-panel').forEach(function(p) { p.classList.add('hidden'); });
  var btn = document.querySelector('.tab-btn[onclick="showTab(\'' + tab + '\')"]');
  if (btn) btn.classList.add('active');
  document.getElementById('tab-' + tab).classList.remove('hidden');
}

function showSubTab(sub) {
  document.querySelectorAll('.sub-tab-btn').forEach(function(b) { b.classList.remove('active'); });
  document.querySelectorAll('.sub-tab-panel').forEach(function(p) { p.classList.remove('active'); });
  event.target.classList.add('active');
  document.getElementById('sub-' + sub).classList.add('active');
}

// ── Assistant config ────────────────────────────────────────────────
var DAYS = ['mon','tue','wed','thu','fri','sat','sun'];
var DAY_LABELS = { mon:'Lun', tue:'Mar', wed:'Mié', thu:'Jue', fri:'Vie', sat:'Sáb', sun:'Dom' };

async function loadAssistantConfig(orgId) {
  try {
    var data = await api('/api/admin/assistant/' + orgId);
    _assistantConfig = data.config || {};
    renderAssistantSubTabs();
  } catch (e) { toast('Error cargando config asistente: ' + e.message, 'err'); }
}

function renderAssistantSubTabs() {
  var c = _assistantConfig;

  // Básico
  document.getElementById('sub-basico').innerHTML =
    '<div class="form-grid">' +
    '<div class="form-group"><label>Nombre del asistente</label><input class="form-input" id="a-name" value="' + esc(c.assistantName||'') + '" placeholder="Laura"></div>' +
    '<div class="form-group"><label>Idioma</label><select class="form-select" id="a-lang">' +
      [['es','Español'],['eu','Euskera'],['es+eu','Español + Euskera']].map(function(l){ return '<option value="' + l[0] + '"' + (c.language===l[0]?' selected':'') + '>' + l[1] + '</option>'; }).join('') +
    '</select></div>' +
    '<div class="form-group"><label>Sector</label><select class="form-select" id="a-sector">' +
      ['generico','restaurante','fisioterapia','clinica','dental','peluqueria','barberia',
       'estetica','gimnasio','academia','veterinaria','farmacia','asesoria','taller','hotel',
       'inmobiliaria','optica','psicologia','coaching','nutricion','podologia','autoescuela',
       'estetica_avanzada','yoga','pilates','guarderia_canina','abogados','notaria',
       'agencia_viajes','reformas','otro'].map(function(s){ return '<option value="' + s + '"' + (c.sector===s?' selected':'') + '>' + s + '</option>'; }).join('') +
    '</select></div>' +
    '<div class="form-group"><label>Modelo LLM</label><select class="form-select" id="a-model">' +
      ['gpt-4o-mini','gpt-4o'].map(function(m){ return '<option value="' + m + '"' + (c.model===m?' selected':'') + '>' + m + '</option>'; }).join('') +
    '</select></div>' +
    '<div class="form-group form-full"><label>Mensaje de bienvenida</label><input class="form-input" id="a-first" value="' + esc(c.firstMessage||'') + '" placeholder="Buenas, ¿en qué puedo ayudarle?"></div>' +
    '<div class="form-group form-full"><label>Información adicional</label><textarea class="form-textarea" id="a-extra" placeholder="Parking, accesibilidad, notas...">' + esc(c.extraInfo||'') + '</textarea></div>' +
    '</div>';

  // Horario
  var sched = c.schedule || {};
  document.getElementById('sub-horario').innerHTML =
    '<div class="schedule-grid">' +
    DAYS.map(function(d) {
      var slot = sched[d];
      var open  = slot ? slot.open  : '09:00';
      var close = slot ? slot.close : '18:00';
      var checked = slot ? 'checked' : '';
      return '<div class="schedule-row">' +
        '<label class="day-toggle"><input type="checkbox" id="day-' + d + '" ' + checked + ' onchange="toggleDay(\'' + d + '\')">' +
        ' <span class="schedule-day">' + DAY_LABELS[d] + '</span></label>' +
        '<div class="schedule-slots" id="slots-' + d + '" style="display:' + (slot?'flex':'none') + '">' +
        '<input type="time" class="form-input" id="open-' + d + '" value="' + open + '" style="width:90px">' +
        '<span style="color:var(--dim);font-size:11px">–</span>' +
        '<input type="time" class="form-input" id="close-' + d + '" value="' + close + '" style="width:90px">' +
        '</div>' +
        (slot ? '' : '<span class="schedule-closed">Cerrado</span>') +
        '</div>';
    }).join('') +
    '</div>';

  // Contenido (sector-specific)
  renderContenidoTab(c.sector || 'generico', c.sectorData || {}, c.services || '');

  // Prompt raw
  var savedPrompt = c.customPromptOverride || '';
  document.getElementById('sub-prompt').innerHTML =
    '<div class="prompt-warning">⚠️ Al guardar texto aquí, se usará este prompt en lugar del generado automáticamente. Borra el campo para volver al generado.</div>' +
    '<textarea class="prompt-raw-textarea" id="a-prompt-raw" placeholder="Deja vacío para usar el prompt generado automáticamente...">' + esc(savedPrompt) + '</textarea>';

  // Voz
  document.getElementById('sub-voz').innerHTML =
    '<div class="form-grid">' +
    '<div class="form-group"><label>Voz TTS</label><select class="form-select" id="a-voice">' +
      ['nova','alloy','echo','fable','onyx','shimmer'].map(function(v){ return '<option value="' + v + '"' + (c.voice===v?' selected':'') + '>' + v + '</option>'; }).join('') +
    '</select></div>' +
    '<div class="form-group"><label>Temperatura</label><input class="form-input" type="number" id="a-temp" min="0" max="1" step="0.1" value="' + (c.temperature ?? 0.5) + '"></div>' +
    '</div>';
}

function toggleDay(day) {
  var checked = document.getElementById('day-' + day).checked;
  document.getElementById('slots-' + day).style.display = checked ? 'flex' : 'none';
}

function renderContenidoTab(sector, sectorData, services) {
  var html = '<div class="form-grid">';
  html += '<div class="form-group form-full"><label>Servicios generales</label><textarea class="form-textarea" id="a-services" placeholder="Describe los servicios que ofrece el negocio...">' + esc(services) + '</textarea></div>';

  if (sector === 'restaurante') {
    html += '<div class="form-group"><label>Horario comidas</label><input class="form-input" id="sd-horarioComida" value="' + esc(sectorData.horarioComida||'') + '" placeholder="13:00-15:30"></div>';
    html += '<div class="form-group"><label>Horario cenas</label><input class="form-input" id="sd-horarioCena" value="' + esc(sectorData.horarioCena||'') + '" placeholder="20:30-23:00"></div>';
    html += '<div class="form-group"><label>Aforo máximo</label><input class="form-input" id="sd-maxGuests" type="number" value="' + esc(sectorData.maxGuests||'') + '" placeholder="12"></div>';
    html += '<div class="form-group form-full"><label>Carta (un plato por línea, formato: Nombre - Precio)</label><textarea class="form-textarea" id="sd-cartaRaw" placeholder="Chuletón - 28€\nMerluza a la vasca - 22€">' + esc((sectorData.cartaItems||[]).map(function(i){return i.name+(i.price?' - '+i.price:'');}).join('\n')) + '</textarea></div>';
  } else if (sector === 'fisioterapia' || sector === 'clinica') {
    var seguros = (sectorData.seguros || []);
    html += '<div class="form-group form-full"><label>Seguros aceptados</label>';
    html += '<div class="chips-container" id="seguros-chips">' + seguros.map(function(s){ return '<span class="chip">' + esc(s) + ' <span class="chip-remove" onclick="removeSeguro(this)">×</span></span>'; }).join('') + '</div>';
    html += '<input class="chip-add-input" id="seguro-input" placeholder="+ Añadir seguro" onkeydown="if(event.key===\'Enter\'||event.key===\',\'){addSeguro();event.preventDefault()}"></div>';
    html += '<div class="form-group form-full"><label>Especialidades</label><textarea class="form-textarea" id="sd-especialidades" placeholder="Columna, rodilla, lesiones deportivas...">' + esc(sectorData.especialidades||'') + '</textarea></div>';
  } else if (sector === 'peluqueria') {
    html += '<div class="form-group form-full"><label>Servicios y precios</label><textarea class="form-textarea" id="sd-servicios" placeholder="Corte mujer - 25€\nTinte - 45€">' + esc(sectorData.servicios||'') + '</textarea></div>';
  } else if (sector === 'gimnasio') {
    html += '<div class="form-group form-full"><label>Clases disponibles</label><textarea class="form-textarea" id="sd-clases" placeholder="Yoga L/X/V 9:00, Spinning M/J 19:00...">' + esc(sectorData.clases||'') + '</textarea></div>';
  } else {
    // Generic fallback: any sector not explicitly handled gets a services textarea
    html += '<div class="form-group form-full"><label>Servicios y precios</label><textarea class="form-textarea" id="sd-servicios" placeholder="Lista tus servicios y precios...">' + esc(sectorData.servicios || services || '') + '</textarea></div>';
  }
  html += '</div>';
  document.getElementById('sub-contenido').innerHTML = html;
}

function addSeguro() {
  var input = document.getElementById('seguro-input');
  var val = input.value.trim();
  if (!val) return;
  var chip = document.createElement('span');
  chip.className = 'chip';
  chip.innerHTML = esc(val) + ' <span class="chip-remove" onclick="removeSeguro(this)">×</span>';
  document.getElementById('seguros-chips').appendChild(chip);
  input.value = '';
}
function removeSeguro(el) {
  el.parentElement.remove();
}

function collectAssistantConfig() {
  var c = {};
  var get = function(id) { var el = document.getElementById(id); return el ? el.value : ''; };

  c.assistantName = get('a-name');
  c.language      = get('a-lang');
  c.sector        = get('a-sector');
  c.model         = get('a-model');
  c.firstMessage  = get('a-first');
  c.extraInfo     = get('a-extra');
  c.voice         = get('a-voice');
  c.temperature   = parseFloat(get('a-temp')) || 0.5;
  c.customPromptOverride = get('a-prompt-raw').trim() || null;

  // Schedule
  c.schedule = {};
  DAYS.forEach(function(d) {
    var cb = document.getElementById('day-' + d);
    if (cb && cb.checked) {
      c.schedule[d] = { open: get('open-' + d) || '09:00', close: get('close-' + d) || '18:00' };
    } else {
      c.schedule[d] = null;
    }
  });

  // Services
  c.services = get('a-services');

  // Sector-specific
  var sd = {};
  var sector = c.sector;
  if (sector === 'restaurante') {
    sd.horarioComida = get('sd-horarioComida');
    sd.horarioCena   = get('sd-horarioCena');
    sd.maxGuests     = parseInt(get('sd-maxGuests')) || null;
    var cartaRaw = get('sd-cartaRaw');
    sd.cartaItems = cartaRaw.split('\n').filter(Boolean).map(function(line) {
      var parts = line.split(' - ');
      return { name: parts[0].trim(), price: parts[1] ? parts[1].trim() : null };
    });
  } else if (sector === 'fisioterapia' || sector === 'clinica') {
    sd.seguros = Array.from(document.querySelectorAll('#seguros-chips .chip')).map(function(el) {
      return el.textContent.replace('×','').trim();
    });
    sd.especialidades = get('sd-especialidades');
  } else if (sector === 'peluqueria') {
    sd.servicios = get('sd-servicios');
  } else if (sector === 'gimnasio') {
    sd.clases = get('sd-clases');
  }
  var sdServEl = document.getElementById('sd-servicios');
  if (sdServEl && !sd.servicios) sd.servicios = sdServEl.value.trim();
  c.sectorData = sd;

  return c;
}

async function previewPrompt() {
  var config = collectAssistantConfig();
  try {
    var data = await api('/api/admin/assistant/generate-prompt', 'POST', { config, orgName: _currentOrgName });
    openModal('<div class="modal-title">Prompt generado</div>' +
      '<pre style="white-space:pre-wrap;font-size:11px;color:#a8b4d0;font-family:monospace;max-height:400px;overflow-y:auto;background:#0d0d15;padding:12px;border-radius:8px">' + esc(data.prompt) + '</pre>' +
      '<div style="margin-top:14px;text-align:right"><button class="btn btn-outline" onclick="closeModal()">Cerrar</button></div>');
  } catch (e) { toast(e.message, 'err'); }
}

async function saveAssistantConfig() {
  var config = collectAssistantConfig();
  try {
    if (_selectedBotId) {
      await api('/api/admin/demo-bots/' + _selectedBotId, 'PATCH', { config });
    } else {
      await api('/api/admin/assistant/' + _selectedOrgId, 'PUT', config);
    }
    _assistantConfig = config;
    toast('Asistente guardado ✓');
  } catch (e) { toast(e.message, 'err'); }
}

// ── Create org modal ────────────────────────────────────────────────
function openCreateOrgModal() {
  openModal('<div class="modal-title">Nueva org</div>' +
    '<div class="form-group" style="margin-bottom:10px"><label>Nombre</label><input class="form-input" id="new-name" placeholder="Mi Negocio S.L."></div>' +
    '<div class="form-group" style="margin-bottom:10px"><label>Email propietario</label><input class="form-input" id="new-email" type="email" placeholder="owner@example.com"></div>' +
    '<div class="form-group" style="margin-bottom:10px"><label>Plan</label><select class="form-select" id="new-plan"><option value="negocio">negocio</option><option value="enterprise">enterprise</option></select></div>' +
    '<div class="form-group" style="margin-bottom:18px"><label>Sector</label><input class="form-input" id="new-sector" placeholder="fisioterapia"></div>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end">' +
    '<button class="btn btn-outline" onclick="closeModal()">Cancelar</button>' +
    '<button class="btn btn-primary" onclick="createOrg()">Crear</button></div>');
}

async function createOrg() {
  var body = {
    name:       document.getElementById('new-name').value.trim(),
    ownerEmail: document.getElementById('new-email').value.trim(),
    plan:       document.getElementById('new-plan').value,
    sector:     document.getElementById('new-sector').value.trim(),
  };
  if (!body.name || !body.ownerEmail) { toast('Nombre y email requeridos', 'err'); return; }
  try {
    await api('/api/admin/orgs', 'POST', body);
    toast('Org creada ✓');
    closeModal();
    loadSidebar();
  } catch (e) { toast(e.message, 'err'); }
}

function openCreateBotModal() {
  openModal('<div class="modal-title">Nuevo bot de prueba</div>' +
    '<div class="form-group" style="margin-bottom:10px"><label>Nombre</label><input class="form-input" id="bot-name" placeholder="bot-restaurante-test"></div>' +
    '<div class="form-group" style="margin-bottom:18px"><label>Sector</label><select class="form-select" id="bot-sector">' +
      ['generico','restaurante','fisioterapia','clinica','dental','peluqueria','barberia',
       'estetica','gimnasio','academia','veterinaria','farmacia','asesoria','taller','hotel',
       'inmobiliaria','optica','psicologia','coaching','nutricion','podologia','autoescuela',
       'estetica_avanzada','yoga','pilates','guarderia_canina','abogados','notaria',
       'agencia_viajes','reformas','otro'].map(function(s){return '<option>'+s+'</option>';}).join('') +
      '</select></div>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end">' +
    '<button class="btn btn-outline" onclick="closeModal()">Cancelar</button>' +
    '<button class="btn btn-primary" onclick="createBot()">Crear</button></div>');
}

async function createBot() {
  var body = {
    name:   document.getElementById('bot-name').value.trim(),
    sector: document.getElementById('bot-sector').value,
  };
  if (!body.name) { toast('Nombre requerido', 'err'); return; }
  try {
    await api('/api/admin/demo-bots', 'POST', body);
    toast('Bot creado ✓');
    closeModal();
    loadSidebar();
  } catch (e) { toast(e.message, 'err'); }
}

// ── Voice demo ──────────────────────────────────────────────────────
var _demoActive   = false;
var _mediaRecorder = null;
var _demoMessages = [];
var _botSpeaking  = false;
var _currentAudio = null;

async function toggleDemo() {
  if (_demoActive) {
    stopDemo();
  } else {
    startDemo();
  }
}

async function startDemo() {
  try {
    var stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    _demoActive = true;
    _demoMessages = [];
    document.getElementById('demoTranscript').innerHTML = '';
    document.getElementById('demoMicBtn').className = 'demo-mic-btn active';
    document.getElementById('demoStatus').textContent = 'Escuchando...';
    captureChunk(stream);
  } catch (e) {
    toast('No se puede acceder al micrófono: ' + e.message, 'err');
  }
}

function stopDemo() {
  _demoActive = false;
  if (_mediaRecorder && _mediaRecorder.state !== 'inactive') _mediaRecorder.stop();
  if (_currentAudio) { _currentAudio.pause(); _currentAudio = null; }
  document.getElementById('demoMicBtn').className = 'demo-mic-btn idle';
  document.getElementById('demoStatus').textContent = 'Pulsa para iniciar demo de voz';
}

function captureChunk(stream) {
  if (!_demoActive || _botSpeaking) return;
  var chunks = [];
  _mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
  _mediaRecorder.ondataavailable = function(e) { if (e.data.size > 0) chunks.push(e.data); };
  _mediaRecorder.onstop = async function() {
    if (!_demoActive) return;
    var blob = new Blob(chunks, { type: 'audio/webm' });
    var reader = new FileReader();
    reader.onload = async function() {
      var base64 = reader.result.split(',')[1];
      try {
        var sttData = await api('/api/demo/stt', 'POST', { audio: base64, mimeType: 'audio/webm' });
        var transcript = (sttData.transcript || '').trim();
        if (transcript) {
          addDemoMsg('user', transcript);
          _demoMessages.push({ role: 'user', content: transcript });
          document.getElementById('demoStatus').textContent = 'Pensando...';
          _botSpeaking = true;
          document.getElementById('demoMicBtn').className = 'demo-mic-btn speaking';
          var chatData = await api('/api/demo/chat', 'POST', {
            orgId: _selectedOrgId || null,
            botId: _selectedBotId || null,
            messages: _demoMessages,
          });
          var reply = chatData.reply || '';
          if (reply) {
            addDemoMsg('bot', reply);
            _demoMessages.push({ role: 'assistant', content: reply });
            await playTTS(reply);
          }
        }
      } catch (e) {
        toast('Error demo: ' + e.message, 'err');
      } finally {
        _botSpeaking = false;
        if (_demoActive) {
          document.getElementById('demoMicBtn').className = 'demo-mic-btn active';
          document.getElementById('demoStatus').textContent = 'Escuchando...';
          captureChunk(stream);
        }
      }
    };
    reader.readAsDataURL(blob);
  };
  _mediaRecorder.start();
  setTimeout(function() {
    if (_mediaRecorder && _mediaRecorder.state === 'recording') _mediaRecorder.stop();
  }, 3000);
}

async function playTTS(text) {
  return new Promise(async function(resolve) {
    try {
      var voice = _assistantConfig.voice || 'nova';
      var res = await fetch('/api/demo/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + _token },
        body: JSON.stringify({ text, voice }),
      });
      var blob = await res.blob();
      var url = URL.createObjectURL(blob);
      _currentAudio = new Audio(url);
      _currentAudio.onended = resolve;
      _currentAudio.onerror = resolve;
      _currentAudio.play();
    } catch (e) { resolve(); }
  });
}

function addDemoMsg(role, text) {
  var div = document.createElement('div');
  div.className = 'demo-msg ' + role;
  div.textContent = text;
  var container = document.getElementById('demoTranscript');
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

// ── Init ────────────────────────────────────────────────────────────
(function init() {
  var saved = sessionStorage.getItem(ADMIN_TOKEN_KEY);
  if (saved) { _token = saved; showApp(); }
})();
