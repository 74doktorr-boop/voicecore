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
async function api(path, method, body, timeoutMs) {
  method = method || 'GET';
  // Timeout de red: sin esto, una consulta que cuelga (pooler de Supabase
  // saturado en frío → hasta 20s) congelaba el dashboard entero, que espera
  // varias en paralelo (bug 2026-07-07). Aborta a los 12s (GET) — el llamador
  // lo cachea con .catch y renderiza sin ese panel en vez de quedar en blanco.
  var ctrl = new AbortController();
  var to = setTimeout(function() { ctrl.abort(); }, timeoutMs || (method === 'GET' ? 12000 : 30000));
  var opts = {
    method: method,
    signal: ctrl.signal,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + _token,
    },
  };
  if (body !== undefined && body !== null) opts.body = JSON.stringify(body);
  try {
    var res = await fetch(path, opts);
    var data = await res.json().catch(function() { return {}; });
    if (!res.ok) {
      var err = new Error(data.error || 'HTTP ' + res.status);
      err.status = res.status;   // el llamador puede distinguir (409 = duplicado)
      throw err;
    }
    return data;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('La respuesta tardó demasiado — inténtalo de nuevo');
    throw e;
  } finally {
    clearTimeout(to);
  }
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
  if (section !== 'dashboard') {
    try { localStorage.setItem('nf_last_section', section); } catch (e) {}
  }
  closeSidebar();

  if (section === 'dashboard')        loadDashboard();
  else if (section === 'llamadas')    loadCalls();
  else if (section === 'citas')       loadCitas();
  else if (section === 'informes')    loadInformes();
  else if (section === 'automatizaciones') loadAutomatizaciones();
  else if (section === 'configuracion')    loadConfig();
  else if (section === 'clientes')         loadClientes();
  else if (section === 'entidades')        loadEntidades();
  else if (section === 'facturacion')      loadFacturacion();
  else if (section === 'integraciones')    loadIntegraciones();
  else if (section === 'seguimientos')     loadSeguimientos();
  else if (section === 'ayuda')            loadAyuda();
  else if (section === 'referidos')        loadReferidos();
  else if (section === 'widget')           loadWidget();
  else if (section === 'tareas')           loadTareas();
  else if (section === 'oportunidades')    loadOportunidades();
  else if (section === 'insights')         loadInsights();
  else if (section === 'espera')           loadEspera();
  else if (section === 'conocimiento')     loadConocimiento();
  if (section === 'asistente') loadAsistente();
}

// ════════ Base de conocimiento (RAG) ═══════════════════════════════════════════
async function loadConocimiento() {
  var ta = document.getElementById('kbText');
  var st = document.getElementById('kbStatus');
  if (!ta) return;
  st.textContent = 'Cargando…'; st.style.color = 'var(--dim)';
  try {
    var r = await api('/api/portal/knowledge');
    ta.value = r.text || '';
    st.textContent = r.chunks ? (r.chunks + ' fragmento(s) guardado(s)') : 'Vacío — añade la información de tu negocio.';
    renderKbSuggestions();
    loadKbUnanswered();
  } catch (e) {
    st.textContent = 'Error al cargar: ' + (e.message || e); st.style.color = 'var(--red)';
  }
}

// ── Bucle de aprendizaje: preguntas sin respuesta → KB en 1 clic ─────
function _kbDismissedSet() {
  try { return new Set(JSON.parse(localStorage.getItem('nf_kb_dismissed') || '[]')); }
  catch (e) { return new Set(); }
}
function _kbQKey(q) {
  return q.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[¿?¡!.,]/g, '').replace(/\s+/g, ' ').trim();
}

async function loadKbUnanswered() {
  var box = document.getElementById('kbUnanswered');
  if (!box) return;
  var qs = [];
  try {
    var r = await api('/api/portal/knowledge/unanswered');
    qs = r.questions || [];
  } catch (e) { /* silencioso: la KB funciona igual sin esto */ }
  var dismissed = _kbDismissedSet();
  qs = qs.filter(function (x) { return !dismissed.has(_kbQKey(x.question)); });
  if (!qs.length) { box.innerHTML = ''; return; }

  var rows = qs.slice(0, 6).map(function (x) {
    var safeQ = esc(x.question).replace(/'/g, '&#39;');
    return '<div class="crit-item">' +
      '<div style="flex:1;min-width:0"><div class="crit-name">“' + esc(x.question) + '”</div>' +
      '<div class="crit-meta">' + (x.count > 1 ? 'Preguntada ' + x.count + ' veces' : 'Preguntada 1 vez') + ' en los últimos 30 días</div></div>' +
      '<div style="display:flex;gap:6px;flex-shrink:0">' +
        '<button class="btn btn-accent btn-sm" onclick="kbAnswerQuestion(this)" data-q="' + safeQ + '">Responder</button>' +
        '<button class="btn btn-d btn-sm" onclick="kbDismissQuestion(this)" data-q="' + safeQ + '" aria-label="Descartar" data-tip="No volver a mostrar">✕</button>' +
      '</div></div>';
  }).join('');

  box.innerHTML =
    '<div class="card" style="border-color:rgba(246,197,68,.3)">' +
      '<div class="card-title">❓ Tu asistente no supo responder esto</div>' +
      '<div style="font-size:13px;color:var(--dim);margin:-8px 0 14px">Clientes reales hicieron estas preguntas y tu asistente no tenía la respuesta. Enséñasela en un clic — la usará desde la siguiente llamada.</div>' +
      rows +
    '</div>';
}

function kbAnswerQuestion(btn) {
  var q = btn.getAttribute('data-q') || '';
  var ta = document.getElementById('kbText');
  if (!ta) return;
  ta.value += (ta.value && !/\n$/.test(ta.value) ? '\n' : '') + 'P: ' + q + '\nR: ';
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
  ta.scrollIntoView({ behavior: 'smooth', block: 'center' });
  toast('Escribe la respuesta y pulsa Guardar — tu asistente la aprenderá');
}

function kbDismissQuestion(btn) {
  var q = btn.getAttribute('data-q') || '';
  var set = _kbDismissedSet();
  set.add(_kbQKey(q));
  try { localStorage.setItem('nf_kb_dismissed', JSON.stringify(Array.from(set).slice(-100))); } catch (e) {}
  loadKbUnanswered();
}

// Añade una línea-plantilla al textarea para guiar qué escribir
function kbAppend(label) {
  var ta = document.getElementById('kbText');
  if (!ta) return;
  ta.value += (ta.value && !/\n$/.test(ta.value) ? '\n' : '') + label + ': ';
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
}

// Chips de sugerencia por sector — convierten la caja vacía en rellenado guiado
function renderKbSuggestions() {
  var box = document.getElementById('kbSuggest');
  if (!box) return;
  var sector = (_orgInfo && _orgInfo.sector) || '';
  var base = ['Horario y días de cierre', 'Formas de pago', 'Aparcamiento', 'Política de cancelación', 'Promociones actuales', 'Preguntas frecuentes'];
  var bySector = {
    clinica: ['Seguros aceptados', 'Primera visita'], dental: ['Seguros aceptados', 'Primera visita'],
    fisioterapia: ['Seguros aceptados', 'Especialidades'], podologia: ['Seguros aceptados'],
    restaurante: ['Menú del día', 'Terraza / accesibilidad', 'Reservas de grupos'],
    peluqueria: ['Servicios y precios', 'Duración de servicios'], estetica: ['Tratamientos y precios'],
    veterinaria: ['Urgencias 24h', 'Vacunaciones'], taller: ['Marcas que atendéis', 'Coche de sustitución'],
    gimnasio: ['Cuotas y clases', 'Horario de clases'], hotel: ['Check-in / check-out', 'Mascotas admitidas'],
    asesoria: ['Servicios fiscales', 'Plazos importantes'], autoescuela: ['Precios de carné', 'Horario de prácticas'],
  };
  var chips = base.concat(bySector[sector] || []);
  box.innerHTML = '<span style="font-size:11px;color:var(--dim);align-self:center;margin-right:2px">Sugerencias:</span>' +
    chips.map(function(c) {
      return '<button type="button" class="btn btn-d btn-sm" style="font-size:11px" onclick="kbAppend(\'' + c.replace(/'/g, "\\'") + '\')">+ ' + c + '</button>';
    }).join('');
}

// Carga pdf.js SELF-HOSTED (public/portal/vendor/pdfjs/, servido desde nuestro dominio) —
// sin dependencia de CDN de terceros en el portal autenticado. pdf.js 3.11.174 (Mozilla).
// Se carga bajo demanda (solo al subir el primer PDF).
function _loadPdfjs() {
  return new Promise(function(resolve, reject) {
    if (window.pdfjsLib) return resolve(window.pdfjsLib);
    var s = document.createElement('script');
    s.src = '/portal/vendor/pdfjs/pdf.min.js';
    s.onload = function() {
      try { window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/portal/vendor/pdfjs/pdf.worker.min.js'; } catch (_) {}
      resolve(window.pdfjsLib);
    };
    s.onerror = function() { reject(new Error('No se pudo cargar el lector de PDF')); };
    document.head.appendChild(s);
  });
}

// Extrae el texto de un PDF en el navegador y lo AÑADE al textarea (el usuario revisa y guarda).
async function kbUploadPdf(file) {
  if (!file) return;
  if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name || '')) { toast('Sube un archivo PDF', 'err'); return; }
  var st = document.getElementById('kbStatus');
  var setSt = function(msg, color) { if (st) { st.textContent = msg; st.style.color = color || 'var(--dim)'; } };
  setSt('📄 Leyendo ' + file.name + '…');
  try {
    var pdfjs = await _loadPdfjs();
    var buf = await file.arrayBuffer();
    var pdf = await pdfjs.getDocument({ data: buf }).promise;
    var pages = [];
    for (var p = 1; p <= pdf.numPages; p++) {
      var page = await pdf.getPage(p);
      var content = await page.getTextContent();
      pages.push(content.items.map(function(it) { return it.str; }).join(' '));
    }
    var text = pages.join('\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (!text) { setSt('Ese PDF no tiene texto legible (¿es un escaneo/imagen?).', 'var(--red)'); toast('PDF sin texto legible', 'err'); return; }
    var ta = document.getElementById('kbText');
    ta.value = (ta.value.trim() ? ta.value.trim() + '\n\n' : '') + '— ' + file.name + ' —\n' + text;
    setSt('✓ PDF añadido (' + pdf.numPages + ' pág). Revísalo y pulsa Guardar.', 'var(--green)');
    toast('PDF leído — revísalo y guarda');
  } catch (e) {
    setSt('No se pudo leer el PDF: ' + (e.message || ''), 'var(--red)');
    toast('Error leyendo el PDF', 'err');
  }
}

async function saveConocimiento() {
  var ta  = document.getElementById('kbText');
  var st  = document.getElementById('kbStatus');
  var btn = document.getElementById('kbSaveBtn');
  if (!ta) return;
  var prev = btn.textContent; btn.disabled = true; btn.textContent = 'Guardando…';
  try {
    var r = await api('/api/portal/knowledge', 'PUT', { text: ta.value });
    st.textContent = '✓ Guardado (' + (r.chunksAdded || 0) + ' fragmentos). Tu asistente ya lo usará en las llamadas.';
    st.style.color = 'var(--green)';
    toast('Base de conocimiento guardada');
  } catch (e) {
    st.textContent = 'Error al guardar: ' + (e.message || e); st.style.color = 'var(--red)';
    toast('Error al guardar', 'err');
  } finally {
    btn.disabled = false; btn.textContent = prev;
  }
}

// ════════ Lista de espera ═════════════════════════════════════════════════════
async function loadEspera() {
  var box = document.getElementById('espera-body');
  if (!box) return;
  box.innerHTML = skelPanel();
  var d;
  try { d = await api('/api/portal/waitlist'); }
  catch (e) { box.innerHTML = '<div class="empty-state"><div>Error: ' + esc(e.message) + '</div></div>'; return; }

  var list = (d.waitlist || []).filter(function(w){ return w.status !== 'booked'; });
  var rows = list.length ? list.map(function(w){
    var tel = (w.phone||'').replace(/[^0-9+]/g,'');
    return '<tr>' +
      '<td><strong>' + esc(w.name || w.phone) + '</strong>' + (w.name?'<div style="font-size:11px;color:var(--dim)">'+esc(w.phone)+'</div>':'') + '</td>' +
      '<td>' + esc(w.service || '—') + '</td>' +
      '<td style="color:var(--dim);font-size:12px">' + esc(w.preferred || '—') + '</td>' +
      '<td style="text-align:right;white-space:nowrap">' +
        '<button class="btn btn-g btn-sm" onclick="dialOrCopy(\'' + esc(tel) + '\')">📞</button> ' +
        '<button class="btn btn-accent btn-sm" onclick="markWaitlistBooked(' + w.id + ')">✓ Citada</button> ' +
        '<button class="btn btn-d btn-sm" onclick="deleteWaitlist(' + w.id + ')">🗑</button>' +
      '</td></tr>';
  }).join('') : '<tr class="empty-row"><td colspan="4" style="text-align:center;color:var(--dim);padding:18px">Lista de espera vacía. El asistente apunta aquí a quien llama sin hueco disponible.</td></tr>';

  box.innerHTML =
    '<div class="card" style="margin-bottom:14px">' +
      '<div style="font-size:14px;font-weight:700;margin-bottom:10px">➕ Apuntar a alguien</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
        '<input class="form-input" id="wlName" placeholder="Nombre" style="flex:1;min-width:120px">' +
        '<input class="form-input" id="wlPhone" placeholder="Teléfono" style="flex:1;min-width:120px">' +
        '<input class="form-input" id="wlPref" placeholder="Cuándo le viene bien (ej. martes mañana)" style="flex:2;min-width:160px">' +
        '<button class="btn btn-accent" onclick="addWaitlist()">+ Añadir</button>' +
      '</div>' +
    '</div>' +
    '<div class="table-wrap"><table><thead><tr><th>Cliente</th><th>Servicio</th><th>Prefiere</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>';
}
async function addWaitlist() {
  var phone = (document.getElementById('wlPhone')||{}).value || '';
  if (!phone.trim()) { toast('Pon al menos el teléfono', 'warn'); return; }
  try {
    await api('/api/portal/waitlist', 'POST', {
      name: (document.getElementById('wlName')||{}).value || '',
      phone: phone.trim(),
      preferred: (document.getElementById('wlPref')||{}).value || '',
    });
    loadEspera();
  } catch (e) { toast('Error: ' + e.message, 'err'); }
}
async function markWaitlistBooked(id) {
  try { await api('/api/portal/waitlist/' + id, 'PATCH', { status: 'booked' }); toast('¡Genial, hueco rellenado!'); loadEspera(); }
  catch (e) { toast('Error: ' + e.message, 'err'); }
}
async function deleteWaitlist(id) {
  try { await api('/api/portal/waitlist/' + id, 'DELETE'); loadEspera(); }
  catch (e) { toast('Error: ' + e.message, 'err'); }
}

// ── 📞 en escritorio: los enlaces tel: abren una página en blanco si no hay
// app de llamadas (bug reportado por Unai 2026-07-07). En móvil marcamos;
// en PC copiamos el número y lo decimos claro.
function dialOrCopy(tel) {
  var isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  if (isTouch) { window.location.href = 'tel:' + tel; return; }
  try {
    navigator.clipboard.writeText(tel);
    toast('📋 Número copiado: ' + tel + ' — márcalo desde tu teléfono');
  } catch (e) { toast(tel, 'warn'); }
}

// ════════ Oportunidades (llamadas sin cita) ═══════════════════════════════════
async function loadOportunidades() {
  var box = document.getElementById('oportunidades-body');
  if (!box) return;
  box.innerHTML = skelPanel();
  var d;
  try { d = await api('/api/portal/missed-opportunities'); }
  catch (e) { box.innerHTML = '<div class="empty-state"><div>Error: ' + esc(e.message) + '</div></div>'; return; }

  var ops = d.opportunities || [];
  if (!ops.length) {
    box.innerHTML = '<div class="card" style="text-align:center;padding:30px"><div style="font-size:40px;margin-bottom:8px">🎉</div>' +
      '<div style="font-weight:700">¡Sin oportunidades perdidas!</div>' +
      '<div style="color:var(--dim);font-size:13px;margin-top:4px">Todas las llamadas recientes acabaron en cita o no hay llamadas aún.</div></div>';
    return;
  }
  var rows = ops.map(function(o){
    var tel = o.phone.replace(/[^0-9+]/g,'');
    // El número abre la TRANSCRIPCIÓN de su última llamada (antes era texto
    // muerto y el 📞 tel: abría una página en blanco en PC).
    var numCell = o.lastCallId
      ? '<a href="#" onclick="openTranscriptModal(\'' + esc(o.lastCallId) + '\');return false" style="color:var(--accent-l);font-weight:700;text-decoration:none" data-tip="Ver qué dijo en su última llamada">' + esc(o.phone) + '</a>'
      : '<strong>' + esc(o.phone) + '</strong>';
    return '<tr>' +
      '<td>' + numCell + (o.count>1?' <span class="badge bp" style="font-size:10px">'+o.count+' llamadas</span>':'') + '</td>' +
      '<td style="color:var(--dim);font-size:12px">' + (o.lastCall?timeAgo(o.lastCall):'—') + '</td>' +
      '<td style="text-align:right;white-space:nowrap">' +
        '<button class="btn btn-accent btn-sm" onclick="oppAiCall(\'' + esc(tel) + '\')">🤖 Que le llame</button> ' +
        '<button class="btn btn-g btn-sm" onclick="dialOrCopy(\'' + esc(tel) + '\')" data-tip="Llamar tú">📞</button> ' +
        '<a class="btn btn-sm" style="background:#25d366;color:#fff;text-decoration:none" href="https://wa.me/' + esc(tel.replace(/\+/g,'')) + '" target="_blank" data-tip="WhatsApp">💬</a>' +
      '</td></tr>';
  }).join('');
  box.innerHTML =
    '<div class="card" style="margin-bottom:14px;background:rgba(253,203,110,.06);border-color:rgba(253,203,110,.25)">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">' +
        '<div style="font-size:13px;color:var(--dim);line-height:1.6;flex:1;min-width:220px">💡 Estas personas llamaron en los últimos ' + (d.sinceDays||14) + ' días pero <strong style="color:var(--text)">no llegaron a reservar cita</strong>. Tu asistente puede llamarlas una a una y ofrecerles hueco.</div>' +
        '<button class="btn btn-accent" onclick="oppAiCallAll(' + ops.length + ')" style="white-space:nowrap">🤖 Que las llame a todas (' + ops.length + ')</button>' +
      '</div>' +
    '</div>' +
    '<div class="table-wrap"><table><thead><tr><th>Teléfono</th><th>Última llamada</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>';
}

// Recuperación en LOTE: encola la campaña; el motor llama con educación
// (L-S 10-20h, de una en una, máx. 2 intentos, sin insistir).
function oppAiCallAll(count) {
  openModal(
    '<div class="modal-title">🤖 Campaña de recuperación</div>' +
    '<p style="font-size:14px;color:var(--text);line-height:1.7;margin-bottom:10px">Tu asistente llamará a <strong>' + count + (count === 1 ? ' cliente' : ' clientes') + '</strong> que no llegaron a reservar, y les ofrecerá encontrar un hueco.</p>' +
    '<ul style="font-size:12px;color:var(--dim);line-height:1.8;margin:0 0 8px 18px">' +
      '<li>Solo en horario razonable: lunes a sábado, de 10:00 a 20:00</li>' +
      '<li>De una en una — nunca en ráfaga</li>' +
      '<li>Si no interesa, se despide con amabilidad y no insiste</li>' +
      '<li>Cada llamada quedará en Llamadas con su resultado</li>' +
    '</ul>' +
    '<div class="modal-actions">' +
      '<button class="btn btn-d" onclick="closeModal()">Cancelar</button>' +
      '<button class="btn btn-accent" id="oppAllBtn" onclick="oppAiCallAllGo()">Lanzar campaña</button>' +
    '</div>');
}

async function oppAiCallAllGo() {
  var btn = document.getElementById('oppAllBtn');
  btn.disabled = true; btn.textContent = 'Encolando…';
  try {
    var r = await api('/api/portal/campaigns/recovery', 'POST', {});
    closeModal();
    toast('✅ ' + (r.queued || 0) + ' llamadas en cola' + (r.skipped ? ' (' + r.skipped + ' saltadas)' : '') + ' — saldrán entre 10:00 y 20:00');
  } catch (e) {
    btn.disabled = false; btn.textContent = 'Lanzar campaña';
    toast('Error: ' + (e.message || e), 'err');
  }
}

// ── Recuperación ejecutable: el asistente llama a la oportunidad ─────
function oppAiCall(phone) {
  var safe = esc(phone).replace(/'/g, '');
  openModal(
    '<div class="modal-title">🤖 Que le llame tu asistente</div>' +
    '<p style="font-size:14px;color:var(--text);line-height:1.6;margin-bottom:8px">Tu asistente llamará ahora a <strong>' + esc(phone) + '</strong>, se presentará como recepción de tu negocio y le ofrecerá reservar una cita.</p>' +
    '<p style="font-size:12px;color:var(--dim);line-height:1.5">La llamada quedará registrada en Llamadas, con su transcripción.</p>' +
    '<div class="modal-actions">' +
      '<button class="btn btn-d" onclick="closeModal()">Cancelar</button>' +
      '<button class="btn btn-accent" id="oppCallBtn" onclick="oppAiCallGo(\'' + safe + '\')">Llamar ahora</button>' +
    '</div>');
}

async function oppAiCallGo(phone) {
  var btn = document.getElementById('oppCallBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Llamando…'; }
  try {
    await api('/api/portal/calls/outbound', 'POST', { to: phone, purpose: 'recovery' });
    closeModal();
    toast('📞 Tu asistente está llamando a ' + phone);
  } catch (e) {
    closeModal();
    toast('No se pudo iniciar la llamada: ' + (e.message || e), 'err');
  }
}

// ════════ Insights (horas/días punta + conversión) ═══════════════════════════
// Genera ideas accionables por reglas (sin LLM) a partir de los datos ya cargados
function buildInsights(d) {
  var out = [];
  if (d.peakHour != null) {
    out.push({ icon: '🕐', text: 'Tu hora punta es las <strong>' + d.peakHour + ':00</strong>. Asegúrate de tener el desvío activo entonces para no perder ninguna llamada.' });
  }
  var cr = Number(d.convRate) || 0;
  if (cr > 0) {
    if (cr < 40) out.push({ icon: '⚠️', text: 'Solo el <strong>' + cr + '%</strong> de tus llamadas acaba en cita. Revisa la info que da tu asistente (precios, servicios, disponibilidad) y su <a onclick="navigate(\'conocimiento\')" style="color:var(--accent-l);cursor:pointer;text-decoration:underline">base de conocimiento</a>.' });
    else if (cr >= 60) out.push({ icon: '🎯', text: '¡El <strong>' + cr + '%</strong> de tus llamadas acaba en cita! Tu asistente convierte de maravilla.' });
    else out.push({ icon: '📈', text: 'El <strong>' + cr + '%</strong> de tus llamadas acaba en cita — hay margen: afina la info que da tu asistente.' });
  }
  if (d.peakDayName) {
    out.push({ icon: '📅', text: 'Los <strong>' + esc(d.peakDayName) + '</strong> son tu día más movido. Buen momento para reforzar disponibilidad.' });
  }
  return out;
}

async function loadInsights() {
  var box = document.getElementById('insights-body');
  if (!box) return;
  box.innerHTML = skelPanel();
  var d;
  try { d = await api('/api/portal/insights'); }
  catch (e) { box.innerHTML = '<div class="empty-state"><div>Error: ' + esc(e.message) + '</div></div>'; return; }

  if (!d.available) {
    box.innerHTML = '<div class="card" style="text-align:center;padding:30px"><div style="font-size:40px;margin-bottom:8px">📈</div>' +
      '<div style="font-weight:700">Aún no hay datos suficientes</div>' +
      '<div style="color:var(--dim);font-size:13px;margin-top:4px">Los insights aparecerán cuando empieces a recibir llamadas.</div></div>';
    return;
  }

  function bars(arr, labels, accent) {
    var max = Math.max.apply(null, arr) || 1;
    return '<div style="display:flex;align-items:flex-end;gap:3px;height:120px;margin-top:10px">' +
      arr.map(function(v,i){
        var h = Math.round((v/max)*100);
        return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%">' +
          '<div style="font-size:9px;color:var(--dim);margin-bottom:2px">' + (v||'') + '</div>' +
          '<div title="' + esc(labels[i]) + ': ' + v + '" style="width:100%;background:' + accent + ';opacity:' + (0.35+0.65*(v/max)) + ';border-radius:3px 3px 0 0;height:' + Math.max(h,2) + '%"></div>' +
          '<div style="font-size:9px;color:var(--dim);margin-top:3px">' + esc(labels[i]) + '</div>' +
        '</div>';
      }).join('') + '</div>';
  }

  var hourLabels = []; for (var h=0;h<24;h++) hourLabels.push(h%3===0? (h+'h'):'');
  var dayLabels = ['D','L','M','X','J','V','S'];
  // reordenar días para empezar en Lunes
  var dayOrder = [1,2,3,4,5,6,0];
  var byDayOrdered = dayOrder.map(function(i){ return d.byDay[i]; });
  var dayLabelsOrdered = dayOrder.map(function(i){ return ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'][i]; });

  var insights = buildInsights(d);
  var insightStrip = insights.length
    ? '<div class="card" style="margin-bottom:18px;background:linear-gradient(135deg,rgba(196,245,70,.10),rgba(56,225,200,.05));border-color:rgba(196,245,70,.28)">' +
        '<div style="font-size:12px;font-weight:800;color:var(--accent-l);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">💡 Ideas para ti</div>' +
        insights.map(function(x){ return '<div style="display:flex;gap:10px;align-items:flex-start;font-size:13px;color:var(--text);line-height:1.6;padding:5px 0"><span style="flex-shrink:0">' + x.icon + '</span><div>' + x.text + '</div></div>'; }).join('') +
      '</div>'
    : '';

  box.innerHTML =
    insightStrip +
    '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:18px">' +
      nfStat(d.total, 'Llamadas (30 días)') +
      nfStat(d.convRate + '%', 'Acaban en cita', 'var(--green,#38e1c8)') +
      nfStat(d.peakDayName || '—', 'Día más activo', '#fdcb6e') +
    '</div>' +
    '<div class="card" style="margin-bottom:16px">' +
      '<div style="font-size:14px;font-weight:700;margin-bottom:2px">🕐 ¿A qué hora te llaman?</div>' +
      '<div style="font-size:12px;color:var(--dim)">Hora punta: <strong style="color:var(--accent-l)">' + (d.peakHour!=null?d.peakHour+':00':'—') + '</strong></div>' +
      bars(d.byHour, hourLabels, 'var(--accent,#c4f546)') +
    '</div>' +
    '<div class="card">' +
      '<div style="font-size:14px;font-weight:700;margin-bottom:2px">📅 ¿Qué días te llaman?</div>' +
      bars(byDayOrdered, dayLabelsOrdered, '#00b894') +
    '</div>';
}

// ════════ Mis tareas CON VIDA — la IA llena el inbox sola ══════════════════════
// Dos bloques: "Sugeridas por tu asistente" (auto, ordenadas por urgencia, con
// enlace a la sección que las resuelve + Hecho/Descartar) y "Tus tareas" (las
// manuales de siempre, con su formulario intacto). dismissKeyFor debe coincidir
// con el backend (src/lifecycle/task-inbox.js).
function _dismissKeyFor(t) {
  var base = t.key || ((t.section || '') + ':' + (t.sourceId || ''));
  return t.dismissScope ? base + '@' + t.dismissScope : base;
}

async function loadTareas() {
  var box = document.getElementById('tareas-body');
  if (!box) return;
  box.innerHTML = skelPanel();

  var data;
  try { data = await api('/api/portal/tasks'); }
  catch (e) { box.innerHTML = '<div class="empty-state"><div>Error: ' + esc(e.message) + '</div></div>'; return; }

  var suggested = data.suggested || [];
  var manual = data.manual || data.tasks || [];
  var pend = manual.filter(function(t){ return !t.done; });
  var done = manual.filter(function(t){ return t.done; });
  var today = new Date().toISOString().slice(0,10);

  // ── Tarjeta de una tarea SUGERIDA por la IA ────────────────────────────────
  function sugRow(t) {
    var dk = _dismissKeyFor(t);
    var nav = "navigate('" + esc(t.section) + "')";
    return '<div style="display:flex;align-items:center;gap:12px;padding:14px 4px;border-bottom:1px solid var(--border)">' +
      '<span style="font-size:22px;line-height:1;flex-shrink:0">' + (t.icon || '•') + '</span>' +
      '<div style="flex:1;min-width:0">' +
        '<div style="font-size:15px;color:var(--text);line-height:1.35">' + esc(t.text) + '</div>' +
      '</div>' +
      '<div style="display:flex;gap:8px;flex-shrink:0">' +
        '<button class="btn btn-accent btn-sm" onclick="' + nav + '">Ir →</button>' +
        '<button class="btn btn-d btn-sm" title="Hecho" onclick="doneSuggestion(this)" data-dk="' + esc(dk) + '">✓ Hecho</button>' +
        '<button class="btn btn-d btn-sm" title="Descartar" onclick="dismissSuggestion(this)" data-dk="' + esc(dk) + '">Descartar</button>' +
      '</div>' +
    '</div>';
  }

  function taskRow(t) {
    var overdue = !t.done && t.due_date && t.due_date < today;
    var dueLabel = t.due_date
      ? (t.due_date === today ? '<span style="color:#fdcb6e">Hoy</span>' : (overdue ? '<span style="color:#e17055">Vencida · ' + fmtDate(t.due_date) + '</span>' : fmtDate(t.due_date)))
      : '';
    return '<div style="display:flex;align-items:center;gap:12px;padding:12px 4px;border-bottom:1px solid var(--border)">' +
      '<input type="checkbox" ' + (t.done?'checked':'') + ' onchange="toggleTask(' + t.id + ',this.checked)" style="width:18px;height:18px;cursor:pointer;flex-shrink:0">' +
      '<div style="flex:1;min-width:0">' +
        '<div style="font-size:14px;' + (t.done?'text-decoration:line-through;color:var(--dim)':'') + '">' + esc(t.title) + '</div>' +
        '<div style="font-size:11px;color:var(--dim)">' + (t.contact_name ? '👤 ' + esc(t.contact_name) + (dueLabel?' · ':'') : '') + dueLabel + '</div>' +
      '</div>' +
      '<button class="btn btn-d btn-sm" onclick="deleteTask(' + t.id + ')" style="flex-shrink:0">🗑</button>' +
    '</div>';
  }

  // "Todo al día" solo cuando NO hay ni sugerencias ni pendientes manuales.
  var allClear = suggested.length === 0 && pend.length === 0;

  box.innerHTML =
    // Sugeridas por tu asistente (auto)
    (suggested.length
      ? '<div class="card" style="margin-bottom:18px;border-color:rgba(196,245,70,.35);background:rgba(196,245,70,.04)">' +
          '<div style="font-size:14px;font-weight:800;margin-bottom:4px">✨ Sugeridas por tu asistente <span style="color:var(--dim);font-weight:400">(' + suggested.length + ')</span></div>' +
          '<div style="font-size:12px;color:var(--dim);margin-bottom:8px">Tu asistente vigila el negocio y te dice qué hacer. Toca "Ir" para resolverlo.</div>' +
          suggested.map(sugRow).join('') +
        '</div>'
      : '') +
    // Añadir tarea (formulario manual — intacto)
    '<div class="card" style="margin-bottom:18px">' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
        '<input class="form-input" id="newTaskTitle" placeholder="¿Qué tienes que hacer? (ej. Llamar a Ana)" style="flex:2;min-width:200px" onkeydown="if(event.key===\'Enter\')addTask()">' +
        '<input class="form-input" id="newTaskDue" type="date" style="flex:1;min-width:140px">' +
        '<button class="btn btn-accent" onclick="addTask()">+ Añadir</button>' +
      '</div>' +
    '</div>' +
    // Tus tareas (manuales)
    '<div class="card" style="margin-bottom:18px">' +
      '<div style="font-size:14px;font-weight:700;margin-bottom:6px">Tus tareas <span style="color:var(--dim);font-weight:400">(' + pend.length + ')</span></div>' +
      (pend.length ? pend.map(taskRow).join('')
        : (allClear
            ? '<div style="color:var(--dim);font-size:14px;padding:14px 0;text-align:center">Todo al día ✅ — tu asistente vigila y te avisará.</div>'
            : '<div style="color:var(--dim);font-size:13px;padding:10px 0">🎉 Nada que escribir a mano. Mira lo que sugiere tu asistente arriba.</div>')) +
    '</div>' +
    // Completadas
    (done.length ? '<div class="card">' +
      '<div style="font-size:14px;font-weight:700;margin-bottom:6px;color:var(--dim)">Completadas (' + done.length + ')</div>' +
      done.slice(0,20).map(taskRow).join('') +
    '</div>' : '');
}

// "Hecho" y "Descartar" en una sugerencia: ambos la ocultan y la PERSISTEN como
// descartada (TTL en el backend → puede resurgir cuando vuelva a ser real). La
// diferencia es solo el mensaje: "Hecho" felicita, "Descartar" es silencioso.
async function _dismissSuggestion(btn, doneMode) {
  var dk = btn && btn.getAttribute('data-dk');
  if (!dk) return;
  var row = btn.closest ? btn.closest('div[style*="border-bottom"]') : null;
  if (row) row.style.opacity = '.4';
  try {
    await api('/api/portal/tasks/dismiss', 'POST', { dismissKey: dk });
    if (doneMode) toast('¡Hecho! 💪');
    loadTareas();
  } catch (e) {
    if (row) row.style.opacity = '1';
    toast('Error: ' + e.message, 'err');
  }
}
function dismissSuggestion(btn) { return _dismissSuggestion(btn, false); }
function doneSuggestion(btn)    { return _dismissSuggestion(btn, true); }

async function addTask() {
  var title = (document.getElementById('newTaskTitle')||{}).value || '';
  var due   = (document.getElementById('newTaskDue')||{}).value || '';
  if (!title.trim()) { toast('Escribe qué tienes que hacer', 'warn'); return; }
  try {
    await api('/api/portal/tasks', 'POST', { title: title.trim(), dueDate: due || undefined });
    loadTareas();
  } catch (e) { toast('Error: ' + e.message, 'err'); }
}
async function toggleTask(id, done) {
  try { await api('/api/portal/tasks/' + id, 'PATCH', { done: done }); loadTareas(); }
  catch (e) { toast('Error: ' + e.message, 'err'); }
}
async function deleteTask(id) {
  try { await api('/api/portal/tasks/' + id, 'DELETE'); loadTareas(); }
  catch (e) { toast('Error: ' + e.message, 'err'); }
}
// Crear tarea desde el perfil de un contacto
function newTaskForContact(contactId, contactName) {
  var title = prompt('Nueva tarea para ' + (contactName || 'este cliente') + ':');
  if (!title || !title.trim()) return;
  api('/api/portal/tasks', 'POST', { title: title.trim(), contactId: contactId, contactName: contactName })
    .then(function(){ toast('Tarea creada'); })
    .catch(function(e){ toast('Error: ' + e.message, 'err'); });
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
      // Quien entra por enlace suele haber olvidado su contraseña →
      // ofrecer cambiarla al llegar (obligatorio si no existe ninguna).
      _viaMagicLink = true;
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

// ── Crear / cambiar contraseña al entrar ──────────────────────────────
// Obligatorio si la org no tiene contraseña; si entró por enlace mágico y
// SÍ tiene, se ofrece cambiarla (venir por enlace suele significar olvido).
var _viaMagicLink = false;
function requirePasswordSetup(canSkip) {
  var title = canSkip ? 'Cambia tu contraseña' : 'Crea tu contraseña';
  var intro = canSkip
    ? 'Has entrado con un enlace de acceso. Si no recuerdas tu contraseña, este es el momento de crear una nueva.'
    : 'Es tu primer acceso. Crea una contraseña segura para entrar directamente la próxima vez, sin esperar enlaces por email.';
  openModal(
    '<div class="modal-title">' + title + '</div>' +
    '<p style="font-size:13px;color:var(--dim);line-height:1.6;margin-bottom:16px">' + intro + '</p>' +
    '<div class="form-group"><label class="form-label">Nueva contraseña</label>' +
      '<input type="password" class="form-input" id="pwNew" placeholder="Mínimo 8 caracteres" autocomplete="new-password"></div>' +
    '<div class="form-group"><label class="form-label">Repítela</label>' +
      '<input type="password" class="form-input" id="pwNew2" autocomplete="new-password" onkeydown="if(event.key===\'Enter\')savePasswordSetup()"></div>' +
    '<div id="pwMsg" style="font-size:12px;color:var(--red);display:none;margin-bottom:8px"></div>' +
    '<div class="modal-actions" style="flex-direction:column;gap:8px">' +
      '<button class="btn btn-accent" id="pwSaveBtn" onclick="savePasswordSetup()" style="width:100%">Guardar y continuar</button>' +
      (canSkip ? '<button class="btn btn-d" onclick="closeModal()" style="width:100%">Mantener mi contraseña actual</button>' : '') +
    '</div>');
  setTimeout(function () { var el = document.getElementById('pwNew'); if (el) el.focus(); }, 100);
}

async function savePasswordSetup() {
  var p1 = (document.getElementById('pwNew') || {}).value || '';
  var p2 = (document.getElementById('pwNew2') || {}).value || '';
  var msg = document.getElementById('pwMsg');
  function err(t) { msg.textContent = t; msg.style.display = 'block'; }
  if (p1.length < 8) return err('Mínimo 8 caracteres.');
  if (!/[0-9]/.test(p1) || !/[a-zA-Z]/.test(p1)) return err('Debe llevar letras y al menos un número.');
  if (p1 !== p2) return err('No coinciden.');
  var btn = document.getElementById('pwSaveBtn');
  btn.disabled = true; btn.textContent = 'Guardando…';
  try {
    await api('/api/auth/set-password', 'POST', { password: p1 });
    _orgInfo.has_password = true;
    closeModal();
    toast('✅ Contraseña creada — úsala en tu próximo acceso');
  } catch (e) {
    btn.disabled = false; btn.textContent = 'Guardar y continuar';
    err(e.message || 'No se pudo guardar. Inténtalo de nuevo.');
  }
}

function showApp() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('app').style.display         = 'block';
  startCallNotifications(); // avisos en pantalla de cada llamada (si están activados)
  initEntidades();          // pestaña Vehículos/Mascotas/… si el sector la tiene

  // Sin contraseña → crearla (obligatorio). Con contraseña pero entrando
  // por enlace mágico → ofrecer cambiarla (probable olvido).
  if (_orgInfo && _orgInfo.has_password === false) {
    setTimeout(function () { requirePasswordSetup(false); }, 400);
  } else if (_viaMagicLink && _orgInfo) {
    setTimeout(function () { requirePasswordSetup(true); }, 400);
  }
  _viaMagicLink = false;

  document.getElementById('sidebarBiz').textContent = _orgInfo.name || '—';
  var planMap = { starter: 'Plan Starter', negocio: 'Plan NodeFlow', pro: 'Plan Pro' };
  document.getElementById('sidebarPlan').textContent    = planMap[_orgInfo.plan] || 'Plan —';
  var planPrice = _orgInfo.plan === 'negocio' ? '€49' : _orgInfo.plan === 'pro' ? '€99' : 'Gratis';
  document.getElementById('sidebarPlanSub').textContent = planPrice + '/mes · Activo';

  // Plan único Negocio €49 — sin upsell a Pro. Solo legacy 'starter' (sin pagar) ve CTA de alta.
  var upgradeEl = document.getElementById('upgradeCtaBox');
  if (upgradeEl) {
    if (_orgInfo.plan === 'starter') {
      upgradeEl.innerHTML =
        '<div style="font-size:11px;font-weight:700;color:var(--accent-l);margin-bottom:4px">🚀 Activa tu IA ahora</div>' +
        '<div style="font-size:10px;color:var(--dim);margin-bottom:8px;line-height:1.4">Atiende llamadas 24/7 y elimina las perdidas por €49/mes</div>' +
        '<a href="https://nodeflow.es/#precios" target="_blank" style="display:block;text-align:center;background:var(--accent);color:#0a0b0d;border-radius:6px;padding:7px;font-size:11px;font-weight:700;text-decoration:none">Ver planes →</a>';
      upgradeEl.style.display = 'block';
    } else {
      upgradeEl.style.display = 'none';
    }
  }

  // Feedback tras volver del OAuth de Google Calendar (/portal/?cal=connected|denied|error)
  var _calParam = new URLSearchParams(location.search).get('cal');
  if (_calParam) {
    if (_calParam === 'connected')   toast('✅ Google Calendar conectado');
    else if (_calParam === 'denied') toast('Conexión de Google Calendar cancelada', 'err');
    else                             toast('No se pudo conectar Google Calendar', 'err');
    history.replaceState(null, '', location.pathname);
    navigate(_calParam === 'connected' ? 'integraciones' : 'dashboard');
    return;
  }

  // Deep-links desde emails: ?go=reglas → Seguimientos ▸ Reglas (informe semanal);
  // ?go=seguimientos → Personalizados (briefing diario).
  var _go = new URLSearchParams(location.search).get('go');
  if (_go === 'reglas' || _go === 'seguimientos') {
    history.replaceState(null, '', location.pathname);
    navigate('seguimientos');
    if (_go === 'reglas') {
      setTimeout(function() {
        var btn = document.querySelector('#sec-seguimientos .tab-btn[data-tab="reglas"]');
        if (btn) btn.click();
      }, 300);
    }
    return;
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

// Login con email + contraseña (si no hay contraseña → enlace mágico)
async function portalLogin() {
  var email = document.getElementById('loginEmail').value.trim();
  var passEl = document.getElementById('loginPass');
  var pass  = passEl ? passEl.value : '';
  var msgEl = document.getElementById('loginMsg');
  if (!email || !email.includes('@')) {
    msgEl.style.color = '#e74c3c'; msgEl.textContent = 'Introduce un email válido.'; msgEl.style.display = 'block'; return;
  }
  if (!pass) { return requestAccess(); } // sin contraseña → enlace por email
  msgEl.style.color = 'var(--dim)'; msgEl.textContent = 'Entrando…'; msgEl.style.display = 'block';
  try {
    var resp = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, password: pass }),
    });
    var data = await resp.json();
    if (!resp.ok || !data.session_token) throw new Error(data.error || 'No se pudo entrar');
    localStorage.setItem(SESSION_KEY, data.session_token);
    _token = data.session_token;
    _orgInfo = await api('/api/portal/me');
    if (!_orgInfo || !_orgInfo.id) throw new Error('Sin negocio asociado');
    showApp();
  } catch (e) {
    msgEl.style.color = '#e74c3c'; msgEl.textContent = e.message || 'Email o contraseña incorrectos.'; msgEl.style.display = 'block';
  }
}

// ── Sección "ACCESO AL PORTAL" según el estado real (hasPassword) ──────────
// Con contraseña: confirmación + "Cambiar" (revela el input) + "Quitar".
// Sin contraseña: el campo de crear. Antes SIEMPRE se pintaba el campo en
// blanco, así que quien ya tenía contraseña creía que no la tenía (bug 2026-07-08).
function passwordSectionHtml(hasPassword) {
  if (hasPassword) {
    return '<label class="form-label">Contraseña de acceso</label>' +
      '<div class="callout callout--accent" style="align-items:center">' +
        '<div class="u-flex-1" style="min-width:200px">✓ Ya tienes una contraseña de acceso configurada. Entras con tu email y contraseña; el enlace por email seguirá funcionando igual.</div>' +
        '<button type="button" class="btn btn-d btn-sm u-nowrap" onclick="revealPasswordChange()">Cambiar contraseña</button>' +
      '</div>' +
      '<div id="cfgPasswordChange" style="display:none;margin-top:12px">' +
        '<div class="u-flex u-gap-2 u-items-center">' +
          '<input class="form-input u-flex-1" id="cfgPassword" type="password" placeholder="Nueva contraseña (mínimo 6 caracteres)" autocomplete="new-password">' +
          '<button type="button" class="btn btn-d u-nowrap" onclick="setPortalPassword()">Guardar</button>' +
        '</div>' +
      '</div>' +
      '<small class="form-hint" style="margin-top:10px"><a class="u-link" onclick="clearPortalPassword()">Quitar contraseña</a> — volverás a entrar solo con el enlace por email.</small>';
  }
  return '<label class="form-label">Contraseña de acceso <span class="u-normal">(opcional — para entrar sin esperar el enlace)</span></label>' +
    '<div class="u-flex u-gap-2 u-items-center">' +
      '<input class="form-input u-flex-1" id="cfgPassword" type="password" placeholder="Mínimo 6 caracteres" autocomplete="new-password">' +
      '<button type="button" class="btn btn-d u-nowrap" onclick="setPortalPassword()">Guardar contraseña</button>' +
    '</div>' +
    '<small class="form-hint">Entra con tu email y esta contraseña. El enlace por email seguirá funcionando igual.</small>';
}

// Revela el input para cambiar la contraseña ya existente.
function revealPasswordChange() {
  var box = document.getElementById('cfgPasswordChange');
  if (box) { box.style.display = ''; var inp = document.getElementById('cfgPassword'); if (inp) inp.focus(); }
}

// Repinta la sección tras un cambio de estado (guardar/quitar) sin recargar todo.
function _refreshPasswordSection(hasPassword) {
  var sec = document.getElementById('cfgPasswordSection');
  if (sec) sec.innerHTML = passwordSectionHtml(hasPassword);
}

// Establecer / cambiar contraseña de acceso (desde Configuración)
async function setPortalPassword() {
  var el = document.getElementById('cfgPassword');
  if (!el) return;
  var pass = el.value.trim();
  if (pass.length < 6) { toast('La contraseña debe tener al menos 6 caracteres', 'err'); return; }
  try {
    await api('/api/auth/set-password', 'POST', { password: pass });
    el.value = '';
    toast('✅ Contraseña guardada — ya puedes entrar con email y contraseña');
    _refreshPasswordSection(true);
  } catch (e) {
    toast('Error: ' + (e.message || e), 'err');
  }
}

// Quitar la contraseña de acceso (vuelve a solo-enlace). Confirma antes.
async function clearPortalPassword() {
  if (!confirm('¿Quitar la contraseña de acceso? Volverás a entrar solo con el enlace por email.')) return;
  try {
    await api('/api/portal/password/clear', 'POST', {});
    toast('Contraseña eliminada — entrarás con el enlace por email');
    _refreshPasswordSection(false);
  } catch (e) {
    toast('Error: ' + (e.message || e), 'err');
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
// Barra de "cosas que hacer" — solo muestra lo que tiene acción pendiente
function dashActionBar(act) {
  var cards = [];
  if (act.opps > 0) cards.push({ n: act.opps, label: act.opps === 1 ? 'oportunidad por recuperar' : 'oportunidades por recuperar', icon: '💡', color: '#fdcb6e', sec: 'oportunidades' });
  if (act.tasks > 0) cards.push({ n: act.tasks, label: act.tasks === 1 ? 'tarea pendiente' : 'tareas pendientes', icon: '✅', color: '#d6ff5c', sec: 'tareas' });
  if (act.wait > 0) cards.push({ n: act.wait, label: act.wait === 1 ? 'cliente en lista de espera' : 'clientes en lista de espera', icon: '⏳', color: '#00b894', sec: 'espera' });
  if (!cards.length) return '';
  return '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px">' +
    cards.map(function(c){
      return '<div onclick="navigate(\'' + c.sec + '\')" style="cursor:pointer;flex:1;min-width:180px;display:flex;align-items:center;gap:12px;background:' + c.color + '15;border:1px solid ' + c.color + '40;border-radius:12px;padding:14px 16px;transition:transform .12s" onmouseover="this.style.transform=\'translateY(-2px)\'" onmouseout="this.style.transform=\'none\'">' +
        '<div style="font-size:22px">' + c.icon + '</div>' +
        '<div><div style="font-size:20px;font-weight:900;color:' + c.color + '">' + c.n + '</div>' +
        '<div style="font-size:12px;color:var(--dim);line-height:1.3">' + c.label + ' →</div></div>' +
      '</div>';
    }).join('') + '</div>';
}

// ── Skeleton loaders (sustituyen al emoji de reloj de arena) ──────────────
function skelBar(w, h, mb) {
  return '<div class="skel" style="width:' + w + ';height:' + (h || 12) + 'px' + (mb != null ? ';margin-bottom:' + mb + 'px' : '') + '"></div>';
}
function skelPanel() {
  var rows = '';
  for (var i = 0; i < 5; i++) {
    rows += '<div style="display:flex;gap:14px;align-items:center;padding:12px 0;border-top:1px solid var(--border)">' +
      skelBar('16px', 16) + skelBar('22%', 12) + skelBar('32%', 12) + skelBar('18%', 12) + '</div>';
  }
  return '<div class="skel-wrap"><div class="card">' + skelBar('180px', 16, 18) + rows + '</div></div>';
}
function skeletonDashboard() {
  var wins = '';
  for (var i = 0; i < 4; i++) wins += skelBar('120px', 22);
  var pills = '';
  for (var p = 0; p < 5; p++) pills += '<div class="skel" style="width:128px;height:36px;border-radius:999px"></div>';
  function card() {
    var rows = '';
    for (var r = 0; r < 4; r++) {
      rows += '<div style="display:flex;gap:14px;padding:11px 0;border-top:1px solid var(--border)">' +
        skelBar('22%', 12) + skelBar('26%', 12) + skelBar('34%', 12) + '</div>';
    }
    return '<div class="card">' + skelBar('160px', 16, 16) + rows + '</div>';
  }
  return '<div class="skel-wrap">' +
    '<div class="section-header"><div>' + skelBar('300px', 34, 8) + skelBar('190px', 13) + '</div>' +
      '<div class="skel" style="width:120px;height:26px;border-radius:20px"></div></div>' +
    skelBar('260px', 17, 16) +
    '<div class="u-flex u-gap-6 u-wrap u-mb-6">' + wins + '</div>' +
    '<div class="u-flex u-gap-2 u-wrap u-mb-6">' + pills + '</div>' +
    '<div class="two-col">' + card() + card() + '</div>' +
  '</div>';
}

// ── Empty state reutilizable (icono + título + texto + CTA opcional) ──────
function emptyState(icon, title, text, ctaHtml) {
  return '<div class="empty-state">' +
    '<div class="empty-state-icon">' + icon + '</div>' +
    (title ? '<div class="empty-state-title">' + title + '</div>' : '') +
    '<div class="empty-state-text">' + text + '</div>' +
    (ctaHtml || '') +
  '</div>';
}

// ── Dashboard · copiloto ─────────────────────────────────────
// El dashboard no es una página de métricas: cuenta lo que NodeFlow
// ya ha hecho por ti hoy y propone el siguiente paso.

var DASH_SECTION_LABELS = {
  llamadas: 'Llamadas', citas: 'Citas', clientes: 'Clientes',
  oportunidades: 'Oportunidades', espera: 'Lista de espera', tareas: 'Mis tareas',
  seguimientos: 'Seguimientos', informes: 'Informes', insights: 'Insights',
  referidos: 'Recomienda y gana', widget: 'Widget para tu web', asistente: 'Asistente',
  conocimiento: 'Base de conocimiento', automatizaciones: 'Automatizaciones',
  integraciones: 'Integraciones', facturacion: 'Facturación',
  configuracion: 'Configuración', ayuda: 'Ayuda',
};

// 2.7h → "2h 42m" · 0.5h → "30m"
function _fmtHm(h) {
  var mins = Math.round((Number(h) || 0) * 60);
  if (mins < 60) return mins + 'm';
  var rest = mins % 60;
  return Math.floor(mins / 60) + 'h' + (rest ? ' ' + rest + 'm' : '');
}

function _win(num, label, money) {
  return '<div class="nf-win' + (money ? ' money' : '') + '">' +
    '<span class="nf-win-check">✓</span>' +
    '<span class="nf-win-num">' + num + '</span>' +
    '<span class="nf-win-label">' + label + '</span></div>';
}

function dashHero(d) {
  var hour    = new Date().getHours();
  var greet   = hour < 14 ? 'Buenos días' : hour < 20 ? 'Buenas tardes' : 'Buenas noches';
  var dateStr = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  var t = d.today || {};
  var busy = (t.callCount || 0) > 0;

  var status = d.aiStatus === 'pending'
    ? '<span class="ai-status" style="background:rgba(246,197,68,.12);color:var(--yellow);border-color:rgba(246,197,68,.25)">◌ Configurando</span>'
    : '<span class="ai-status"><span class="nf-wave nf-wave--sm" style="color:var(--green2)" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>Asistente activo</span>';

  var wins = '';
  if (busy) {
    wins += _win(t.callCount, t.callCount === 1 ? 'llamada atendida' : 'llamadas atendidas');
    if (t.bookedToday)   wins += _win(t.bookedToday, t.bookedToday === 1 ? 'cita reservada' : 'citas reservadas');
    if (t.emailsSent)    wins += _win(t.emailsSent, t.emailsSent === 1 ? 'aviso enviado' : 'avisos enviados');
    if (d.valueEstToday) wins += _win('€' + d.valueEstToday, 'en reservas · estimado', true);
    if (t.hoursSaved)    wins += _win(_fmtHm(t.hoursSaved), 'sin estar tú al teléfono');
  }

  var lead;
  if (d.aiStatus === 'pending') {
    lead = 'Tu asistente está casi listo. Completa los primeros pasos y empezará a atender llamadas.';
  } else if (busy) {
    lead = 'Hoy NodeFlow ya ha trabajado por ti.';
  } else if ((d.totalCalls || 0) > 0) {
    lead = 'Todo tranquilo por ahora. Tu asistente sigue al teléfono — en total ya ha atendido <strong>' +
      d.totalCalls + (d.totalCalls === 1 ? ' llamada' : ' llamadas') + '</strong>' +
      (d.totalBookings ? ' y reservado <strong>' + d.totalBookings + (d.totalBookings === 1 ? ' cita' : ' citas') + '</strong>' : '') + ' por ti.';
  } else {
    lead = 'Tu asistente está al teléfono, listo para su primera llamada.';
  }

  return '<div class="nf-hero">' +
    '<div class="u-flex u-justify-between u-items-start u-gap-3 u-wrap">' +
      '<div><div class="nf-hero-greet">' + greet + ', ' + esc(d.businessName) + '</div>' +
      '<div class="nf-hero-date">' + dateStr + (d.daysActive ? ' · tu asistente lleva ' + d.daysActive + ' días contigo' : '') + '</div></div>' +
      status +
    '</div>' +
    '<div class="nf-hero-lead">' + lead + '</div>' +
    (wins ? '<div class="nf-wins nf-stagger">' + wins + '</div>' : '') +
    (wins && d.valueEstToday && d.avgTicketConfigured === false
      ? '<div class="u-text-sm u-dim u-mt-2">El € está calculado con un ticket medio genérico (35€). ' +
        '<a onclick="navigate(\'configuracion\')" class="u-accent u-pointer" style="text-decoration:underline">Pon el tuyo</a> y será exacto.</div>'
      : '') +
  '</div>';
}

// IA proactiva: detecta y propone, no espera órdenes
function dashRecos(act) {
  function reco(text, sub, btnLabel, sec) {
    return '<div class="nf-reco">' +
      '<div class="nf-reco-spark"><svg class="ico" width="16" height="16"><use href="#i-insights"/></svg></div>' +
      '<div class="nf-reco-body"><div class="nf-reco-text">' + text + '</div>' +
      (sub ? '<div class="nf-reco-sub">' + sub + '</div>' : '') + '</div>' +
      '<button class="btn btn-accent btn-sm" onclick="navigate(\'' + sec + '\')">' + btnLabel + '</button></div>';
  }
  var out = '';
  if (act.opps > 0) {
    out += reco(
      'He detectado <strong>' + act.opps + (act.opps === 1 ? ' cliente' : ' clientes') + '</strong> que llamaron y se quedaron sin cita.',
      'Puedo ayudarte a recuperarlos antes de que se enfríen.',
      'Recuperar', 'oportunidades');
  }
  if (act.wait > 0) {
    out += reco(
      '<strong>' + act.wait + (act.wait === 1 ? ' cliente espera' : ' clientes esperan') + '</strong> un hueco libre en tu agenda.',
      'Si se cancela una cita, avísales con un toque.',
      'Ver lista', 'espera');
  }
  if (act.unanswered > 0) {
    out += reco(
      'Tu asistente no supo responder <strong>' + act.unanswered + (act.unanswered === 1 ? ' pregunta' : ' preguntas') + '</strong> de clientes.',
      'Enséñale la respuesta en un minuto — la usará desde la siguiente llamada.',
      'Enseñarle', 'conocimiento');
  }
  if (!out) return '';
  return '<div style="margin-bottom:24px"><div class="kicker">Copiloto · qué hacer ahora</div>' + out + '</div>';
}

function dashContinue() {
  var last  = localStorage.getItem('nf_last_section');
  var label = DASH_SECTION_LABELS[last];
  if (!label) return '';
  return '<div><div class="nf-continue" role="button" tabindex="0" onclick="navigate(\'' + last + '\')" ' +
    'onkeydown="if(event.key===\'Enter\')navigate(\'' + last + '\')">' +
    '<span class="nf-continue-kicker">Continúa donde lo dejaste</span>' +
    '<span>' + label + '</span><span class="nf-continue-arrow">→</span></div></div>';
}

function dashQuick(act) {
  function qa(iconId, label, onclick) {
    return '<button class="nf-qa-btn" onclick="' + onclick + '">' +
      '<span class="qa-ico"><svg class="ico" width="15" height="15"><use href="#' + iconId + '"/></svg></span>' +
      label + '</button>';
  }
  return '<div class="nf-qa-title">Acciones rápidas</div><div class="nf-qa nf-stagger">' +
    qa('i-citas', 'Nueva cita', "navigate('citas');setTimeout(function(){if(window.openNewCita)openNewCita();},350)") +
    qa('i-tareas', act.tasks > 0 ? 'Mis tareas · ' + act.tasks : 'Nueva tarea', "navigate('tareas')") +
    qa('i-asistente', 'Tu asistente', "navigate('asistente')") +
    qa('i-informes', 'Informes', "navigate('informes')") +
    qa('i-referidos', 'Recomienda y gana', "navigate('referidos')") +
  '</div>';
}

function dashUpcoming(d) {
  var today = new Date().toLocaleDateString('sv-SE');
  var stBadge = {
    confirmed: '<span class="badge bg">Confirmada</span>',
    pending:   '<span class="badge by">Pendiente</span>',
    cancelled: '<span class="badge br">Cancelada</span>',
  };
  var html = '';
  if (d.upcoming && d.upcoming.length) {
    for (var i = 0; i < d.upcoming.length; i++) {
      var a = d.upcoming[i];
      var isToday = a.date === today;
      html += '<div class="crit-item">' +
        '<div><div class="crit-name">' + esc(a.patientName) + '</div>' +
        '<div class="crit-meta">' + esc(a.service) + '</div></div>' +
        '<div><div class="crit-date">' + (isToday ? '<span class="u-accent">Hoy</span>' : fmtDate(a.date)) + ' · ' + esc(a.time) + '</div>' +
        '<div class="crit-days">' + (stBadge[a.status] || stBadge.pending) + '</div></div></div>';
    }
  } else {
    html = '<div class="u-dim u-text-md u-py-2">Aún no hay citas próximas. Cuando tu asistente reserve una, aparecerá aquí.</div>';
  }
  return '<div class="card"><div class="card-title">Próximas citas</div>' + html +
    '<button class="btn btn-d btn-sm u-mt-3" onclick="navigate(\'citas\')">Ver agenda →</button></div>';
}

function dashFeedItems(list) {
  if (!list || !list.length) {
    return '<div style="color:var(--dim);font-size:13px;padding:8px 0">Sin actividad todavía. En cuanto entre la primera llamada la verás aquí, en directo.</div>';
  }
  var html = '';
  for (var j = 0; j < list.length; j++) {
    var ev  = list[j];
    var dot = ev.type === 'reserva' ? 'ok' : ev.type === 'info' ? 'info' : '';
    var txt = ev.type === 'reserva' ? '<strong>Cita reservada</strong> · ' + esc(ev.text)
            : ev.type === 'info'    ? 'Consulta resuelta · '                + esc(ev.text)
            :                          esc(ev.text);
    html += '<div class="nf-feed-item"><span class="nf-feed-dot ' + dot + '"></span>' +
      '<div class="nf-feed-body"><div class="nf-feed-text">' + txt + '</div>' +
      '<div class="nf-feed-time">' + timeAgo(ev.time) + '</div></div></div>';
  }
  return html;
}

function dashFeed(list) {
  return '<div class="card"><div class="card-title"><span class="nf-wave nf-wave--sm" style="color:var(--green2)" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>Actividad en directo</div>' +
    '<div class="nf-feed" id="dashFeed">' + dashFeedItems(list) + '</div>' +
    '<button class="btn btn-d btn-sm" style="margin-top:12px" onclick="navigate(\'llamadas\')">Ver llamadas →</button></div>';
}

// Checklist de primeros pasos (solo cuentas sin llamadas aún)
// Aviso ACTIVO de Google Calendar: si el asistente agenda citas (modo 'citas')
// pero el calendario NO está conectado, las citas no llegan a la agenda real del
// dueño — viven solo en el portal = fallo silencioso. Antes era un opt-in
// enterrado en "Apps"; ahora se pide en el dashboard hasta conectar u ocultar.
// Citas de MAÑANA con riesgo de plantón — el dueño las confirma personalmente.
function dashAtRisk(atRisk) {
  if (!atRisk || !atRisk.length) return '';
  var rows = atRisk.map(function (a) {
    var tel = String(a.phone || '').replace(/[^0-9]/g, '');
    return '<div style="display:flex;gap:10px;align-items:center;padding:8px 0;border-top:1px solid var(--border);flex-wrap:wrap">' +
      '<div style="font-weight:700;font-size:13px;min-width:44px">' + esc(a.time || '—') + '</div>' +
      '<div style="flex:1;min-width:120px">' +
        '<div style="font-size:13px;color:var(--text)">' + esc(a.patientName || 'Cliente') + (a.service ? ' · <span style="color:var(--dim)">' + esc(a.service) + '</span>' : '') + '</div>' +
        '<div style="font-size:11px;color:#e0a030">' + esc(a.note || ('Ha faltado ' + a.noShows + ' veces')) + '</div>' +
      '</div>' +
      (tel ? '<a class="btn btn-d btn-sm" style="text-decoration:none" href="https://wa.me/' + tel + '" target="_blank">💬</a>' +
             '<button class="btn btn-d btn-sm" onclick="callOutbound(\'' + esc(a.phone) + '\',this)">📞</button>' : '') +
    '</div>';
  }).join('');
  return '<div class="card" style="margin-bottom:20px;border-color:rgba(224,160,48,.35);background:rgba(224,160,48,.05)">' +
    '<div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">' +
      '<div style="font-size:22px">⚠️</div>' +
      '<div style="font-weight:800;font-size:14px">' + atRisk.length + ' cita' + (atRisk.length !== 1 ? 's' : '') + ' de mañana con riesgo de plantón</div>' +
    '</div>' +
    '<div style="font-size:12px;color:var(--dim);margin-bottom:6px">Estos clientes suelen faltar. Una llamada tuya hoy convierte el hueco en dinero, no en una ausencia.</div>' +
    rows +
  '</div>';
}

function dashCalendarNudge(cal, mode) {
  if (!cal || !cal.enabled || cal.connected) return '';   // no aplica o ya conectado
  if (mode === 'contacto') return '';                      // no agenda citas → no molestar
  if (localStorage.getItem('nf_cal_nudge_dismissed') === '1') return '';
  return '<div class="card" style="margin-bottom:20px;border-color:rgba(66,133,244,.4);background:rgba(66,133,244,.06)">' +
    '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">' +
      '<div style="font-size:26px;line-height:1">📅</div>' +
      '<div style="flex:1;min-width:220px">' +
        '<div style="font-weight:800;font-size:14px;margin-bottom:2px">Conecta tu Google Calendar</div>' +
        '<div style="font-size:12.5px;color:var(--dim);line-height:1.6">Tu asistente agenda citas, pero sin conectar el calendario <strong style="color:var(--text)">no aparecerán en tu agenda</strong> — solo aquí. Conéctalo y cada cita se crea sola en tu Google Calendar.</div>' +
      '</div>' +
      '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
        '<button class="btn btn-accent btn-sm" onclick="connectGoogleCalendar(this)">Conectar ahora</button>' +
        '<button class="btn btn-d btn-sm" onclick="this.closest(\'.card\').style.display=\'none\';localStorage.setItem(\'nf_cal_nudge_dismissed\',\'1\')">Ahora no</button>' +
      '</div>' +
    '</div>' +
  '</div>';
}

function dashSetup(d) {
  if (localStorage.getItem('nf_banner_dismissed') === '1') return '';
  if ((d.totalCalls || 0) !== 0) return '';
  var arrow = ' <span class="u-accent">→</span>';
  var steps =
    '<div class="setup-step done">✅ Pago confirmado — tu cuenta está activa</div>' +
    '<div class="setup-step u-pointer" onclick="navigate(\'asistente\')">⚙️ <strong>Configura tu asistente</strong> — nombre, voz, idioma y servicios' + arrow + '</div>' +
    '<div class="setup-step u-pointer" onclick="navigate(\'configuracion\')">📋 <strong>Completa los datos del negocio</strong> — dirección, horarios, tu WhatsApp' + arrow + '</div>' +
    (d.onboarding && d.onboarding.number_assigned
      ? '<div class="setup-step u-pointer" onclick="navigate(\'asistente\')">▶ <strong>Escúchalo antes de desviar</strong> — tu asistente te llama al móvil' + arrow + '</div>' +
        '<div class="setup-step u-pointer" onclick="navigate(\'configuracion\')">📞 <strong>Activa el desvío de llamadas</strong>' +
        (d.nodeflowNumber ? ' — tu número NodeFlow: <strong class="u-accent">' + esc(d.nodeflowNumber) + '</strong>' : '') +
        arrow + '</div>'
      : '<div class="setup-step u-dim-2">⏳ <strong>Número NodeFlow asignándose…</strong> — recibirás un email con los códigos de desvío</div>');
  return '<div class="card u-border-accent" id="setup-banner">' +
    '<div class="card-title">🚀 Primeros pasos</div>' +
    '<div class="u-flex u-col u-gap-2">' + steps + '</div>' +
    '<button class="btn btn-d btn-sm u-mt-4" ' +
      'onclick="document.getElementById(\'setup-banner\').style.display=\'none\';localStorage.setItem(\'nf_banner_dismissed\',\'1\')">Ocultar</button>' +
  '</div>';
}

// Dashboard vivo: refresca el feed sin recargar la vista
var _dashLive = null;
function startDashLive() {
  clearInterval(_dashLive);
  _dashLive = setInterval(async function () {
    if (_currentSection !== 'dashboard' || document.hidden) return;
    try {
      var d = await api('/api/portal/dashboard');
      var feed = document.getElementById('dashFeed');
      if (feed) feed.innerHTML = dashFeedItems(d.recentActivity);
    } catch (e) { /* silencioso: siguiente tick */ }
  }, 45000);
}

// Widget de consumo del mes: minutos incluidos · usados · disponibles, barra,
// y accesos a comprar más minutos / cambiar de voz (petición Unai 2026-07-04).
function dashMinutes(u) {
  if (!u || u.minutesLimit === undefined || u.minutesLimit === null) return '';
  var used  = Math.round(u.minutesUsed || 0);
  var limit = u.minutesLimit || 0;
  var rem   = Math.max(0, Math.floor(u.minutesRemaining != null ? u.minutesRemaining : (limit - used)));
  var pct   = u.percentUsed != null ? u.percentUsed : (limit > 0 ? Math.round((used / limit) * 100) : 0);
  // Color de la barra por umbral — tokens del sistema, no hex sueltos.
  var barColor = pct >= 90 ? 'var(--red)' : pct >= 70 ? 'var(--yellow)' : 'var(--accent)';
  var rate = (u.overageRate != null ? u.overageRate : 0.15).toFixed(2).replace('.', ',');
  return '<div class="card u-mb-4">' +
    '<div class="u-flex u-justify-between u-items-center u-wrap u-gap-2 u-mb-4">' +
      '<div class="u-text-md u-bold">📞 Minutos de este mes</div>' +
      '<div class="u-text-xs u-dim">Se renueva cada mes</div>' +
    '</div>' +
    '<div class="u-grid u-gap-2 u-center u-mb-3" style="grid-template-columns:repeat(3,1fr)">' +
      '<div><div class="u-text-2xl u-black u-white">' + limit + '</div><div class="u-text-xs u-dim">incluidos</div></div>' +
      '<div><div class="u-text-2xl u-black u-yellow">' + used + '</div><div class="u-text-xs u-dim">usados</div></div>' +
      '<div><div class="u-text-2xl u-black u-green">' + rem + '</div><div class="u-text-xs u-dim">disponibles</div></div>' +
    '</div>' +
    '<div class="progress u-mb-1"><div class="progress-bar" style="width:' + Math.min(pct, 100) + '%;background:' + barColor + '"></div></div>' +
    '<div class="u-text-xs u-dim">' + pct + '% usado' +
      ((u.overage > 0) ? ' · <span class="u-red">' + u.overage.toFixed(1) + ' min extra a ' + rate + '€/min</span>' : ' · el extra se cobra a ' + rate + '€/min') + '</div>' +
    '<div class="u-flex u-gap-3 u-wrap u-mt-4">' +
      '<button class="btn btn-accent btn-sm" onclick="navigate(\'facturacion\')">Comprar más minutos</button>' +
      '<button class="btn btn-d btn-sm" onclick="showVoiceModels()">Ver modelos de voz</button>' +
    '</div>' +
  '</div>';
}

// Comparativa de los 3 modelos de voz con su precio — el cliente elige con
// criterio (petición Unai 2026-07-04). "Elegir" lleva al selector del asistente.
async function showVoiceModels() {
  var d; try { d = await api('/api/voices'); } catch (e) { toast('No se pudieron cargar los modelos de voz', 'err'); return; }
  var voices = (d && d.voices) || [];
  var n = {}; voices.forEach(function (v) { if (v.provider !== 'local') n[v.tier] = (n[v.tier] || 0) + 1; });
  // Voz/modelo ACTUAL del asistente — para marcarlo (petición Unai: "no se ve").
  var curVoice = '', curTier = '', curName = '';
  try {
    var a = await api('/api/portal/assistant');
    curVoice = (a && a.config && a.config.voice) || '';
    var cur = voices.filter(function (v) { return v.id === curVoice || v.providerVoiceId === curVoice; })[0];
    if (cur) { curTier = cur.tier; curName = cur.name; }
  } catch (e) { /* si no se puede, el modal sale sin marcar la actual */ }
  // Cupo premium real de esta org — la cifra coincide con la degradación real.
  var q = null;
  try { var qr = await api('/api/portal/voice-quota'); if (qr && qr.ok) q = qr; } catch (e) { /* fail-open */ }
  var TIERS = [
    { key: 'estandar', name: 'Estándar', icon: '🎙️', price: 'Incluida en tu plan', col: 'var(--dim)', bd: 'var(--border)',
      desc: 'Voces naturales de alta calidad y respuesta rápida (Cartesia). Sin límite dentro de tus minutos del mes.' },
    { key: 'premium', name: 'Premium', icon: '✨', price: '+10€/mes', col: 'var(--accent-l)', bd: 'rgba(196,245,70,.4)',
      desc: 'Voces ultrarrealistas (ElevenLabs) y tu voz clonada. 40 min/mes incluidos · 200 con el complemento.' },
  ];
  var cards = TIERS.map(function (t) {
    var isCur = t.key === curTier;
    return '<div style="border:1px solid ' + (isCur ? t.col : t.bd) + ';border-radius:12px;padding:16px;margin-bottom:10px;' + (isCur ? 'box-shadow:0 0 0 1px ' + t.col + ' inset' : '') + '">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px">' +
        '<div style="font-size:15px;font-weight:800">' + t.icon + ' ' + t.name +
          (isCur ? ' <span style="font-size:10px;font-weight:800;color:' + t.col + ';border:1px solid ' + t.col + ';border-radius:999px;padding:1px 7px;margin-left:4px">TU VOZ AHORA</span>' : '') + '</div>' +
        '<span style="font-size:11px;font-weight:800;color:' + t.col + '">' + t.price + '</span></div>' +
      '<div style="font-size:12px;color:var(--dim);line-height:1.5;margin-bottom:10px">' + t.desc + '</div>' +
      '<div style="display:flex;justify-content:space-between;align-items:center">' +
        '<span style="font-size:11px;color:var(--dim)">' + (n[t.key] || 0) + ' voces disponibles</span>' +
        '<button class="btn btn-d btn-sm" onclick="closeModal();navigate(\'asistente\')">Elegir voz →</button></div>' +
    '</div>';
  }).join('');
  var curLine = curName
    ? '<div style="font-size:12px;color:var(--text);background:var(--card2);border-radius:8px;padding:8px 12px;margin-bottom:12px">🔊 Ahora mismo tu asistente usa <strong>' + esc(curName) + '</strong>' + (curTier ? ' · ' + (curTier === 'estandar' ? 'Estándar' : curTier === 'premium' ? 'Premium' : 'Ultra-rápida') : '') + '</div>'
    : '';
  // Cupo premium: "te quedan X de Y min este mes" + barra. SOLO cuando la voz
  // actual consume cupo (premium/ElevenLabs) o ya degradó — las voces incluidas
  // (Cartesia estándar) no gastan cupo, así que no mostramos la barra.
  var quotaLine = '';
  if (q && (q.metered || q.downgraded)) {
    var qUsed = Math.round(q.used || 0), qTot = q.quota || 0, qRem = Math.floor(q.remaining || 0);
    var qPct = qTot > 0 ? Math.min(100, Math.round((qUsed / qTot) * 100)) : 0;
    var qColor = q.downgraded ? '#e74c3c' : qPct >= 80 ? '#f39c12' : 'var(--accent)';
    var head = q.downgraded
      ? '<span style="color:#e74c3c;font-weight:700">Cupo premium agotado</span> — tu asistente suena en Estándar hasta fin de mes'
      : 'Te quedan <strong style="color:var(--green2)">' + qRem + ' min</strong> de voz premium este mes';
    quotaLine =
      '<div style="background:var(--card2);border-radius:8px;padding:10px 12px;margin-bottom:12px">' +
        '<div style="font-size:12px;color:var(--text);margin-bottom:7px">✨ ' + head + '</div>' +
        '<div style="background:var(--bg);border-radius:6px;height:8px;overflow:hidden;margin-bottom:5px">' +
          '<div style="height:100%;width:' + qPct + '%;background:' + qColor + ';border-radius:6px;transition:width .4s"></div></div>' +
        '<div style="font-size:11px;color:var(--dim)">' + qUsed + ' / ' + qTot + ' min usados' +
          (q.hasAddon ? ' · complemento Voz Premium activo' : '') +
          (q.extraMinutes > 0 ? ' · +' + q.extraMinutes + ' min comprados' : '') + '</div>' +
      '</div>';
  }
  openModal(
    '<div style="font-size:16px;font-weight:800;margin-bottom:4px">🎚️ Modelos de voz</div>' +
    '<div style="font-size:12px;color:var(--dim);margin-bottom:14px">Elige cómo suena tu asistente. Puedes probarlas todas en la demo o en Asistente.</div>' +
    curLine +
    quotaLine +
    cards +
    '<div style="font-size:11px;color:var(--dim);margin:8px 0 12px">¿Se te acaban los minutos de voz premium? Cómpralos en <a onclick="closeModal();navigate(\'facturacion\')" style="color:var(--accent-l);cursor:pointer;text-decoration:underline">Facturación</a> (packs desde 5€).</div>' +
    '<div style="text-align:right"><button class="btn btn-d" onclick="closeModal()">Cerrar</button></div>'
  );
}

async function loadDashboard() {
  var sec = document.getElementById('sec-dashboard');
  sec.innerHTML = skeletonDashboard();
  var d;
  try {
    d = await api('/api/portal/dashboard');
  } catch (e) {
    sec.innerHTML = emptyState('⚠️', 'No se pudo cargar', esc(e.message));
    return;
  }

  // Contadores accionables + consumo de minutos (en paralelo, tolerante a fallos).
  // Timeout CORTO (6s): son secundarios; si la BD va lenta, el dashboard se
  // pinta igual y el panel que falta sale a 0 en vez de congelar todo.
  var act = { opps: 0, tasks: 0, wait: 0, unanswered: 0 };
  var usage = null, cal = null, asisMode = 'citas', atRisk = [];
  try {
    var r = await Promise.all([
      api('/api/portal/missed-opportunities', null, null, 6000).catch(function () { return {}; }),
      api('/api/portal/tasks', null, null, 6000).catch(function () { return {}; }),
      api('/api/portal/waitlist', null, null, 6000).catch(function () { return {}; }),
      api('/api/portal/knowledge/unanswered', null, null, 6000).catch(function () { return {}; }),
      api('/api/billing/usage', null, null, 6000).catch(function () { return null; }),
      api('/api/calendar/status', null, null, 6000).catch(function () { return null; }),
      api('/api/portal/assistant', null, null, 6000).catch(function () { return null; }),
      api('/api/portal/at-risk-tomorrow', null, null, 6000).catch(function () { return {}; }),
    ]);
    act.opps  = (r[0].opportunities || []).length;
    // Contador UNIFICADO: tareas manuales abiertas + sugerencias no descartadas
    // (una sola cifra en el dashboard, el nav y el briefing).
    act.tasks = (r[1].manual || r[1].tasks || []).filter(function (t) { return !t.done; }).length
              + (r[1].suggested || []).length;
    act.wait  = (r[2].waitlist || []).filter(function (w) { return w.status === 'waiting'; }).length;
    var dismissed = _kbDismissedSet();
    act.unanswered = (r[3].questions || []).filter(function (x) { return !dismissed.has(_kbQKey(x.question)); }).length;
    usage = r[4];
    cal = r[5];
    asisMode = (r[6] && r[6].config && r[6].config.mode) || 'citas';
    atRisk = (r[7] && r[7].atRisk) || [];
  } catch (e) {}

  sec.innerHTML =
    dashHero(d) +
    '<div id="dash-briefing" style="margin:0 0 14px"></div>' +
    '<div id="dash-roi" style="margin:0 0 14px"></div>' +
    dashMinutes(usage) +
    dashSetup(d) +
    dashCalendarNudge(cal, asisMode) +
    dashAtRisk(atRisk) +
    dashRecos(act) +
    dashContinue() +
    dashQuick(act) +
    '<div class="two-col nf-stagger">' + dashUpcoming(d) + dashFeed(d.recentActivity) + '</div>' +
    referralCta('dashboard');

  startDashLive();
  loadMorningBriefing();       // ☀️ briefing matinal — lo primero que se ve
  loadFollowupRoi('dash-roi'); // 💶 lo que el motor ha traído — en la primera pantalla
}

// ── Briefing matinal accionable: el dashboard saluda y propone ───────────
// v0 del "dashboard = cerebro del negocio": resume AYER y lista lo accionable
// de HOY, cada línea clicable hacia la sección que lo resuelve. Carga NO
// bloqueante (mismo patrón que loadFollowupRoi, timeout 6s): si la BD va
// lenta, el dashboard ya está pintado y la tarjeta aparece cuando llega.
async function loadMorningBriefing() {
  var box = document.getElementById('dash-briefing');
  if (!box) return;
  var b;
  try { b = await api('/api/portal/briefing', null, null, 6000); }
  catch (e) { box.innerHTML = ''; return; }
  if (!b || !b.ok) { box.innerHTML = ''; return; }

  var head =
    '<div style="font-size:17px;font-weight:800;color:var(--text);line-height:1.3">' +
      esc(b.greeting) + (b.greetingName ? ', ' + esc(b.greetingName) : '') + ' 👋' +
    '</div>' +
    (b.summary ? '<div style="font-size:12.5px;color:var(--dim);margin-top:3px">' + esc(b.summary) + '</div>' : '');

  var body;
  if (b.allClear) {
    // Nunca caja vacía: una línea serena y a otra cosa.
    body = '<div style="font-size:13px;color:var(--dim);margin-top:10px">✅ ' +
      esc(b.allClearText || 'Todo al día. Tu asistente sigue de guardia 24/7.') + '</div>';
  } else {
    body = (b.lines || []).map(function (l) {
      var nav = 'navigate(\'' + esc(l.section) + '\')';
      return '<div role="button" tabindex="0" onclick="' + nav + '" ' +
        'onkeydown="if(event.key===\'Enter\')' + nav + '" ' +
        'onmouseover="this.style.borderColor=\'var(--accent-l)\'" onmouseout="this.style.borderColor=\'var(--border)\'" ' +
        'style="display:flex;align-items:center;gap:10px;padding:9px 12px;margin-top:8px;background:var(--bg);border:1px solid var(--border);border-radius:10px;cursor:pointer;transition:border-color .15s">' +
        '<span style="font-size:16px;line-height:1">' + l.icon + '</span>' +
        '<span style="flex:1;min-width:0;font-size:13px;color:var(--text)">' + esc(l.text) + '</span>' +
        '<span style="color:var(--accent-l);font-weight:800">→</span>' +
      '</div>';
    }).join('');
  }

  box.innerHTML =
    '<div class="card" style="border-color:rgba(196,245,70,.35);background:rgba(196,245,70,.04)">' +
      head + body +
    '</div>';
}

// ── Notificaciones de llamadas (v1: sondeo cada 30s) ─────────────────────
// Feedback real 2026-07-03: "cuando entre una llamada, quiero que me salte
// en pantalla". v1 con Notification API + sondeo; v2 (tiempo real por SSE)
// en el sprint de portal.
var _notifPoll = null;
function notificationsEnabled() {
  return typeof Notification !== 'undefined' &&
         Notification.permission === 'granted' &&
         localStorage.getItem('nf_notif') === '1';
}
async function toggleCallNotifications(btn) {
  if (typeof Notification === 'undefined') { toast('Tu navegador no soporta notificaciones', 'err'); return; }
  if (Notification.permission !== 'granted') {
    var p = await Notification.requestPermission();
    if (p !== 'granted') { toast('Permiso de notificaciones denegado', 'err'); return; }
  }
  var on = localStorage.getItem('nf_notif') === '1';
  localStorage.setItem('nf_notif', on ? '0' : '1');
  toast(on ? 'Notificaciones desactivadas' : '🔔 Te avisaremos en pantalla de cada llamada');
  if (btn) btn.textContent = on ? '🔕 Avisos' : '🔔 Avisos';
  startCallNotifications();
}
function startCallNotifications() {
  clearInterval(_notifPoll);
  if (!notificationsEnabled()) return;
  _notifPoll = setInterval(async function () {
    try {
      var d = await api('/api/portal/calls?limit=1');
      var c = d.calls && d.calls[0];
      if (!c) return;
      var last = localStorage.getItem('nf_last_call_notif');
      localStorage.setItem('nf_last_call_notif', c.callId);
      if (!last || c.callId === last) return;
      var quien  = c.contactName || c.callerNumber || 'Número oculto';
      var titulo = c.outcome === 'booked' ? '📅 Nueva reserva por teléfono' : '📞 Llamada atendida por tu asistente';
      var cuerpo = quien + (c.appointment ? ' · ' + c.appointment.service + ' · ' + fmtDate(c.appointment.date) + ' ' + c.appointment.time : '');
      new Notification(titulo, { body: cuerpo, icon: '/favicon.svg' });
    } catch (e) { /* siguiente tick */ }
  }, 30000);
}

// ── Llamadas ──────────────────────────────────────────────────
async function loadCalls(outcome, from, to) {
  var sec = document.getElementById('sec-llamadas');
  sec.innerHTML = skelPanel();

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
      // Detalles EN LENGUAJE DE DUEÑO: qué se reservó, no "N turnos"
      // (feedback real 2026-07-03: "no entiendo esto de los 9 turnos").
      var aptList = (c.appointments && c.appointments.length) ? c.appointments : (c.appointment ? [c.appointment] : []);
      var detalle = '';
      for (var k = 0; k < aptList.length; k++) {
        var ap = aptList[k];
        detalle += '<div>📅 ' + esc(fmtDate(ap.date)) + ' · ' + esc(ap.time) + ' · ' + esc(ap.service) + '</div>';
      }
      if (!detalle) {
        detalle = '<div class="u-dim">' +
          (c.outcome === 'info' ? 'Consulta atendida sin reserva'
            : c.turnCount > 0 ? 'Conversación sin reserva' : 'Colgó sin hablar') + '</div>';
      }
      detalle += '<small class="u-muted">' + c.turnCount + ' intercambios</small>';
      // Contacto: nombre enlazado a su ficha si el cliente está fichado
      var contacto = c.contactId
        ? '<a href="#" onclick="openContactProfile(\'' + esc(c.contactId) + '\');return false" class="u-accent u-no-underline" style="font-weight:600">' + esc(c.contactName || 'Ver ficha') + '</a>' +
          (c.callerNumber ? '<div class="u-text-sm u-dim">' + esc(c.callerNumber) + '</div>' : '')
        : (c.callerNumber ? '<div class="u-text-sm">' + esc(c.callerNumber) + '</div>' : '—');
      var waNum   = c.callerNumber ? c.callerNumber.replace(/[^0-9]/g,'') : '';
      var callBtn = c.callerNumber
        ? '<button class="btn btn-g btn-sm" onclick="callOutbound(\'' + esc(c.callerNumber) + '\',this)" title="Llamar">📞</button>' +
          '<a class="btn btn-sm btn-wa u-no-underline" href="https://wa.me/' + waNum + '" target="_blank" title="WhatsApp">💬</a>'
        : '<span class="u-muted">—</span>';
      rows += '<tr><td>' + timeAgo(c.startedAt) + '</td><td>' + dur + '</td><td>' + badge + '</td>' +
        '<td>' + detalle + '</td>' +
        '<td class="u-dim">' + contacto + '</td>' +
        '<td><button class="btn btn-d btn-sm" onclick="openTranscriptModal(\'' + esc(c.callId || '') + '\')">💬</button></td>' +
        '<td>' + callBtn + '</td></tr>';
    }
  } else {
    rows = '<tr class="empty-row"><td colspan="7">No hay llamadas con estos filtros</td></tr>';
  }

  sec.innerHTML =
    '<div class="section-header"><div class="kicker">Actividad</div><div class="section-title">Llamadas</div>' +
      '<button class="btn btn-d btn-sm" onclick="toggleCallNotifications(this)" title="Avisarme en pantalla de cada llamada">' + (notificationsEnabled() ? '🔔 Avisos' : '🔕 Avisos') + '</button>' +
    '</div>' +
    '<div class="filter-bar">' +
      '<label class="u-text-sm u-dim">Resultado:</label>' +
      '<select id="fOutcome" onchange="loadCalls(this.value,document.getElementById(\'fFrom\').value,document.getElementById(\'fTo\').value)">' +
        '<option value="todas">Todas</option>' +
        '<option value="booked">Reserva</option>' +
        '<option value="info">Informativas</option>' +
        '<option value="abandoned">Abandonadas</option>' +
      '</select>' +
      '<label class="u-text-sm u-dim">Desde:</label>' +
      '<input type="date" id="fFrom" onchange="loadCalls(document.getElementById(\'fOutcome\').value,this.value,document.getElementById(\'fTo\').value)">' +
      '<label class="u-text-sm u-dim">Hasta:</label>' +
      '<input type="date" id="fTo" onchange="loadCalls(document.getElementById(\'fOutcome\').value,document.getElementById(\'fFrom\').value,this.value)">' +
      '<button class="btn btn-d btn-sm" onclick="loadCalls()">Limpiar</button>' +
    '</div>' +
    '<div class="table-wrap"><table>' +
      '<thead><tr><th>Cuándo</th><th>Duración</th><th>Resultado</th><th>Detalles</th><th>Contacto</th><th>Transcript</th><th>Acciones</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>' +
    '<div class="u-text-sm u-dim u-mt-3">Total: ' + (data.count || 0) + ' llamadas</div>';

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
var _citasView = localStorage.getItem('nf_citas_view') || 'semana';
var _citasWeekOffset = 0;
var _citasAutoJumped = false;

// Nueva cita con la fecha del día clicado en la vista semana
function openNewCitaOn(dateIso) {
  openNewCita();
  var el = document.getElementById('mDate');
  if (el && dateIso) el.value = dateIso;
  var name = document.getElementById('mPatientName');
  if (name) name.focus();
}

function setCitasView(v) {
  _citasView = v;
  try { localStorage.setItem('nf_citas_view', v); } catch (e) {}
  renderCitas();
}

// Lunes de la semana actual + desplazamiento en semanas
function _mondayOf(offsetWeeks) {
  var d = new Date();
  var dow = (d.getDay() + 6) % 7; // 0 = lunes
  d.setDate(d.getDate() - dow + offsetWeeks * 7);
  return d;
}

// Vista semanal: 7 columnas, citas como tarjetas clicables
function citasWeekHtml(filtered, today) {
  var mon = _mondayOf(_citasWeekOffset);
  var names = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  var byDate = {};
  filtered.forEach(function (a) { (byDate[a.date] = byDate[a.date] || []).push(a); });

  var cols = '';
  for (var i = 0; i < 7; i++) {
    var dd = new Date(mon); dd.setDate(mon.getDate() + i);
    var iso = dd.toLocaleDateString('sv-SE');
    var apts = (byDate[iso] || []).sort(function (x, y) { return (x.time || '').localeCompare(y.time || ''); });
    var cards = '';
    for (var j = 0; j < apts.length; j++) {
      var a = apts[j];
      var cls = a.status === 'cancelled' ? ' cancelled' : a.status === 'pending' ? ' pending' : '';
      cards += '<div class="nf-apt' + cls + '" onclick="openEditCita(\'' + esc(a.id) + '\')" role="button" tabindex="0" ' +
        'onkeydown="if(event.key===\'Enter\')openEditCita(\'' + esc(a.id) + '\')">' +
        '<div class="nf-apt-time">' + esc(a.time || '') + '</div>' +
        '<div class="nf-apt-name">' + esc(a.patientName) + '</div>' +
        '<div class="nf-apt-svc">' + esc(a.service || '') + '</div></div>';
    }
    cols += '<div class="nf-week-day' + (iso === today ? ' today' : '') + '">' +
      '<div class="nf-week-head"><span>' + names[i] + '</span>' +
        '<span style="display:inline-flex;align-items:center;gap:4px">' +
          '<button class="nf-week-add" onclick="openNewCitaOn(\'' + iso + '\')" aria-label="Nueva cita el ' + names[i] + ' ' + dd.getDate() + '" data-tip="Nueva cita">+</button>' +
          '<span class="num">' + dd.getDate() + '</span></span></div>' +
      (cards || '<button class="nf-week-empty-add" onclick="openNewCitaOn(\'' + iso + '\')">+ cita</button>') + '</div>';
  }

  var monthLbl = mon.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
  var weekLbl = _citasWeekOffset === 0 ? 'Esta semana'
              : _citasWeekOffset === 1 ? 'Próxima semana'
              : _citasWeekOffset === -1 ? 'Semana pasada'
              : (_citasWeekOffset > 0 ? '+' : '') + _citasWeekOffset + ' semanas';

  return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;flex-wrap:wrap">' +
    '<button class="btn btn-d btn-sm" onclick="_citasWeekOffset--;renderCitas()" aria-label="Semana anterior">‹</button>' +
    '<button class="btn btn-d btn-sm" onclick="_citasWeekOffset++;renderCitas()" aria-label="Semana siguiente">›</button>' +
    (_citasWeekOffset !== 0 ? '<button class="btn btn-d btn-sm" onclick="_citasWeekOffset=0;renderCitas()">Hoy</button>' : '') +
    '<span style="font-size:13px;font-weight:700;color:var(--white)">' + weekLbl + '</span>' +
    '<span style="font-size:12px;color:var(--dim);text-transform:capitalize">· ' + monthLbl + '</span></div>' +
    '<div class="nf-week-scroll"><div class="nf-week nf-stagger">' + cols + '</div></div>';
}

async function loadCitas(statusFilter, search) {
  _citasFilterStatus = statusFilter || _citasFilterStatus || 'todas';
  _citasSearch       = (search !== undefined) ? search : (_citasSearch || '');

  var sec = document.getElementById('sec-citas');
  if (!_citasData.length) {
    sec.innerHTML = skelPanel();
  }

  try {
    var data = await api('/api/portal/appointments');
    _citasData = data.appointments || [];
  } catch (e) {
    sec.innerHTML = '<div class="empty-state"><div>Error: ' + esc(e.message) + '</div></div>';
    return;
  }

  // Salto automático a la semana con citas: la vista abría siempre en la
  // semana actual aunque todas las citas fueran de la siguiente y había que
  // descubrirlas con la flechita (feedback real 2026-07-03). Solo al entrar
  // por primera vez — la navegación manual del dueño siempre gana.
  if (!_citasAutoJumped) {
    _citasAutoJumped = true;
    var hoy = new Date().toLocaleDateString('sv-SE');
    var prox = _citasData
      .filter(function(a) { return a.date >= hoy && a.status !== 'cancelled'; })
      .sort(function(a, b) { return a.date.localeCompare(b.date); });
    if (prox.length) {
      var mon0 = _mondayOf(0); mon0.setHours(0, 0, 0, 0);
      var diffDays = Math.round((new Date(prox[0].date + 'T00:00:00') - mon0) / 86400000);
      var off = Math.floor(diffDays / 7);
      if (off > 0) _citasWeekOffset = off;
    }
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

  // ── Orden cronológico + agrupación por día (próximas arriba, pasadas al final) ──
  var tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  var tomorrowStr = tomorrow.toLocaleDateString('sv-SE');
  var dayLabel = function(d) {
    if (d === today) return 'Hoy';
    if (d === tomorrowStr) return 'Mañana';
    return fmtDate(d);
  };
  var keyOf = function(a) { return a.date + ' ' + (a.time || ''); };
  var upcoming = filtered.filter(function(a) { return a.date >= today; })
                         .sort(function(a, b) { return keyOf(a).localeCompare(keyOf(b)); });
  var past     = filtered.filter(function(a) { return a.date < today; })
                         .sort(function(a, b) { return keyOf(b).localeCompare(keyOf(a)); });

  var apptRow = function(a) {
    var isToday  = a.date === today;
    var badge    = STATUS_BADGE[a.status] || STATUS_BADGE.pending;
    var safeId   = esc(a.id);
    var safeName = esc(a.patientName).replace(/'/g, "\\'");
    var actions  = a.status !== 'cancelled'
      ? '<button class="btn btn-d btn-sm" onclick="openEditCita(\'' + safeId + '\')">✏️</button> ' +
        '<button class="btn btn-r btn-sm" onclick="cancelCitaConfirm(\'' + safeId + '\',\'' + safeName + '\')">✕</button>'
      : '';
    return '<tr' + (isToday ? ' style="background:rgba(196,245,70,0.08)"' : '') + '>' +
      '<td><strong>' + esc(a.time) + '</strong></td>' +
      '<td>' + esc(a.patientName) + '</td>' +
      '<td>' + esc(a.phone || '—') + '</td>' +
      '<td>' + esc(a.service) + (a.notes ? '<div style="font-size:11px;color:var(--dim);margin-top:2px">📝 ' + esc(a.notes) + '</div>' : '') + '</td>' +
      '<td>' + badge + '</td>' +
      '<td style="white-space:nowrap">' + actions + '</td></tr>';
  };
  var dayHeader = function(label, muted) {
    return '<tr><td colspan="6" style="background:' + (muted ? 'rgba(255,255,255,.02)' : 'var(--card2)') +
      ';font-weight:800;font-size:12px;color:' + (muted ? 'var(--dim)' : 'var(--accent-l)') +
      ';padding:8px 14px;text-transform:capitalize">' + label + '</td></tr>';
  };

  var rows = '';
  if (upcoming.length || past.length) {
    var lastDay = null;
    upcoming.forEach(function(a) {
      if (a.date !== lastDay) { rows += dayHeader(dayLabel(a.date)); lastDay = a.date; }
      rows += apptRow(a);
    });
    if (past.length) {
      rows += '<tr><td colspan="6" style="background:rgba(255,255,255,.02);font-weight:700;font-size:11px;color:var(--dim);padding:8px 14px;text-transform:uppercase;letter-spacing:.06em">Pasadas</td></tr>';
      var lastPast = null;
      past.forEach(function(a) {
        if (a.date !== lastPast) { rows += dayHeader(dayLabel(a.date), true); lastPast = a.date; }
        rows += apptRow(a);
      });
    }
  } else {
    rows = '<tr class="empty-row"><td colspan="6">' + (_citasSearch || _citasFilterStatus !== 'todas' ? 'Sin resultados con este filtro' : 'No hay citas registradas') + '</td></tr>';
  }

  var viewHtml = _citasView === 'semana'
    ? citasWeekHtml(filtered, today)
    : '<div class="table-wrap"><table>' +
        '<thead><tr><th>Hora</th><th>Cliente</th><th>Teléfono</th><th>Servicio</th><th>Estado</th><th>Acciones</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table></div>';

  sec.innerHTML =
    '<div class="section-header">' +
      '<div class="kicker">Actividad</div><div class="section-title">Citas</div>' +
      '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">' +
        '<div class="tabs">' +
          '<button class="tab-btn' + (_citasView === 'semana' ? ' active' : '') + '" onclick="setCitasView(\'semana\')">Semana</button>' +
          '<button class="tab-btn' + (_citasView === 'lista' ? ' active' : '') + '" onclick="setCitasView(\'lista\')">Lista</button>' +
        '</div>' +
        '<button class="btn btn-accent" onclick="openNewCita()">+ Nueva cita</button>' +
      '</div>' +
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
    viewHtml +
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
  sec.innerHTML = skelPanel();

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
      '<div class="kicker">Crecimiento</div><div class="section-title">Informes</div>' +
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
// Etiquetas en español de los tipos de fecha crítica (slug → texto)
var CRIT_TYPE_LABELS = {
  itv_expiry: 'ITV (vehículo)', vaccine_due: 'Vacuna / recordatorio sanitario',
  tax_filing: 'Declaración de impuestos', quarterly_vat: 'IVA trimestral',
  insurance_renewal: 'Renovación de seguro', license_renewal: 'Renovación de licencia',
  contract_renewal: 'Renovación de contrato', pregnancy_due: 'Fecha prevista de parto',
  treatment_cycle: 'Ciclo de tratamiento', follow_up: 'Seguimiento / revisión',
  birthday: 'Cumpleaños', annual_review: 'Revisión anual',
  mortgage_payment: 'Pago de hipoteca', warranty_expiry: 'Fin de garantía',
  subscription_renewal: 'Renovación de suscripción', other: 'Otro',
};
function critTypeLabel(t) { return CRIT_TYPE_LABELS[t] || (t ? String(t).replace(/_/g, ' ') : '—'); }

async function loadAutomatizaciones() {
  var sec = document.getElementById('sec-automatizaciones');
  sec.innerHTML = skelPanel();

  // Resiliencia por bloque: si un sub-servicio falla (p.ej. fechas críticas
  // sin configurar), la sección NUNCA muere entera — el resto se pinta y el
  // bloque roto muestra un aviso suave. Bug real 2026-07-03: la sección
  // Automatizaciones quedaba en negro con el error crudo a pantalla completa.
  // La tarjeta "avisos por llamada" solo aparece si la org tiene fichas
  // (entidades) — sin fichas no hay fechas que llamar.
  if (!_entTypes) { try { await initEntidades(); } catch (e) {} }

  var autoData, critData, critError = null;
  try {
    autoData = await api('/api/portal/automations');
  } catch (e) {
    sec.innerHTML = '<div class="empty-state"><div>Error: ' + esc(e.message) + '</div></div>';
    return;
  }
  try {
    critData = await api('/api/critical-dates/' + _orgInfo.id);
  } catch (e) {
    critError = e.message || 'no disponible';
    critData = { entries: [] };
  }

  var auto = autoData.automations || {};
  var rem  = auto.reminders || {};
  var rev  = auto.reviews   || {};
  var reb  = auto.rebooking || {};

  // 📞 LA ENTIDAD LLAMA — opt-in (defecto OFF, al contrario que el resto):
  // solo si la org tiene fichas. Nota honesta: las salientes consumen minutos.
  var entCallCard = '';
  if (_entTypes && _entTypes.length) {
    var entOn = !!(auto.entityCalls && auto.entityCalls.enabled);
    entCallCard =
      '<div class="auto-card"><div class="auto-row"><div>' +
        '<div class="auto-name">📞 Avisos por llamada</div>' +
        '<div class="auto-desc">Cuando a una ficha le llega una fecha importante (ITV, vacuna, renovación…), la asistente llama al cliente, le ofrece tu servicio y le reserva la cita en la misma llamada</div>' +
      '</div><label class="toggle"><input type="checkbox" id="togEntityCalls" ' + (entOn ? 'checked' : '') +
        ' onchange="patchAuto(\'entityCalls\',{enabled:this.checked})"><span class="slider"></span></label></div>' +
      '<div class="u-text-xs u-dim u-mt-2">Las llamadas salientes consumen minutos de tu plan. El aviso por WhatsApp sigue saliendo igual.</div></div>';

    // 📤 LA FICHA COMUNICA — auto-envío del resumen al crear ficha (defecto OFF)
    var sumOn = !!(auto.entitySummaryOnCreate && auto.entitySummaryOnCreate.enabled);
    entCallCard +=
      '<div class="auto-card"><div class="auto-row"><div>' +
        '<div class="auto-name">📤 Resumen al crear ficha</div>' +
        '<div class="auto-desc">Al crear una ficha con cliente vinculado, se le envía un resumen humano por WhatsApp (bono, próxima cita, renovación…) para que lo tenga a mano</div>' +
      '</div><label class="toggle"><input type="checkbox" id="togEntitySummary" ' + (sumOn ? 'checked' : '') +
        ' onchange="patchAuto(\'entitySummaryOnCreate\',{enabled:this.checked})"><span class="slider"></span></label></div>' +
      '<div class="u-text-xs u-dim u-mt-2">Consume 1 mensaje del paquete por ficha. También puedes enviarlo a mano desde cada ficha. Respeta si el cliente pidió no recibir avisos.</div></div>';
  }

  var critRows = '';
  if (critData.entries && critData.entries.length > 0) {
    for (var i = 0; i < critData.entries.length; i++) {
      var e = critData.entries[i];
      var days = Math.ceil((new Date(e.dueDate) - new Date()) / 86400000);
      var urgClass = days <= 7 ? 'br' : days <= 15 ? 'by' : 'bp';
      var daysText = days > 0 ? 'en ' + days + 'd' : days === 0 ? 'hoy' : 'hace ' + (-days) + 'd';
      critRows += '<div class="crit-item">' +
        '<div><div class="crit-name">' + esc(e.clientName) + '</div>' +
          '<div class="crit-meta"><span class="badge ' + urgClass + '">' + esc(critTypeLabel(e.type)) + '</span>' + (e.notes ? ' · ' + esc(e.notes) : '') + '</div></div>' +
        '<div><div class="crit-date">' + fmtDate(e.dueDate) + '</div><div class="crit-days">' + daysText + '</div></div>' +
        '<button class="btn btn-r btn-sm" onclick="deleteCritDate(\'' + esc(e.id) + '\')">✕</button>' +
        '</div>';
    }
  } else if (critError) {
    critRows = '<div class="empty-state" style="padding:24px"><div class="empty-state-text">Los recordatorios de fechas no están disponibles ahora mismo. El resto de automatizaciones funciona con normalidad.</div></div>';
  } else {
    critRows = '<div class="empty-state" style="padding:24px"><div class="empty-state-text">No hay fechas críticas activas</div></div>';
  }

  sec.innerHTML =
    '<div class="section-header"><div class="kicker">Tu asistente</div><div class="section-title">Automatizaciones</div></div>' +
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
      // Confirmación por WhatsApp card
      '<div class="auto-card"><div class="auto-row"><div>' +
        '<div class="auto-name">📲 Confirmación por WhatsApp</div>' +
        '<div class="auto-desc">Al agendar una cita, el cliente recibe la confirmación por WhatsApp</div>' +
      '</div><label class="toggle"><input type="checkbox" id="togWaConfirm" ' + ((auto.waConfirm && auto.waConfirm.enabled !== false) ? 'checked' : '') +
        ' onchange="patchAuto(\'waConfirm\',{enabled:this.checked})"><span class="slider"></span></label></div></div>' +

      // Reactivación (rebooking) card
      '<div class="auto-card"><div class="auto-row"><div>' +
        '<div class="auto-name">🔄 Reactivación de clientes</div>' +
        '<div class="auto-desc">Cuando un cliente lleva tiempo sin venir, le recuerdas por email o el asistente le llama para invitarle a volver</div>' +
      '</div><label class="toggle"><input type="checkbox" id="togRebooking" ' + (reb.enabled !== false ? 'checked' : '') +
        ' onchange="patchAuto(\'rebooking\',{enabled:this.checked})"><span class="slider"></span></label></div>' +
      '<div class="auto-footer"><span class="auto-label">Días sin venir:</span><div class="auto-hours">' +
        '<input type="number" id="daysRebooking" value="' + (reb.daysThreshold || nfReactivationDays() || 42) + '" min="7" max="365"' +
        ' onchange="patchAuto(\'rebooking\',{daysThreshold:parseInt(this.value)})"></div></div>' +
      '<div class="auto-footer"><span class="auto-label">Cómo avisar:</span>' +
        '<select id="chanRebooking" class="form-ctrl" style="width:auto" onchange="patchAuto(\'rebooking\',{channel:this.value})">' +
          '<option value="email"' + ((reb.channel || 'email') === 'email' ? ' selected' : '') + '>✉️ Email</option>' +
          '<option value="voice"' + (reb.channel === 'voice' ? ' selected' : '') + '>📞 El asistente le llama</option>' +
          '<option value="whatsapp"' + (reb.channel === 'whatsapp' ? ' selected' : '') + '>💬 WhatsApp</option>' +
        '</select></div>' +
      (nfReactivationDays() ? '<div class="u-text-xs u-dim u-mt-2">Recomendado para tu sector: <strong class="u-text">' + nfReactivationDays() + ' días</strong>. La reactivación (email o voz) es del add-on Crecimiento.</div>' : '<div class="u-text-xs u-dim u-mt-2">La reactivación (email o voz) es del add-on Crecimiento.</div>') +
      '</div>' +
      // Recuperación de no-shows card
      '<div class="auto-card"><div class="auto-row"><div>' +
        '<div class="auto-name">🔁 Recuperación de no-shows</div>' +
        '<div class="auto-desc">Si un cliente falta a su cita, la IA le escribe automáticamente para reagendar</div>' +
      '</div><label class="toggle"><input type="checkbox" id="togNoshow" ' + ((auto.noshow && auto.noshow.enabled !== false) ? 'checked' : '') +
        ' onchange="patchAuto(\'noshow\',{enabled:this.checked})"><span class="slider"></span></label></div></div>' +
      entCallCard +
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
    return '<option value="' + t + '">' + critTypeLabel(t) + '</option>';
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
// Lista de sectores (semilla + custom aprobados) desde /api/sectors — FUENTE
// ÚNICA. Fallback mínimo para que el primer render nunca falle; tras cargar se
// repuebla el desplegable. Añadir un sector nuevo aparece aquí sin tocar el front.
var _sectorsCache = null;
var _SECTOR_FALLBACK = [
  { slug: 'generico', label: 'Genérico' }, { slug: 'restaurante', label: 'Restaurante' },
  { slug: 'dental', label: 'Clínica dental' }, { slug: 'clinica', label: 'Clínica médica' },
  { slug: 'peluqueria', label: 'Peluquería' }, { slug: 'taller', label: 'Taller mecánico' },
  { slug: 'otro', label: 'Otro' },
];
function sectorOptionsHtml(selected) {
  var list = _sectorsCache || _SECTOR_FALLBACK;
  return list.map(function (s) {
    return '<option value="' + s.slug + '"' + (selected === s.slug ? ' selected' : '') + '>' + esc(s.label || s.slug) + '</option>';
  }).join('');
}
function _ensureSectors(cb) {
  if (_sectorsCache) { if (cb) cb(); return; }
  fetch('/api/sectors').then(function (r) { return r.json(); }).then(function (d) {
    var arr = (d && d.sectors) || [];
    _sectorsCache = [{ slug: 'generico', label: 'Genérico' }].concat(arr).concat([{ slug: 'otro', label: 'Otro' }]);
    if (cb) cb();
  }).catch(function () { if (cb) cb(); });
}

async function loadConfig() {
  var sec = document.getElementById('sec-configuracion');
  sec.innerHTML = skelPanel();

  var data;
  try {
    data = await api('/api/portal/config');
  } catch (e) {
    sec.innerHTML = '<div class="empty-state"><div>Error: ' + esc(e.message) + '</div></div>';
    return;
  }

  var c = data.config || {};
  var hasPassword = !!data.hasPassword;
  // Sectores desde /api/sectors (fuente única). Primer paint con fallback; tras
  // cargar, se repuebla el <select> — así los sectores nuevos aparecen sin deploy.
  var sectorOpts = sectorOptionsHtml(c.sector);
  _ensureSectors(function () {
    var el = document.getElementById('cfgSector');
    if (el) el.innerHTML = sectorOptionsHtml(c.sector);
  });

  sec.innerHTML =
    '<div class="section-header"><div class="kicker">Cuenta</div><div class="section-title">Configuración</div></div>' +
    '<div class="card u-mx-auto u-maxw-form">' +
      '<div class="form-section-title">Información general</div>' +
      '<div class="form-row">' +
        '<div class="form-group"><label class="form-label">Nombre del negocio</label>' +
          '<input class="form-input" id="cfgName" value="' + esc(c.name || '') + '"></div>' +
        '<div class="form-group"><label class="form-label">Email del propietario</label>' +
          '<input class="form-input" readonly value="' + esc(c.ownerEmail || '') + '">' +
          '<small class="form-hint">Para cambiar el email, contacta con soporte</small></div>' +
      '</div>' +
      '<div class="form-row">' +
        '<div class="form-group"><label class="form-label">Teléfono del negocio</label>' +
          '<input class="form-input" readonly value="' + esc(c.phone || '—') + '">' +
          '<small class="form-hint">Número provisionado — no editable</small></div>' +
        '<div class="form-group"><label class="form-label">Idioma de la IA</label>' +
          '<div class="u-text-sm u-dim u-py-2" style="line-height:1.5">Se configura en <a onclick="navigate(\'asistente\')" class="u-link">Asistente</a> para no tenerlo en dos sitios. Actual: <strong class="u-text">' + ({ es: 'Castellano', eu: 'Euskera', gl: 'Galego', 'es+eu': 'Castellano + Euskera', 'es+gl': 'Castellano + Galego' }[c.language] || 'Castellano') + '</strong>.</div></div>' +
      '</div>' +
      '<div class="form-group"><label class="form-label">Sector</label>' +
        '<select class="form-input" id="cfgSector">' + sectorOpts + '</select></div>' +
      '<div class="form-section-title">Servicios y horarios</div>' +
      '<div class="form-group"><label class="form-label">Servicios y precios <span class="u-normal">— la IA se los dice a tus clientes con exactitud</span></label>' +
        '<div id="svcGaps"></div>' +
        '<div class="svc-head"><span>Servicio</span><span>Precio</span><span>Duración</span><span>Detalle (opcional)</span><span></span></div>' +
        '<div id="svcList"></div>' +
        '<datalist id="svcPriceOpts"><option value="a presupuesto"><option value="gratis"><option value="desde 30€"></datalist>' +
        '<button type="button" class="btn btn-d btn-sm u-mt-2" onclick="addServiceRow()">+ Añadir servicio</button>' +
        '<small class="form-hint">El precio también puede ser texto — <em>«a presupuesto»</em>, <em>«desde 30€»</em>, <em>«gratis»</em> — y la IA lo dirá tal cual. Si es a presupuesto, ofrecerá que le llaméis para presupuestar.</small>' +
        copilotBox('services', 'Ej: corte de pelo 15 euros media hora, tinte 45 hora y media, mechas a presupuesto') + '</div>' +
      // #7: el textarea libre de horarios era un campo MUERTO (custom.schedule
      // no lo leía nada del runtime) — el horario real es el selector por días
      // de Asistente (assistant_config.schedule), que alimenta agenda y prompt.
      '<div class="form-group"><label class="form-label">Horarios</label>' +
        '<div class="callout callout--accent">' +
          '<div class="u-flex-1" style="min-width:200px">Se configuran con el <strong class="u-white">selector por días</strong> (mañana y tarde, hora a hora) — la agenda y la IA usan exactamente lo mismo, sin formatos que adivinar.</div>' +
          '<button type="button" class="btn btn-accent btn-sm u-nowrap" onclick="navigate(\'asistente\')">Configurar horarios →</button>' +
        '</div></div>' +
      '<div class="form-section-title">Configuración de la IA</div>' +
      '<div class="form-group"><label class="form-label">Mensaje de bienvenida</label>' +
        '<textarea class="form-input" id="cfgWelcome" rows="3" placeholder="Hola, has llamado a…">' + esc(c.welcomeMessage || '') + '</textarea>' +
        // Campo COMPARTIDO con Asistente → Básico (mismo almacén: es lo que
        // suena al descolgar). Antes cada pantalla guardaba en un sitio
        // distinto y el saludo nuevo nunca llegaba a las llamadas.
        '<small class="form-hint">Es el saludo que oyen tus clientes al llamar — el mismo que ves en <a onclick="navigate(\'asistente\')" class="u-link">Asistente</a>. Para quitarlo y volver al saludo automático, bórralo desde Asistente.</small></div>' +
      '<div class="form-group"><label class="form-label">Precio medio por servicio (€)</label>' +
        '<input class="form-input" id="cfgAvgTicket" type="number" min="1" max="9999" value="' + (c.avgTicket || 35) + '"></div>' +
      '<div class="form-section-title">Dirección</div>' +
      '<div class="form-group"><label class="form-label">Dirección del negocio</label>' +
        '<input class="form-input" id="cfgAddress" placeholder="Calle Mayor 12, 20140 Andoain"' +
          ' value="' + esc(c.address || '') + '">' +
        '<small class="form-hint">Usada en fichas de Google, facturas y comunicaciones a clientes.</small></div>' +

      '<div class="form-section-title">Reseñas de Google</div>' +
      '<div class="form-group"><label class="form-label">URL de tu ficha de Google</label>' +
        '<input class="form-input" id="cfgReviewUrl" type="url" placeholder="https://g.page/r/…/review"' +
          ' value="' + esc(c.reviewUrl || '') + '">' +
        '<small class="form-hint">Se incluye en los mensajes automáticos post-cita para pedir reseña. <strong>Cómo conseguirlo:</strong> entra en <a href="https://business.google.com" target="_blank" class="u-accent">business.google.com</a> con la cuenta de tu negocio → botón <em>«Pedir reseñas»</em> (o <em>«Comparte tu perfil»</em>) → copia el enlace corto (empieza por g.page/r/…) y pégalo aquí.</small></div>' +

      '<div class="form-section-title">Notificaciones al propietario</div>' +
      '<div class="form-row">' +
        '<div class="form-group"><label class="form-label">Tu WhatsApp personal <span class="u-normal">(confirmaciones y cancelaciones)</span></label>' +
          '<input class="form-input" id="cfgAlertPhone" type="tel" placeholder="+34 612 345 678"' +
            ' value="' + esc(c.alertPhone || '') + '">' +
          '<small class="form-hint">Recibirás un WhatsApp cuando un cliente confirme o cancele su cita. Debe ser diferente al número del negocio.</small></div>' +
        '<div class="form-group"><label class="form-label">Email para notificaciones <span class="u-normal">(resumen diario y alertas)</span></label>' +
          '<input class="form-input" id="cfgNotifyEmail" type="email" placeholder="tu@email.com"' +
            ' value="' + esc(c.notifyEmail || '') + '"></div>' +
      '</div>' +

      '<div class="form-section-title">Acceso al portal</div>' +
      '<div class="form-group" id="cfgPasswordSection">' + passwordSectionHtml(hasPassword) + '</div>' +

      '<div class="u-flex u-gap-3 u-mt-6">' +
        '<button class="btn btn-accent" onclick="saveConfig()">Guardar cambios</button>' +
        '<a href="https://wa.me/34666351319?text=Necesito%20ayuda%20con%20mi%20portal" target="_blank"' +
           ' class="btn btn-d u-no-underline">Contactar soporte</a>' +
      '</div>' +
    '</div>' +
    // BUG FIX: usar outboundNumber (número NodeFlow asignado), NO c.phone (teléfono del propietario)
    (c.outboundNumber
      ? renderDesvioGuide(c.outboundNumber)
      : '<div class="card card--warn u-mx-auto u-maxw-form u-mt-6">' +
          '<div class="card-title u-yellow">⏳ Número NodeFlow pendiente de asignación</div>' +
          '<p class="u-text-md u-dim" style="margin:0">Tu número dedicado se está asignando automáticamente. En cuanto esté listo recibirás un email con las instrucciones de desvío y aquí aparecerán los códigos.<br><br>' +
          '¿Necesitas ayuda? <a href="https://wa.me/34666351319?text=Hola%20Unai%2C%20mi%20n%C3%BAmero%20NodeFlow%20a%C3%BAn%20no%20aparece" target="_blank" class="u-accent">Escríbenos →</a></p>' +
        '</div>');

  // Render de servicios+precios existentes (o una fila vacía para empezar)
  (Array.isArray(c.serviceList) && c.serviceList.length ? c.serviceList : [{}]).forEach(addServiceRow);

  // Bucle de mejora (#5): lo que los clientes preguntaron y el asistente no
  // supo responder, pintado donde se arregla. Fail-open: sin datos, nada.
  api('/api/portal/config/gaps').then(function (d) {
    var el = document.getElementById('svcGaps');
    if (!el || !d || !Array.isArray(d.gaps) || !d.gaps.length) return;
    var items = d.gaps.slice(0, 4).map(function (g) {
      return '<strong class="u-text">«' + esc(g.gap) + '»</strong>' + (g.count > 1 ? ' <span class="u-dim-2">(×' + g.count + ')</span>' : '');
    }).join(' · ');
    el.innerHTML =
      '<div class="callout callout--warn callout--block u-mb-2">' +
        '🧠 Estas semanas tus clientes preguntaron cosas que tu asistente no supo responder: ' + items +
        '. Añádelo aquí abajo (o en <a onclick="navigate(\'conocimiento\')" class="u-link">tu Base de conocimiento</a>) y lo dirá con exactitud en la próxima llamada.' +
      '</div>';
  }).catch(function () {});
}

// Editor de servicios+precios (filas dinámicas)
// Ejemplos de servicio POR SECTOR: un peluquero ve ejemplos de peluquería, un
// dentista de dental… ayuda a rellenar bien y rápido. [nombre, precio, duración, detalle].
function _svcExamples(sector) {
  var EX = {
    peluqueria:   ['Corte de pelo', '15€', '30 min', 'incluye lavado y peinado'],
    estetica_avanzada: ['Limpieza facial', '45€', '60 min', 'incluye hidratación'],
    dental:       ['Limpieza dental', '50€', '30 min', 'incluye revisión'],
    clinica:      ['Consulta general', 'a presupuesto', '20 min', 'primera visita incluye historia'],
    fisioterapia: ['Sesión de fisioterapia', '40€', '45 min', 'incluye valoración inicial'],
    podologia:    ['Quiropodia', '25€', '30 min', 'callos y uñas'],
    optica:       ['Revisión de la vista', 'gratis', '20 min', 'graduación incluida'],
    farmacia:     ['Toma de tensión', 'gratis', '10 min', 'sin cita'],
    nutricion:    ['Primera consulta', '50€', '60 min', 'incluye plan personalizado'],
    psicologia:   ['Sesión individual', '60€', '50 min', 'la primera es de valoración'],
    veterinaria:  ['Consulta general', '30€', '20 min', 'incluye revisión'],
    taller:       ['Cambio de aceite', '60€', '45 min', 'aceite y filtro incluidos'],
    gimnasio:     ['Cuota mensual', '35€/mes', 'opcional', 'acceso ilimitado a sala'],
    yoga:         ['Clase suelta', '12€', '60 min', 'primera clase de prueba gratis'],
    spa:          ['Circuito spa', '25€', '90 min', 'piscinas y sauna'],
    restaurante:  ['Menú del día', '14€', 'opcional', 'entrante, principal y postre'],
    hotel:        ['Habitación doble', '80€/noche', 'opcional', 'desayuno incluido'],
    agencia_viajes: ['Escapada fin de semana', 'a presupuesto', 'opcional', 'vuelo + hotel'],
    asesoria:     ['Cuota autónomos', '50€/mes', 'opcional', 'fiscal y laboral'],
    abogados:     ['Consulta inicial', 'a presupuesto', '45 min', 'primera orientación'],
    inmobiliaria: ['Valoración de inmueble', 'gratis', 'opcional', 'informe de mercado'],
    academia:     ['Clase de refuerzo', '15€', '60 min', 'grupos reducidos'],
    coaching:     ['Sesión de coaching', '60€', '60 min', 'individual o programa'],
    autoescuela:  ['Clase práctica', '30€', '45 min', 'vehículo incluido'],
    reformas:     ['Reforma de baño', 'a presupuesto', 'opcional', 'requiere visita'],
    guarderia_canina: ['Día de guardería', '18€', 'opcional', 'requiere cartilla de vacunas'],
    reconocimientos: ['Renovación carnet de conducir', '45€', '20 min', 'trae DNI y gafas si usas'],
    generico:     ['Servicio principal', '15€ · a presupuesto', '30 min', 'lo que quieras aclarar'],
  };
  var ALIAS = { barberia:'peluqueria', estetica:'estetica_avanzada', laser:'estetica_avanzada',
    pilates:'yoga', notaria:'abogados', residencia_mascotas:'guarderia_canina', arquitectura:'reformas',
    bar:'restaurante', cafeteria:'restaurante', hostal:'hotel', clinica_dental:'dental', dentista:'dental',
    fisio:'fisioterapia', vet:'veterinaria', mecanico:'taller' };
  var k = String(sector || '').toLowerCase().trim();
  k = ALIAS[k] || k;
  var e = EX[k] || EX[k.replace(/es$/, '')] || EX[k.replace(/s$/, '')] || EX.generico;
  return { name: e[0], price: e[1], dur: e[2], notes: e[3] };
}

function addServiceRow(s) {
  s = s || {};
  var box = document.getElementById('svcList');
  if (!box) return;
  var ex = _svcExamples((_orgInfo && _orgInfo.sector) || '');
  var row = document.createElement('div');
  row.className = 'svc-row';
  row.innerHTML =
    '<input class="form-input svc-name" placeholder="Ej. ' + esc(ex.name) + '" value="' + esc(s.name || '') + '">' +
    '<input class="form-input svc-price" list="svcPriceOpts" placeholder="Ej. ' + esc(ex.price) + '" value="' + esc(s.price || '') + '">' +
    '<input class="form-input svc-dur" placeholder="Ej. ' + esc(ex.dur) + '" value="' + esc(s.duration || '') + '">' +
    '<input class="form-input svc-notes" placeholder="Ej. ' + esc(ex.notes) + '" value="' + esc(s.notes || '') + '">' +
    '<button type="button" class="btn btn-r btn-sm svc-del" title="Quitar">✕</button>';
  row.querySelector('.svc-del').onclick = function () { row.remove(); };
  box.appendChild(row);
}
function collectServiceList() {
  var rows = document.querySelectorAll('#svcList .svc-row');
  return Array.prototype.map.call(rows, function (r) {
    return {
      name:     r.querySelector('.svc-name').value.trim(),
      price:    r.querySelector('.svc-price').value.trim(),
      duration: r.querySelector('.svc-dur').value.trim(),
      notes:    r.querySelector('.svc-notes').value.trim(),
    };
  }).filter(function (s) { return s.name; });
}

async function saveConfig() {
  var body = {
    name:           document.getElementById('cfgName').value.trim(),
    language:       (document.getElementById('cfgLang') || {}).value || undefined,
    sector:         document.getElementById('cfgSector').value,
    serviceList:    collectServiceList(),
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
  var digits = String(phone).replace(/[^0-9]/g, '');
  if (!digits.startsWith('34')) digits = '34' + digits;

  var tipos = [
    {
      icon: '⭐',
      label: 'Por no contestar',
      recommended: true,
      when: 'La opción más habitual',
      desc: 'Si no coges el teléfono en unos segundos, el asistente lo recoge automáticamente. Tú sigues siendo el primero en intentar contestar — el asistente es tu red de seguridad.',
      activate:   '**61*' + digits + '#',
      deactivate: '##61#',
    },
    {
      icon: '🔄',
      label: 'Incondicional',
      recommended: false,
      when: 'Fuera de horario o días libres',
      desc: 'Todas las llamadas van directamente al asistente, sin que suene tu teléfono. Perfecto para cuando cierras el negocio o te vas de vacaciones.',
      activate:   '**21*' + digits + '#',
      deactivate: '##21#',
    },
    {
      icon: '📵',
      label: 'Por línea ocupada',
      recommended: false,
      when: 'Mientras atiendes a otro cliente',
      desc: 'Cuando ya estás en otra llamada, el asistente recoge las llamadas que entran en espera. Ningún cliente se queda sin atender.',
      activate:   '**67*' + digits + '#',
      deactivate: '##67#',
    },
    {
      icon: '📴',
      label: 'Por no disponible',
      recommended: false,
      when: 'Móvil apagado o sin cobertura',
      desc: 'El asistente actúa cuando tu teléfono está apagado, en modo avión o sin señal.',
      activate:   '**62*' + digits + '#',
      deactivate: '##62#',
    },
  ];

  function codeBlock(id, code, accent) {
    var lbl = accent ? 'ACTIVAR' : 'DESACTIVAR';
    return '<div class="code-chip' + (accent ? ' code-chip--on' : '') + '">' +
      '<span class="code-chip__lbl">' + lbl + '</span>' +
      '<code id="' + id + '">' + code + '</code>' +
      '<button class="code-chip__copy" onclick="copyCode(\'' + id + '\')" title="Copiar al portapapeles">📋</button>' +
    '</div>';
  }

  var rows = tipos.map(function(t, i) {
    var actId   = 'dv-act-'   + i;
    var deactId = 'dv-deact-' + i;
    var recBadge = t.recommended
      ? '<span class="badge bc" style="margin-left:8px;vertical-align:middle">Recomendado</span>'
      : '';
    return '<div class="dv-type' + (t.recommended ? ' dv-type--rec' : '') + '">' +
      '<div class="u-flex u-items-center u-gap-2 u-mb-1">' +
        '<span class="u-text-xl">' + t.icon + '</span>' +
        '<span class="u-bold u-text-md">' + t.label + '</span>' +
        recBadge +
      '</div>' +
      '<div class="u-text-xs u-accent u-mb-1" style="font-weight:600">⚡ ' + t.when + '</div>' +
      '<div class="u-text-sm u-dim u-mb-3" style="line-height:1.6">' + t.desc + '</div>' +
      '<div class="u-flex u-gap-2 u-wrap">' +
        codeBlock(actId,   t.activate,   true) +
        codeBlock(deactId, t.deactivate, false) +
      '</div>' +
    '</div>';
  }).join('');

  var steps =
    '<div class="u-flex u-col u-gap-2 u-mb-5">' +
      '<div class="step-row">' +
        '<div class="step-num">1</div>' +
        '<span>Elige el tipo de desvío que mejor se adapta a tu negocio (ver abajo)</span>' +
      '</div>' +
      '<div class="step-row">' +
        '<div class="step-num">2</div>' +
        '<span>Pulsa <strong>📋</strong> para copiar el código de activación</span>' +
      '</div>' +
      '<div class="step-row">' +
        '<div class="step-num">3</div>' +
        '<span>Abre el marcador de tu móvil, pega el código y pulsa <strong>llamar ✅</strong></span>' +
      '</div>' +
      '<div class="step-row">' +
        '<div class="step-num step-num--done">4</div>' +
        '<span class="u-dim">Para desactivarlo en cualquier momento, copia y marca el código <strong>Desactivar</strong></span>' +
      '</div>' +
    '</div>';

  return '<div class="card u-mx-auto u-maxw-form u-mt-6">' +
    '<div class="card-title u-mb-1">📲 Activar el desvío de llamadas</div>' +
    '<div class="u-text-sm u-dim u-mb-4">' +
      'Tu número de NodeFlow (destino del desvío): ' +
      '<strong class="u-accent u-mono u-text-md">+' + digits + '</strong>' +
    '</div>' +
    steps +
    '<div class="u-text-sm u-bold u-dim u-mb-2" style="text-transform:uppercase;letter-spacing:.06em">Elige tu tipo de desvío</div>' +
    rows +
    '<div class="callout callout--warn callout--block u-yellow u-mt-4 u-text-xs">' +
      '<strong>¿Con qué operador tienes el teléfono del negocio?</strong><br>' +
      '• Movistar, Vodafone, Jazztel, Yoigo, MásMóvil, Euskaltel → los códigos de arriba funcionan tal cual<br>' +
      '• Orange → cambia <code class="code-inline">**21</code> por <code class="code-inline">*21</code> (sin el asterisco doble inicial)<br>' +
      '• Centralita fija (Grandstream, Panasonic, Asterisk…) → la configuración es diferente, ' +
      '<a href="https://wa.me/34666351319?text=Necesito%20ayuda%20para%20configurar%20el%20desv%C3%ADo%20en%20mi%20centralita" target="_blank" class="u-yellow">escríbenos y lo hacemos juntos →</a>' +
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

var _clientesTag = ''; // filtro de etiqueta activo
var _clientesAttention = false; // filtro "necesita atención" activo

// Umbral de días sin llamar por sector — DEBE coincidir con REBOOKING_DEFAULTS del
// backend (src/scheduling/rebooking-cron.js). Así la señal "necesita atención" del
// portal coincide con cuándo el sistema envía de verdad el mensaje de reactivación.
var NF_REBOOKING_DAYS = {
  restaurante:21, peluqueria:42, estetica:42, barberia:28, clinica:180, dental:180,
  veterinaria:365, taller:365, gimnasio:21, academia:30, farmacia:30, asesoria:90,
  hotel:90, inmobiliaria:null, optica:365, psicologia:21, coaching:21, nutricion:30,
  dietetica:30, podologia:90, autoescuela:14, estetica_avanzada:45, laser:45,
  yoga:21, pilates:21, guarderia_canina:60, residencia_mascotas:60, abogados:60,
  notaria:60, agencia_viajes:180, reformas:90, arquitectura:90
};
function nfReactivationDays() {
  var s = (_orgInfo && _orgInfo.sector) || '';
  var d = NF_REBOOKING_DAYS[s];
  return (d === undefined) ? 60 : d; // 60 = WINBACK_DAYS por defecto (daily-briefing.js)
}
function nfDaysSince(iso) {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}
function nfNeedsAttention(c) {
  var thr = nfReactivationDays();
  if (thr === null) return false;            // sector con reactivación desactivada
  if ((c.callCount || 0) < 1) return false;  // sólo clientes que ya vinieron alguna vez
  var d = nfDaysSince(c.lastCallAt);
  return d !== null && d > thr;
}

function nfTagChip(tag, removable) {
  // color estable según el texto de la etiqueta
  var colors = ['#c4f546','#00b894','#0984e3','#e17055','#fdcb6e','#e84393','#38e1c8'];
  var h = 0; for (var i=0;i<tag.length;i++) h = (h*31 + tag.charCodeAt(i)) % colors.length;
  var col = colors[h];
  return '<span style="display:inline-flex;align-items:center;gap:4px;background:' + col + '22;color:' + col +
    ';border:1px solid ' + col + '55;border-radius:20px;padding:2px 9px;font-size:11px;font-weight:600;margin:2px">' +
    esc(tag) + (removable ? '<span style="cursor:pointer;opacity:.7;font-size:13px" onclick="event.stopPropagation();removeContactTag(\'' + esc(tag) + '\')">×</span>' : '') + '</span>';
}

async function loadClientes(q) {
  q = q || '';
  var sec = document.getElementById('sec-clientes');
  sec.innerHTML = skelPanel();

  var data;
  try {
    var params = [];
    if (q) params.push('q=' + encodeURIComponent(q));
    if (_clientesTag) params.push('tag=' + encodeURIComponent(_clientesTag));
    data = await api('/api/portal/contacts' + (params.length ? '?' + params.join('&') : ''));
  } catch (e) {
    sec.innerHTML = '<div class="empty-state"><div>Error: ' + esc(e.message) + '</div></div>';
    return;
  }

  var _all = (data.contacts || []);
  var attentionCount = 0;
  for (var k = 0; k < _all.length; k++) { if (nfNeedsAttention(_all[k])) attentionCount++; }
  var shown = _clientesAttention ? _all.filter(nfNeedsAttention) : _all;

  // Día-1: sin clientes y sin filtros → empty state que enseña y empuja a activar
  if (_all.length === 0 && !q && !_clientesTag && !_clientesAttention) {
    sec.innerHTML =
      '<div class="section-header"><div class="kicker">Actividad</div><div class="section-title">Clientes</div></div>' +
      emptyState('👥', 'Aún no tienes clientes',
        'Cada persona que llame a tu asistente aparecerá aquí con su historial, sus citas y sus etiquetas — tu CRM se construye solo con cada llamada. Configura tu asistente para recibir la primera.',
        '<button class="btn btn-accent" onclick="navigate(\'asistente\')">Configurar mi asistente →</button>');
    return;
  }

  var cardsHtml = '';
  if (shown.length > 0) {
    for (var i = 0; i < shown.length; i++) {
      var c = shown[i];
      var initial = (c.displayName || '?').trim().charAt(0).toUpperCase();
      var attention = nfNeedsAttention(c);
      var tagsHtml = (c.tags && c.tags.length)
        ? '<div class="nf-client-tags">' + c.tags.map(function(t){return nfTagChip(t,false);}).join('') + '</div>'
        : '';
      var selected = _clientesSelectMode && _clientesSelected.has(c.id);
      var cardClick = _clientesSelectMode
        ? 'nfToggleSelect(\'' + esc(c.id) + '\')'
        : 'openContactProfile(\'' + esc(c.id) + '\')';
      cardsHtml += '<div class="nf-client" role="button" tabindex="0" data-cid="' + esc(c.id) + '" ' +
        'style="' + (_clientesSelectMode ? 'position:relative;' : '') + (selected ? 'border-color:var(--accent-l);box-shadow:0 0 0 1px var(--accent-l)' : '') + '" ' +
        'onclick="' + cardClick + '" ' +
        'onkeydown="if(event.key===\'Enter\')' + cardClick + '">' +
        (_clientesSelectMode ? '<div style="position:absolute;top:8px;right:10px;font-size:15px">' + (selected ? '✅' : '⬜') + '</div>' : '') +
        '<div class="nf-client-top">' +
          '<div class="nf-client-avatar">' + esc(initial) + '</div>' +
          '<div class="u-flex-1" style="min-width:0">' +
            '<div class="nf-client-name">' + esc(c.displayName) + '</div>' +
            '<div class="nf-client-sub">' + esc(c.phone || c.email || '—') + '</div>' +
          '</div>' +
        '</div>' +
        tagsHtml +
        '<div class="nf-client-foot">' +
          '<span>' + (c.callCount || 0) + (c.callCount === 1 ? ' llamada' : ' llamadas') + '</span>' +
          (attention
            ? '<span class="badge by" title="Lleva más tiempo sin llamar que el umbral de reactivación de tu sector. Buen momento para recuperarlo.">⚠ Reactivar</span>'
            : '<span>' + (c.lastCallAt ? timeAgo(c.lastCallAt) : '—') + '</span>') +
        '</div>' +
      '</div>';
    }
    cardsHtml = '<div class="nf-client-grid nf-stagger">' + cardsHtml + '</div>';
  } else {
    cardsHtml = '<div class="empty-state"><div class="empty-state-text">' +
      (_clientesAttention ? 'Ningún cliente necesita atención ahora mismo 🎉' :
       (q || _clientesTag ? 'Sin resultados con este filtro' : 'Aún no hay clientes registrados. Aparecerán tras las primeras llamadas.')) +
      '</div></div>';
  }

  // Chips de filtro por etiqueta
  var tagFilter = '';
  if (data.allTags && data.allTags.length) {
    tagFilter = '<div class="u-flex u-wrap u-gap-1 u-items-center u-mb-4">' +
      '<span class="u-text-sm u-dim" style="margin-right:4px">Filtrar:</span>' +
      '<span onclick="setClientesTag(\'\')" class="chip u-pointer' + (!_clientesTag ? ' chip-solid' : '') + '">Todos</span>' +
      data.allTags.map(function(t){
        var on = _clientesTag === t;
        return '<span onclick="setClientesTag(\'' + esc(t) + '\')" class="chip u-pointer' + (on ? ' chip-solid' : '') + '">' + esc(t) + '</span>';
      }).join('') + '</div>';
  }

  // Chip de filtro "necesita atención" — conecta el CRM con la promesa de reactivación
  var attnFilter = '';
  if (attentionCount > 0 || _clientesAttention) {
    attnFilter = '<div class="u-mb-4">' +
      '<span onclick="toggleClientesAttention()" class="chip u-pointer ' + (_clientesAttention ? 'chip-solid-warn' : 'chip-yellow') + '">' +
        '⚠ Necesita atención · ' + attentionCount + '</span>' +
      (_clientesAttention ? ' <span onclick="toggleClientesAttention()" class="u-pointer u-text-sm u-dim" style="margin-left:8px">✕ quitar filtro</span>' : '') +
    '</div>';
  }

  sec.innerHTML =
    '<div class="section-header">' +
      '<div class="kicker">Actividad</div><div class="section-title">Clientes</div>' +
      '<div class="u-flex u-items-center u-gap-2">' +
        '<span class="u-text-md u-dim">' + (data.count || 0) + ' contactos</span>' +
        '<button class="btn ' + (_clientesSelectMode ? 'btn-accent' : 'btn-d') + ' btn-sm" onclick="toggleSelectMode()">📨 Avisar' + (_clientesSelectMode ? ' — cancelar' : '') + '</button>' +
        '<button class="btn btn-accent btn-sm" onclick="openPromoModal()">📣 Promoción</button>' +
        '<button class="btn btn-d btn-sm" onclick="openImportModal()">⬆ Importar</button>' +
        '<button class="btn btn-d btn-sm" onclick="exportClientes(this)">⬇ Exportar CSV</button>' +
      '</div>' +
    '</div>' +
    (_clientesSelectMode ? '<div style="background:rgba(196,245,70,.08);border:1px solid rgba(196,245,70,.25);border-radius:10px;padding:10px 14px;margin-bottom:12px;font-size:13px;color:var(--dim)">📨 Toca los clientes a los que quieras enviar un aviso por WhatsApp <strong style="color:var(--text)">en nombre de tu negocio</strong>, y pulsa "Escribir aviso" abajo.</div>' : '') +
    '<div class="search-bar">' +
      '<input class="search-input" id="clientesSearch" placeholder="Buscar por nombre, teléfono o email…"' +
        ' value="' + esc(q) + '" oninput="onClientesSearch()">' +
    '</div>' +
    attnFilter +
    tagFilter +
    cardsHtml +
    (_clientesSelectMode ? '<div style="position:sticky;bottom:12px;margin-top:14px;display:flex;gap:10px;align-items:center;justify-content:center;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px 16px;box-shadow:0 6px 24px rgba(0,0,0,.35)">' +
      '<span style="font-size:13px;color:var(--dim)"><strong style="color:var(--text)">' + _clientesSelected.size + '</strong> seleccionado' + (_clientesSelected.size !== 1 ? 's' : '') + '</span>' +
      '<button class="btn btn-accent btn-sm" ' + (_clientesSelected.size ? '' : 'disabled ') + 'onclick="openNotifyModal()">Escribir aviso →</button>' +
    '</div>' : '');
}

// ── 📨 Aviso directo a clientes seleccionados ────────────────────────────────
var _clientesSelectMode = false;
var _clientesSelected = new Set();

function toggleSelectMode() {
  _clientesSelectMode = !_clientesSelectMode;
  if (!_clientesSelectMode) _clientesSelected.clear();
  loadClientes((document.getElementById('clientesSearch') || {}).value || '');
}

function nfToggleSelect(id) {
  if (_clientesSelected.has(id)) _clientesSelected.delete(id); else _clientesSelected.add(id);
  loadClientes((document.getElementById('clientesSearch') || {}).value || '');
}

function openNotifyModal() {
  if (!_clientesSelected.size) return;
  openModal(
    '<div class="modal-title">📨 Aviso a ' + _clientesSelected.size + ' cliente' + (_clientesSelected.size !== 1 ? 's' : '') + '</div>' +
    '<p style="color:var(--dim);font-size:13px;line-height:1.6;margin-bottom:10px">Les llegará por WhatsApp como <strong style="color:var(--text)">"Hola [nombre], un mensaje de ' + esc((window._bizName || 'tu negocio')) + ': [tu texto]"</strong>. Cuenta para tu paquete de mensajes; quien pidió no recibir avisos queda excluido automáticamente.</p>' +
    '<textarea id="notifyText" maxlength="240" placeholder="ej. mañana cerramos por la tarde — si tenías pensado pasarte, ven por la mañana." style="width:100%;min-height:84px;resize:vertical;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:13px;line-height:1.5"></textarea>' +
    '<div class="modal-actions">' +
      '<button class="btn btn-d" onclick="closeModal()">Cancelar</button>' +
      '<button class="btn btn-accent" onclick="sendNotifyClients(this)">Enviar aviso</button>' +
    '</div>');
}

async function sendNotifyClients(btn) {
  var text = ((document.getElementById('notifyText') || {}).value || '').trim();
  if (text.length < 10) { toast('Escribe el mensaje (mínimo 10 caracteres)', 'warn'); return; }
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Enviando…'; }
  try {
    var r = await api('/api/portal/notify-clients', 'POST', { contactIds: Array.from(_clientesSelected), text: text });
    closeModal();
    toast('📨 Aviso en camino a ' + r.queued + ' cliente' + (r.queued !== 1 ? 's' : '') + (r.skipped ? ' (' + r.skipped + ' excluidos por sus preferencias)' : ''));
    toggleSelectMode();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Enviar aviso'; }
    toast(e.message || 'No se pudo enviar', 'err');
  }
}

function setClientesTag(tag) {
  _clientesTag = tag;
  var q = (document.getElementById('clientesSearch') || {}).value || '';
  loadClientes(q);
}

function toggleClientesAttention() {
  _clientesAttention = !_clientesAttention;
  var q = (document.getElementById('clientesSearch') || {}).value || '';
  loadClientes(q);
}

async function exportClientes(btn) {
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Generando…'; }
  try {
    var res = await fetch('/api/portal/contacts/export', { headers: { 'Authorization': 'Bearer ' + _token } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var blob = await res.blob();
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'clientes-nodeflow.csv';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    toast('CSV descargado');
  } catch (e) {
    toast('Error al exportar: ' + e.message, 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⬇ Exportar CSV'; }
  }
}

// ── 📣 Promoción por WhatsApp a los clientes ────────────────────────────────
function openPromoModal() {
  openModal(
    '<div class="modal-title">📣 Enviar promoción por WhatsApp</div>' +
    '<p style="color:var(--dim);font-size:13px;line-height:1.5;margin-bottom:12px">' +
      'Escribe tu promo y llegará por WhatsApp a tus clientes (los que pidieron no recibir mensajes quedan excluidos automáticamente). El mensaje sale con tu nombre de negocio y el cliente puede responder directamente.' +
    '</p>' +
    '<textarea id="promoText" maxlength="300" oninput="promoPreview()" placeholder="ej. este mes el tinte + corte tiene un 15% de descuento. Pide tu cita antes del día 31." ' +
      'style="width:100%;min-height:90px;resize:vertical;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:13px;line-height:1.5"></textarea>' +
    '<div style="margin-top:10px;border:1px solid var(--border);border-radius:8px;padding:10px 12px">' +
      '<div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:8px">🎯 ¿A quién? <span style="font-weight:400;color:var(--dim)">(combina los filtros que quieras)</span></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
        '<div><label style="font-size:11px;color:var(--dim)">Etiqueta</label>' +
          '<input id="promoTag" type="text" placeholder="(todas)" oninput="promoPreview()" style="width:100%;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-size:12px"></div>' +
        '<div><label style="font-size:11px;color:var(--dim)">Que hayan usado el servicio</label>' +
          '<input id="promoService" type="text" placeholder="ej. tinte, ITV, fisio" oninput="promoPreview()" style="width:100%;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-size:12px"></div>' +
        '<div><label style="font-size:11px;color:var(--dim)">Dormidos: sin venir hace…</label>' +
          '<select id="promoInactive" onchange="promoPreview()" style="width:100%;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-size:12px">' +
            '<option value="">(cualquiera)</option><option value="90">+3 meses</option><option value="180">+6 meses</option><option value="365">+1 año</option></select></div>' +
        '<div style="display:flex;align-items:flex-end"><label style="font-size:12px;color:var(--dim);display:flex;align-items:center;gap:6px;cursor:pointer">' +
          '<input id="promoBday" type="checkbox" onchange="promoPreview()" style="width:15px;height:15px"> 🎂 Cumplen este mes</label></div>' +
      '</div>' +
    '</div>' +
    '<div id="promoEstimate" style="margin-top:12px;font-size:12px;color:var(--dim)">Calculando destinatarios…</div>' +
    '<div class="modal-actions">' +
      '<button class="btn btn-d" onclick="closeModal()">Cancelar</button>' +
      '<button class="btn btn-accent" id="promoSendBtn" onclick="sendPromoNow()" disabled>Enviar</button>' +
    '</div>'
  );
  promoPreview();
}

// Lee los filtros de segmento del modal → objeto para la API.
function _promoSegments() {
  var seg = {
    tag: (document.getElementById('promoTag') || {}).value || '',
    service: ((document.getElementById('promoService') || {}).value || '').trim() || undefined,
    birthdayMonth: !!(document.getElementById('promoBday') || {}).checked || undefined,
  };
  var inact = (document.getElementById('promoInactive') || {}).value;
  if (inact) seg.inactiveDays = parseInt(inact, 10);
  return seg;
}

var _promoPrevTimer;
function promoPreview() {
  clearTimeout(_promoPrevTimer);
  _promoPrevTimer = setTimeout(async function() {
    var box = document.getElementById('promoEstimate');
    var btn = document.getElementById('promoSendBtn');
    if (!box) return;
    var seg = _promoSegments();
    var tag = seg.tag;
    var text = ((document.getElementById('promoText') || {}).value || '').trim();
    try {
      var results = await Promise.all([
        api('/api/portal/promo', 'POST', Object.assign({ preview: true }, seg)),
        api('/api/portal/message-usage').catch(function(){ return null; }),
      ]);
      var n = (results[0] && results[0].recipients) || 0;
      var u = results[1];
      var packLine = '';
      if (u && n > 0) {
        var left = Math.max(0, u.included - u.used);
        var extra = Math.max(0, n - left);
        packLine = extra > 0
          ? ' · <span style="color:#e0a030">usa tus ' + left + ' incluidos + ' + extra + ' extra ≈ ' + (extra * u.ratePerMessage).toFixed(2) + '€</span>'
          : ' · <span style="color:var(--green2,#21c08a)">dentro de tus ' + left + ' mensajes incluidos este mes ✓</span>';
      }
      var anySeg = tag || seg.service || seg.inactiveDays || seg.birthdayMonth;
      box.innerHTML = n
        ? '📱 <strong style="color:var(--text)">' + n + ' destinatario' + (n !== 1 ? 's' : '') + '</strong>' + packLine
        : 'Sin destinatarios elegibles' + (anySeg ? ' con esos filtros' : '') + '.';
      if (btn) btn.disabled = !(n > 0 && text.length >= 10);
    } catch (e) { box.textContent = 'No se pudo calcular: ' + e.message; }
  }, 350);
}

async function sendPromoNow() {
  var btn = document.getElementById('promoSendBtn');
  var text = ((document.getElementById('promoText') || {}).value || '').trim();
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Enviando…'; }
  try {
    var r = await api('/api/portal/promo', 'POST', Object.assign({ text: text }, _promoSegments()));
    closeModal();
    toast('📣 Promoción enviada a ' + r.sent + ' cliente' + (r.sent !== 1 ? 's' : '') + (r.failed ? ' (' + r.failed + ' fallidos)' : ''));
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Enviar'; }
    toast(e.message || 'No se pudo enviar', 'err');
  }
}

// ── Importación masiva de clientes (export de la clínica → caducidades) ──
var _importCsv = '';

function openImportModal() {
  _importCsv = '';
  openModal(
    '<div class="modal-title">⬆ Importar clientes</div>' +
    '<p style="color:var(--dim);font-size:13px;line-height:1.5;margin-bottom:14px">' +
      'Sube el export de tu base de clientes. Con la <strong>fecha de caducidad</strong> (p. ej. del psicotécnico), el sistema avisará a cada cliente <strong>~1 mes antes</strong> para que renueve contigo — sin llamadas a destiempo.' +
    '</p>' +
    '<div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:14px;font-size:12px;color:var(--dim)">' +
      'Columnas: <code>Nombre</code>, <code>Teléfono</code>, <code>Caduca_el</code> (aaaa-mm-dd o dd/mm/aaaa), <code>Tipo</code>, <code>Email</code>, <code>Cumpleaños</code>. Solo <code>Teléfono</code> es obligatorio; el resto, los que tengas. Acepta CSV con , o ;' +
    '</div>' +
    '<input type="file" id="importFile" accept=".csv,text/csv,text/plain" onchange="onImportFile(event)" ' +
      'style="display:block;width:100%;margin-bottom:10px;color:var(--dim);font-size:13px">' +
    '<div style="text-align:center;color:var(--dim);font-size:12px;margin:4px 0">— o pega el CSV —</div>' +
    '<textarea id="importText" oninput="onImportText()" placeholder="Nombre,Teléfono,Caduca_el,Tipo&#10;Aitor Zubeldia,688760760,2026-08-10,B" ' +
      'style="width:100%;min-height:96px;resize:vertical;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:13px;font-family:monospace;line-height:1.5"></textarea>' +
    '<div id="importPreview" style="margin-top:12px"></div>' +
    '<div class="modal-actions">' +
      '<button class="btn btn-d" onclick="closeModal()">Cancelar</button>' +
      '<button class="btn btn-accent" id="importBtn" onclick="runImport()" disabled>Importar</button>' +
    '</div>'
  );
}

function onImportFile(ev) {
  var f = ev.target.files && ev.target.files[0];
  if (!f) return;
  var reader = new FileReader();
  reader.onload = function() {
    _importCsv = String(reader.result || '');
    var ta = document.getElementById('importText'); if (ta) ta.value = _importCsv.slice(0, 4000);
    previewImport();
  };
  reader.readAsText(f, 'utf-8');
}

var _importDebounce;
function onImportText() {
  _importCsv = (document.getElementById('importText') || {}).value || '';
  clearTimeout(_importDebounce);
  _importDebounce = setTimeout(previewImport, 350);
}

async function previewImport() {
  var box = document.getElementById('importPreview');
  var btn = document.getElementById('importBtn');
  if (!box) return;
  if (!_importCsv.trim()) { box.innerHTML = ''; if (btn) btn.disabled = true; return; }
  box.innerHTML = '<div style="color:var(--dim);font-size:12px">Analizando…</div>';
  var r;
  try { r = await api('/api/portal/contacts/import', 'POST', { csv: _importCsv, preview: true }); }
  catch (e) { box.innerHTML = '<div style="color:var(--danger,#e5484d);font-size:13px">' + esc(e.message) + '</div>'; if (btn) btn.disabled = true; return; }

  if (!r.total) { box.innerHTML = '<div style="color:var(--danger,#e5484d);font-size:13px">No hay filas válidas para importar.</div>'; if (btn) btn.disabled = true; return; }
  box.innerHTML =
    '<div style="background:rgba(196,245,70,.08);border:1px solid rgba(196,245,70,.25);border-radius:8px;padding:12px 14px">' +
      '<div style="font-weight:700;color:var(--accent-l);font-size:14px">' + r.total + ' cliente' + (r.total !== 1 ? 's' : '') + ' listos para importar</div>' +
      '<div style="color:var(--dim);font-size:13px;margin-top:3px">📅 ' + r.willSchedule + ' renovación' + (r.willSchedule !== 1 ? 'es' : '') + ' se programará' + (r.willSchedule !== 1 ? 'n' : '') + ' automáticamente</div>' +
      (r.errorCount ? '<div style="color:#e0a030;font-size:12px;margin-top:6px">⚠ ' + r.errorCount + ' fila' + (r.errorCount !== 1 ? 's' : '') + ' con errores se omitirán (líneas: ' + r.errors.map(function(e){return e.line;}).slice(0, 8).join(', ') + (r.errorCount > 8 ? '…' : '') + ')</div>' : '') +
    '</div>';
  if (btn) btn.disabled = false;
}

async function runImport() {
  var btn = document.getElementById('importBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Importando…'; }
  try {
    var r = await api('/api/portal/contacts/import', 'POST', { csv: _importCsv });
    closeModal();
    toast('✅ ' + r.imported + ' clientes importados · ' + r.scheduled + ' renovaciones programadas' +
      (r.urgent > 0 ? ' · ⚡ ' + r.urgent + ' caducan ya: se avisan mañana' : ''));
    if (_currentSection === 'clientes') loadClientes();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Importar'; }
    toast('Error al importar: ' + e.message, 'err');
  }
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

  // ── Timeline cronológico unificado (llamadas + citas) ──────────────────────
  var events = [];
  (data.calls || []).forEach(function(cl){
    var when = cl.startedAt ? new Date(cl.startedAt) : null;
    var dur = cl.durationMs ? Math.round(cl.durationMs/1000)+'s' : '';
    var label = { booked:'reservó cita', info:'pidió información', abandoned:'colgó' }[cl.outcome] || (cl.outcome||'llamada');
    events.push({ t: when, icon:'📞', color:'#c4f546',
      title:'Llamada — ' + label, meta: dur,
      action: cl.callSid ? '<button class="btn btn-d btn-sm" onclick="openTranscriptModal(\'' + esc(cl.callSid) + '\')">💬 Ver</button>' : '' });
  });
  var _todayStr = new Date().toLocaleDateString('sv-SE');
  (data.appointments || []).forEach(function(a){
    var when = a.date ? new Date(a.date + 'T' + (a.time||'00:00')) : null;
    var cancelled = a.status === 'cancelled';
    var noShow = a.status === 'no_show';
    var past = a.date && a.date <= _todayStr && !cancelled;
    // Botón para marcar/desmarcar falta en citas pasadas (alimenta el riesgo).
    var act = '';
    if (noShow) {
      act = '<button class="btn btn-d btn-sm" onclick="markNoShow(\'' + esc(a.id) + '\',false)">↩︎ No faltó</button>';
    } else if (past) {
      act = '<button class="btn btn-d btn-sm" onclick="markNoShow(\'' + esc(a.id) + '\',true)">🚫 Marcó falta</button>';
    }
    events.push({ t: when, icon: cancelled?'❌':(noShow?'🚫':'📅'), color: cancelled?'#e17055':(noShow?'#e0a030':'#00b894'),
      title: (cancelled?'Cita cancelada':(noShow?'Cita — NO se presentó':'Cita')) + (a.service ? ' — ' + esc(a.service) : ''),
      meta: (a.time||'') , action: act });
  });
  // Seguimientos ENVIADOS a este cliente → también son su historia
  (data.reminders || []).forEach(function(r){
    if (r.status !== 'sent' || !r.sent_at) return;
    events.push({ t: new Date(r.sent_at), icon:'📨', color:'#a29bfe',
      title:'Seguimiento enviado — ' + esc(r.message_preview || String(r.service_key||'').replace(/_/g,' ')),
      meta: r.channel || '', action:'' });
  });
  events.sort(function(x,y){ return (y.t?y.t.getTime():0) - (x.t?x.t.getTime():0); });

  var timelineHtml;
  if (events.length === 0) {
    timelineHtml = '<div style="color:var(--dim);font-size:13px;padding:8px 0">Sin actividad todavía. Aparecerá tras la primera llamada o cita.</div>';
  } else {
    timelineHtml = '<div style="position:relative;padding-left:6px">' + events.map(function(ev){
      var dateStr = ev.t ? ev.t.toLocaleDateString('es-ES',{day:'numeric',month:'short',year:'numeric'}) : '—';
      return '<div style="display:flex;gap:12px;padding:10px 0;border-bottom:1px solid var(--border)">' +
        '<div style="width:30px;height:30px;border-radius:50%;background:' + ev.color + '22;border:1px solid ' + ev.color + '55;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:14px">' + ev.icon + '</div>' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-size:13px;font-weight:600">' + ev.title + '</div>' +
          '<div style="font-size:11px;color:var(--dim)">' + dateStr + (ev.meta?' · '+esc(ev.meta):'') + '</div>' +
        '</div>' +
        (ev.action ? '<div style="flex-shrink:0">' + ev.action + '</div>' : '') +
      '</div>';
    }).join('') + '</div>';
  }

  // ── Editor de etiquetas ────────────────────────────────────────────────────
  _cpId = id;
  _cpTags = Array.isArray(c.tags) ? c.tags.slice() : [];

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
        cpRiskBadge(data.noShowRisk) +
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
    '<div style="display:flex;gap:8px;margin-bottom:16px">' +
      '<button class="btn btn-accent btn-sm" onclick="saveContactNotes(\'' + esc(id) + '\', true)">Guardar datos</button>' +
      '<button class="btn btn-r btn-sm" onclick="deleteContact(\'' + esc(id) + '\')">Eliminar contacto</button>' +
    '</div>' +

    '<div class="profile-section-title">Etiquetas</div>' +
    '<div id="cpTagsBox" style="margin-bottom:6px">' + renderCpTags() + '</div>' +
    '<div style="display:flex;gap:6px;margin-bottom:16px">' +
      '<input class="form-input" id="cpTagInput" placeholder="Añadir etiqueta (ej. VIP)" style="flex:1" onkeydown="if(event.key===\'Enter\'){event.preventDefault();addContactTag();}">' +
      '<button class="btn btn-d btn-sm" onclick="addContactTag()">+ Añadir</button>' +
    '</div>' +

    // ── FICHA 360 ↔ ENTIDADES: "sus cosas" (su coche, su bono, su póliza) ──
    cpEntitiesHtml(data, id) +

    // ── FICHA 360: los seguimientos DE ESTE cliente ──────────────────
    '<div class="profile-section-title" style="display:flex;align-items:center;justify-content:space-between">' +
      '<span>🔔 Seguimientos de este cliente</span>' +
      '<button class="btn btn-d btn-sm" onclick="cpTogglePause(\'' + esc(id) + '\',' + (data.paused ? 'false' : 'true') + ')" ' +
        (data.paused ? 'style="color:var(--red)"' : '') + '>' + (data.paused ? '⏸ En pausa — reanudar' : '⏸ Pausar avisos') + '</button>' +
    '</div>' +
    (data.paused ? '<div style="font-size:12px;color:var(--red);margin-bottom:8px">Este cliente no recibe ningún aviso (whatsapp, sms ni email) hasta que lo reanudes.</div>' : '') +
    cpRemindersHtml(data.reminders, id) +
    '<div style="display:flex;gap:6px;align-items:center;margin:10px 0 4px;flex-wrap:wrap">' +
      '<input type="date" id="cpPrDate" style="background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:6px 8px;font-size:12px">' +
      '<input type="text" id="cpPrLabel" placeholder="ej. preguntar por el presupuesto de la moto" maxlength="120" style="flex:1;min-width:160px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-size:12px">' +
      '<button class="btn btn-accent btn-sm" onclick="cpAddPersonal(\'' + esc(id) + '\')">+ Avisar</button>' +
    '</div>' +
    cpKeyDatesHtml(data.sectorFields, (c.sectorData || {}), id) +

    '<div class="profile-section-title" style="display:flex;align-items:center;justify-content:space-between">' +
      '<span>📋 Actividad</span>' +
      '<button class="btn btn-d btn-sm" onclick="newTaskForContact(\'' + esc(id) + '\',\'' + esc((c.displayName||'').replace(/'/g,'')) + '\')">+ Tarea</button>' +
    '</div>' +
    timelineHtml +

    '<div class="modal-actions" style="margin-top:20px">' +
      (c.phone ? '<button class="btn btn-g" onclick="callOutbound(\'' + esc(c.phone) + '\',this)">📞 Llamar</button>' : '') +
      (c.phone ? '<a class="btn" style="background:#25d366;color:#fff;text-decoration:none" href="https://wa.me/' + esc(c.phone.replace(/[^0-9]/g,'')) + '" target="_blank">💬 WhatsApp</a>' : '') +
      '<button class="btn btn-d" onclick="closeModal()">Cerrar</button>' +
    '</div>'
  );
}

// ── FICHA 360 ↔ ENTIDADES: "sus cosas" ──────────────────────────────────────
// Bidireccional con la ficha viva: las entidades de ESTE cliente como chips
// («🚗 Golf GTI · 1234ABC») que abren su ficha; y el alta desde aquí vincula
// al cliente sola (prelink). Solo aparece si el sector tiene fichas.
function cpEntitiesHtml(data, contactId) {
  if (!data.hasEntityTypes) return '';
  var ents = data.entities || [];
  var typeLabel = '';
  try {
    var t = _entType();
    if (t) typeLabel = ' ' + t.label_singular.toLowerCase();
  } catch (e) {}

  var chips = ents.map(function(en) {
    return '<button class="btn btn-d btn-sm" style="border-radius:999px;font-size:13px;padding:9px 14px" ' +
      'onclick="openEntityFicha(\'' + esc(en.id) + '\')">' +
      esc(en.icon || '🗂️') + ' ' + esc(en.display_name) +
      (en.is_draft ? ' ' + _entDraftBadge(true) : '') + '</button>';
  }).join(' ');

  return '<div class="profile-section-title" style="display:flex;align-items:center;justify-content:space-between">' +
      '<span>🗂️ Sus cosas</span>' +
      '<button class="btn btn-d btn-sm" onclick="entNewForContact(\'' + esc(contactId) + '\')">+ Añadir' + esc(typeLabel) + '</button>' +
    '</div>' +
    (chips
      ? '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px">' + chips + '</div>'
      : '<div style="color:var(--dim);font-size:12px;margin-bottom:16px">Sin fichas vinculadas todavía. Añade la suya y sus avisos (ITV, vacuna, renovación…) saldrán solos.</div>');
}

// Alta de entidad DESDE la Ficha 360: el cliente llega preseleccionado.
async function entNewForContact(contactId) {
  if (!_entTypes) { try { await initEntidades(); } catch (e) {} }
  if (!_entType()) { toast('Las fichas no están disponibles para tu negocio', 'err'); return; }
  openEntityModal(null, null, contactId);
}

// ── FICHA 360: badge de riesgo de plantón (no-show) ─────────────────────────
function cpRiskBadge(risk) {
  if (!risk || risk.level === 'none' || !risk.noShows) return '';
  var high = risk.level === 'high';
  var bg = high ? 'rgba(224,160,48,.14)' : 'rgba(157,157,180,.14)';
  var col = high ? '#e0a030' : 'var(--dim)';
  var icon = high ? '⚠️' : '•';
  return '<div style="margin-top:6px"><span title="' + esc(risk.note || '') + '" ' +
    'style="display:inline-block;font-size:11px;font-weight:700;padding:3px 9px;border-radius:99px;background:' + bg + ';color:' + col + ';border:1px solid ' + col + '44">' +
    icon + ' Riesgo de plantón ' + (high ? 'ALTO' : 'bajo') + ' · ' + risk.noShows + ' falta' + (risk.noShows === 1 ? '' : 's') +
    '</span></div>';
}

async function markNoShow(aptId, mark) {
  try {
    await api('/api/portal/appointments/' + aptId + '/no-show', 'POST', { noShow: mark });
    toast(mark ? '🚫 Marcada como falta' : '↩︎ Falta deshecha');
    openContactProfile(_cpId); // recarga la ficha → recalcula el riesgo
  } catch (e) { toast(e.message || 'No se pudo actualizar', 'err'); }
}

// ── FICHA 360: seguimientos del cliente ─────────────────────────────────────
function cpRemindersHtml(reminders, contactId) {
  var upcoming = (reminders || []).filter(function(r){ return r.status === 'pending' || r.status === 'postponed'; })
    .sort(function(a,b){ return new Date(a.scheduled_for) - new Date(b.scheduled_for); });
  if (!upcoming.length) {
    return '<div style="color:var(--dim);font-size:12px;padding:4px 0 2px">Sin avisos programados. Añade uno personal abajo, o rellena sus fechas clave y el motor los programará solo.</div>';
  }
  return upcoming.map(function(r){
    var label = r.message_preview || String(r.service_key || '').replace(/_/g, ' ');
    var d = new Date(r.scheduled_for);
    return '<div style="display:flex;align-items:center;gap:10px;padding:7px 10px;background:var(--card);border:1px solid var(--border);border-radius:8px;margin-bottom:5px">' +
      '<span style="font-size:14px">🔔</span>' +
      '<div style="flex:1;min-width:0">' +
        '<div style="font-size:13px;font-weight:600">' + esc(label) + '</div>' +
        '<div style="font-size:11px;color:var(--dim)">' + d.toLocaleDateString('es-ES',{day:'numeric',month:'long',year:'numeric'}) + ' · ' + esc(r.channel || 'whatsapp') + (r.status==='postponed' ? ' · pospuesto' : '') + '</div>' +
      '</div>' +
      '<button class="btn btn-d btn-sm" data-tip="Enviar ahora" onclick="cpReminderAction(\'' + esc(r.id) + '\',\'send-now\',\'' + esc(contactId) + '\')">📤</button>' +
      '<button class="btn btn-d btn-sm" data-tip="Posponer 7 días" onclick="cpReminderAction(\'' + esc(r.id) + '\',\'postpone\',\'' + esc(contactId) + '\')">+7d</button>' +
      '<button class="btn btn-d btn-sm" data-tip="Cancelar aviso" onclick="cpReminderAction(\'' + esc(r.id) + '\',\'cancel\',\'' + esc(contactId) + '\')">✕</button>' +
    '</div>';
  }).join('');
}

function cpKeyDatesHtml(fields, sectorData, contactId) {
  var inputs = (fields || []).map(function(f){
    var val = sectorData[f.key] || '';
    return '<div style="display:flex;flex-direction:column;gap:2px">' +
      '<label style="font-size:11px;color:var(--dim)">' + esc(f.label) + '</label>' +
      '<input id="cpKd-' + esc(f.key) + '" type="' + (f.type === 'date' ? 'date' : f.type) + '" value="' + esc(val) + '" ' +
        'style="background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:6px 8px;font-size:12px;width:150px">' +
    '</div>';
  }).join('');
  // DETALLE universal (todos los sectores): lo que hace el mensaje PERSONAL.
  // "tu seguimiento (la lumbalgia)" · "el tinte (rubio ceniza)" · "(permiso C)".
  inputs += '<div style="display:flex;flex-direction:column;gap:2px;flex:1;min-width:200px">' +
    '<label style="font-size:11px;color:var(--dim)">✨ Detalle para sus avisos <span style="color:var(--muted)">(entra en el mensaje)</span></label>' +
    '<input id="cpKd-_detalle" type="text" maxlength="60" value="' + esc(sectorData._detalle || '') + '" ' +
      'placeholder="ej. la lumbalgia · el tinte rubio ceniza · permiso C" ' +
      'style="background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:6px 8px;font-size:12px;width:100%">' +
  '</div>';
  return '<div style="margin-top:10px;padding:10px 12px;background:rgba(196,245,70,.05);border:1px solid rgba(196,245,70,.2);border-radius:8px">' +
    '<div style="font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--accent-l);margin-bottom:6px">📅 Datos que personalizan sus avisos</div>' +
    '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">' + inputs +
      '<button class="btn btn-accent btn-sm" onclick="cpSaveKeyDates(\'' + esc(contactId) + '\')">Guardar</button>' +
    '</div>' +
  '</div>';
}

async function cpReminderAction(reminderId, action, contactId) {
  try {
    var body = action === 'postpone' ? { days: 7 } : {};
    await api('/api/portal/reminders/' + reminderId + '/' + action, 'POST', body);
    toast(action === 'send-now' ? 'Enviándose en unos segundos' : action === 'postpone' ? 'Pospuesto 7 días' : 'Aviso cancelado');
    openContactProfile(contactId);
  } catch (e) { toast('Error: ' + e.message, 'err'); }
}

async function cpAddPersonal(contactId) {
  var date = (document.getElementById('cpPrDate') || {}).value;
  var label = ((document.getElementById('cpPrLabel') || {}).value || '').trim();
  if (!date) { toast('Elige la fecha del aviso', 'err'); return; }
  if (!label) { toast('Escribe de qué avisarle', 'err'); return; }
  try {
    await api('/api/portal/contacts/' + contactId + '/personal-reminder', 'POST', { date: date, label: label });
    toast('Seguimiento personal programado ✓');
    openContactProfile(contactId);
  } catch (e) { toast(e.message || 'No se pudo programar', 'err'); }
}

async function cpTogglePause(contactId, paused) {
  try {
    await api('/api/portal/contacts/' + contactId + '/pause', 'PUT', { paused: paused });
    toast(paused ? 'Avisos en pausa para este cliente' : 'Avisos reanudados');
    openContactProfile(contactId);
  } catch (e) { toast('Error: ' + e.message, 'err'); }
}

async function cpSaveKeyDates(contactId) {
  var sectorData = {};
  document.querySelectorAll('[id^="cpKd-"]').forEach(function(inp){
    var key = inp.id.slice(5);
    if (inp.value) sectorData[key] = inp.value;
  });
  try {
    // El PUT de sector-data ya recalcula los avisos del cliente en background.
    var current = await api('/api/portal/contacts/' + contactId + '/sector-data');
    var merged = Object.assign({}, current.sectorData || {}, sectorData);
    await api('/api/portal/contacts/' + contactId + '/sector-data', 'PUT', { sectorData: merged });
    toast('Fechas guardadas — avisos reprogramados ✓');
    setTimeout(function(){ openContactProfile(contactId); }, 600);
  } catch (e) { toast('Error: ' + e.message, 'err'); }
}

// ── Etiquetas en el perfil de contacto ──────────────────────────────────────
var _cpId = null, _cpTags = [];
function renderCpTags() {
  if (!_cpTags.length) return '<span style="font-size:12px;color:var(--dim)">Sin etiquetas. Añade una para agrupar a tus clientes.</span>';
  return _cpTags.map(function(t){ return nfTagChip(t, true); }).join('');
}
function _refreshCpTags() {
  var box = document.getElementById('cpTagsBox');
  if (box) box.innerHTML = renderCpTags();
}
async function addContactTag() {
  var input = document.getElementById('cpTagInput');
  var val = (input.value || '').trim().slice(0,24).replace(/[^a-zA-Z0-9 áéíóúñü\-_]/gi,'');
  if (!val) return;
  if (_cpTags.indexOf(val) === -1) _cpTags.push(val);
  input.value = '';
  _refreshCpTags();
  await _saveCpTags();
}
async function removeContactTag(tag) {
  _cpTags = _cpTags.filter(function(t){ return t !== tag; });
  _refreshCpTags();
  await _saveCpTags();
}
async function _saveCpTags() {
  try {
    await api('/api/portal/contacts/' + _cpId, 'PATCH', { tags: _cpTags });
    if (_currentSection === 'clientes') loadClientes((document.getElementById('clientesSearch')||{}).value||'');
  } catch (e) { toast('Error al guardar etiqueta: ' + e.message, 'err'); }
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

  // Análisis de la llamada (auditor IA + métricas) — el sistema se puntúa
  // solo tras cada llamada y el dueño ve el porqué, no solo el qué.
  var an = data.analysis;
  var analysisHtml = '';
  if (an && an.score != null) {
    var scoreColor = an.score >= 85 ? 'var(--green2)' : an.score >= 60 ? '#f39c12' : '#e74c3c';
    var chips = '';
    if (an.satisfied === false)    chips += '<span class="badge br">cliente insatisfecho</span> ';
    if (an.hallucinated === true)  chips += '<span class="badge br">inventó datos</span> ';
    if (an.verbosity === 'se_enrolla') chips += '<span class="badge by">se enrolla</span> ';
    var probs = (an.problems || []).map(function(p){ return '<li>' + esc(p) + '</li>'; }).join('');
    var imps  = (an.improvements || []).map(function(p){ return '<li>' + esc(p) + '</li>'; }).join('');
    analysisHtml =
      '<div style="background:rgba(255,255,255,.03);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin:12px 0">' +
        '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">' +
          '<span style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--dim)">Análisis de la llamada</span>' +
          '<span style="font-size:16px;font-weight:900;color:' + scoreColor + '">' + an.score + '/100</span>' + chips +
        '</div>' +
        (probs ? '<div style="font-size:12px;color:var(--dim)"><strong>Puntos débiles:</strong><ul style="margin:4px 0 8px 18px;padding:0">' + probs + '</ul></div>' : '') +
        (imps  ? '<div style="font-size:12px;color:var(--dim)"><strong>El asistente mejorará:</strong><ul style="margin:4px 0 0 18px;padding:0">' + imps + '</ul></div>' : '') +
      '</div>';
  }

  openModal(
    '<div class="modal-title">💬 Transcripción' + (dateStr ? ' · ' + dateStr : '') + '</div>' +
    (durStr ? '<div style="font-size:12px;color:var(--dim);margin-bottom:12px">' + durStr + ' · ' + data.transcript.length + ' intercambios</div>' : '') +
    analysisHtml +
    '<div class="transcript-list">' + rows + '</div>' +
    '<div class="modal-actions"><button class="btn btn-d" onclick="closeModal()">Cerrar</button></div>'
  );
}

// ── Auto-actualización tras deploy ────────────────────────────────────────
// El servidor estrena bootId en cada arranque (/health). Si esta copia del
// portal se cargó con otro bootId, purgamos SW+caché y recargamos UNA vez
// (anti-bucle por sessionStorage). Fin de "no veo la feature que ya está
// desplegada" — caso real 2026-07-03 con service workers antiguos.
(function autoRefreshOnDeploy() {
  fetch('/health', { cache: 'no-store' })
    .then(function(r) { return r.json(); })
    .then(function(h) {
      if (!h || !h.bootId) return;
      var seen = localStorage.getItem('nf_boot_id');
      localStorage.setItem('nf_boot_id', h.bootId);
      if (!seen || seen === h.bootId) return;
      if (sessionStorage.getItem('nf_boot_reloaded') === h.bootId) return;
      sessionStorage.setItem('nf_boot_reloaded', h.bootId);
      var work = [];
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
        work.push(navigator.serviceWorker.getRegistrations()
          .then(function(rs) { return Promise.all(rs.map(function(reg) { return reg.unregister(); })); }));
      }
      if (window.caches && caches.keys) {
        work.push(caches.keys().then(function(ks) { return Promise.all(ks.map(function(k) { return caches.delete(k); })); }));
      }
      Promise.all(work).catch(function() {}).then(function() { location.reload(); });
    })
    .catch(function() {});
})();

// ── Boot ──────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', initAuth);

// ── Asistente section ─────────────────────────────────────────────
var _asisConfig = {};
var _asisOrgName = '';
var _DAYS = ['mon','tue','wed','thu','fri','sat','sun'];
var _DAY_LABELS = { mon:'Lun', tue:'Mar', wed:'Mié', thu:'Jue', fri:'Vie', sat:'Sáb', sun:'Dom' };

// ── Copiloto de configuración (#8): "dímelo con tus palabras" ─────────
// Doble puerta SIEMPRE: la IA propone → el dueño ve la propuesta y pulsa
// Aplicar (solo rellena el formulario) → su Guardar de siempre persiste.
var _copProposal = {};
function copilotBox(kind, placeholder) {
  return '<div style="margin-top:12px">' +
    '<button type="button" class="btn btn-d btn-sm" onclick="toggleCopilot(\'' + kind + '\')" id="cop-btn-' + kind + '">✨ Dímelo con tus palabras</button>' +
    '<div id="cop-panel-' + kind + '" style="display:none;margin-top:10px;background:rgba(196,245,70,.05);border:1px solid rgba(196,245,70,.2);border-radius:10px;padding:14px">' +
      '<div style="font-size:12px;color:var(--dim);margin-bottom:8px">Escríbelo como se lo contarías a una persona y te propongo cómo queda. Nada se aplica sin tu confirmación.</div>' +
      '<textarea class="form-input" id="cop-text-' + kind + '" rows="2" placeholder="' + placeholder + '"></textarea>' +
      '<div style="display:flex;gap:8px;margin-top:8px;align-items:center">' +
        '<button type="button" class="btn btn-accent btn-sm" onclick="copilotPropose(\'' + kind + '\')" id="cop-go-' + kind + '">Proponer</button>' +
        '<span id="cop-status-' + kind + '" style="font-size:11px;color:var(--dim)"></span>' +
      '</div>' +
      '<div id="cop-preview-' + kind + '" style="margin-top:10px"></div>' +
    '</div>' +
  '</div>';
}
function toggleCopilot(kind) {
  var p = document.getElementById('cop-panel-' + kind);
  if (p) p.style.display = p.style.display === 'none' ? 'block' : 'none';
}
async function copilotPropose(kind) {
  var ta = document.getElementById('cop-text-' + kind);
  var st = document.getElementById('cop-status-' + kind);
  var pv = document.getElementById('cop-preview-' + kind);
  if (!ta || !ta.value.trim()) { if (st) st.textContent = 'Escribe algo primero.'; return; }
  st.textContent = 'Pensando…'; pv.innerHTML = '';
  try {
    var d = await api('/api/portal/copilot/parse', 'POST', { kind: kind, text: ta.value.trim() });
    st.textContent = '';
    if (!d || !d.ok) { st.textContent = (d && d.error) || 'No he podido procesarlo.'; return; }
    _copProposal[kind] = d;
    pv.innerHTML = copilotPreviewHtml(kind, d) +
      '<div style="display:flex;gap:8px;margin-top:10px">' +
        '<button type="button" class="btn btn-accent btn-sm" onclick="copilotApply(\'' + kind + '\')">Aplicar al formulario</button>' +
        '<button type="button" class="btn btn-d btn-sm" onclick="document.getElementById(\'cop-preview-' + kind + '\').innerHTML=\'\'">Descartar</button>' +
      '</div>' +
      '<div style="font-size:11px;color:var(--dim);margin-top:6px">«Aplicar» solo rellena el formulario — no se guarda nada hasta que pulses Guardar.</div>';
  } catch (e) { if (st) st.textContent = 'Error: ' + e.message; }
}
function copilotPreviewHtml(kind, d) {
  if (kind === 'services') {
    return '<div style="font-size:12px;color:var(--text);line-height:1.8">' + d.services.map(function (s) {
      return '• <strong>' + esc(s.name) + '</strong>' + (s.price ? ' — ' + esc(s.price) : '') +
        (s.duration ? ' · ' + esc(s.duration) : '') + (s.notes ? ' · ' + esc(s.notes) : '');
    }).join('<br>') + '</div>';
  }
  return '<div style="font-size:12px;color:var(--text);line-height:1.8">' + _DAYS.filter(function (day) { return day in d.schedule; }).map(function (day) {
    var s = d.schedule[day];
    if (s === null) return '• <strong>' + _DAY_LABELS[day] + '</strong>: cerrado';
    return '• <strong>' + _DAY_LABELS[day] + '</strong>: ' + s.open + '–' + s.close +
      (s.afternoon_open ? ' y ' + s.afternoon_open + '–' + s.afternoon_close : '');
  }).join('<br>') + '</div>';
}
function copilotApply(kind) {
  var d = _copProposal[kind];
  if (!d) return;
  if (kind === 'services') {
    d.services.forEach(addServiceRow);
    toast('Servicios añadidos a la tabla — revisa y pulsa Guardar');
  } else {
    applyScheduleToAsisGrid(d.schedule);
    toast('Horario aplicado al selector — revisa y pulsa Guardar');
  }
  var p = document.getElementById('cop-panel-' + kind); if (p) p.style.display = 'none';
  var pv = document.getElementById('cop-preview-' + kind); if (pv) pv.innerHTML = '';
}
function applyScheduleToAsisGrid(schedule) {
  _DAYS.forEach(function (day) {
    if (!(day in schedule)) return;
    var cb = document.getElementById('asis-day-' + day);
    if (!cb) return;
    var slot = schedule[day];
    cb.checked = slot !== null;
    toggleAsisDayClosed(day);
    if (!slot) return;
    var set = function (id, v) { var el = document.getElementById(id); if (el && v) el.value = v; };
    set('asis-open-' + day, slot.open);
    set('asis-close-' + day, slot.close);
    var pmEl  = document.getElementById('asis-pm-' + day);
    var btnEl = document.getElementById('asis-pm-btn-' + day);
    var wantPm = !!(slot.afternoon_open && slot.afternoon_close);
    if (pmEl) {
      pmEl.style.display = wantPm ? 'flex' : 'none';
      if (btnEl) btnEl.textContent = wantPm ? '– Tarde' : '+ Tarde';
      if (wantPm) { set('asis-pm-open-' + day, slot.afternoon_open); set('asis-pm-close-' + day, slot.afternoon_close); }
    }
  });
}

async function loadAsistente() {
  try {
    var data = await api('/api/portal/assistant');
    _asisConfig  = data.config  || {};
    _asisOrgName = data.orgName || '';
    renderAsistenteForm();
    // Prefill del "Llámame y pruébalo" con el teléfono del dueño, SIEMPRE
    // en formato internacional (el backend normaliza igualmente: "666...",
    // con espacios o con +34, todo vale — feedback real 2026-07-03).
    var tp = document.getElementById('testCallPhone');
    if (tp) {
      if (!tp.value && _orgInfo && _orgInfo.phone) tp.value = _orgInfo.phone;
      if (tp.value && /^[6789]\d{8}$/.test(tp.value.replace(/\s/g, ''))) tp.value = '+34' + tp.value.replace(/\s/g, '');
      if (!tp.value) tp.value = '+34';
      tp.placeholder = '+34 600 000 000';
    }
  } catch (e) { toast('Error cargando asistente: ' + e.message, 'err'); }
}

// ── "Llámame y pruébalo": tu asistente te llama al móvil ─────────────
var _testCallCooldown = false;
async function testCallMe() {
  var inp = document.getElementById('testCallPhone');
  var btn = document.getElementById('testCallBtn');
  var msg = document.getElementById('testCallMsg');
  var phone = (inp.value || '').trim();
  if (phone.replace(/[^\d]/g, '').length < 9) {
    msg.style.display = 'block'; msg.style.color = 'var(--red)';
    msg.textContent = 'Escribe un número válido (con prefijo si no es español).';
    inp.focus();
    return;
  }
  if (_testCallCooldown) return;
  _testCallCooldown = true;
  btn.disabled = true; btn.textContent = 'Llamando…';
  msg.style.display = 'none';
  try {
    await api('/api/portal/calls/outbound', 'POST', { to: phone, purpose: 'test_call' });
    msg.style.display = 'block'; msg.style.color = 'var(--green2)';
    msg.innerHTML = '📱 <strong>Te estamos llamando.</strong> Descuelga y háblale como un cliente. ' +
      'Después la verás en <a onclick="navigate(\'llamadas\')" class="u-link">Llamadas</a>, con su transcripción.';
    // Cooldown: una llamada de prueba cada 30s
    setTimeout(function () {
      _testCallCooldown = false;
      btn.disabled = false; btn.textContent = 'Llámame otra vez';
    }, 30000);
  } catch (e) {
    _testCallCooldown = false;
    btn.disabled = false; btn.textContent = 'Llámame ahora';
    msg.style.display = 'block'; msg.style.color = 'var(--red)';
    msg.textContent = 'No se pudo iniciar la llamada: ' + (e.message || e) + '. Si sigue fallando, escríbenos desde Ayuda.';
  }
}

function switchAsistenteTab(tab) {
  document.querySelectorAll('.btn-subtab').forEach(function(b) {
    b.classList.toggle('active', b.dataset.subtab === tab);
  });
  document.querySelectorAll('.asis-panel').forEach(function(p) {
    p.classList.toggle('hidden', p.id !== 'asis-' + tab);
  });
}

// Atajo de activación: lleva al demo de voz desde cualquier tab
function probarAsistente() {
  switchAsistenteTab('voz');
  setTimeout(function() {
    var m = document.getElementById('portal-mic-btn');
    if (m) m.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 80);
}

// ── Selector de voz profesional (catálogo dinámico ElevenLabs) ──────────
var _voiceCatalog = [];
var _voiceFilter = 'all';
var _voicePreviewAudio = null;

function _voiceEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

var _voiceTiers = {};
var _hasPremiumVoice = false; // ¿el negocio tiene el add-on de voz Premium?
var _voiceUsage = null;       // minutos del PLAN (incluidas/Cartesia) para la barra + tier estándar
var _voiceQuota = null;       // cupo de minutos PREMIUM (ElevenLabs) para el tier premium
function loadVoiceCatalog() {
  var grid = document.getElementById('voice-grid');
  // Minutos del plan: para que el dueño VALORE (cuántos incluye, cuánto el extra)
  // antes de elegir voz. Sale del plan REAL — no se hardcodea (enterprise=ilimitado).
  api('/api/billing/usage').then(function(u) {
    _voiceUsage = u;
    if (document.getElementById('voice-grid')) renderVoiceGrid();
  }).catch(function() {});
  // Cupo de minutos PREMIUM (distinto del plan): las voces ElevenLabs gastan un
  // cupo aparte (200/mes con add-on, 40 sin él). Para mostrar minutos por tier.
  api('/api/portal/voice-quota').then(function(q) {
    _voiceQuota = q;
    if (document.getElementById('voice-grid')) renderVoiceGrid();
  }).catch(function() {});
  // El estado del add-on decide si las Premium salen con candado (se ven y se
  // escuchan igual — el candado es el gancho de venta, no un muro).
  api('/api/portal/addons').then(function(d) {
    var a = (d && d.addons || []).filter(function(x) { return x.key === 'voice_premium' && x.active; });
    _hasPremiumVoice = a.length > 0;
  }).catch(function() {}).then(function() {
    fetch('/api/voices')
      .then(function(r) { return r.json(); })
      .then(function(d) { _voiceCatalog = (d && d.voices) || []; _voiceTiers = (d && d.tiers) || {}; renderVoiceGrid(); })
      .catch(function() { if (grid) grid.innerHTML = '<div class="voice-empty">No se pudo cargar el catálogo de voces.</div>'; });
  });
}

function setVoiceFilter(g, btn) {
  _voiceFilter = g;
  var chips = document.querySelectorAll('.vf-chip');
  for (var i = 0; i < chips.length; i++) chips[i].classList.toggle('active', chips[i] === btn);
  renderVoiceGrid();
}

// Barra de plan sobre el grid: minutos incluidos + coste del extra + qué cuestan
// las voces. Responde "¿qué me da mi plan?" justo donde el dueño decide la voz.
function _voicePlanBar() {
  var u = _voiceUsage;
  var planName = (_orgInfo && _orgInfo.plan === 'negocio') ? 'NodeFlow'
    : (_orgInfo && _orgInfo.plan ? (_orgInfo.plan.charAt(0).toUpperCase() + _orgInfo.plan.slice(1)) : '');
  var line1;
  if (u && u.minutesLimit != null) {
    var limit = u.minutesLimit;
    if (limit >= 99999) {
      line1 = 'Tu plan' + (planName ? ' <strong>' + _voiceEsc(planName) + '</strong>' : '') + ' incluye <strong>minutos ilimitados</strong> de voz.';
    } else {
      var rem  = Math.max(0, Math.floor(u.minutesRemaining != null ? u.minutesRemaining : (limit - (u.minutesUsed || 0))));
      var rate = (u.overageRate != null ? u.overageRate : 0.15).toFixed(2).replace('.', ',');
      line1 = 'Tu plan' + (planName ? ' <strong>' + _voiceEsc(planName) + '</strong>' : '') + ' incluye <strong>' + limit
        + ' min/mes</strong> · te quedan <strong>' + rem + ' min</strong> este mes · el minuto extra, ' + rate + '€.';
    }
  } else {
    line1 = 'La voz que elijas usa los <strong>minutos incluidos en tu plan</strong> — la Premium no gasta más.';
  }
  var showCta = !!(u && u.minutesLimit != null && u.minutesLimit < 99999);
  return '<div class="voice-planbar">'
    + '<span class="vpb-ico">📞</span>'
    + '<div class="vpb-txt">'
      + '<div class="vpb-1">' + line1 + '</div>'
      + '<div class="vpb-2">Voz <strong>estándar incluida</strong> · voces <strong>Premium +10€/mes</strong>, mismas llamadas y mismos minutos.</div>'
    + '</div>'
    + (showCta ? '<span class="vpb-cta" onclick="navigate(\'facturacion\')">Ver mis minutos →</span>' : '')
    + '</div>';
}

// Minutos por TIER para el encabezado: estándar = minutos del PLAN (Cartesia,
// compartidos); premium = cupo PREMIUM aparte (ElevenLabs). Devuelve HTML (con
// <strong>) o '' si no hay dato. Los números salen del backend, no se hardcodean.
function _tierMinutes(t) {
  if (t === 'estandar' || t === 'ultra') {
    var u = _voiceUsage;
    if (!u || u.minutesLimit == null) return '';
    if (u.minutesLimit >= 99999) return ' · <strong>minutos ilimitados</strong> de tu plan';
    var rem = Math.max(0, Math.floor(u.minutesRemaining != null ? u.minutesRemaining : (u.minutesLimit - (u.minutesUsed || 0))));
    return ' · <strong>' + u.minutesLimit + ' min/mes</strong> de tu plan · te quedan <strong>' + rem + '</strong>';
  }
  if (t === 'premium') {
    var q = _voiceQuota;
    if (!q || q.ok === false || q.quota == null) return '';
    var r = Math.max(0, Math.round(q.remaining || 0));
    return ' · <strong>' + q.quota + ' min/mes</strong> premium · te quedan <strong>' + r + '</strong>';
  }
  return '';
}

function renderVoiceGrid() {
  var grid = document.getElementById('voice-grid');
  if (!grid) return;
  var sel = (document.getElementById('asis-voice') || {}).value || '';
  var q = ((document.getElementById('voice-search') || {}).value || '').toLowerCase().trim();
  var list = _voiceCatalog.filter(function(v) {
    if (_voiceFilter === 'female' && v.gender !== 'female') return false;
    if (_voiceFilter === 'male' && v.gender !== 'male') return false;
    if (q) {
      var hay = (v.name + ' ' + (v.description || '') + ' ' + (v.labels || []).join(' ') + ' ' + (v.useCase || '') + ' ' + (v.accent || '')).toLowerCase();
      if (hay.indexOf(q) < 0) return false;
    }
    return true;
  });
  if (!list.length) { grid.innerHTML = '<div class="voice-empty">Sin voces que coincidan.</div>'; return; }

  // Agrupado por tier: el dueño ve QUÉ incluye cada nivel (características,
  // minutos y coste del minuto extra) antes de elegir — petición Unai.
  // 'ultra' se conserva por compatibilidad durante la ventana de deploy (el
  // backend viejo aún etiqueta Cartesia como ultra); tras el deploy no hay voces
  // ultra y el grupo se auto-oculta (filter de abajo). Evita que Cartesia
  // desaparezca del selector si el frontend (raw) va por delante del backend.
  var TIER_ORDER = ['estandar', 'premium', 'ultra'];
  var byTier = {};
  list.forEach(function(v) { var t = v.tier || 'premium'; (byTier[t] = byTier[t] || []).push(v); });

  var card = function(v) {
    var g = v.gender === 'female' ? 'fem' : (v.gender === 'male' ? 'mal' : '');
    var ico = v.gender === 'female' ? '👩' : (v.gender === 'male' ? '👨' : '🎙️');
    var sub = [v.accent, v.age].filter(Boolean).join(' · ') || (v.gender || '');
    var chips = (v.labels || []).slice(0, 3).map(function(t) { return '<span class="vc-tag">' + _voiceEsc(t) + '</span>'; }).join('');
    var id = _voiceEsc(v.id);
    var locked = (v.tier === 'premium') && !_hasPremiumVoice;
    return '<div class="voice-card ' + g + ' tier-' + _voiceEsc(v.tier || 'premium') + (v.id === sel ? ' selected' : '') + (locked ? ' locked' : '') + '" data-vid="' + id + '" onclick="selectVoice(\'' + id + '\')">'
      + '<div class="vc-top">'
        + '<div class="vc-avatar">' + ico + '</div>'
        + '<div class="vc-id"><div class="vc-name">' + _voiceEsc(v.name) + '</div><div class="vc-sub">' + _voiceEsc(sub) + '</div></div>'
        + '<span class="vc-sel">Tu voz</span>'
        + '<span class="vc-lock" title="Voz Premium — actívala para usarla">🔒 Premium</span>'
      + '</div>'
      + '<div class="vc-desc">' + _voiceEsc((v.description || '').slice(0, 88)) + '</div>'
      + (chips ? '<div class="vc-chips">' + chips + '</div>' : '')
      + (v.isClone
          // Voz clonada: no hay muestra que escuchar (aún no existe tu voz) →
          // el botón LLEVA al proceso de grabar/clonar, no a una voz default.
          ? '<button type="button" class="vc-listen" onclick="event.stopPropagation();openVoiceCloneModal()" aria-label="Grabar mi voz">'
              + '<span class="vc-ico">🎙️</span><span class="vc-listen-label">Grabar mi voz</span>'
            + '</button>'
          : '<button type="button" class="vc-listen" onclick="event.stopPropagation();previewVoice(\'' + id + '\',this)" aria-label="Escuchar a ' + _voiceEsc(v.name) + '">'
              + '<span class="vc-ico">▶</span><span class="vc-spin"></span>'
              + '<span class="vc-eq"><i></i><i></i><i></i><i></i></span>'
              + '<span class="vc-listen-label">Escuchar</span>'
            + '</button>')
    + '</div>';
  };

  // Copy que VENDE cada nivel (no el blurb técnico del backend).
  var TIER_COPY = {
    estandar: { title: 'Incluidas en tu plan', badge: 'Sin coste extra', cls: 'inc',
                note: 'Voces naturales y rápidas, listas para tus llamadas.' },
    premium:  { title: 'Voces Premium',        badge: '+10€/mes',        cls: 'prem',
                note: 'Ultrarrealistas: quien llama cree hablar con una persona. Pruébalas gratis.' },
    ultra:    { title: 'Incluidas en tu plan', badge: 'Sin coste extra', cls: 'inc',
                note: 'Voces rápidas incluidas en tu plan.' },
  };
  var shown = TIER_ORDER.filter(function(t) { return byTier[t] && byTier[t].length; });
  grid.innerHTML = _voicePlanBar() + shown.map(function(t, i) {
    var c = TIER_COPY[t] || { title: t, badge: '', cls: 'inc', note: '' };
    var header = '<div class="voice-tier' + (i > 0 ? ' mt' : '') + '">'
      + '<span class="voice-tier-title">' + _voiceEsc(c.title) + '</span>'
      + '<span class="voice-tier-badge ' + c.cls + '">' + _voiceEsc(c.badge) + '</span>'
      + '<span class="voice-tier-note">' + _voiceEsc(c.note) + _tierMinutes(t) + '</span>'
      + (t === 'premium' ? '<span class="voice-tier-cta" onclick="navigate(\'facturacion\')">Activar Premium →</span>' : '')
      + '</div>';
    return header + byTier[t].map(card).join('');
  }).join('');
}

function selectVoice(id) {
  var v = _voiceCatalog.filter(function(x) { return x.id === id; })[0];
  // Voz personalizada (clonada): abre el flujo de clonar TU voz (el propio modal
  // maneja el candado Premium — no dejamos al usuario en una voz default).
  if (v && (v.isClone || id === 'custom-clone')) { openVoiceCloneModal(); return; }
  // Premium sin add-on: se escucha (gancho) pero no se puede fijar como voz —
  // en vez de dejar que falle al guardar (402), empujamos a activarla.
  if (v && v.tier === 'premium' && !_hasPremiumVoice) {
    previewVoice(id);
    toast('🔒 ' + (v.name || 'Esta voz') + ' es Premium. Escúchala y actívala (+10€/mes) en Facturación para usarla.', 'info');
    return;
  }
  var h = document.getElementById('asis-voice'); if (h) h.value = id;
  // Actualizar el resaltado SIN re-renderizar (evita repetir la animación de
  // entrada en cada clic) y escuchar la voz elegida al instante.
  var cards = document.querySelectorAll('#voice-grid .voice-card');
  for (var i = 0; i < cards.length; i++) {
    cards[i].classList.toggle('selected', cards[i].getAttribute('data-vid') === id);
  }
  previewVoice(id);
}

// ── Voz personalizada: clonar TU voz (ElevenLabs IVC) ──────────────────────
var _cloneRec = null, _cloneChunks = [], _cloneBlob = null, _cloneTimer = null, _cloneSecs = 0;
function _fmtSecs(s) { return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
function openVoiceCloneModal() {
  _cloneBlob = null; _cloneChunks = []; _cloneSecs = 0;
  // Candado Premium: la voz clonada va con el add-on Voz Premium (+10€/mes).
  // En vez de dejar al dueño en una voz default, le explicamos y le llevamos.
  if (!_hasPremiumVoice) {
    openModal(
      '<div style="max-width:440px">' +
        '<h3 style="margin:0 0 6px;font-size:18px">🎙️ Tu voz personalizada</h3>' +
        '<p style="font-size:13px;line-height:1.6;margin:0 0 14px;color:var(--dim)">Tu negocio contesta con <strong style="color:var(--text)">TU voz</strong>: la clonamos con un minuto de audio. Va incluida en <strong style="color:var(--accent-l)">Voz Premium</strong> (+10€/mes), junto a todas las voces ultrarrealistas.</p>' +
        '<div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">' +
          '<button class="btn btn-d btn-sm" onclick="closeModal()">Ahora no</button>' +
          '<button class="btn btn-accent btn-sm" onclick="closeModal();navigate(\'facturacion\')">Activar Voz Premium →</button>' +
        '</div>' +
      '</div>'
    );
    return;
  }
  openModal(
    '<div style="max-width:460px">' +
      '<h3 style="margin:0 0 6px;font-size:18px">🎙️ Tu voz personalizada</h3>' +
      '<p style="font-size:13px;line-height:1.6;margin:0 0 16px;color:var(--dim)">Graba <strong style="color:var(--text)">un minuto</strong> leyendo cualquier texto con tu tono habitual, sin ruido de fondo. Tu asistente contestará con TU voz.</p>' +
      '<div style="display:flex;align-items:center;gap:12px;background:var(--card2);border:1px solid var(--border);border-radius:10px;padding:14px 16px">' +
        '<button id="cloneRecBtn" class="btn btn-accent btn-sm" onclick="toggleCloneRec()">● Grabar</button>' +
        '<span id="cloneTimer" style="font-variant-numeric:tabular-nums;color:var(--dim)">0:00</span>' +
      '</div>' +
      '<audio id="clonePreview" controls style="display:none;width:100%;margin-top:10px"></audio>' +
      '<div style="font-size:12px;color:var(--dim);margin:12px 0 6px;text-align:center">— o sube un archivo de audio —</div>' +
      '<input type="file" id="cloneFile" accept="audio/*" onchange="onCloneFile(this)" style="font-size:12px;width:100%">' +
      '<label style="display:flex;gap:8px;align-items:flex-start;font-size:12px;color:var(--dim);margin-top:16px;line-height:1.5;cursor:pointer">' +
        '<input type="checkbox" id="cloneConsent" style="margin-top:2px;flex-shrink:0"><span>Confirmo que es mi voz (o tengo permiso para usarla) y autorizo a NodeFlow a clonarla para mi asistente.</span></label>' +
      '<div id="cloneMsg" style="font-size:12px;color:var(--dim);margin-top:10px;min-height:16px"></div>' +
      '<div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">' +
        '<button class="btn btn-d btn-sm" onclick="closeModal()">Cancelar</button>' +
        '<button id="cloneSubmit" class="btn btn-accent btn-sm" onclick="submitClone()">Clonar mi voz</button>' +
      '</div>' +
    '</div>'
  );
}
async function toggleCloneRec() {
  var btn = document.getElementById('cloneRecBtn'), msg = document.getElementById('cloneMsg');
  if (_cloneRec && _cloneRec.state === 'recording') { _cloneRec.stop(); return; }
  if (!navigator.mediaDevices || !window.MediaRecorder) { msg.textContent = 'Tu navegador no permite grabar; sube un archivo de audio.'; return; }
  try {
    var stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    _cloneChunks = []; _cloneSecs = 0;
    _cloneRec = new MediaRecorder(stream);
    _cloneRec.ondataavailable = function (e) { if (e.data && e.data.size) _cloneChunks.push(e.data); };
    _cloneRec.onstop = function () {
      stream.getTracks().forEach(function (t) { t.stop(); });
      clearInterval(_cloneTimer);
      _cloneBlob = new Blob(_cloneChunks, { type: (_cloneRec.mimeType || 'audio/webm').split(';')[0] });
      var a = document.getElementById('clonePreview'); if (a) { a.src = URL.createObjectURL(_cloneBlob); a.style.display = 'block'; }
      btn.textContent = '● Volver a grabar';
      msg.textContent = 'Grabado ' + _fmtSecs(_cloneSecs) + '. ' + (_cloneSecs < 30 ? '⚠ Graba al menos 30 segundos.' : '¡Listo para clonar!');
    };
    _cloneRec.start();
    btn.textContent = '■ Parar';
    _cloneTimer = setInterval(function () {
      _cloneSecs++; var t = document.getElementById('cloneTimer'); if (t) t.textContent = _fmtSecs(_cloneSecs);
      if (_cloneSecs >= 120) { _cloneRec.stop(); } // cap 2 min
    }, 1000);
  } catch (e) { msg.textContent = 'No se pudo acceder al micrófono: ' + (e.message || e); }
}
function onCloneFile(inp) {
  if (inp.files && inp.files[0]) {
    _cloneBlob = inp.files[0];
    var a = document.getElementById('clonePreview'); if (a) { a.src = URL.createObjectURL(_cloneBlob); a.style.display = 'block'; }
    document.getElementById('cloneMsg').textContent = 'Archivo listo: ' + inp.files[0].name;
  }
}
async function submitClone() {
  var msg = document.getElementById('cloneMsg'), btn = document.getElementById('cloneSubmit');
  if (!_cloneBlob) { msg.textContent = 'Primero graba o sube tu voz.'; return; }
  if (!document.getElementById('cloneConsent').checked) { msg.innerHTML = '<span style="color:var(--accent-l)">Marca la casilla de consentimiento.</span>'; return; }
  btn.disabled = true; btn.textContent = 'Clonando… (~30s)';
  try {
    var res = await fetch('/api/portal/voice/clone?consent=1', {
      method: 'POST',
      headers: { 'Content-Type': _cloneBlob.type || 'audio/webm', 'Authorization': 'Bearer ' + _token },
      body: _cloneBlob,
    });
    var d = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(d.error || ('HTTP ' + res.status));
    closeModal();
    toast('✅ Voz clonada — tu asistente ya habla con tu voz');
    if (typeof loadVoiceCatalog === 'function') loadVoiceCatalog();
  } catch (e) { btn.disabled = false; btn.textContent = 'Clonar mi voz'; msg.innerHTML = '<span style="color:#e74c3c">' + (e.message || e) + '</span>'; }
}

// Muestras pregeneradas (coste cero): public/audio/voices/manifest.json.
// Se generan UNA vez con scripts/generate-voice-samples.js; si no existen,
// caemos a la API (que a su vez cachea por frase+voz en el servidor).
var _voiceManifest = null;
function _getVoiceManifest() {
  if (_voiceManifest !== null) return Promise.resolve(_voiceManifest);
  return fetch('/audio/voices/manifest.json')
    .then(function (r) { return r.ok ? r.json() : {}; })
    .catch(function () { return {}; })
    .then(function (m) { _voiceManifest = m || {}; return _voiceManifest; });
}

// Estado visual de reproducción en la tarjeta: idle → loading (spinner) →
// playing (ecualizador en vivo). Hace que ESCUCHAR sea satisfactorio.
var _voicePlayingCard = null;
function _vcState(card, state) {
  if (!card) return;
  card.classList.remove('loading', 'playing');
  var label = card.querySelector('.vc-listen-label');
  if (state === 'loading') { card.classList.add('loading'); if (label) label.textContent = 'Cargando'; }
  else if (state === 'playing') { card.classList.add('playing'); if (label) label.textContent = 'Sonando'; }
  else if (label) label.textContent = 'Escuchar';
}
function _vcStop() {
  if (_voicePreviewAudio) { try { _voicePreviewAudio.pause(); } catch (e) {} _voicePreviewAudio = null; }
  if (_voicePlayingCard) { _vcState(_voicePlayingCard, 'idle'); _voicePlayingCard = null; }
}
function _vcCardFor(voice, btn) {
  if (btn && btn.closest) return btn.closest('.voice-card');
  try { return document.querySelector('.voice-card[data-vid="' + voice + '"]'); } catch (e) { return null; }
}

function previewVoice(voice, btn) {
  var statusEl = document.getElementById('portal-demo-status');
  var card = _vcCardFor(voice, btn);
  // Toggle: si esta misma voz ya suena, parar.
  if (card && card === _voicePlayingCard) { _vcStop(); if (statusEl) statusEl.textContent = 'Pulsa una voz para escucharla'; return; }
  _vcStop();
  _vcState(card, 'loading');

  _getVoiceManifest().then(function (manifest) {
    if (manifest[voice]) { _vcPlay(new Audio('/audio/voices/' + manifest[voice]), card, statusEl); return; }
    _previewVoiceViaApi(voice, card, statusEl);
  });
}

function _vcPlay(audio, card, statusEl) {
  _voicePreviewAudio = audio;
  _voicePlayingCard = card;
  _vcState(card, 'playing');
  var nm = card ? (card.querySelector('.vc-name') || {}).textContent : '';
  if (statusEl) statusEl.textContent = '🔊 Escuchando' + (nm ? ' a ' + nm : '') + '…';
  audio.onended = function () {
    if (card === _voicePlayingCard) _vcStop();
    if (statusEl) statusEl.textContent = '¿Te gusta? Pulsa "Elegir" o prueba otra.';
  };
  audio.play().catch(function () { _vcState(card, 'idle'); if (statusEl) statusEl.textContent = 'Escucharás la voz en la prueba de llamada'; });
}

function _previewVoiceViaApi(voice, card, statusEl) {
  var _pvNegocio = _asisOrgName || 'tu negocio';
  var _pvNombre  = (document.getElementById('asis-name') || {}).value || '';
  var previewText = '¡Hola! Ha llamado a ' + _pvNegocio + '. ' + (_pvNombre ? 'Soy ' + _pvNombre + ', su' : 'Soy su') + ' asistente virtual. ¿En qué puedo ayudarle?';
  fetch('/api/demo/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + _token },
    body: JSON.stringify({ text: previewText, voice: voice }),
  })
  .then(function(res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.blob(); })
  .then(function(blob) { _vcPlay(new Audio(URL.createObjectURL(blob)), card, statusEl); })
  .catch(function() { _vcState(card, 'idle'); if (statusEl) statusEl.textContent = 'Escucharás la voz en la prueba de llamada'; });
}

function renderAsistenteForm() {
  var c = _asisConfig;
  var setVal = function(id, val) { var el = document.getElementById(id); if (el) el.value = val || ''; };

  setVal('asis-name',  c.assistantName || '');
  setVal('asis-lang',  c.language || 'es');
  setVal('asis-mode',  c.mode || 'citas');
  setVal('asis-first', c.firstMessage || '');
  setVal('asis-extra', c.extraInfo || '');
  setVal('asis-voice', c.voice || '');

  // Cargar el catálogo de voces y pintar el selector (resalta la voz guardada).
  loadVoiceCatalog();

  // Schedule grid (supports partido: morning + afternoon)
  var sched = c.schedule || {};
  var schedHtml = _DAYS.map(function(d) {
    var slot = sched[d];
    var hasAfternoon = slot && slot.afternoon_open;
    return '<div class="u-mb-2">' +
      '<div class="u-grid u-gap-2 u-items-center" style="grid-template-columns:80px 1fr">' +
        '<label class="u-flex u-items-center u-gap-2 u-text-sm u-dim u-pointer">' +
          '<input type="checkbox" id="asis-day-' + d + '"' + (slot ? ' checked' : '') + ' onchange="toggleAsisDayClosed(\'' + d + '\')">' +
          ' ' + _DAY_LABELS[d] + '</label>' +
        '<div id="asis-slots-' + d + '" style="display:' + (slot?'block':'none') + '">' +
          '<div class="u-flex u-gap-2 u-items-center u-wrap">' +
            '<input type="time" class="form-ctrl" id="asis-open-' + d + '" value="' + (slot?slot.open:'09:00') + '" style="width:90px">' +
            '<span class="u-dim u-text-xs">–</span>' +
            '<input type="time" class="form-ctrl" id="asis-close-' + d + '" value="' + (slot?slot.close:'14:00') + '" style="width:90px">' +
            '<button type="button" id="asis-pm-btn-' + d + '" class="btn btn-sm u-text-xs" style="padding:3px 8px" ' +
              'onclick="toggleAsisAfternoon(\'' + d + '\')">' +
              (hasAfternoon ? '– Tarde' : '+ Tarde') +
            '</button>' +
          '</div>' +
          '<div id="asis-pm-' + d + '" class="u-gap-2 u-items-center u-wrap u-mt-1" style="display:' + (hasAfternoon?'flex':'none') + '">' +
            '<span class="u-dim u-text-xs" style="width:80px">Tarde</span>' +
            '<input type="time" class="form-ctrl" id="asis-pm-open-' + d + '" value="' + (hasAfternoon?slot.afternoon_open:'16:00') + '" style="width:90px">' +
            '<span class="u-dim u-text-xs">–</span>' +
            '<input type="time" class="form-ctrl" id="asis-pm-close-' + d + '" value="' + (hasAfternoon?slot.afternoon_close:'20:00') + '" style="width:90px">' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');
  document.getElementById('asis-schedule-grid').innerHTML = schedHtml;

  // Copiloto de horarios (#8): una vez, encima del grid
  var horPanel = document.getElementById('asis-horario');
  if (horPanel && !document.getElementById('cop-panel-schedule')) {
    horPanel.insertAdjacentHTML('afterbegin',
      '<div class="card u-mb-4" style="padding:16px 20px;margin-top:0">' +
        '<div class="u-text-sm u-dim" style="margin-bottom:2px">¿Prefieres no ir día a día?</div>' +
        copilotBox('schedule', 'Ej: de lunes a viernes de 9 a 2 y de 4 a 8, sábados solo mañana') +
      '</div>');
  }

  // Contenido
  renderAsisSectorFields(c.sector || 'generico', c.sectorData || {});

  // Generated prompt preview
  var genPrompt = document.getElementById('asis-generated-prompt');
  if (genPrompt) genPrompt.textContent = '(Guarda primero para ver el prompt generado)';
}

function toggleAsisDayClosed(day) {
  var checked = document.getElementById('asis-day-' + day).checked;
  document.getElementById('asis-slots-' + day).style.display = checked ? 'block' : 'none';
}

function toggleAsisAfternoon(day) {
  var pmEl  = document.getElementById('asis-pm-' + day);
  var btnEl = document.getElementById('asis-pm-btn-' + day);
  if (!pmEl) return;
  var showing = pmEl.style.display !== 'none';
  pmEl.style.display = showing ? 'none' : 'flex';
  if (btnEl) btnEl.textContent = showing ? '+ Tarde' : '– Tarde';
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
  return '<div class="form-group u-flex u-items-center u-gap-2 u-mt-1">' +
    '<input type="checkbox" id="' + id + '"' + (checked ? ' checked' : '') +
    ' style="width:16px;height:16px;accent-color:var(--accent)">' +
    '<label for="' + id + '" class="form-label u-pointer" style="margin:0">' + label + '</label></div>';
}
function _segurosBlock(arr) {
  return '<div class="form-group"><label class="form-label">Seguros aceptados</label>' +
    '<div id="asis-seguros-chips" class="u-flex u-wrap u-gap-1 u-mb-1">' +
    (arr||[]).map(function(s) {
      return '<span class="chip chip-accent">' +
        esc(s) + ' <span class="u-pointer" onclick="this.parentElement.remove()">×</span></span>';
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

function renderAsisSectorFields(sector, sd) {
  // #8 Editor único: los servicios y precios viven SOLO en la tabla de
  // Configuración. Aquí ya no hay textareas de servicios — solo contexto
  // de sector que no duplica precios.
  var html = '<div class="callout callout--accent u-mb-4">' +
    '<div class="u-flex-1" style="min-width:200px">' +
      '<strong class="u-white">Servicios y precios</strong> se gestionan en una única tabla (nombre · precio · duración) que la IA dice con exactitud y que decide los huecos de la agenda.</div>' +
    '<button class="btn btn-accent btn-sm u-nowrap" onclick="navigate(\'configuracion\')">Gestionar servicios y precios →</button>' +
  '</div>';

  if (sector === 'fisioterapia' || sector === 'clinica' || sector === 'dental') {
    html += _segurosBlock(sd.seguros);
    html += _ta('asis-espec', 'Especialidades', sd.especialidades, 2, 'Ej: Rehabilitación, Osteopatía…');

  } else if (sector === 'restaurante') {
    html += '<div class="form-row">' +
      _inp('asis-horComida', 'Horario comidas', sd.horarioComida, '13:00-15:30') +
      _inp('asis-horCena',   'Horario cenas',   sd.horarioCena,   '20:30-23:00') + '</div>';
    html += _ta('asis-carta', 'Carta (nombre – precio por línea)',
      (sd.cartaItems||[]).map(function(i){ return i.name + (i.price ? ' - ' + i.price : ''); }).join('\n'),
      5, 'Chuletón - 28€');

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
    html += '<div class="form-row">' +
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

  }
  // Fallback genérico (otro, generico…): sin campos extra — la tabla única cubre servicios y precios.

  document.getElementById('asis-contenido-body').innerHTML = html;
}

function addAsisSeguro() {
  var input = document.getElementById('asis-seguro-input');
  var val = input.value.trim(); if (!val) return;
  var span = document.createElement('span');
  span.className = 'chip chip-accent';
  // Use DOM API (not innerHTML) to avoid XSS from user-typed insurer name
  span.appendChild(document.createTextNode(val + ' '));
  var x = document.createElement('span');
  x.className = 'u-pointer';
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
  c.mode          = get('asis-mode') || 'citas';
  c.firstMessage  = get('asis-first');
  c.extraInfo     = get('asis-extra');
  c.voice         = get('asis-voice');
  // #8: 'services' (texto libre) ya no se envía — la tabla de Configuración
  // es la única fuente; el backend solo la sembraría si estuviera vacía.

  c.schedule = {};
  _DAYS.forEach(function(d) {
    var cb = document.getElementById('asis-day-' + d);
    if (!cb || !cb.checked) { c.schedule[d] = null; return; }
    var slot = { open: get('asis-open-' + d)||'09:00', close: get('asis-close-' + d)||'14:00' };
    var pmEl = document.getElementById('asis-pm-' + d);
    if (pmEl && pmEl.style.display !== 'none') {
      var pmOpen  = get('asis-pm-open-' + d);
      var pmClose = get('asis-pm-close-' + d);
      if (pmOpen)  slot.afternoon_open  = pmOpen;
      if (pmClose) slot.afternoon_close = pmClose;
    }
    c.schedule[d] = slot;
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
    document.getElementById('portal-mic-btn').style.background = 'rgba(196,245,70,.15)';
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
  sec.innerHTML = skelPanel();
  try {
    // Resiliencia por bloque: si Stripe no responde (o la org aún no tiene
    // cliente Stripe), el plan y los minutos se pintan IGUAL con los datos
    // de la org — antes moría la sección entera y el dueño no veía ni sus
    // minutos restantes (caso real 2026-07-03).
    var results  = await Promise.all([
      api('/api/billing/usage').catch(function(){ return null; }),
      api('/api/billing/invoices').catch(function(){ return {}; }),
      api('/api/portal/reports?period=month').catch(function(){ return {}; }),
    ]);
    var usage = results[0];
    if (!usage || usage.minutesLimit === undefined) {
      var used  = (_orgInfo && _orgInfo.monthly_minutes_used)  || 0;
      var limit = (_orgInfo && _orgInfo.monthly_minutes_limit) || 300;
      usage = {
        plan: (_orgInfo && _orgInfo.plan) || 'negocio',
        minutesUsed: used, minutesLimit: limit,
        minutesRemaining: Math.max(0, limit - used),
        percentUsed: limit > 0 ? Math.round((used / limit) * 100) : 0,
        overage: Math.max(0, used - limit), overageCost: 0, overageRate: null,
      };
    }
    var invoices = results[1].invoices || [];
    var monthVal = (results[2] && results[2].summary) || {};
    renderFacturacion(sec, usage, invoices, monthVal);
  } catch (e) {
    sec.innerHTML =
      '<div class="empty-state"><div class="empty-state-icon">❌</div>' +
      '<div class="empty-state-text">Error al cargar facturación: ' + esc(e.message) + '</div></div>';
  }
}

function renderFacturacion(sec, usage, invoices, monthVal) {
  var planNames  = { starter: 'Starter', negocio: 'NodeFlow', pro: 'Pro' };
  var planPrices = { starter: 'Gratis', negocio: '€49/mes', pro: '€99/mes' };
  var planName   = planNames[usage.plan]  || usage.plan;
  var planPrice  = planPrices[usage.plan] || '';
  var pct        = usage.percentUsed || 0;
  var barColor   = pct >= 90 ? 'var(--red)' : pct >= 70 ? 'var(--yellow)' : 'var(--accent)';

  // Overage warning
  var overageWarn = '';
  if (usage.overage > 0) {
    overageWarn =
      '<div class="callout callout--error u-mt-2">' +
        '⚠️ Has superado tu límite de minutos en <strong>' + usage.overage.toFixed(1) + ' min</strong>. ' +
        'Cargo adicional estimado: <strong>€' + usage.overageCost.toFixed(2) + '</strong>.' +
      '</div>';
  }

  // Plan único Negocio €49 — sin upsell a Pro (plan retirado).
  var proUpsell = '';

  // Invoices table rows
  var invRows = '';
  if (invoices.length === 0) {
    invRows = '<tr class="empty-row"><td colspan="4">No hay facturas aún.</td></tr>';
  } else {
    invoices.forEach(function(inv) {
      var d       = new Date(inv.date * 1000);
      var dateStr = d.toLocaleDateString('es-ES', { year: 'numeric', month: 'short', day: 'numeric' });
      var symbol  = inv.currency === 'eur' ? '€' : inv.currency.toUpperCase() + ' ';
      var amt     = symbol + Number(inv.amount).toFixed(2);
      var statusLabel = inv.status === 'paid'
        ? '<span class="u-green">Pagada</span>'
        : '<span class="u-yellow">' + inv.status + '</span>';
      var pdfLink = inv.pdf
        ? ' <a href="' + inv.pdf + '" target="_blank" class="u-accent u-text-xs">PDF ↓</a>'
        : '';
      invRows +=
        '<tr>' +
          '<td class="u-dim">' + dateStr + '</td>' +
          '<td class="u-tabular">' + (inv.number || inv.id) + '</td>' +
          '<td class="num u-bold">' + amt + '</td>' +
          '<td>' + statusLabel + pdfLink + '</td>' +
        '</tr>';
    });
  }

  var manageBtn = usage.plan !== 'starter'
    ? '<button class="btn btn-d btn-sm" onclick="openStripePortal()">Gestionar suscripción →</button>'
    : '<a href="https://nodeflow.es/#precios" target="_blank" class="btn btn-accent btn-sm" style="text-decoration:none">Activar plan →</a>';

  var vm = monthVal || {};
  var valStat = function (n, label, colorCls) {
    return '<div><div class="u-text-2xl u-black ' + (colorCls || 'u-white') + '">' + n + '</div>' +
      '<div class="u-text-xs u-dim">' + label + '</div></div>';
  };
  var valueStrip = ((vm.totalCalls || 0) > 0 || (vm.bookings || 0) > 0)
    ? '<div class="card u-border-accent" style="background:linear-gradient(135deg,rgba(196,245,70,.10),rgba(56,225,200,.05))">' +
        '<div class="u-text-xs u-accent u-bold u-mb-3" style="text-transform:uppercase;letter-spacing:.08em">Lo que NodeFlow te dio este mes</div>' +
        '<div class="u-grid u-gap-4" style="grid-template-columns:repeat(auto-fit,minmax(120px,1fr))">' +
          valStat(vm.totalCalls || 0, 'llamadas atendidas') +
          valStat(vm.bookings || 0, 'citas capturadas', 'u-green') +
          valStat('€' + (vm.revenueEst || 0), 'en reservas (est.)', 'u-green') +
          valStat((vm.hoursSaved || 0) + 'h', 'ahorradas', 'u-blue') +
        '</div>' +
        '<div class="u-text-sm u-dim u-mt-3">Todo esto por <strong class="u-text">' + planPrice + '</strong>.</div>' +
      '</div>'
    : '';

  sec.innerHTML =
    '<div class="section-header">' +
      '<div class="kicker">Cuenta</div><h2 class="section-title">Facturación</h2>' +
      '<p class="section-sub">Gestiona tu plan y consulta tus facturas</p>' +
    '</div>' +
    valueStrip +

    // Plan card + usage bar
    '<div class="card">' +
      '<div class="u-flex u-items-center u-justify-between u-wrap u-gap-3 u-mb-4">' +
        '<div>' +
          '<div class="u-text-xs u-dim u-mb-1" style="text-transform:uppercase;letter-spacing:.06em">Plan actual</div>' +
          '<div class="u-text-xl u-bold u-white">' + planName +
            '<span class="u-text-md u-dim" style="font-weight:400;margin-left:8px">' + planPrice + '</span>' +
          '</div>' +
        '</div>' +
        manageBtn +
      '</div>' +
      '<div class="u-text-sm u-dim u-mb-1">' +
        'Minutos este mes: <strong class="u-text">' +
        (usage.minutesUsed || 0).toFixed(1) + ' / ' + (usage.minutesLimit || 0) +
        '</strong>' +
      '</div>' +
      '<div class="progress u-mb-1"><div class="progress-bar" style="width:' + Math.min(pct, 100) + '%;background:' + barColor + '"></div></div>' +
      '<div class="u-text-xs u-dim">' +
        pct + '% utilizado · ' + Math.floor(usage.minutesRemaining || 0) + ' min restantes' +
      '</div>' +
      '<div class="u-text-xs u-dim u-mt-1">Minutos extra: <strong class="u-text">€' +
        (usage.overageRate != null ? usage.overageRate.toFixed(2).replace('.', ',') : '0,15') + '/min</strong> · solo si superas tu plan</div>' +
      overageWarn +
    '</div>' +

    // Add-ons (voz Premium +10€, Crecimiento +39€) — carga async abajo
    '<div id="addonsBox"></div>' +

    proUpsell +

    // Invoice history
    '<div class="card u-mt-4">' +
      '<div class="card-title">🧾 Historial de facturas</div>' +
      '<div class="table-wrap" style="border:0">' +
        '<table>' +
          '<thead><tr><th>Fecha</th><th>Nº Factura</th><th class="num">Importe</th><th>Estado</th></tr></thead>' +
          '<tbody>' + invRows + '</tbody>' +
        '</table>' +
      '</div>' +
    '</div>' +
    referralCta('facturacion');

  loadAddonsBox();
}

// ── Complementos de suscripción (voz Premium +10€, Crecimiento +39€) ──
async function loadAddonsBox() {
  try {
    var d = await api('/api/portal/addons');
    var el = document.getElementById('addonsBox');
    if (!el || !d || !Array.isArray(d.addons)) return;
    el.innerHTML =
      '<div class="card" style="padding:20px;margin-top:16px">' +
        '<div style="font-size:13px;font-weight:700;margin-bottom:4px">✨ Complementos</div>' +
        '<div style="font-size:11px;color:var(--dim);margin-bottom:14px">Amplía tu plan cuando lo necesites — se añaden a tu suscripción y Stripe prorratea el mes en curso automáticamente.</div>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px">' +
        d.addons.map(function (a) {
          var price = '+' + (a.monthlyCents / 100).toFixed(0) + '€/mes';
          var btn;
          if (a.active) {
            btn = '<button class="btn btn-d btn-sm" onclick="addonAction(\'' + a.key + '\',\'cancel\')">Cancelar</button>';
          } else if (a.available) {
            btn = '<button class="btn btn-accent btn-sm" onclick="addonAction(\'' + a.key + '\',\'activate\')">Activar ' + price + '</button>';
          } else {
            btn = '<span style="font-size:11px;color:var(--dim)">Muy pronto online — escríbenos y lo activamos hoy</span>';
          }
          return '<div style="background:var(--card2);border:1px solid ' + (a.active ? 'rgba(196,245,70,.4)' : 'var(--border)') + ';border-radius:10px;padding:14px 16px">' +
            '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">' +
              '<strong style="font-size:13px">' + esc(a.label) + '</strong>' +
              (a.active
                ? '<span style="font-size:10px;color:var(--accent-l);font-weight:800">ACTIVO · ' + price + '</span>'
                : '<span style="font-size:11px;color:var(--dim)">' + price + '</span>') +
            '</div>' +
            '<div style="font-size:11px;color:var(--dim);margin:8px 0 12px;line-height:1.5">' + esc(a.blurb || '') + '</div>' +
            btn +
          '</div>';
        }).join('') +
        '</div>' +
        // Packs de minutos de voz (compra puntual — amplían el cupo del mes)
        '<div style="margin-top:16px;border-top:1px solid var(--border);padding-top:14px">' +
          '<div style="font-size:12px;font-weight:700;margin-bottom:2px">🎙️ ¿Se te acaban los minutos de voz premium?</div>' +
          '<div style="font-size:11px;color:var(--dim);margin-bottom:10px">Compra minutos extra cuando los necesites. Se suman a tu cupo de este mes.</div>' +
          '<div style="display:flex;gap:10px;flex-wrap:wrap">' +
            '<button class="btn btn-d btn-sm" onclick="buyVoicePack(\'premium\')">+50 min Premium · 5€</button>' +
            '<button class="btn btn-d btn-sm" onclick="buyVoicePack(\'ultra\')">+100 min Ultra (Cartesia) · 5€</button>' +
          '</div>' +
        '</div>' +
      '</div>';
  } catch (e) { /* fail-open: sin tarjetas */ }
}
async function buyVoicePack(kind) {
  try {
    var d = await api('/api/portal/voice-pack/' + kind + '/checkout', 'POST', {});
    if (d && d.url) { window.location.href = d.url; }
    else { toast((d && d.error) || 'No se pudo iniciar la compra', 'err'); }
  } catch (e) { toast('❌ ' + e.message, 'err'); }
}
async function addonAction(key, action) {
  if (action === 'cancel' && !confirm('¿Cancelar este complemento? Dejará de cobrarse desde tu próxima factura.')) return;
  try {
    var d = await api('/api/portal/addons/' + key + '/' + action, 'POST', {});
    if (d && d.ok) {
      toast(action === 'activate' ? '✅ Complemento activado' : 'Complemento cancelado');
      loadAddonsBox();
    } else {
      toast((d && d.error) || 'No se pudo completar', 'err');
    }
  } catch (e) { toast('❌ ' + e.message, 'err'); }
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

// ── Embedded Signup oficial de Meta (self-service) ─────────────
// El popup de Meta devuelve por postMessage el phone_number_id y el
// waba_id (sessionInfo v3) y por FB.login el `code`; con las tres
// piezas el backend cierra la conexión (token, register, plantillas).
var _waEs = { phoneNumberId: null, wabaId: null, listening: false, cfg: null };

function _waEsListen() {
  if (_waEs.listening) return;
  _waEs.listening = true;
  window.addEventListener('message', function (ev) {
    if (ev.origin !== 'https://www.facebook.com' && ev.origin !== 'https://web.facebook.com') return;
    try {
      var d = JSON.parse(ev.data);
      if (d.type !== 'WA_EMBEDDED_SIGNUP') return;
      if (d.event === 'FINISH' && d.data) {
        _waEs.phoneNumberId = d.data.phone_number_id || null;
        _waEs.wabaId = d.data.waba_id || null;
      }
    } catch (e) { /* mensajes ajenos */ }
  });
}

function _waEsLoadSdk(appId) {
  return new Promise(function (resolve, reject) {
    if (window.FB) return resolve();
    window.fbAsyncInit = function () {
      FB.init({ appId: appId, autoLogAppEvents: true, xfbml: false, version: 'v21.0' });
      resolve();
    };
    var s = document.createElement('script');
    s.src = 'https://connect.facebook.net/es_ES/sdk.js';
    s.async = true; s.defer = true; s.crossOrigin = 'anonymous';
    s.onerror = function () { reject(new Error('No se pudo cargar el SDK de Meta')); };
    document.head.appendChild(s);
  });
}

async function startWaEmbeddedSignup() {
  try {
    if (!_waEs.cfg) _waEs.cfg = await api('/api/portal/whatsapp/es-config');
  } catch (e) { _waEs.cfg = { available: false }; }
  if (!_waEs.cfg || !_waEs.cfg.available) { openWaUpgrade(); return; }

  toast('Abriendo la conexión con WhatsApp…');
  try { await _waEsLoadSdk(_waEs.cfg.appId); } catch (e) { toast('❌ ' + e.message, 'err'); return; }
  _waEsListen();
  _waEs.phoneNumberId = null; _waEs.wabaId = null;

  FB.login(function (response) {
    if (response && response.authResponse && response.authResponse.code) {
      _waEsFinish(response.authResponse.code);
    } else {
      toast('Conexión cancelada — puedes intentarlo cuando quieras');
    }
  }, {
    config_id: _waEs.cfg.configId,
    response_type: 'code',
    override_default_response_type: true,
    extras: { setup: {}, featureType: '', sessionInfoVersion: '3' },
  });
}

async function _waEsFinish(code) {
  // el postMessage FINISH puede llegar unos ms después del callback de FB.login
  for (var i = 0; i < 20 && !_waEs.phoneNumberId; i++) { await new Promise(function (r) { setTimeout(r, 250); }); }
  if (!_waEs.phoneNumberId || !_waEs.wabaId) {
    toast('❌ Meta no devolvió el número. Cierra el popup e inténtalo de nuevo.', 'err');
    return;
  }
  toast('Conectando tu número… (unos segundos)');
  try {
    var out = await api('/api/portal/whatsapp/connect-meta', 'POST', {
      code: code, phoneNumberId: _waEs.phoneNumberId, wabaId: _waEs.wabaId,
    });
    if (out && out.ok) {
      toast('✅ ¡WhatsApp conectado! Tus avisos saldrán desde ' + (out.phoneNumber || 'tu número'));
      loadIntegraciones();
    } else {
      toast('❌ ' + ((out && out.error) || 'No se pudo completar la conexión'), 'err');
    }
  } catch (e) {
    if (e.status === 402 || /complemento/i.test(e.message || '')) { openWaUpgrade(); return; }
    toast('❌ ' + e.message, 'err');
  }
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

// Avisos por WhatsApp — dos niveles:
//   Incluido: salen del número verificado de NodeFlow, siempre nombrando al negocio.
//   Premium:  número propio del negocio (Meta Cloud API), montado por NodeFlow.
function renderWaCard(waStatus) {
  var connected = waStatus && waStatus.connected;                    // premium activo
  var sharedActive = !waStatus || waStatus.sharedActive !== false;   // incluido operativo

  var head =
    '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">' +
      '<div style="display:flex;align-items:center;gap:12px">' +
        '<div style="width:40px;height:40px;border-radius:10px;background:linear-gradient(135deg,#25d366,#128c7e);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">💬</div>' +
        '<div>' +
          '<div style="font-weight:700;font-size:14px">Avisos por WhatsApp</div>' +
          '<div style="font-size:11px;color:var(--dim);margin-top:2px">Recordatorios, confirmaciones y reseñas a tus clientes</div>' +
        '</div>' +
      '</div>';

  if (connected) {
    return '<div class="card" style="margin-bottom:20px;border-color:rgba(37,211,102,.3)">' +
      head +
      '<div style="display:flex;align-items:center;gap:8px">' +
        '<span class="badge bg" style="font-size:11px">✅ Tu propio número</span>' +
        '<button class="btn btn-d btn-sm" onclick="disconnectWa()">Desconectar</button>' +
      '</div></div>' +
      '<div style="margin-top:12px;font-size:12px;color:var(--dim)">Cada mensaje sale desde ' +
        '<span style="color:var(--text);font-weight:600">' + esc(waStatus.phoneNumber || '—') + '</span>, con tu marca. ' +
        'WABA: <code style="font-size:11px">' + esc(waStatus.wabaId || '—') + '</code></div>' +
    '</div>';
  }

  var includedBadge = sharedActive
    ? '<span class="badge bg" style="font-size:11px">✅ Incluido en tu plan</span>'
    : '<span class="badge by" style="font-size:11px">⏳ Activándose</span>';
  var includedText = sharedActive
    ? 'Tus avisos se envían desde el número verificado de NodeFlow, <strong style="color:var(--text)">siempre con el nombre de tu negocio</strong> en el mensaje. No tienes que configurar nada.'
    : 'El canal WhatsApp de NodeFlow está en activación. Mientras tanto tus avisos salen por email — en cuanto esté listo se activará solo.';

  return '<div class="card" style="margin-bottom:20px">' +
    head +
    '<div style="display:flex;align-items:center;gap:8px">' + includedBadge + '</div></div>' +
    '<div style="margin-top:10px;font-size:12px;color:var(--dim);line-height:1.6">' + includedText + '</div>' +
    '<div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">' +
      '<div style="font-size:12px;color:var(--dim);line-height:1.6;flex:1;min-width:220px">' +
        '<strong style="color:var(--text)">¿Quieres que salgan desde TU número?</strong><br>' +
        (waStatus && waStatus.hasAddon
          ? 'Tu complemento está activo: conecta tu WhatsApp de empresa en 2 minutos con el asistente oficial de Meta. Las plantillas se dan de alta solas.'
          : 'Número de WhatsApp de empresa propio, con tu nombre y tu logo. Nos encargamos de todo: alta con Meta, verificación y plantillas.') +
      '</div>' +
      (waStatus && waStatus.hasAddon
        ? '<button class="btn btn-accent btn-sm" onclick="startWaEmbeddedSignup()" style="white-space:nowrap">Conectar mi WhatsApp →</button>'
        : '<button class="btn btn-accent btn-sm" onclick="openWaUpgrade()" style="white-space:nowrap">Quiero mi número →</button>') +
    '</div>' +
  '</div>';
}

// Solicitud del nivel premium (alta gestionada por NodeFlow)
function openWaUpgrade() {
  openModal(
    '<div class="modal-title">Tu propio número de WhatsApp</div>' +
    '<p style="font-size:14px;color:var(--text);line-height:1.7;margin-bottom:12px">' +
      'Montamos tu número de WhatsApp de empresa de principio a fin: alta y verificación con Meta, ' +
      'plantillas aprobadas y conexión con tu asistente. Tus clientes verán <strong>tu nombre y tu logo</strong> en cada aviso.</p>' +
    '<p style="font-size:12px;color:var(--dim);line-height:1.6;margin-bottom:8px">' +
      'Si ya tienes un número de empresa lo conectamos; si no, te conseguimos uno. ' +
      'Es un proceso con Meta que gestionamos nosotros — tú solo firmas.</p>' +
    '<div class="modal-actions">' +
      '<button class="btn btn-d" onclick="closeModal()">Ahora no</button>' +
      '<button class="btn btn-accent" onclick="requestWaUpgrade(this)">Solicitar</button>' +
    '</div>');
}

// El mailto: abría el selector de aplicaciones/archivos en equipos sin
// cliente de correo (bug real 2026-07-03). La solicitud ahora viaja por
// nuestro servidor: el cliente solo ve la confirmación.
async function requestWaUpgrade(btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Enviando…'; }
  try {
    await api('/api/portal/whatsapp/request', 'POST', {});
    closeModal();
    toast('✅ Solicitud enviada — te contactamos en menos de 24h');
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Solicitar'; }
    toast('No se pudo enviar. Inténtalo de nuevo.');
  }
}

async function loadIntegraciones() {
  var sec = document.getElementById('sec-integraciones');
  sec.innerHTML = skelPanel();

  // Cargar estado WA y webhooks en paralelo
  var waStatus;
  try { waStatus = await loadWaStatus(); } catch(e) { waStatus = { connected: false }; }

  var calStatus;
  try { calStatus = await api('/api/calendar/status'); } catch(e) { calStatus = { enabled: false, connected: false }; }

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
        '<div class="kicker">Tu asistente</div><div class="section-title">Integraciones</div>' +
        '<div style="font-size:12px;color:var(--dim);margin-top:4px">Conecta tus herramientas: WhatsApp, Google Calendar y más</div>' +
      '</div>' +
    '</div>' +

    // ── Apps: WhatsApp + Google Calendar ─────────────────────────
    renderWaCard(waStatus) +
    renderCalendarCard(calStatus) +

    // ── Avanzado: Webhooks (desarrolladores) ─────────────────────
    '<details style="margin-top:8px">' +
      '<summary style="cursor:pointer;font-size:14px;font-weight:800;color:var(--dim);padding:12px 0;user-select:none">🌐 Avanzado — Webhooks para desarrolladores</summary>' +
      '<div style="display:flex;justify-content:flex-end;margin:6px 0 12px"><button class="btn btn-accent btn-sm" onclick="openNewWebhookModal()">+ Nuevo webhook</button></div>' +

    // Info box
    '<div style="background:rgba(196,245,70,.08);border:1px solid rgba(196,245,70,.2);border-radius:10px;padding:14px 16px;margin-bottom:20px;font-size:12px;color:var(--dim);line-height:1.6">' +
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
      '<pre style="background:var(--card2);border-radius:6px;padding:12px;margin-top:10px;font-size:11px;overflow-x:auto;color:#d6ff5c">' +
'// Node.js\n' +
'const sig = req.headers[\'x-nodeflow-signature\'];\n' +
'const expected = \'sha256=\' + crypto\n' +
'  .createHmac(\'sha256\', whsec_YOUR_SECRET)\n' +
'  .update(req.body).digest(\'hex\');\n' +
'const ok = crypto.timingSafeEqual(\n' +
'  Buffer.from(sig), Buffer.from(expected));' +
      '</pre>' +
    '</div>' +
    '</details>';
}

function renderCalendarCard(cal) {
  var enabled   = cal && cal.enabled;
  var connected = cal && cal.connected;
  var statusBadge = connected
    ? '<span class="badge bg" style="font-size:11px">✅ Conectado</span>'
    : (enabled ? '<span class="badge by" style="font-size:11px">Sin conectar</span>'
               : '<span class="badge bd" style="font-size:11px">🔜 Muy pronto</span>');
  var actionBtn = connected
    ? '<button class="btn btn-d btn-sm" onclick="disconnectCalendar()" style="margin-left:8px">Desconectar</button>'
    : (enabled ? '<button class="btn btn-accent btn-sm" onclick="connectGoogleCalendar(this)" style="margin-left:8px">Conectar</button>' : '');
  var info = connected
    ? '<div style="margin-top:10px;font-size:12px;color:var(--dim);line-height:1.6">El asistente consulta tu disponibilidad y crea las citas en tu calendario automáticamente durante la llamada.</div>'
    : (enabled
      ? '<div style="margin-top:10px;font-size:12px;color:var(--dim);line-height:1.6">Conéctalo para que el asistente <strong style="color:var(--text)">reserve citas en tu Google Calendar</strong> mientras habla con el cliente, consultando tu disponibilidad real.</div>'
      : '<div style="margin-top:10px;font-size:12px;color:var(--dim);line-height:1.6">Estamos terminando de activar esta integración. Muy pronto tu asistente podrá <strong style="color:var(--text)">reservar directamente en tu Google Calendar</strong>, consultando tu disponibilidad real. Mientras tanto, tus citas viven en la sección Citas.</div>');
  return '<div class="card" style="margin-bottom:20px;border-color:' + (connected ? 'rgba(66,133,244,.3)' : 'var(--border)') + '">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">' +
      '<div style="display:flex;align-items:center;gap:12px">' +
        '<div style="width:40px;height:40px;border-radius:10px;background:#fff;display:flex;align-items:center;justify-content:center;flex-shrink:0">' +
          '<svg width="22" height="22" viewBox="0 0 24 24" fill="#4285f4"><path d="M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2zm0 16H5V10h14v10zM5 8V6h14v2H5z"/></svg>' +
        '</div>' +
        '<div>' +
          '<div style="font-weight:700;font-size:14px">Google Calendar</div>' +
          '<div style="font-size:11px;color:var(--dim);margin-top:2px">Reserva y sincroniza citas automáticamente</div>' +
        '</div>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:8px">' + statusBadge + actionBtn + '</div>' +
    '</div>' + info +
  '</div>';
}

async function connectGoogleCalendar(btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Conectando…'; }
  try {
    var d = await api('/api/calendar/auth');
    if (d && d.url) { window.location.href = d.url; return; }
    throw new Error('No se pudo iniciar la conexión');
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Conectar'; }
    toast('Error al conectar: ' + (e.message || ''), 'err');
  }
}

async function disconnectCalendar() {
  try {
    await api('/api/calendar/disconnect', 'POST');
    toast('Google Calendar desconectado');
    loadIntegraciones();
  } catch (e) { toast('Error: ' + e.message, 'err'); }
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
    window._pendingWebhookSecret = data.webhook.secret;
    openModal(
      '<div class="modal-title">✅ Webhook creado</div>' +
      '<p style="font-size:13px;color:var(--dim);margin-bottom:12px">' +
        '⚠️ <strong style="color:#f59e0b">Guarda este secreto ahora.</strong> No se volverá a mostrar.' +
      '</p>' +
      '<textarea id="wh-secret-box" readonly style="width:100%;background:var(--card2);border-radius:8px;padding:12px;font-family:monospace;font-size:12px;word-break:break-all;color:#d6ff5c;border:none;resize:none;box-sizing:border-box" rows="3">' +
        esc(data.webhook.secret) +
      '</textarea>' +
      '<button class="btn btn-accent" style="width:100%;margin-top:10px" onclick="copyWebhookSecret()">' +
        '📋 Copiar y cerrar' +
      '</button>'
    );
  } catch (e) {
    toast('Error: ' + esc(e.message), 'err');
  }
}

function copyWebhookSecret() {
  var secret = window._pendingWebhookSecret || '';
  var el = document.getElementById('wh-secret-box');
  if (el) { el.select(); }
  if (navigator.clipboard && secret) {
    navigator.clipboard.writeText(secret).catch(function() {
      document.execCommand('copy');
    });
  } else {
    document.execCommand('copy');
  }
  window._pendingWebhookSecret = null;
  toast('Secreto copiado ✓');
  closeModal();
  loadIntegraciones();
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
  openModal(
    '<div class="modal-title">📞 Llamada saliente</div>' +
    '<p style="font-size:14px;margin:10px 0">El asistente AI llamará a <strong>' + esc(phone) + '</strong>.</p>' +
    '<div class="modal-actions">' +
      '<button class="btn btn-d" onclick="closeModal()">Cancelar</button>' +
      '<button class="btn btn-accent" onclick="closeModal();_doCallOutbound(' + JSON.stringify(phone) + ',window._callOutboundBtn)">Llamar</button>' +
    '</div>'
  );
  window._callOutboundBtn = btn;
}
async function _doCallOutbound(phone, btn) {
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
  loadFollowupRoi();    // Non-blocking: ROI del motor (citas atribuidas)

  // Wire up tab switching
  document.querySelectorAll('#sec-seguimientos .tab-btn').forEach(function(btn) {
    btn.onclick = function() {
      document.querySelectorAll('#sec-seguimientos .tab-btn').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      var tab = btn.dataset.tab;
      document.getElementById('tab-sugeridos').style.display = tab === 'sugeridos' ? '' : 'none';
      document.getElementById('tab-proximos').style.display  = tab === 'proximos'  ? '' : 'none';
      document.getElementById('tab-reglas').style.display    = tab === 'reglas'    ? '' : 'none';
      document.getElementById('tab-historial').style.display = tab === 'historial' ? '' : 'none';
      if (tab === 'sugeridos') loadFollowups();
      if (tab === 'proximos')  loadUpcomingReminders();
      if (tab === 'reglas')    loadFollowupRules();
      if (tab === 'historial') loadReminderHistory();
    };
  });
  await loadFollowups();
}

// ── ROI del motor: lo que los seguimientos han traído de verdad ──
// targetId opcional (2026-07-08): la misma tarjeta se pinta en Seguimientos
// (followup-roi) y en el DASHBOARD (dash-roi) — la cifra que renueva
// suscripciones debe estar en la primera pantalla, no escondida en una pestaña.
async function loadFollowupRoi(targetId) {
  var box = document.getElementById(targetId || 'followup-roi');
  if (!box) return;
  var r;
  try { r = await api('/api/portal/followup-roi'); }
  catch (e) { box.innerHTML = ''; return; }

  var t = (r && r.totals) || { count: 0, value: 0 };
  if (t.count > 0) {
    var partes = [];
    if (t.auto > 0)     partes.push(t.auto + ' de avisos automáticos');
    if (t.personal > 0) partes.push(t.personal + ' de tus mensajes personales');
    box.innerHTML =
      '<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;background:rgba(33,192,138,.08);border:1px solid rgba(33,192,138,.3);border-radius:12px;padding:14px 18px">' +
        '<div style="font-size:24px">💶</div>' +
        '<div style="flex:1;min-width:200px">' +
          '<div style="font-weight:800;color:var(--green2,#21c08a);font-size:15px">Tus seguimientos han traído ' + t.count + ' cita' + (t.count !== 1 ? 's' : '') +
            (t.value > 0 ? ' (~' + t.value + '€)' : '') + ' en 30 días</div>' +
          '<div style="color:var(--dim);font-size:12px;margin-top:2px">' + esc(partes.join(' · ')) + ' — cita creada en los 14 días tras el aviso, mismo teléfono</div>' +
        '</div>' +
      '</div>';
  } else if ((r.sentCount || 0) > 0) {
    box.innerHTML =
      '<div style="color:var(--dim);font-size:12px;padding:2px 4px">📤 ' + r.sentCount + ' seguimiento' + (r.sentCount !== 1 ? 's' : '') +
      ' enviado' + (r.sentCount !== 1 ? 's' : '') + ' en 30 días — cuando alguno acabe en cita lo verás aquí, con su valor.</div>';
  } else {
    box.innerHTML = '';
  }
}

// ── Seguimientos personalizados (sistema sugiere → tú revisas y envías) ──
async function loadFollowups() {
  var el = document.getElementById('followups-list');
  if (!el) return;
  el.innerHTML = '<div class="loading-msg">Cargando seguimientos...</div>';
  var res;
  try { res = await api('/api/portal/followups'); }
  catch (e) { el.innerHTML = '<div class="empty-state-text">No se pudieron cargar los seguimientos.</div>'; return; }

  var items = (res && res.followups) || [];
  if (!items.length) {
    el.innerHTML =
      '<div class="empty-state" style="text-align:center;padding:48px 24px">' +
        '<div style="font-size:32px;margin-bottom:12px">✅</div>' +
        '<div style="font-size:16px;font-weight:700;color:var(--text);margin-bottom:8px">No hay seguimientos pendientes</div>' +
        '<div class="empty-state-text" style="max-width:480px;margin:0 auto">Cuando alguien llame y no reserve, aparecerá aquí con un mensaje ya redactado para que le escribas tú desde tu WhatsApp. Sin recordatorios a destiempo: solo los que valen la pena.</div>' +
      '</div>';
    return;
  }

  el.innerHTML =
    '<div style="color:var(--dim);font-size:13px;margin-bottom:14px">' + items.length +
    ' cliente' + (items.length !== 1 ? 's' : '') + ' llamaron y no reservaron. Revisa el mensaje, edítalo si quieres y envíalo desde tu WhatsApp.</div>' +
    items.map(followupCard).join('');
}

function _fuReason(r) {
  if (r === 'callback_requested') return 'Dejó sus datos';
  if (r === 'abandoned') return 'Se cortó la llamada';
  return 'Consultó, no reservó';
}
function _fuAgo(iso) {
  if (!iso) return '';
  var d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (d <= 0) return 'hoy';
  if (d === 1) return 'ayer';
  return 'hace ' + d + ' días';
}

// Teléfono legible: "612 345 678" para nacionales (quita +34/0034); el resto tal cual.
function _fuPhoneFmt(p) {
  var raw = String(p || '').trim();
  var d = raw.replace(/[^0-9]/g, '');
  if (!d) return '';
  if (d.length === 11 && d.indexOf('34') === 0) d = d.slice(2);
  else if (d.length === 13 && d.indexOf('0034') === 0) d = d.slice(4);
  if (d.length === 9) return d.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3');
  return raw;
}

function followupCard(f) {
  // Nombre + teléfono SIEMPRE: con tres "Raúl" en la lista solo el número los
  // distingue (bug 2026-07-08). Sin nombre, el teléfono solo.
  var phoneFmt = _fuPhoneFmt(f.phone);
  var who = esc(f.name ? (phoneFmt ? f.name + ' · ' + phoneFmt : f.name) : (phoneFmt || 'Cliente'));
  var id  = esc(f.callId);
  return '' +
    '<div class="fu-card" data-fu="' + id + '" style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:12px">' +
      '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-bottom:10px">' +
        '<div style="font-weight:700;color:var(--text);font-size:15px">' + who + '</div>' +
        '<div style="color:var(--dim);font-size:12px;white-space:nowrap">' + esc(_fuReason(f.reason)) + ' · ' + esc(_fuAgo(f.when)) + '</div>' +
      '</div>' +
      '<textarea class="fu-msg" style="width:100%;min-height:76px;resize:vertical;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:14px;font-family:inherit;line-height:1.5">' + esc(f.draft) + '</textarea>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">' +
        '<button onclick="fuSendLink(\'' + id + '\',\'' + esc(f.phone || '') + '\')" style="background:#25D366;color:#fff;border:none;border-radius:8px;padding:9px 16px;font-size:13px;font-weight:700;cursor:pointer">📱 Enviar por WhatsApp</button>' +
        '<button onclick="fuSendApi(\'' + id + '\')" style="background:transparent;color:var(--dim);border:1px solid var(--border);border-radius:8px;padding:9px 14px;font-size:13px;cursor:pointer">Enviar desde mi número</button>' +
        '<button onclick="fuDismiss(\'' + id + '\')" style="background:transparent;color:var(--dim);border:none;padding:9px 8px;font-size:13px;cursor:pointer;margin-left:auto">Descartar</button>' +
      '</div>' +
    '</div>';
}

// Elimina suplentes UTF-16 huérfanos (p. ej. un pegado que cortó un emoji por
// la mitad): encodeURIComponent LANZA URIError con ellos (el botón moriría en
// silencio) y por otras vías acaban pintados como "�" en WhatsApp.
function _fuWellFormed(s) {
  var out = '', i, c, d;
  for (i = 0; i < s.length; i++) {
    c = s.charCodeAt(i);
    if (c >= 0xD800 && c <= 0xDBFF) {           // suplente alto…
      d = s.charCodeAt(i + 1);
      if (d >= 0xDC00 && d <= 0xDFFF) { out += s[i] + s[i + 1]; i++; }  // …con pareja: emoji válido
    } else if (!(c >= 0xDC00 && c <= 0xDFFF)) { // bajo huérfano → fuera
      out += s[i];
    }
  }
  return out;
}
function _fuMsg(id) {
  var card = document.querySelector('.fu-card[data-fu="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
  return card ? _fuWellFormed(card.querySelector('.fu-msg').value).trim() : '';
}
function _fuRemove(id) {
  var card = document.querySelector('.fu-card[data-fu="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
  if (card) card.remove();
  var left = document.querySelectorAll('#followups-list .fu-card').length;
  if (!left) loadFollowups();
}

// Vía wa.me: abre WhatsApp con el mensaje puesto, lo envía él → sin límite de plantilla.
async function fuSendLink(id, phone) {
  var msg = _fuMsg(id);
  var num = String(phone || '').replace(/[^0-9]/g, '');
  if (num.length === 9) num = '34' + num;   // fijo/móvil español sin prefijo → wa.me lo necesita
  window.open('https://wa.me/' + num + '?text=' + encodeURIComponent(msg), '_blank');
  try { await api('/api/portal/followups/' + id + '/done', 'POST', { channel: 'wa_link' }); } catch (e) {}
  toast('Seguimiento marcado como enviado');
  _fuRemove(id);
}

// Vía API del número propio (add-on). Fuera de la ventana 24h Meta lo rechaza → guía al enlace.
async function fuSendApi(id) {
  var msg = _fuMsg(id);
  if (!msg) return;
  try {
    await api('/api/portal/followups/' + id + '/send', 'POST', { message: msg });
    toast('Enviado desde tu número ✓');
    _fuRemove(id);
  } catch (e) {
    toast((e && e.message) || 'No se pudo enviar', 'err');
  }
}

async function fuDismiss(id) {
  try { await api('/api/portal/followups/' + id + '/done', 'POST', { channel: 'dismissed' }); } catch (e) {}
  _fuRemove(id);
}

// ── Reglas de seguimiento por sector ──────────────────────────
var _rulesState = { sector: '', channels: ['whatsapp','sms','email'], triggers: [] };
var _CH_LABEL = { whatsapp: 'WhatsApp', sms: 'SMS', email: 'Email' };

async function loadFollowupRules() {
  var el = document.getElementById('rules-body');
  if (!el) return;
  el.innerHTML = '<div class="loading-msg">Cargando reglas...</div>';
  var res;
  try { res = await api('/api/portal/followup-rules'); }
  catch (e) { el.innerHTML = '<div class="empty-state-text">No se pudieron cargar las reglas.</div>'; return; }

  _rulesState.sector = res.sector;
  _rulesState.channels = res.channels || _rulesState.channels;
  _rulesState.triggers = res.customTriggers || [];
  _rulesState.cap = (res.frequencyCapDays != null ? res.frequencyCapDays : 7);
  _rulesState.fieldCoverage = res.fieldCoverage || {};
  var defaults = (res.rules || []).filter(function(r){ return !r.custom; });
  var custom   = (res.rules || []).filter(function(r){ return r.custom; });

  // Aviso honesto de canales: qué puede enviar HOY de verdad.
  var chLive = res.channelsLive || {};
  var chNotice = '';
  if (chLive.whatsapp === false) {
    var fallbacks = [chLive.sms && 'SMS', chLive.email && 'email'].filter(Boolean);
    chNotice = '<div style="display:flex;gap:8px;align-items:flex-start;background:rgba(253,203,110,.08);border:1px solid rgba(253,203,110,.3);border-radius:10px;padding:10px 14px;margin-bottom:14px">' +
      '<span>📡</span><div style="font-size:12px;color:var(--dim);line-height:1.5">' +
      (fallbacks.length
        ? '<strong style="color:var(--text)">WhatsApp está en activación</strong> — mientras tanto, tus seguimientos saldrán por ' + fallbacks.join(' y ') + '. En cuanto WhatsApp esté activo, pasarán solos a WhatsApp.'
        : '<strong style="color:var(--text)">Ningún canal de envío está activo todavía</strong> — los avisos que venzan ahora no podrán entregarse. Contacta con NodeFlow para activar WhatsApp antes de que venza el primero.') +
      '</div></div>';
  }

  var head =
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:6px">' +
      '<div>' +
        '<div style="font-size:15px;font-weight:700;color:var(--text)">Motor de seguimientos' + (res.sectorLabel ? ' · ' + esc(res.sectorLabel) : '') + '</div>' +
        '<div style="color:var(--dim);font-size:13px;margin-top:2px">Estos son los avisos que tu asistente enviará solo. Ajusta el cuándo, el canal, o añade los tuyos.</div>' +
      '</div>' +
      '<button class="btn btn-accent btn-sm" onclick="saveFollowupRules(this)">Guardar cambios</button>' +
    '</div>' +
    '<div id="rules-reach" style="font-size:13px;color:var(--accent-l);min-height:18px;margin-bottom:14px"></div>' +
    '<div id="rules-msgusage" style="font-size:12px;color:var(--dim);margin:-8px 0 12px"></div>' +
    chNotice +
    '<div id="rules-suggestions"></div>' +
    '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 12px;border:1px solid var(--border);border-radius:10px;background:var(--card);margin-bottom:18px">' +
      '<span style="font-size:16px">🛡️</span>' +
      '<span style="font-size:13px;color:var(--text)">No enviar más de un seguimiento al mismo cliente cada</span>' +
      '<input type="number" id="rules-cap" min="0" max="90" value="' + _rulesState.cap + '" style="width:58px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:5px 6px;font-size:13px;text-align:center">' +
      '<span style="font-size:13px;color:var(--dim)">días (0 = sin límite). Si coinciden, el aviso se pospone, no se pierde.</span>' +
    '</div>';

  var defaultsHtml = defaults.length
    ? '<div style="font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:var(--dim);margin:6px 0 8px">Incluidos en tu sector</div>' +
      defaults.map(ruleRow).join('')
    : '<div style="color:var(--dim);font-size:13px;margin-bottom:12px">Tu sector no trae seguimientos de fábrica — añade los tuyos abajo.</div>';

  var customHtml =
    '<div style="font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:var(--dim);margin:20px 0 8px">Tuyos personalizados</div>' +
    '<div id="rules-custom">' + (custom.length ? custom.map(ruleRow).join('') : '') + '</div>' +
    '<button class="btn btn-d btn-sm" style="margin-top:8px" onclick="addCustomRuleRow()">+ Añadir seguimiento</button>' +
    '<div id="rules-recipes"></div>';

  el.innerHTML = head + defaultsHtml + customHtml + '<div id="rules-campaigns"></div>';

  loadRulesReach();
  loadRuleSuggestions();
  loadRuleRecipes();
  loadMsgUsage();
  loadCampaigns();
}

// ✉️ Contador del paquete de mensajes — transparencia total: nadie descubre
// un cargo en la factura, lo ve aquí antes.
async function loadMsgUsage() {
  var el = document.getElementById('rules-msgusage');
  if (!el) return;
  try {
    var u = await api('/api/portal/message-usage');
    var pct = Math.min(100, Math.round((u.used / Math.max(1, u.included)) * 100));
    el.innerHTML = '✉️ Mensajes de automatización este mes: <strong style="color:var(--text)">' + u.used + '</strong> / ' + u.included + ' incluidos' +
      (u.overage > 0
        ? ' · <span style="color:#e0a030">' + u.overage + ' extra ≈ ' + u.overageEur.toFixed(2) + '€ (' + u.ratePerMessage.toFixed(2) + '€/mensaje)</span>'
        : ' <span style="color:var(--muted)">(' + pct + '%)</span>');
  } catch (e) { el.textContent = ''; }
}

// ── 🗓️ Campañas del año: estacionales de un clic ────────────────────────────
async function loadCampaigns() {
  var box = document.getElementById('rules-campaigns');
  if (!box) return;
  var r;
  try { r = await api('/api/portal/campaigns'); } catch (e) { return; }
  var list = (r && r.campaigns) || [];
  if (!list.length) { box.innerHTML = ''; return; }
  var MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  box.innerHTML =
    '<div style="font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:var(--dim);margin:22px 0 8px">🗓️ Campañas del año de tu sector</div>' +
    '<div style="font-size:12px;color:var(--dim);margin-bottom:10px">Actívalas una vez y cada año salen solas en su fecha, a tus ' + (r.audience || 0) + ' clientes elegibles (cuentan para tu paquete de mensajes).</div>' +
    list.map(function(c) {
      return '<div style="display:flex;gap:12px;align-items:flex-start;padding:12px;border:1px solid ' + (c.enabled ? 'rgba(196,245,70,.35)' : 'var(--border)') + ';border-radius:10px;margin-bottom:8px;background:var(--card)">' +
        '<label style="display:flex;align-items:center;padding-top:2px;cursor:pointer">' +
          '<input type="checkbox"' + (c.enabled ? ' checked' : '') + ' onchange="toggleCampaign(\'' + esc(c.key) + '\', this.checked, this)" style="width:16px;height:16px;cursor:pointer">' +
        '</label>' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-weight:600;color:var(--text);font-size:14px">' + esc(c.name) +
            ' <span style="font-size:11px;color:var(--accent-l);font-weight:600">· cada ' + c.day + ' de ' + MESES[c.month - 1] + '</span>' +
            (c.lastFiredYear ? ' <span style="font-size:10px;color:var(--muted)">· última: ' + c.lastFiredYear + '</span>' : '') + '</div>' +
          '<div style="color:var(--dim);font-size:12px;margin-top:2px;font-style:italic">"…' + esc(c.text) + '"</div>' +
        '</div>' +
      '</div>';
    }).join('');
}

async function toggleCampaign(key, enabled, el) {
  try {
    await api('/api/portal/campaigns', 'PUT', { key: key, enabled: enabled });
    toast(enabled ? '🗓️ Campaña activada — saldrá sola en su fecha' : 'Campaña desactivada');
    loadCampaigns();
  } catch (e) {
    if (el) el.checked = !enabled;
    toast('Error: ' + e.message, 'err');
  }
}

// ── Recetario: ideas curadas del sector, se añaden con un clic ──
async function loadRuleRecipes() {
  var box = document.getElementById('rules-recipes');
  if (!box) return;
  var res;
  try { res = await api('/api/portal/followup-rules/recipes'); }
  catch (e) { return; }
  var recipes = (res && res.recipes) || [];
  _rulesState.recipes = recipes;
  if (!recipes.length) { box.innerHTML = ''; return; }

  box.innerHTML =
    '<div style="font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:var(--dim);margin:24px 0 8px">💡 Ideas para tu sector</div>' +
    '<div style="color:var(--dim);font-size:12px;margin-bottom:10px">Mejores prácticas de negocios como el tuyo. Añádelas con un clic, ajusta los días si quieres, y guarda.</div>' +
    recipes.map(function(r, i) {
      return '<div class="recipe-card" data-recipe="' + i + '" style="display:flex;gap:12px;align-items:flex-start;padding:12px 14px;border:1px dashed var(--border);border-radius:10px;margin-bottom:8px;background:transparent">' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-weight:600;color:var(--text);font-size:14px">' + esc(r.label) +
            ' <span style="color:var(--dim);font-weight:400;font-size:12px">· ' + r.days + ' días</span></div>' +
          '<div style="color:var(--dim);font-size:12px;line-height:1.55;margin-top:3px">' + esc(r.tip) + '</div>' +
        '</div>' +
        '<button onclick="addRecipeRow(' + i + ')" style="background:transparent;color:var(--accent-l);border:1px solid rgba(196,245,70,.4);border-radius:8px;padding:7px 14px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap">+ Añadir</button>' +
      '</div>';
    }).join('');
}

function addRecipeRow(i) {
  var r = (_rulesState.recipes || [])[i];
  var box = document.getElementById('rules-custom');
  if (!r || !box) return;
  var tmp = document.createElement('div');
  tmp.innerHTML = ruleRow({
    key: 'custom_nuevo', custom: true, editableDays: true, enabled: true,
    trigger: r.trigger, days: r.days, channel: 'whatsapp',
    label: r.label, serviceFilter: r.serviceFilter || [],
  });
  box.appendChild(tmp.firstChild);
  var card = document.querySelector('.recipe-card[data-recipe="' + i + '"]');
  if (card) card.remove();
  // Última idea añadida → fuera también la cabecera (quedaba huérfana:
  // "Ideas para tu sector" sin ideas debajo — reporte de Unai 2026-07-07).
  if (!document.querySelector('#rules-recipes .recipe-card')) {
    var rbox = document.getElementById('rules-recipes');
    if (rbox) rbox.innerHTML = '';
  }
  toast('Añadido — revisa los días y pulsa "Guardar cambios"');
  box.lastChild.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// El sistema aprende de las citas reales y propone ajustes; el dueño aprueba.
async function loadRuleSuggestions() {
  var box = document.getElementById('rules-suggestions');
  if (!box) return;
  var res;
  try { res = await api('/api/portal/followup-rules/suggestions'); }
  catch (e) { return; }
  var items = (res && res.suggestions) || [];
  if (!items.length) { box.innerHTML = ''; return; }

  box.innerHTML =
    '<div style="border:1px solid rgba(196,245,70,.3);background:rgba(196,245,70,.06);border-radius:12px;padding:14px 16px;margin-bottom:18px">' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">' +
        '<span style="font-size:16px">💡</span>' +
        '<span style="font-weight:700;color:var(--accent-l);font-size:14px">Sugerencias de tus datos</span>' +
        '<span style="color:var(--dim);font-size:12px">— NodeFlow ha mirado tus citas</span>' +
      '</div>' +
      items.map(suggestionCard).join('') +
    '</div>';
}

function suggestionCard(s) {
  var id = esc(s.id);
  return '<div class="sug-card" data-sug="' + id + '" style="display:flex;gap:12px;align-items:flex-start;padding:10px 0;border-top:1px solid rgba(196,245,70,.15)">' +
    '<div style="flex:1;min-width:0">' +
      '<div style="font-weight:600;color:var(--text);font-size:14px">' + esc(s.title) + '</div>' +
      '<div style="color:var(--dim);font-size:13px;margin-top:2px;line-height:1.5">' + esc(s.detail) + '</div>' +
      '<div style="color:var(--dim);font-size:11px;margin-top:3px">Basado en ' + (s.sampleSize || 0) + ' ' + (s.type === 'timing' ? 'retornos' : 'citas') + '</div>' +
    '</div>' +
    '<div style="display:flex;flex-direction:column;gap:6px;white-space:nowrap">' +
      '<button onclick="applySuggestion(\'' + id + '\')" style="background:var(--accent);color:#0a0b0d;border:none;border-radius:8px;padding:7px 14px;font-size:13px;font-weight:700;cursor:pointer">Aplicar</button>' +
      '<button onclick="dismissSuggestion(\'' + id + '\')" style="background:transparent;color:var(--dim);border:none;font-size:12px;cursor:pointer">Descartar</button>' +
    '</div>' +
  '</div>';
}

function _sugRemove(id) {
  var c = document.querySelector('.sug-card[data-sug="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
  if (c) c.remove();
  if (!document.querySelectorAll('#rules-suggestions .sug-card').length) {
    var box = document.getElementById('rules-suggestions'); if (box) box.innerHTML = '';
  }
}

async function applySuggestion(id) {
  try {
    await api('/api/portal/followup-rules/suggestions/apply', 'POST', { id: id });
    toast('Regla ajustada ✓');
    loadFollowupRules();   // recarga reglas + sugerencias
  } catch (e) { toast(e.message || 'No se pudo aplicar', 'err'); }
}

async function dismissSuggestion(id) {
  try { await api('/api/portal/followup-rules/suggestions/dismiss', 'POST', { id: id }); } catch (e) {}
  _sugRemove(id);
}

function _chanSelect(sel) {
  return '<select class="rule-ch" style="background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:5px 6px;font-size:12px">' +
    _rulesState.channels.map(function(c){ return '<option value="' + c + '"' + (c === sel ? ' selected' : '') + '>' + _CH_LABEL[c] + '</option>'; }).join('') +
  '</select>';
}

// Cobertura de la fecha de una regla: cuántas fichas la tienen rellenada.
// Con 0, la regla no envía nada — mejor decirlo aquí que dejar al dueño
// pensando que está rota (auditoría 2026-07-07).
function _coverageNote(r) {
  var cov = _rulesState.fieldCoverage || {};
  if (!(r.key in cov)) return '';
  var n = cov[r.key];
  return n === 0
    ? ' <span style="color:#e0a030">⚠️ Ningún cliente tiene esta fecha rellenada aún — hasta entonces no se envía nada.</span>'
    : ' <span style="color:var(--dim)">✓ ' + n + ' cliente' + (n === 1 ? '' : 's') + ' con la fecha rellenada.</span>';
}

function ruleRow(r) {
  var isCustom = !!r.custom;
  var daysCell = r.editableDays
    ? '<input type="number" class="rule-days" min="1" max="3650" value="' + (r.days != null ? r.days : '') + '" style="width:64px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:5px 6px;font-size:13px"> <span style="color:var(--dim);font-size:12px">días</span>'
    : '<span style="color:var(--dim);font-size:12px">' + esc(r.triggerLabel || '') + '</span>';

  var nameCell = isCustom
    ? '<input type="text" class="rule-label" value="' + esc(r.label || '') + '" placeholder="Nombre del seguimiento" style="width:100%;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:6px 8px;font-size:14px;font-weight:600">' +
      '<input type="text" class="rule-filter" value="' + esc((r.serviceFilter || []).join(', ')) + '" placeholder="Solo tras (palabras, opcional): corte, mechas…" style="width:100%;margin-top:5px;background:var(--bg);color:var(--dim);border:1px solid var(--border);border-radius:6px;padding:5px 8px;font-size:12px">' +
      '<input type="text" class="rule-text" maxlength="250" value="' + esc(r.customText || '') + '" placeholder="✍️ Mensaje 100% tuyo (opcional) — usa {detalle} para el dato de cada ficha" style="width:100%;margin-top:5px;background:var(--bg);color:var(--dim);border:1px solid rgba(196,245,70,.25);border-radius:6px;padding:5px 8px;font-size:12px">' +
      (r.trigger === 'before_sector_field' ? '<div style="font-size:11px;color:var(--accent-l);margin-top:4px">📅 La fecha "' + esc(r.label || 'de esta regla') + '" aparecerá en la ficha de cada cliente para rellenar.' + _coverageNote(r) + '</div>' : '')
    : '<div style="font-weight:600;color:var(--text);font-size:14px">' + esc(r.label) +
        (r.applies === false ? ' <span style="font-size:10px;font-weight:600;color:#e0a030;background:rgba(224,160,48,.12);border:1px solid rgba(224,160,48,.3);border-radius:5px;padding:1px 7px;vertical-align:middle" data-tip="Ninguno de tus servicios casa con este seguimiento. Actívalo solo si lo ofreces.">no ofreces este servicio</span>' : '') +
      '</div>' +
      '<div style="color:var(--dim);font-size:12px;margin-top:1px">' + esc(r.desc || '') + _coverageNote(r) +
        (r.noData ? ' <span style="color:var(--green2,#21c08a)">✓ Funciona solo, sin rellenar nada.</span>' : '') + '</div>';

  var trigCell = isCustom
    ? '<select class="rule-trigger" style="background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:5px 6px;font-size:12px;max-width:220px">' +
        _rulesState.triggers.map(function(t){ return '<option value="' + t.value + '"' + (t.value === r.trigger ? ' selected' : '') + '>' + esc(t.label) + '</option>'; }).join('') +
      '</select>'
    : '';

  return '<div class="rule-row" data-key="' + esc(r.key) + '" data-custom="' + (isCustom ? '1' : '0') + '" data-trigger="' + esc(r.trigger) + '" data-servicelabel="' + esc(r.serviceLabel || '') + '" data-editabledays="' + (r.editableDays ? '1' : '0') +
    '" style="display:flex;gap:12px;align-items:flex-start;padding:12px;border:1px solid var(--border);border-radius:10px;margin-bottom:8px;background:var(--card)">' +
    '<label style="display:flex;align-items:center;padding-top:2px;cursor:pointer"><input type="checkbox" class="rule-enabled"' + (r.enabled ? ' checked' : '') + ' style="width:16px;height:16px;cursor:pointer"></label>' +
    '<div style="flex:1;min-width:0">' + nameCell + (isCustom ? '<div style="margin-top:6px">' + trigCell + '</div>' : '') + '</div>' +
    '<div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end;white-space:nowrap">' +
      '<div>' + daysCell + '</div>' +
      _chanSelect(r.channel) +
      (isCustom ? '<button onclick="this.closest(\'.rule-row\').remove()" style="background:transparent;border:none;color:var(--dim);font-size:12px;cursor:pointer;padding:2px">Eliminar</button>' : '') +
    '</div>' +
  '</div>';
}

function addCustomRuleRow() {
  var box = document.getElementById('rules-custom');
  if (!box) return;
  var t0 = (_rulesState.triggers[0] || { value: 'from_last_appointment' }).value;
  var tmp = document.createElement('div');
  tmp.innerHTML = ruleRow({ key: 'custom_nuevo', custom: true, editableDays: true, enabled: true, trigger: t0, days: 30, channel: 'whatsapp', label: '', serviceFilter: [] });
  box.appendChild(tmp.firstChild);
  var input = box.lastChild.querySelector('.rule-label');
  if (input) input.focus();
}

async function saveFollowupRules(btn) {
  var overrides = {}, custom = [];
  var rows = document.querySelectorAll('#tab-reglas .rule-row');
  var invalid = false;
  rows.forEach(function(row){
    var enabled = row.querySelector('.rule-enabled').checked;
    var chEl = row.querySelector('.rule-ch');
    var channel = chEl ? chEl.value : 'whatsapp';
    var daysEl = row.querySelector('.rule-days');
    var days = daysEl ? parseInt(daysEl.value, 10) : null;
    if (row.dataset.custom === '1') {
      var label = (row.querySelector('.rule-label').value || '').trim();
      if (!label) return; // fila vacía → se ignora
      if (!days) { invalid = true; }
      var trigEl = row.querySelector('.rule-trigger');
      var filter = (row.querySelector('.rule-filter').value || '').trim();
      var textEl = row.querySelector('.rule-text');
      var customText = textEl ? (textEl.value || '').trim() : '';
      custom.push({
        key: /^custom_/.test(row.dataset.key) && row.dataset.key !== 'custom_nuevo' ? row.dataset.key : undefined,
        label: label, trigger: trigEl ? trigEl.value : row.dataset.trigger,
        days: days, serviceFilter: filter || undefined, channel: channel, enabled: enabled,
        serviceLabel: row.dataset.servicelabel || undefined,
        customText: customText || undefined,
      });
    } else {
      var ov = { enabled: enabled, channel: channel };
      if (row.dataset.editabledays === '1' && days) ov.days = days;
      overrides[row.dataset.key] = ov;
    }
  });
  if (invalid) { toast('Pon los días de cada seguimiento personalizado', 'err'); return; }

  var capEl = document.getElementById('rules-cap');
  var cap = capEl ? parseInt(capEl.value, 10) : undefined;

  if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
  try {
    await api('/api/portal/followup-rules', 'PUT', { overrides: overrides, custom: custom, frequencyCapDays: (isNaN(cap) ? undefined : cap) });
    toast('Reglas guardadas');
    loadFollowupRules();
  } catch (e) {
    toast(e.message || 'No se pudo guardar', 'err');
    if (btn) { btn.disabled = false; btn.textContent = 'Guardar cambios'; }
  }
}

async function loadRulesReach() {
  var el = document.getElementById('rules-reach');
  if (!el) return;
  try {
    var r = await api('/api/portal/followup-rules/reach');
    if (r && r.total > 0) {
      el.innerHTML = '<i>≈ ' + r.total + ' cliente' + (r.total !== 1 ? 's' : '') + ' recibirán un seguimiento en los próximos ' + r.horizon + ' días con estas reglas.</i>';
    } else { el.textContent = ''; }
  } catch (e) { el.textContent = ''; }
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
      '<div style="background:rgba(196,245,70,.08);border:1px solid rgba(196,245,70,.25);border-radius:10px;padding:14px 18px;display:flex;align-items:center;gap:14px">' +
        '<div style="font-size:22px">💡</div>' +
        '<div style="flex:1">' +
          '<div style="font-weight:700;color:var(--accent-l);font-size:14px">Activa los recordatorios automáticos</div>' +
          '<div style="color:var(--dim);font-size:13px;margin-top:2px">Completa los datos de ' + n + ' cliente' + (n !== 1 ? 's' : '') + ' para que el sistema empiece a funcionar</div>' +
        '</div>' +
        '<button onclick="openSectorWizard()" style="background:var(--accent);color:#0a0b0d;border:none;border-radius:8px;padding:8px 16px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap">Completar →</button>' +
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
    openModal('<div class="modal-title">Error</div><p style="color:var(--red)">' + esc(e.message) + '</p><div class="modal-actions"><button class="btn" onclick="closeModal()">Cerrar</button></div>');
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
        '<div style="color:var(--dim);font-size:13px">Completa los datos de tus clientes para activar los recordatorios</div>' +
      '</div>' +
      '<button onclick="closeWizardModal()" style="background:none;border:none;font-size:20px;color:var(--muted);cursor:pointer;padding:0 0 0 12px">✕</button>' +
    '</div>' +
    '<div style="margin:14px 0 4px">' +
      '<div style="background:rgba(255,255,255,.1);border-radius:8px;height:8px;overflow:hidden">' +
        '<div id="wizard-progress-bar" style="background:var(--accent);height:8px;border-radius:8px;transition:width 0.3s;width:' + pct + '%"></div>' +
      '</div>' +
      '<div id="wizard-progress-text" style="color:var(--dim);font-size:12px;margin-top:4px">' + done + ' de ' + total + ' completados</div>' +
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
      statusBadge = '<span style="color:var(--muted);font-size:12px">omitido</span>';
      rowBg = 'rgba(255,255,255,.03)';
    } else {
      statusBadge = '<span style="color:var(--dim);font-size:12px">toca para completar ▸</span>';
      rowBg = '#fff';
    }
    return '<div id="wc-row-' + c.id + '" onclick="expandWizardContact(\'' + c.id + '\')" ' +
      'style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:' + rowBg + ';border:1px solid rgba(255,255,255,.1);border-radius:8px;margin-bottom:6px;cursor:pointer">' +
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
      '<label style="display:block;font-size:11px;color:var(--dim);font-weight:600;margin-bottom:3px">' + esc(f.label) + (f.optional ? ' <span style="color:var(--muted);font-weight:400">(opcional)</span>' : '') + '</label>' +
      '<input id="wf-' + contactId + '-' + f.key + '" type="' + (f.type === 'date' ? 'text' : f.type) + '" ' +
        'placeholder="' + esc(f.placeholder) + '" value="' + esc(currentVal) + '" ' +
        'style="width:100%;border:1px solid #93c5fd;border-radius:6px;padding:7px 10px;font-size:13px;box-sizing:border-box">' +
    '</div>';
  }).join('');

  formEl.innerHTML =
    '<div style="background:rgba(196,245,70,.08);border:1px solid rgba(196,245,70,.25);border-radius:8px;padding:12px 14px;margin-bottom:6px">' +
    fieldsHtml +
    '<div id="wf-err-' + contactId + '" style="color:var(--red);font-size:12px;display:none;margin-bottom:6px"></div>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:4px">' +
      '<button onclick="skipWizardContact(\'' + contactId + '\')" style="background:rgba(255,255,255,.05);border:none;border-radius:6px;padding:7px 14px;font-size:12px;color:var(--dim);cursor:pointer">Omitir</button>' +
      '<button onclick="saveWizardContact(\'' + contactId + '\')" style="background:var(--accent);color:#0a0b0d;border:none;border-radius:6px;padding:7px 14px;font-size:13px;font-weight:600;cursor:pointer">Guardar →</button>' +
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
    rowEl.style.background = 'rgba(255,255,255,.03)';
    rowEl.onclick = null;
    rowEl.innerHTML = '<span style="font-weight:500;flex:1;font-size:13px">' + esc(contact ? (contact.name || contact.phone || contact.id) : contactId) + '</span><span style="color:var(--muted);font-size:12px">omitido</span>';
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
        '<div style="color:var(--dim);font-size:14px">Los recordatorios se calcularán automáticamente en los próximos minutos.</div>' +
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

var _upcomingReminders = [];
var _calSelectedDay = null;   // 'YYYY-MM-DD' o null = todos

async function loadUpcomingReminders() {
  loadAutoRulesPanel();   // arriba del todo: qué está activo, qué espera, y crear
  var container = document.getElementById('reminders-upcoming-list');
  container.innerHTML = '<div class="loading-msg">Cargando...</div>';
  var calBox = document.getElementById('reminders-calendar');
  if (calBox) calBox.innerHTML = '';
  _calSelectedDay = null;

  var res;
  try {
    res = await api('/api/portal/reminders/upcoming');
  } catch (e) {
    container.innerHTML = '<p style="color:#888;text-align:center;padding:20px">Error al cargar: ' + esc(e.message) + '</p>';
    return;
  }

  if (!res || !res.reminders || !res.reminders.length) {
    // Sin avisos EN COLA todavía. No es un callejón sin salida: el panel de
    // arriba ya dice qué reglas están activas y deja crear las tuyas.
    container.innerHTML =
      '<div class="empty-state" style="padding:36px 24px">' +
        '<div class="empty-state-icon">🔄</div>' +
        '<div style="font-size:16px;font-weight:700;color:var(--text);margin-bottom:8px">Aún no hay ningún aviso en cola</div>' +
        '<div class="empty-state-text" style="max-width:520px;margin:0 auto">En cuanto una de tus reglas de arriba encuentre un cliente que toque avisar (por ejemplo, alguien que llegue a los días marcados desde su última visita o desde que lo diste de alta), el aviso aparecerá aquí con su fecha exacta. Puedes crear las tuyas con el botón de arriba.</div>' +
      '</div>';
    return;
  }

  _upcomingReminders = res.reminders;
  renderRemindersCalendar();
  renderUpcomingList();
}

// ── Panel "Recordatorios automáticos": qué está ACTIVO, qué ESPERA (y por qué,
// con el arreglo), y el botón para crear los tuyos. Nace del dolor de Unai:
// la pestaña estaba vacía y no había forma de crear reglas (2026-07-08). ──
function _autoRuleStatus(r, fieldCoverage, chLive) {
  // Apagada por el dueño.
  if (r.enabled === false) return { state: 'off' };
  // Ningún canal puede enviar hoy.
  var anyChannel = chLive.whatsapp || chLive.sms || chLive.email;
  if (!anyChannel) {
    return { state: 'waiting', why: 'Ningún canal de envío está activo todavía.', fix: 'Activa WhatsApp (o SMS/email) para que estos avisos puedan salir.' };
  }
  // No ofreces el servicio con el que casa esta regla de fábrica.
  if (r.applies === false) {
    return { state: 'waiting', why: 'Ninguno de tus servicios casa con este aviso.', fix: 'Actívalo solo si ofreces este servicio (o edítalo en "Reglas por sector").' };
  }
  // Regla de FECHA del cliente sin ninguna ficha rellenada.
  var needsField = (r.trigger === 'before_sector_field' || r.trigger === 'from_sector_field' || r.trigger === 'yearly_field');
  if (needsField && (r.key in fieldCoverage) && fieldCoverage[r.key] === 0) {
    return { state: 'waiting', why: 'Ningún cliente tiene aún la fecha que necesita este aviso.', fix: 'Rellena la fecha (' + esc(r.label || 'la de esta regla') + ') en la ficha de cada cliente, o crea abajo un aviso "desde su alta / última visita" que no necesita fechas.' };
  }
  // Todo listo: dispara sola con lo que ya hay.
  return { state: 'active' };
}

async function loadAutoRulesPanel() {
  var box = document.getElementById('auto-rules-panel');
  if (!box) return;
  box.innerHTML = '<div class="loading-msg">Cargando reglas...</div>';
  var res;
  try { res = await api('/api/portal/followup-rules'); }
  catch (e) { box.innerHTML = ''; return; }

  var rules = (res.rules || []).slice();
  var cov = res.fieldCoverage || {};
  var chLive = res.channelsLive || { whatsapp: true, sms: true, email: true };
  _rulesState.channels = res.channels || _rulesState.channels;
  _rulesState.triggers = res.customTriggers || _rulesState.triggers;

  var active = [], waiting = [];
  rules.forEach(function(r) {
    var st = _autoRuleStatus(r, cov, chLive);
    if (st.state === 'active')  active.push(r);
    else if (st.state === 'waiting') waiting.push({ r: r, st: st });
  });

  function line(r, badge, sub) {
    return '<div style="display:flex;gap:10px;align-items:flex-start;padding:10px 0;border-top:1px solid var(--border)">' +
      badge +
      '<div style="flex:1;min-width:0">' +
        '<div style="font-weight:600;color:var(--text);font-size:14px">' + esc(r.label || r.key) + '</div>' +
        '<div style="color:var(--dim);font-size:12px;margin-top:1px">' + esc(r.desc || r.triggerLabel || '') + '</div>' +
        (sub || '') +
      '</div>' +
      '<span class="badge bp" style="font-size:11px;white-space:nowrap">' + esc(_CH_LABEL[r.channel] || r.channel || 'WhatsApp') + '</span>' +
    '</div>';
  }

  var GREEN = '<span style="font-size:16px;line-height:1.3">🟢</span>';
  var AMBER = '<span style="font-size:16px;line-height:1.3">🟡</span>';

  var html =
    '<div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px 18px">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:4px">' +
        '<div>' +
          '<div style="font-size:15px;font-weight:700;color:var(--text)">Avisos que salen solos</div>' +
          '<div style="color:var(--dim);font-size:13px;margin-top:2px">Estas reglas trabajan por ti sin que tengas que acordarte. Crea las tuyas o ajústalas cuando quieras.</div>' +
        '</div>' +
        '<button class="btn btn-accent btn-sm" onclick="openAutoRuleCreator()" style="white-space:nowrap">+ Crear recordatorio automático</button>' +
      '</div>';

  if (active.length) {
    html += '<div style="font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:var(--green2,#21c08a);margin:16px 0 2px">✓ Activos — salen solos</div>' +
      active.map(function(r) { return line(r, GREEN, ''); }).join('');
  }

  if (waiting.length) {
    html += '<div style="font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:#e0a030;margin:16px 0 2px">⏳ Esperando algo para poder salir</div>' +
      waiting.map(function(w) {
        var sub = '<div style="font-size:12px;color:#e0a030;margin-top:4px;line-height:1.5">' + esc(w.st.why) +
          ' <span style="color:var(--dim)">→ ' + w.st.fix + '</span></div>';
        return line(w.r, AMBER, sub);
      }).join('');
  }

  if (!active.length && !waiting.length) {
    html += '<div style="padding:20px 0;color:var(--dim);font-size:13px;text-align:center">Todavía no tienes ningún aviso automático encendido. Pulsa <strong style="color:var(--text)">"+ Crear recordatorio automático"</strong> para poner el primero — el más fácil es "a los N días de su última visita", que funciona con lo que ya tienes.</div>';
  }

  html += '</div>';
  box.innerHTML = html;
}

// Constructor sencillo (en cristiano) de un recordatorio automático. Guarda por
// la MISMA vía que "Reglas por sector" (PUT /followup-rules, custom[]), así el
// motor lo recoge y lo aplica a la cartera actual (recalculateOrg).
function openAutoRuleCreator() {
  var triggers = (_rulesState.triggers && _rulesState.triggers.length ? _rulesState.triggers : [
    { value: 'from_last_appointment', label: 'A los N días de su última visita' },
    { value: 'from_last_if_no_new',   label: 'A los N días de su última visita, solo si no ha vuelto' },
    { value: 'from_signup',           label: 'A los N días desde que lo diste de alta' },
    { value: 'before_sector_field',   label: 'N días antes de una fecha del cliente (caducidad, cuota…)' },
  ]);
  var channels = (_rulesState.channels && _rulesState.channels.length) ? _rulesState.channels : ['whatsapp','sms','email'];

  var trigOpts = triggers.map(function(t) {
    return '<option value="' + esc(t.value) + '">' + esc(t.label) + '</option>';
  }).join('');
  var chOpts = channels.map(function(c) {
    return '<option value="' + c + '">' + _CH_LABEL[c] + '</option>';
  }).join('');

  openModal(
    '<div style="max-width:520px">' +
      '<h3 style="margin:0 0 4px;font-size:18px;color:var(--text)">Crear recordatorio automático</h3>' +
      '<p style="color:var(--dim);font-size:13px;margin:0 0 18px">Se enviará solo cuando cada cliente cumpla la condición. No tienes que hacer nada más.</p>' +

      '<label style="display:block;font-size:13px;color:var(--text);font-weight:600;margin-bottom:5px">¿Cómo quieres llamarlo?</label>' +
      '<input type="text" id="ar-label" maxlength="60" placeholder="ej. Invitar a volver, Bienvenida, Revisión…" style="width:100%;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:14px;margin-bottom:16px">' +

      '<label style="display:block;font-size:13px;color:var(--text);font-weight:600;margin-bottom:5px">¿Cuándo se envía?</label>' +
      '<select id="ar-trigger" onchange="_arOnTriggerChange()" style="width:100%;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:14px;margin-bottom:10px">' + trigOpts + '</select>' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">' +
        '<input type="number" id="ar-days" min="1" max="3650" value="30" style="width:80px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:9px 10px;font-size:14px;text-align:center">' +
        '<span style="font-size:13px;color:var(--dim)">días</span>' +
      '</div>' +
      '<div id="ar-trighint" style="font-size:12px;color:var(--accent-l);margin-bottom:16px;line-height:1.5"></div>' +

      '<label style="display:block;font-size:13px;color:var(--text);font-weight:600;margin-bottom:5px">Mensaje <span style="color:var(--dim);font-weight:400">(opcional — si lo dejas vacío, usamos uno estándar)</span></label>' +
      '<textarea id="ar-text" maxlength="250" placeholder="✍️ Escríbelo como tú hablas. Usa {detalle} para el dato de cada ficha." style="width:100%;min-height:64px;resize:vertical;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:14px;font-family:inherit;line-height:1.5;margin-bottom:16px"></textarea>' +

      '<label style="display:block;font-size:13px;color:var(--text);font-weight:600;margin-bottom:5px">¿Por dónde se envía?</label>' +
      '<select id="ar-channel" style="width:100%;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:14px;margin-bottom:20px">' + chOpts + '</select>' +

      '<div id="ar-entities-note"></div>' +

      '<div style="display:flex;gap:10px;justify-content:flex-end">' +
        '<button class="btn btn-d btn-sm" onclick="closeModal()">Cancelar</button>' +
        '<button class="btn btn-accent btn-sm" onclick="saveAutoRule(this)">Crear</button>' +
      '</div>' +
    '</div>'
  );
  _arOnTriggerChange();
  _arLoadEntitiesNote();  // tie-in con ENTIDADES: si ya tienen fichas con fechas
}

// Tie-in con ENTIDADES (opcional, fail-closed): si el negocio usa fichas
// (vehículos, bonos…) con fechas que ya generan avisos solos (ITV, caducidad),
// se lo recordamos aquí para que no las duplique con una regla manual.
async function _arLoadEntitiesNote() {
  var note = document.getElementById('ar-entities-note');
  if (!note) return;
  var r;
  try { r = await api('/api/portal/entity-types'); } catch (e) { return; }
  if (!r || !r.available || !r.types || !r.types.length) return;
  var dateFields = [];
  r.types.forEach(function(t) {
    (t.fields || []).forEach(function(f) {
      if (f.type === 'date' && f.reminder) dateFields.push((t.label_singular || t.label || t.key) + ' · ' + (f.label || f.key));
    });
  });
  if (!dateFields.length) return;
  note.innerHTML =
    '<div style="display:flex;gap:8px;align-items:flex-start;background:rgba(196,245,70,.06);border:1px solid rgba(196,245,70,.25);border-radius:10px;padding:10px 12px;margin-bottom:16px">' +
      '<span>📇</span><div style="font-size:12px;color:var(--dim);line-height:1.5">' +
        '<strong style="color:var(--text)">Ya tienes fichas con fechas que avisan solas</strong> — ' + esc(dateFields.slice(0, 4).join(', ')) +
        (dateFields.length > 4 ? '…' : '') + '. Esas no hace falta crearlas aquí: se envían solas cuando se acerca la fecha de cada ficha.' +
      '</div>' +
    '</div>';
}

function _arOnTriggerChange() {
  var t = document.getElementById('ar-trigger');
  var hint = document.getElementById('ar-trighint');
  if (!t || !hint) return;
  var v = t.value;
  var msg = {
    from_last_appointment: '👍 Funciona con lo que ya tienes: cuenta desde la última cita del cliente. No hay que rellenar nada.',
    from_last_if_no_new:   '👍 Funciona con lo que ya tienes: solo escribe a quien no haya vuelto a reservar. Nada que rellenar.',
    from_signup:           '👍 Funciona con lo que ya tienes: cuenta desde el día que diste de alta al cliente. No hay que rellenar nada.',
    before_sector_field:   '📅 Necesita una fecha por cliente (tú la inventas). Aparecerá en la ficha de cada uno para que la rellenes; hasta entonces, a ese cliente no se le envía.',
  }[v] || '';
  hint.innerHTML = esc(msg).replace('👍', '<span>👍</span>').replace('📅', '<span>📅</span>');
  // color de aviso para el que sí pide datos
  hint.style.color = (v === 'before_sector_field') ? '#e0a030' : 'var(--accent-l)';
}

async function saveAutoRule(btn) {
  var label = (document.getElementById('ar-label').value || '').trim();
  var trigger = document.getElementById('ar-trigger').value;
  var days = parseInt(document.getElementById('ar-days').value, 10);
  var customText = (document.getElementById('ar-text').value || '').trim();
  var channel = document.getElementById('ar-channel').value;

  if (label.length < 2) { toast('Ponle un nombre al recordatorio', 'err'); return; }
  if (!days || days < 1) { toast('Pon los días', 'err'); return; }

  // Read-merge-write: recuperamos las reglas actuales para NO borrar las que ya
  // existen (defaults + otros personalizados) al añadir la nueva.
  if (btn) { btn.disabled = true; btn.textContent = 'Creando…'; }
  var current;
  try { current = await api('/api/portal/followup-rules'); }
  catch (e) { toast('No se pudo cargar la configuración actual', 'err'); if (btn) { btn.disabled = false; btn.textContent = 'Crear'; } return; }

  var overrides = {}, custom = [];
  (current.rules || []).forEach(function(r) {
    if (r.custom) {
      custom.push({
        key: r.key, label: r.label, trigger: r.trigger, days: r.days,
        serviceFilter: (r.serviceFilter && r.serviceFilter.length) ? r.serviceFilter.join(', ') : undefined,
        channel: r.channel, enabled: r.enabled !== false,
        serviceLabel: r.serviceLabel || undefined,
        customText: r.customText || undefined,
      });
    } else {
      var ov = { enabled: r.enabled !== false, channel: r.channel };
      if (r.editableDays && r.days) ov.days = r.days;
      overrides[r.key] = ov;
    }
  });
  custom.push({ label: label, trigger: trigger, days: days, channel: channel, enabled: true, customText: customText || undefined });

  try {
    await api('/api/portal/followup-rules', 'PUT', { overrides: overrides, custom: custom });
    toast('Recordatorio creado — ya trabaja por ti ✓');
    closeModal();
    loadAutoRulesPanel();
    loadUpcomingReminders();
  } catch (e) {
    toast(e.message || 'No se pudo crear', 'err');
    if (btn) { btn.disabled = false; btn.textContent = 'Crear'; }
  }
}

// ── Mini-calendario: qué saldrá solo las próximas 4 semanas ──
function _dayKey(iso) { return new Date(iso).toLocaleDateString('sv-SE'); }

function renderRemindersCalendar() {
  var box = document.getElementById('reminders-calendar');
  if (!box) return;

  var countByDay = {};
  _upcomingReminders.forEach(function(r) {
    var k = _dayKey(r.scheduled_for);
    countByDay[k] = (countByDay[k] || 0) + 1;
  });

  // 4 semanas empezando el lunes de esta semana.
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var start = new Date(today);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));   // lunes
  var todayKey = today.toLocaleDateString('sv-SE');

  var thisWeek = 0, nextWeek = 0;
  var cells = '';
  for (var i = 0; i < 28; i++) {
    var d = new Date(start); d.setDate(start.getDate() + i);
    var k = d.toLocaleDateString('sv-SE');
    var n = countByDay[k] || 0;
    if (n && i < 7)               thisWeek += n;
    else if (n && i < 14)         nextWeek += n;
    var isToday = k === todayKey;
    var isPast  = d < today;
    var sel     = _calSelectedDay === k;
    var newMonth = d.getDate() === 1 || i === 0;
    cells += '<div onclick="' + (n ? 'calSelectDay(\'' + k + '\')' : '') + '" title="' + (n ? n + ' aviso' + (n !== 1 ? 's' : '') : '') + '"' +
      ' style="position:relative;aspect-ratio:1;display:flex;flex-direction:column;align-items:center;justify-content:center;border-radius:8px;font-size:12px;' +
      (sel ? 'background:var(--accent);color:#0a0b0d;font-weight:700;' :
       isToday ? 'border:1px solid var(--accent);color:var(--text);' :
       'border:1px solid ' + (n ? 'rgba(196,245,70,.35)' : 'var(--border)') + ';color:' + (isPast ? 'var(--muted)' : 'var(--text)') + ';') +
      (n ? 'cursor:pointer;' + (sel ? '' : 'background:rgba(196,245,70,.07);') : 'opacity:' + (isPast ? '.35' : '.7') + ';') + '">' +
      '<span>' + d.getDate() + (newMonth ? '<span style="font-size:9px;opacity:.7"> ' + d.toLocaleDateString('es-ES', { month: 'short' }).replace('.', '') + '</span>' : '') + '</span>' +
      (n ? '<span style="font-size:10px;font-weight:800;' + (sel ? 'color:#0a0b0d' : 'color:var(--accent-l)') + '">' + n + '</span>' : '') +
      '</div>';
  }

  var resumen = [];
  if (thisWeek) resumen.push('<strong style="color:var(--accent-l)">' + thisWeek + '</strong> esta semana');
  if (nextWeek) resumen.push('<strong style="color:var(--accent-l)">' + nextWeek + '</strong> la que viene');

  box.innerHTML =
    '<div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px 18px">' +
      '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:10px">' +
        '<div style="font-size:13px;font-weight:700;color:var(--text)">📅 Lo que saldrá solo — próximas 4 semanas</div>' +
        '<div style="font-size:12px;color:var(--dim)">' + (resumen.length ? resumen.join(' · ') : 'Sin avisos en las próximas 2 semanas') +
          (_calSelectedDay ? ' · <span onclick="calSelectDay(null)" style="color:var(--accent-l);cursor:pointer;text-decoration:underline">ver todos</span>' : '') + '</div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;font-size:10px;color:var(--muted);text-align:center;margin-bottom:4px">' +
        ['L','M','X','J','V','S','D'].map(function(d){ return '<div>' + d + '</div>'; }).join('') + '</div>' +
      '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px">' + cells + '</div>' +
    '</div>';
}

function calSelectDay(key) {
  _calSelectedDay = (_calSelectedDay === key) ? null : key;
  renderRemindersCalendar();
  renderUpcomingList();
}

function renderUpcomingList() {
  var container = document.getElementById('reminders-upcoming-list');
  if (!container) return;
  var shown = _calSelectedDay
    ? _upcomingReminders.filter(function(r) { return _dayKey(r.scheduled_for) === _calSelectedDay; })
    : _upcomingReminders;

  if (!shown.length) {
    container.innerHTML = '<div style="color:var(--dim);font-size:13px;text-align:center;padding:16px">Nada ese día.</div>';
    return;
  }

  // Group reminders by date
  var byDate = {};
  shown.forEach(function(r) {
    var d = new Date(r.scheduled_for).toLocaleDateString('es-ES', { weekday:'long', day:'numeric', month:'long' });
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(r);
  });

  container.innerHTML = Object.entries(byDate).map(function(entry) {
    var date = entry[0];
    var reminders = entry[1];
    return '<div class="reminder-group" style="margin-bottom:16px">' +
      '<h4 style="color:var(--dim);font-size:13px;font-weight:600;text-transform:uppercase;margin-bottom:8px">📅 ' + esc(date) + '</h4>' +
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

function sendReminderNow(id) {
  openModal(
    '<div class="modal-title">📨 Enviar recordatorio</div>' +
    '<p style="font-size:14px;margin:10px 0">¿Enviar este recordatorio ahora?</p>' +
    '<div class="modal-actions">' +
      '<button class="btn btn-d" onclick="closeModal()">Cancelar</button>' +
      '<button class="btn btn-accent" onclick="closeModal();_submitSendReminder(' + JSON.stringify(id) + ')">Enviar</button>' +
    '</div>'
  );
}
async function _submitSendReminder(id) {
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

function cancelReminder(id) {
  openModal(
    '<div class="modal-title">⛔ Cancelar recordatorio</div>' +
    '<p style="font-size:14px;margin:10px 0">El recordatorio no se enviará. ¿Confirmas?</p>' +
    '<div class="modal-actions">' +
      '<button class="btn btn-d" onclick="closeModal()">Volver</button>' +
      '<button class="btn btn-r" onclick="closeModal();_submitCancelReminder(' + JSON.stringify(id) + ')">Cancelar recordatorio</button>' +
    '</div>'
  );
}
async function _submitCancelReminder(id) {
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

async function loadReferidos() {
  var box = document.getElementById('referidos-body');
  if (!box) return;
  box.innerHTML = skelPanel();

  var d;
  try { d = await api('/api/portal/referral'); }
  catch (e) { box.innerHTML = '<div class="empty-state"><div>No se pudo cargar: ' + esc(e.message) + '</div></div>'; return; }

  if (!d || !d.available) {
    box.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🎁</div><div>Tu código de referido estará disponible en breve.</div></div>';
    return;
  }

  var waShare = 'https://wa.me/?text=' + encodeURIComponent(d.shareText);

  box.innerHTML =
    // Hero explicativo
    '<div class="card" style="margin-bottom:18px;background:linear-gradient(135deg,rgba(196,245,70,.12),rgba(56,225,200,.08));border-color:rgba(196,245,70,.3)">' +
      '<div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap">' +
        '<div style="font-size:46px;line-height:1">🎁</div>' +
        '<div style="flex:1;min-width:220px">' +
          '<div style="font-size:17px;font-weight:800;margin-bottom:4px">Tú ganas, tu colega gana</div>' +
          '<div style="font-size:13px;color:var(--dim);line-height:1.6">Comparte tu código con otro negocio. Cuando se dé de alta con él, ' +
          '<strong style="color:var(--text)">se lleva un ' + d.refereeDiscount + '% de descuento</strong> y ' +
          '<strong style="color:var(--accent-l)">tú un mes a mitad de precio</strong>.</div>' +
        '</div>' +
      '</div>' +
    '</div>' +

    // Código + acciones
    '<div class="card" style="margin-bottom:18px">' +
      '<div style="font-size:12px;color:var(--dim);margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px">Tu código</div>' +
      '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">' +
        '<code style="font-size:20px;font-weight:800;color:var(--accent-l);background:rgba(196,245,70,.1);border:1px solid rgba(196,245,70,.3);border-radius:10px;padding:10px 18px;letter-spacing:1px">' + esc(d.code) + '</code>' +
        '<button class="btn btn-d btn-sm" onclick="nfCopy(\'' + esc(d.code) + '\',this)">📋 Copiar código</button>' +
        '<button class="btn btn-d btn-sm" onclick="nfCopy(\'' + esc(d.link) + '\',this)">🔗 Copiar enlace</button>' +
        '<a class="btn btn-sm" href="' + esc(waShare) + '" target="_blank" rel="noopener" style="background:#25d366;color:#fff;border:none">💬 Compartir por WhatsApp</a>' +
      '</div>' +
    '</div>' +

    // Estadísticas
    '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">' +
      nfStat(d.timesShared,    'Veces compartido') +
      nfStat(d.timesConverted, 'Se dieron de alta', 'var(--green,#38e1c8)') +
      nfStat(d.rewardPending,  'Recompensas pendientes', '#00b894') +
    '</div>' +
    (d.rewardPending > 0
      ? '<div style="margin-top:14px;background:rgba(0,184,148,.08);border:1px solid rgba(0,184,148,.25);border-radius:10px;padding:12px 16px;font-size:13px;color:var(--dim)">🎉 Tienes <strong style="color:#00b894">' + d.rewardPending + ' recompensa(s)</strong> pendientes de aplicar. Te contactaremos para descontarlas de tu próxima factura.</div>'
      : '');
}

async function loadWidget() {
  var box = document.getElementById('widget-body');
  if (!box) return;
  box.innerHTML = skelPanel();

  var d;
  try { d = await api('/api/portal/widget'); }
  catch (e) { box.innerHTML = '<div class="empty-state"><div>No se pudo cargar: ' + esc(e.message) + '</div></div>'; return; }

  var rows = (d.callbacks && d.callbacks.length)
    ? d.callbacks.map(function(c){
        var when = c.created_at ? new Date(c.created_at).toLocaleString('es-ES') : '';
        return '<tr>' +
          '<td>' + esc(c.name || '—') + '</td>' +
          '<td><a href="#" onclick="dialOrCopy(\'' + esc(String(c.phone||'').replace(/[^0-9+]/g,'')) + '\');return false" style="color:var(--accent-l)">' + esc(c.phone) + '</a></td>' +
          '<td style="color:var(--dim);font-size:12px">' + esc(c.message || '') + '</td>' +
          '<td style="color:var(--dim);font-size:12px">' + esc(when) + '</td>' +
        '</tr>';
      }).join('')
    : '<tr><td colspan="4" style="color:var(--dim);text-align:center;padding:18px">Aún no has recibido solicitudes. Instala el widget en tu web 👇</td></tr>';

  box.innerHTML =
    '<div class="card" style="margin-bottom:18px">' +
      '<div style="font-size:14px;font-weight:700;margin-bottom:6px">📋 Instálalo en tu web</div>' +
      '<div style="font-size:13px;color:var(--dim);margin-bottom:12px;line-height:1.6">Copia esta línea y pégala antes de <code>&lt;/body&gt;</code> en tu página web. Aparecerá un botón flotante "¿Te llamamos?".</div>' +
      '<div style="display:flex;gap:8px;align-items:stretch;flex-wrap:wrap">' +
        '<code style="flex:1;min-width:240px;background:rgba(196,245,70,.08);border:1px solid rgba(196,245,70,.25);border-radius:8px;padding:12px 14px;font-size:12px;word-break:break-all;color:var(--text)">' + esc(d.snippet) + '</code>' +
        '<button class="btn btn-d btn-sm" onclick="nfCopy(' + JSON.stringify(d.snippet).replace(/"/g,'&quot;') + ',this)">📋 Copiar</button>' +
      '</div>' +
      '<div style="margin-top:12px;font-size:12px;color:var(--dim)">💡 ¿No tienes web o usas Instagram/Google? Llámanos y te ayudamos a ponerlo.</div>' +
    '</div>' +
    '<div class="card">' +
      '<div style="font-size:14px;font-weight:700;margin-bottom:12px">📞 Solicitudes recibidas</div>' +
      '<div class="table-wrap"><table style="width:100%"><thead><tr><th>Nombre</th><th>Teléfono</th><th>Mensaje</th><th>Cuándo</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
    '</div>';
}

// CTA de referido para colocar en momentos de emoción (tras valor / buen mes)
function referralCta(context) {
  var msg = context === 'facturacion'
    ? '¿Conoces otro negocio al que le vendría bien? Recomiéndalo y te llevas <strong style="color:var(--accent-l)">un mes a mitad de precio</strong>.'
    : 'Recomienda NodeFlow a otro negocio y gana <strong style="color:var(--accent-l)">un mes a mitad de precio</strong>.';
  return '<div class="card" style="margin-top:16px;display:flex;gap:14px;align-items:center;justify-content:space-between;flex-wrap:wrap;background:linear-gradient(135deg,rgba(196,245,70,.08),transparent);border-color:rgba(196,245,70,.2)">' +
    '<div style="font-size:13px;color:var(--dim);line-height:1.6;flex:1;min-width:200px">🎁 ' + msg + '</div>' +
    '<button class="btn btn-accent btn-sm" onclick="navigate(\'referidos\')" style="white-space:nowrap">Recomendar y ganar →</button>' +
  '</div>';
}

function nfStat(value, label, color) {
  return '<div class="card" style="text-align:center;padding:18px 10px">' +
    '<div style="font-size:26px;font-weight:900;color:' + (color || 'var(--accent-l)') + '">' + (value || 0) + '</div>' +
    '<div style="font-size:11px;color:var(--dim);margin-top:4px">' + label + '</div></div>';
}

function nfCopy(text, btn) {
  function done() {
    if (!btn) return;
    var old = btn.textContent; btn.textContent = '✅ Copiado';
    setTimeout(function(){ btn.textContent = old; }, 1500);
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(function(){ nfCopyFallback(text); done(); });
  } else { nfCopyFallback(text); done(); }
}
function nfCopyFallback(text) {
  var ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); } catch (_) {}
  document.body.removeChild(ta);
}

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

// ════════ ENTIDADES v0 — Vehículos / Mascotas / Pólizas… ═══════════════════
// Pestaña dinámica: la etiqueta, el icono y el FORMULARIO salen de la
// plantilla del sector (field defs) — un solo componente para 14 sectores.
// Simple > completo: fichas grandes, botones grandes, cero configuración.

var _entTypes    = null;   // tipos de entidad de la org (o [] si no aplica)
var _entTypeKey  = null;   // tipo activo (v0: casi siempre hay uno)
var _entList     = [];     // entidades cargadas
var _entQ        = '';     // búsqueda actual
var _entQTimer   = null;
var _entContacts = null;   // cache de contactos para el selector "dueño"
var _entPresets  = null;   // recetario del sector: { type, intro, items } o null
var _entView         = 'list'; // 'list' | 'grouped' (solo si el tipo es agrupable)
var _entFichaCur     = null;   // entidad abierta en la ficha viva (editar desde ahí)
var _entModalTypeKey = null;   // tipo del modal abierto (puede no ser el de la pestaña)

// Espejo ES5 de groupableField (src/entities/entity-types.js): el PRIMER
// select con 2..6 opciones agrupa la lista (estado, fase, especie…).
function entGroupField(fields) {
  for (var i = 0; i < (fields || []).length; i++) {
    var f = fields[i];
    if (f.type === 'select' && f.options && f.options.length >= 2 && f.options.length <= 6) return f;
  }
  return null;
}

function _entTypeById(id) {
  if (!_entTypes) return null;
  for (var i = 0; i < _entTypes.length; i++) if (_entTypes[i].id === id) return _entTypes[i];
  return null;
}

// Badge de ficha borrador (la abrió la IA en una llamada; falta completarla)
function _entDraftBadge(small) {
  return '<span style="display:inline-flex;align-items:center;gap:3px;background:rgba(224,160,48,.14);border:1px solid rgba(224,160,48,.4);color:#e0a030;border-radius:999px;padding:' + (small ? '1px 8px' : '2px 10px') + ';font-size:' + (small ? '10px' : '11px') + ';font-weight:700;white-space:nowrap">📝 completar ficha</span>';
}

// Al entrar: ¿tiene esta org fichas? Si sí, aparece la pestaña con su nombre.
async function initEntidades() {
  try {
    var r = await api('/api/portal/entity-types');
    if (!r.available || !r.types || !r.types.length) return; // pestaña oculta
    _entTypes   = r.types;
    _entTypeKey = r.types[0].key;
    _entPresets = r.presets || null; // fichas típicas del sector (fechas ya resueltas)
    var nav = document.getElementById('nav-entidades');
    var lbl = document.getElementById('nav-entidades-label');
    if (lbl) lbl.textContent = r.types.length === 1 ? r.types[0].label_plural : 'Fichas';
    if (nav) nav.style.display = '';
  } catch (e) { /* sin fichas: la pestaña no aparece */ }
}

function _entType() {
  if (!_entTypes) return null;
  for (var i = 0; i < _entTypes.length; i++) if (_entTypes[i].key === _entTypeKey) return _entTypes[i];
  return _entTypes[0] || null;
}

// ¿Este campo-fecha genera aviso automático? → pill 🔔
function _entReminderPill(small) {
  return '<span style="display:inline-flex;align-items:center;gap:4px;background:rgba(196,245,70,.12);border:1px solid rgba(196,245,70,.3);color:var(--accent-l);border-radius:999px;padding:' + (small ? '1px 8px' : '2px 10px') + ';font-size:' + (small ? '10px' : '11px') + ';font-weight:700;white-space:nowrap">🔔 aviso automático</span>';
}

async function loadEntidades() {
  var sec = document.getElementById('sec-entidades');
  if (!sec) return;
  if (!_entTypes) { await initEntidades(); }
  var type = _entType();
  if (!type) {
    sec.innerHTML = '<div class="empty-state"><div style="font-size:34px">🗂️</div>' +
      '<div class="empty-state-text">Las fichas no están disponibles para tu negocio todavía.</div></div>';
    return;
  }

  // Cabecera + buscador + botón grande (se pinta una vez; la lista se refresca)
  var tabs = '';
  if (_entTypes.length > 1) {
    tabs = '<div style="display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap">' + _entTypes.map(function(t) {
      return '<button class="btn ' + (t.key === _entTypeKey ? 'btn-accent' : 'btn-d') + '" onclick="entSwitchType(\'' + esc(t.key) + '\')">' + esc(t.icon || '') + ' ' + esc(t.label_plural) + '</button>';
    }).join('') + '</div>';
  }

  // Vista agrupada por estado/fase (v1): solo si la plantilla tiene un
  // select agrupable. Acordeón táctil, NO kanban (regla de los 60 años).
  var gf = entGroupField(type.fields);
  var viewToggle = '';
  if (gf) {
    viewToggle =
      '<div style="display:flex;gap:6px;flex:none">' +
        '<button class="btn ' + (_entView === 'list' ? 'btn-accent' : 'btn-d') + '" style="padding:10px 14px" onclick="entSetView(\'list\')">☰ Lista</button>' +
        '<button class="btn ' + (_entView === 'grouped' ? 'btn-accent' : 'btn-d') + '" style="padding:10px 14px" onclick="entSetView(\'grouped\')">⊞ Por ' + esc((gf.label || gf.key).toLowerCase()) + '</button>' +
      '</div>';
  }

  sec.innerHTML =
    '<div class="section-header">' +
      '<div><div class="kicker">Actividad</div>' +
      '<h2 class="section-title">' + esc(type.icon || '') + ' ' + esc(type.label_plural) + '</h2>' +
      '<p class="section-sub">Cada ficha guarda sus fechas importantes — los avisos a tus clientes salen solos ' + _entReminderPill(true) + '</p></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
        '<button class="btn btn-d" style="font-size:15px;padding:12px 16px" onclick="openEntityImportModal()">📥 Importar de Excel</button>' +
        '<button class="btn btn-accent" style="font-size:15px;padding:12px 20px" onclick="openEntityModal()">+ Añadir ' + esc(type.label_singular.toLowerCase()) + '</button>' +
      '</div>' +
    '</div>' +
    tabs +
    '<div class="card" style="padding:14px;margin-bottom:16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">' +
      '<input class="form-input" id="entSearch" placeholder="🔎 Buscar…" value="' + esc(_entQ) + '" ' +
        'style="flex:1;min-width:180px;font-size:16px;padding:12px" oninput="entSearchInput(this.value)">' +
      viewToggle +
    '</div>' +
    '<div id="entPresetChips"></div>' +
    '<div id="entList"><div class="empty-state"><span class="nf-wave nf-wave--lg" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span><div class="empty-state-text">Cargando fichas…</div></div></div>';

  entFetchList();
}

function entSwitchType(key) { _entTypeKey = key; _entQ = ''; _entView = 'list'; loadEntidades(); }

function entSetView(v) { _entView = v; loadEntidades(); }

function entSearchInput(v) {
  _entQ = v;
  clearTimeout(_entQTimer);
  _entQTimer = setTimeout(entFetchList, 300);
}

async function entFetchList() {
  var type = _entType();
  var box  = document.getElementById('entList');
  if (!type || !box) return;
  try {
    var r = await api('/api/portal/entities?type=' + encodeURIComponent(type.key) + (_entQ ? '&q=' + encodeURIComponent(_entQ) : ''));
    _entList = r.entities || [];
    renderEntidades();
  } catch (e) {
    box.innerHTML = '<div class="empty-state"><div class="empty-state-text">Error al cargar: ' + esc(e.message) + '</div></div>';
  }
}

// Presets del sector si aplican al tipo activo (v0: 1 tipo por sector).
function _entPresetItems(type) {
  if (!_entPresets || !type || _entPresets.type !== type.key) return [];
  return _entPresets.items || [];
}

function renderEntidades() {
  var type  = _entType();
  var box   = document.getElementById('entList');
  var chips = document.getElementById('entPresetChips');
  if (!type || !box) return;

  if (!_entList.length) {
    if (chips) chips.innerHTML = ''; // sin lista, el recetario vive en el onboarding
    if (_entQ) {
      box.innerHTML = emptyState(type.icon || '🗂️', 'Sin resultados',
        'Prueba con otro nombre o identificador.', '');
    } else {
      box.innerHTML = entOnboardingHtml(type);
    }
    return;
  }

  // Con lista: el recetario se pliega a chips de alta rápida sobre la lista
  if (chips) chips.innerHTML = entPresetChipsHtml(type);

  var fields     = type.fields || [];
  var listFields = fields.filter(function(f) { return f.show_in_list; });
  var gf         = entGroupField(fields);

  if (gf && _entView === 'grouped') {
    box.innerHTML = entGroupedHtml(type, gf, listFields);
    return;
  }

  var html = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:12px">';
  for (var i = 0; i < _entList.length; i++) {
    html += entCardHtml(_entList[i], type, listFields, null);
  }
  html += '</div>';
  box.innerHTML = html;
}

// Tarjeta de entidad (compartida entre lista y agrupada). Clic → FICHA VIVA;
// «Editar ✏️» va directo al formulario. stateField (solo agrupada): selector
// grande para cambiar de estado sin abrir nada.
function entCardHtml(e, type, listFields, stateField) {
  var a = e.attrs || {};

  // Datos de la lista (máx 4-5 por plantilla) — fechas con aviso llevan 🔔
  var rows = '';
  for (var j = 0; j < listFields.length; j++) {
    var f = listFields[j];
    if (stateField && f.key === stateField.key) continue; // la sección ya lo dice
    var v = a[f.key];
    if (v === undefined || v === null || v === '') continue;
    var shown = f.type === 'date' ? fmtDate(String(v)) : (Array.isArray(v) ? v.join(', ') : String(v));
    if (f.type === 'select' && f.options) {
      for (var k = 0; k < f.options.length; k++) if (f.options[k].value === v) shown = f.options[k].label;
    }
    rows += '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;font-size:13px;padding:3px 0">' +
      '<span style="color:var(--dim)">' + esc(f.label || f.key) + '</span>' +
      '<span style="font-weight:600;text-align:right">' + esc(shown) + (f.type === 'date' && f.reminder ? ' <span title="Aviso automático">🔔</span>' : '') + '</span></div>';
  }

  // Chip del dueño → Ficha 360 del contacto
  var owner = e.contact_id
    ? '<button class="btn btn-d btn-sm" style="border-radius:999px" onclick="event.stopPropagation();openContactProfile(\'' + esc(e.contact_id) + '\')">👤 ' + esc(e.contact_name || 'Ver cliente') + '</button>'
    : '<span style="font-size:11px;color:var(--dim)">Sin cliente vinculado</span>';

  // Selector de estado en la vista agrupada (dedo grande, cero drag)
  var stateSel = '';
  if (stateField) {
    stateSel = '<div style="margin-top:10px" onclick="event.stopPropagation()">' +
      '<select class="form-input" style="width:100%;font-size:15px;padding:10px" ' +
        'onchange="entQuickState(\'' + esc(e.id) + '\',\'' + esc(stateField.key) + '\',this.value)">' +
      '<option value="">— ' + esc(stateField.label || stateField.key) + ' —</option>' +
      (stateField.options || []).map(function(o) {
        return '<option value="' + esc(o.value) + '"' + (String(a[stateField.key] || '') === o.value ? ' selected' : '') + '>' + esc(o.label) + '</option>';
      }).join('') + '</select></div>';
  }

  return '<div class="card" style="padding:16px;cursor:pointer" onclick="openEntityFicha(\'' + esc(e.id) + '\')">' +
    '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">' +
      '<div style="font-size:22px">' + esc(type.icon || '🗂️') + '</div>' +
      '<div style="font-size:16px;font-weight:700;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(e.display_name) + '</div>' +
      (a.is_draft ? _entDraftBadge(true) : '') +
    '</div>' +
    rows +
    stateSel +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;gap:8px">' + owner +
      '<button class="btn btn-d btn-sm" onclick="event.stopPropagation();openEntityModal(\'' + esc(e.id) + '\')">Editar ✏️</button></div>' +
  '</div>';
}

// ── Vista AGRUPADA por estado/fase (v1) ──────────────────────────
// Secciones con contador en el orden de las opciones + «Sin estado» al
// final. Cabecera táctil que pliega/despliega; el cambio de estado es un
// select grande en la tarjeta (queda registrado en el timeline de la ficha).
function entGroupedHtml(type, gf, listFields) {
  var groups = {};   // value → items
  var i;
  for (i = 0; i < _entList.length; i++) {
    var v = String((_entList[i].attrs || {})[gf.key] || '');
    if (!groups[v]) groups[v] = [];
    groups[v].push(_entList[i]);
  }

  var sections = (gf.options || []).map(function(o) { return { value: o.value, label: o.label }; });
  sections.push({ value: '', label: 'Sin ' + (gf.label || gf.key).toLowerCase() });

  var html = '';
  for (i = 0; i < sections.length; i++) {
    var s     = sections[i];
    var items = groups[s.value] || [];
    if (!items.length && s.value === '') continue; // «Sin estado» solo si hay huérfanas
    var sid = 'entGrp-' + i;
    html +=
      '<div class="card" style="padding:0;margin-bottom:12px;overflow:hidden">' +
        '<div role="button" tabindex="0" onclick="entToggleGroup(\'' + sid + '\')" onkeydown="if(event.key===\'Enter\')entToggleGroup(\'' + sid + '\')" ' +
          'style="display:flex;align-items:center;gap:10px;padding:14px 16px;cursor:pointer;user-select:none">' +
          '<span style="font-weight:800;font-size:15px;flex:1">' + esc(s.label) + '</span>' +
          '<span style="background:rgba(196,245,70,.12);border:1px solid rgba(196,245,70,.3);color:var(--accent-l);border-radius:999px;padding:2px 12px;font-size:12px;font-weight:700">' + items.length + '</span>' +
          '<span id="' + sid + '-arrow" style="color:var(--dim);font-size:12px">▾</span>' +
        '</div>' +
        '<div id="' + sid + '" style="padding:0 12px 12px">' +
          (items.length
            ? '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:12px">' +
                items.map(function(e) { return entCardHtml(e, type, listFields, gf); }).join('') + '</div>'
            : '<div style="color:var(--dim);font-size:12.5px;padding:2px 6px 6px">Nada en «' + esc(s.label.toLowerCase()) + '» ahora mismo.</div>') +
        '</div>' +
      '</div>';
  }
  return html || '<div class="empty-state"><div class="empty-state-text">Sin fichas todavía.</div></div>';
}

function entToggleGroup(sid) {
  var body  = document.getElementById(sid);
  var arrow = document.getElementById(sid + '-arrow');
  if (!body) return;
  var hidden = body.style.display === 'none';
  body.style.display = hidden ? '' : 'none';
  if (arrow) arrow.textContent = hidden ? '▾' : '▸';
}

// Cambio de estado desde la tarjeta (vista agrupada) → PATCH + evento en
// el timeline (updateEntity registra el field_change en el servidor).
async function entQuickState(id, key, value) {
  if (!value) return;
  try {
    var body = { attrs: {} };
    body.attrs[key] = value;
    await api('/api/portal/entities/' + id, 'PATCH', body);
    toast('Estado actualizado ✔');
    entFetchList();
  } catch (e) {
    toast('Error: ' + e.message, 'err');
    entFetchList();
  }
}

// ── Primera vez: onboarding personalizado del sector ─────────────
// El fundador (2026-07-08): "una pantalla vacía sin planes predefinidos ni
// guías no le sirve a ningún sector". Mismo patrón que el recetario de
// Seguimientos: qué es esto (en SU vocabulario), cómo funciona en 3 pasos,
// y fichas típicas que prellenan el formulario con un clic.
// Espejo ES5 de emptyStateVocabulary (src/entities/entity-types.js): las
// palabras del PROPIO tipo (sus campos-fecha) para el estado vacío, en vez de
// una lista genérica de otro sector ("ITV, vacuna…" para una fisio). Si cambia
// allí, cambia aquí.
function entVocabExamples(type) {
  var out = [], seen = {};
  var fields = (type && type.fields) || [];
  for (var i = 0; i < fields.length && out.length < 3; i++) {
    if (fields[i].type !== 'date') continue;
    var c = String(fields[i].label || '')
      .replace(/^pr[óo]xim[oa]s?\s+/i, '')
      .replace(/^fecha\s+de\s+/i, '')
      .replace(/^[úu]ltim[oa]\s+/i, '')
      .replace(/\s*\([^)]*\)\s*/g, ' ')
      .replace(/\s+/g, ' ').trim().toLowerCase();
    if (c && !seen[c]) { seen[c] = 1; out.push(c); }
  }
  return out;
}

function entOnboardingHtml(type) {
  var items = _entPresetItems(type);
  var examples = entVocabExamples(type);
  var examplesText = examples.length ? examples.join(', ')
    : 'fechas importantes de cada ' + type.label_singular.toLowerCase();
  var intro = (_entPresets && _entPresets.type === type.key && _entPresets.intro)
    ? _entPresets.intro
    : 'Guarda cada ' + type.label_singular.toLowerCase() + ' con sus fechas importantes — y NodeFlow avisa a tu cliente antes de que llegue el día.';

  var steps = [
    ['1', 'Crea la ficha', 'Elige una de ejemplo o empieza desde cero'],
    ['2', 'Sus fechas quedan guardadas', examplesText.charAt(0).toUpperCase() + examplesText.slice(1) + '…'],
    ['3', 'Los avisos salen solos 🔔', 'A tu cliente, por WhatsApp, antes de la fecha'],
  ];
  var stepsHtml = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;margin:18px 0 22px">' +
    steps.map(function(s) {
      return '<div style="display:flex;gap:10px;align-items:flex-start;padding:12px 14px;background:rgba(255,255,255,.03);border:1px solid var(--border);border-radius:12px">' +
        '<div style="flex:none;width:26px;height:26px;border-radius:50%;background:rgba(196,245,70,.15);color:var(--accent-l);font-weight:800;font-size:13px;display:flex;align-items:center;justify-content:center">' + s[0] + '</div>' +
        '<div style="min-width:0"><div style="font-weight:700;font-size:13px">' + s[1] + '</div>' +
        '<div style="color:var(--dim);font-size:12px;line-height:1.45;margin-top:2px">' + s[2] + '</div></div></div>';
    }).join('') + '</div>';

  var cards = '';
  if (items.length) {
    cards = '<div style="font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:var(--dim);margin:0 0 10px">💡 Empieza con una ficha típica de tu sector — un clic y casi lista</div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px;margin-bottom:18px">' +
      items.map(function(p, i) {
        return '<div role="button" tabindex="0" onclick="entApplyPreset(' + i + ')" onkeydown="if(event.key===\'Enter\')entApplyPreset(' + i + ')" ' +
          'style="padding:16px;cursor:pointer;border:1px dashed rgba(196,245,70,.35);border-radius:12px;background:rgba(196,245,70,.04);display:flex;flex-direction:column">' +
          '<div style="font-weight:700;font-size:15px;margin-bottom:6px">' + esc(p.label) + '</div>' +
          '<div style="color:var(--dim);font-size:12px;line-height:1.5;margin-bottom:12px;flex:1">' + esc(p.description || '') + '</div>' +
          '<span style="align-self:flex-start;color:var(--accent-l);border:1px solid rgba(196,245,70,.4);border-radius:8px;padding:8px 16px;font-size:13px;font-weight:700">+ Añadir</span>' +
        '</div>';
      }).join('') + '</div>';
  }

  return '<div class="card" style="padding:22px 20px;max-width:920px">' +
    '<div style="display:flex;gap:14px;align-items:flex-start">' +
      '<div style="font-size:34px;line-height:1">' + esc(type.icon || '🗂️') + '</div>' +
      '<div style="min-width:0">' +
        '<div style="font-weight:800;font-size:17px;margin-bottom:6px">Tus ' + esc(type.label_plural.toLowerCase()) + ', con los avisos en piloto automático</div>' +
        '<div style="color:var(--dim);font-size:13.5px;line-height:1.6">' + esc(intro) + '</div>' +
      '</div>' +
    '</div>' +
    stepsHtml +
    cards +
    '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">' +
      '<button class="btn ' + (items.length ? 'btn-d' : 'btn-accent') + '" style="font-size:15px;padding:12px 20px" onclick="openEntityModal()">' +
        (items.length ? 'O empieza desde cero — añadir ' : '+ Añadir ') + esc(type.label_singular.toLowerCase()) + '</button>' +
      '<button class="btn btn-d" style="font-size:15px;padding:12px 20px" onclick="openEntityImportModal()">📥 ¿Ya los tienes en un Excel? Impórtalos</button>' +
    '</div>' +
  '</div>';
}

// Chips de alta rápida cuando ya hay fichas (el mismo recetario, plegado)
function entPresetChipsHtml(type) {
  var items = _entPresetItems(type);
  if (!items.length) return '';
  return '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:16px">' +
    '<span style="font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--dim)">⚡ Alta rápida:</span>' +
    items.map(function(p, i) {
      return '<button onclick="entApplyPreset(' + i + ')" title="' + esc(p.description || '') + '" ' +
        'style="background:transparent;color:var(--accent-l);border:1px dashed rgba(196,245,70,.4);border-radius:999px;padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap">+ ' + esc(p.label) + '</button>';
    }).join('') + '</div>';
}

// Clic en un preset → el modal de alta se abre PRELLENADO (fechas incluidas,
// ya resueltas por el servidor a partir de hoy). El dueño elige el cliente,
// ajusta lo que quiera y guarda.
function entApplyPreset(i) {
  var items = _entPresetItems(_entType());
  if (items[i]) openEntityModal(null, i);
}

// Contactos para el selector "dueño" (cacheados 1 vez por sesión de pestaña)
async function _entLoadContacts() {
  if (_entContacts) return _entContacts;
  try {
    var r = await api('/api/portal/contacts');
    _entContacts = (r.contacts || []).slice(0, 300);
  } catch (e) { _entContacts = []; }
  return _entContacts;
}

// ════════ FICHA VIVA (v1) — la historia completa de la cosa ═════════
// Clic en una tarjeta → cabecera con chips, dueño, estado tocable y el
// TIMELINE universal: eventos propios + citas + avisos (enviados y
// próximos 🔔) ya unidos por el servidor. Con caja de «añadir nota».

async function openEntityFicha(id) {
  openModal('<div class="modal-title">🗂️ Ficha</div>' +
    '<div style="color:var(--dim);font-size:13px">Cargando…</div>');

  var r;
  try {
    r = await api('/api/portal/entities/' + id + '/timeline');
  } catch (err) {
    openModal('<div class="modal-title">🗂️ Ficha</div>' +
      '<p style="color:var(--dim)">Error: ' + esc(err.message) + '</p>' +
      '<div class="modal-actions"><button class="btn btn-d" onclick="closeModal()">Cerrar</button></div>');
    return;
  }
  if (!_entTypes) { try { await initEntidades(); } catch (e2) {} }

  var e = r.entity;
  _entFichaCur = e;
  var type = _entTypeById(e.entity_type_id) || _entType() || { fields: [], icon: '🗂️', label_singular: 'Ficha' };
  var a = e.attrs || {};

  // Chips de los datos clave (los show_in_list de la plantilla)
  var chips = '';
  var fields = type.fields || [];
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i];
    if (!f.show_in_list) continue;
    var v = a[f.key];
    if (v === undefined || v === null || v === '') continue;
    var shown = f.type === 'date' ? fmtDate(String(v)) : (Array.isArray(v) ? v.join(', ') : String(v));
    if (f.type === 'select' && f.options) {
      for (var k = 0; k < f.options.length; k++) if (f.options[k].value === v) shown = f.options[k].label;
    }
    chips += '<span style="display:inline-flex;align-items:center;gap:5px;background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:999px;padding:4px 12px;font-size:12.5px">' +
      '<span style="color:var(--dim)">' + esc(f.label || f.key) + ':</span> <b>' + esc(shown) + '</b>' +
      (f.type === 'date' && f.reminder ? ' <span title="Aviso automático">🔔</span>' : '') + '</span> ';
  }

  // Dueño → Ficha 360 del contacto (bidireccional con «sus cosas»)
  var ownerChip = e.contact_id
    ? '<button class="btn btn-d btn-sm" style="border-radius:999px" onclick="openContactProfile(\'' + esc(e.contact_id) + '\')">👤 ' + esc(e.contact_name || 'Ver cliente') + '</button>'
    : '<span style="font-size:12px;color:var(--dim)">Sin cliente vinculado — sin dueño no hay a quién avisar</span>';

  // Estado tocable (pills grandes) si la plantilla es agrupable
  var gf = entGroupField(fields);
  var stateRow = '';
  if (gf) {
    stateRow = '<div style="margin:12px 0 4px">' +
      '<div style="font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--dim);margin-bottom:6px">' + esc(gf.label || gf.key) + '</div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
      (gf.options || []).map(function(o) {
        var cur = String(a[gf.key] || '') === o.value;
        return '<button onclick="entFichaSetState(\'' + esc(e.id) + '\',\'' + esc(gf.key) + '\',\'' + esc(o.value) + '\')" ' +
          'style="border-radius:999px;padding:9px 16px;font-size:13px;font-weight:700;cursor:pointer;' +
          (cur ? 'background:rgba(196,245,70,.15);border:1px solid rgba(196,245,70,.5);color:var(--accent-l)'
               : 'background:transparent;border:1px solid var(--border);color:var(--dim)') + '">' +
          esc(o.label) + '</button>';
      }).join('') + '</div></div>';
  }

  openModal(
    '<div style="display:flex;gap:12px;align-items:flex-start;margin-bottom:10px">' +
      '<div style="font-size:34px;line-height:1">' + esc(type.icon || '🗂️') + '</div>' +
      '<div style="flex:1;min-width:0">' +
        '<div class="modal-title" style="margin:0 0 4px">' + esc(e.display_name) + (a.is_draft ? ' ' + _entDraftBadge() : '') + '</div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">' + ownerChip + '</div>' +
      '</div>' +
      '<button class="btn btn-accent" style="flex:none;padding:10px 16px" onclick="openEntityModal(\'' + esc(e.id) + '\')">✏️ Editar</button>' +
    '</div>' +
    (chips ? '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">' + chips + '</div>' : '') +
    stateRow +
    '<div class="profile-section-title" style="margin-top:16px">📋 Su historia</div>' +
    entTimelineHtml(r.timeline || []) +
    '<div style="display:flex;gap:6px;align-items:center;margin-top:12px">' +
      '<input class="form-input" id="entNoteText" placeholder="Añadir nota a la ficha…" maxlength="500" ' +
        'style="flex:1;font-size:15px;padding:11px" onkeydown="if(event.key===\'Enter\'){event.preventDefault();entAddNote(\'' + esc(e.id) + '\');}">' +
      '<button class="btn btn-accent" style="padding:11px 18px" onclick="entAddNote(\'' + esc(e.id) + '\')">+ Nota</button>' +
    '</div>' +
    entSummaryBlock(e, type) +
    '<div class="modal-actions" style="margin-top:16px">' +
      '<button class="btn btn-d" onclick="closeModal()">Cerrar</button>' +
    '</div>'
  );
}

// 📤 LA FICHA COMUNICA — enviar al cliente un resumen humano de su ficha.
// Dos caminos, como en Seguimientos: (a) wa.me desde el móvil del dueño (sin
// límite de plantilla), (b) "Enviar desde NodeFlow" por la maquinaria de
// avisos (cuenta 1 mensaje del paquete). Sin dueño con teléfono → botones
// deshabilitados con motivo honesto.
function entSummaryBlock(e, type) {
  var hasPhone = !!(e.contact_id && e.contact_phone);
  var tip = !e.contact_id
    ? 'Vincula un cliente con teléfono para poder enviarle el resumen'
    : (!e.contact_phone ? 'El cliente vinculado no tiene teléfono' : '');
  var dis = hasPhone ? '' : ' disabled style="opacity:.5;cursor:not-allowed"';
  var tipAttr = tip ? ' title="' + esc(tip) + '"' : '';
  return '<div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border)">' +
    '<div style="font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--dim);margin-bottom:8px">📤 Enviar resumen al cliente</div>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
      '<button class="btn btn-sm" style="background:#25d366;color:#fff"' + dis + tipAttr +
        ' onclick="entSummaryWaLink(\'' + esc(e.id) + '\')">💬 Por WhatsApp (desde tu móvil)</button>' +
      '<button class="btn btn-accent btn-sm"' + dis + tipAttr +
        ' onclick="entSummarySend(\'' + esc(e.id) + '\')">Enviar desde NodeFlow</button>' +
    '</div>' +
    (tip ? '<div class="u-text-xs u-dim u-mt-2">' + esc(tip) + '.</div>'
         : '<div class="u-text-xs u-dim u-mt-2">«Enviar desde NodeFlow» consume 1 mensaje del paquete y respeta si el cliente pidió no recibir avisos.</div>') +
    '</div>';
}

// Espejo ES5 del builder del servidor (src/entities/entity-notify.js) SOLO para
// prellenar el enlace wa.me — el servidor sigue siendo la fuente de verdad del
// envío por NodeFlow. Si cambia allí, cambia aquí.
function entBuildSummary(e, type) {
  var a = (e && e.attrs) || {};
  var fields = (type && type.fields) || [];
  var name = ((e && e.contact_name) || '').trim().split(/\s+/)[0] || '';
  var label = ((e && e.display_name) || (type && type.label_singular) || 'tu ficha').trim();
  var shown = fields.filter(function(f) { return f.show_in_list && f.type !== 'note'; })
    .sort(function(x, y) { return (x.position || 99) - (y.position || 99); });
  var parts = [];
  for (var i = 0; i < shown.length; i++) {
    var f = shown[i], v = a[f.key];
    if (v === undefined || v === null || v === '') continue;
    var val;
    if (f.type === 'date') val = fmtDate(String(v));
    else if (f.type === 'boolean') val = (v === true || v === 'true') ? 'Sí' : 'No';
    else if ((f.type === 'select' || f.type === 'multiselect') && f.options) {
      var arr = Array.isArray(v) ? v : [v];
      val = arr.map(function(x) {
        for (var k = 0; k < f.options.length; k++) if (String(f.options[k].value) === String(x)) return f.options[k].label;
        return String(x);
      }).join(', ');
    } else val = Array.isArray(v) ? v.join(', ') : String(v).trim();
    if (!val) continue;
    if (label.toLowerCase().indexOf(String(val).toLowerCase()) !== -1) continue;
    var fl = String(f.label || f.key).replace(/\s*\([^)]*\)\s*$/, '').trim();
    fl = fl ? fl.charAt(0).toLowerCase() + fl.slice(1) : fl;
    parts.push(f.type === 'date' ? (fl + ' el ' + val) : (fl + ': ' + val));
  }
  var saludo = name ? ('Hola ' + name + ' 👋') : '¡Hola! 👋';
  var cuerpo;
  if (parts.length) {
    var joined = parts.length === 1 ? parts[0]
      : parts.length === 2 ? (parts[0] + ' y ' + parts[1])
      : (parts.slice(0, -1).join(', ') + ' y ' + parts[parts.length - 1]);
    cuerpo = 'Aquí tienes el resumen de tu ' + label + ': ' + joined + '.';
  } else {
    cuerpo = 'Aquí tienes tu ficha: ' + label + '.';
  }
  return _fuWellFormed(saludo + ' ' + cuerpo + ' Cualquier cosa, respóndenos por aquí.');
}

function entSummaryWaLink(id) {
  var e = _entFichaCur;
  if (!e || e.id !== id || !e.contact_phone) { toast('Sin teléfono del cliente', 'err'); return; }
  var type = _entTypeById(e.entity_type_id) || _entType() || { fields: [] };
  var msg = entBuildSummary(e, type);
  var num = String(e.contact_phone).replace(/[^0-9]/g, '');
  if (num.length === 9) num = '34' + num;
  window.open('https://wa.me/' + num + '?text=' + encodeURIComponent(msg), '_blank');
  toast('WhatsApp abierto con el resumen ✔');
}

async function entSummarySend(id) {
  try {
    var r = await api('/api/portal/entities/' + id + '/send-summary', 'POST', {});
    var chan = r.channel === 'sms' ? 'SMS' : r.channel === 'email' ? 'email' : 'WhatsApp';
    toast('Resumen enviado por ' + chan + ' 📤');
    openEntityFicha(id); // el envío queda YA en la historia de la ficha
  } catch (e) {
    toast(e.message || 'No se pudo enviar', 'err');
  }
}

// El timeline llega LISTO del servidor (título, icono, meta, upcoming):
// aquí solo se pinta. Próximo primero (🔔), después la historia.
function entTimelineHtml(items) {
  if (!items.length) {
    return '<div style="color:var(--dim);font-size:13px;padding:8px 0">Sin actividad todavía. Aparecerá aquí cada cambio, cita, nota y aviso.</div>';
  }
  var html = '';
  var lastUpcoming = null;
  for (var i = 0; i < items.length; i++) {
    var ev = items[i];
    if (lastUpcoming === null || lastUpcoming !== !!ev.upcoming) {
      lastUpcoming = !!ev.upcoming;
      html += '<div style="font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:' +
        (lastUpcoming ? 'var(--accent-l)' : 'var(--dim)') + ';margin:8px 0 2px">' +
        (lastUpcoming ? '🔜 Próximo' : 'Historia') + '</div>';
    }
    var d = ev.at ? new Date(ev.at) : null;
    var dateStr = d && !isNaN(d.getTime()) ? d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
    html += '<div style="display:flex;gap:12px;padding:9px 0;border-bottom:1px solid var(--border)' +
        (ev.upcoming ? ';background:rgba(196,245,70,.03)' : '') + '">' +
      '<div style="width:30px;height:30px;border-radius:50%;background:rgba(255,255,255,.05);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:14px">' + esc(ev.icon || '•') + '</div>' +
      '<div style="flex:1;min-width:0">' +
        '<div style="font-size:13px;font-weight:600">' + esc(ev.title || '') + '</div>' +
        '<div style="font-size:11px;color:var(--dim)">' + dateStr + (ev.meta ? ' · ' + esc(ev.meta) : '') + '</div>' +
      '</div>' +
    '</div>';
  }
  return '<div style="max-height:340px;overflow-y:auto;position:relative;padding-left:2px">' + html + '</div>';
}

async function entAddNote(id) {
  var el = document.getElementById('entNoteText');
  var text = ((el && el.value) || '').trim();
  if (!text) { toast('Escribe la nota antes de guardar', 'err'); if (el) el.focus(); return; }
  try {
    await api('/api/portal/entities/' + id + '/notes', 'POST', { text: text });
    toast('Nota guardada ✔');
    openEntityFicha(id); // recarga: la nota aparece arriba de la historia
  } catch (e) { toast('Error: ' + e.message, 'err'); }
}

async function entFichaSetState(id, key, value) {
  try {
    var body = { attrs: {} };
    body.attrs[key] = value;
    await api('/api/portal/entities/' + id, 'PATCH', body);
    toast('Estado actualizado ✔');
    openEntityFicha(id); // el cambio queda YA en su historia
    if (document.getElementById('entList')) entFetchList();
  } catch (e) { toast('Error: ' + e.message, 'err'); }
}

// Modal crear/editar — el formulario se GENERA desde las field defs:
// inputs grandes, campos-fecha con la pill de aviso automático.
// presetIdx (opcional, solo alta): prellenar con esa ficha típica del sector.
// prelinkContactId (opcional, solo alta): dueño preseleccionado — crear la
// ficha DESDE la Ficha 360 del cliente la vincula sola.
async function openEntityModal(id, presetIdx, prelinkContactId) {
  var entity = null;
  if (id) {
    for (var i = 0; i < _entList.length; i++) if (_entList[i].id === id) entity = _entList[i];
    // Abierta desde la ficha viva o desde la Ficha 360: puede no estar en la lista
    if (!entity && _entFichaCur && _entFichaCur.id === id) entity = _entFichaCur;
    if (!entity) return;
  }
  var type = entity ? (_entTypeById(entity.entity_type_id) || _entType()) : _entType();
  if (!type) return;
  _entModalTypeKey = type.key;
  var preset = (!id && presetIdx !== undefined && presetIdx !== null)
    ? (_entPresetItems(type)[presetIdx] || null) : null;
  var a = (entity && entity.attrs) || (preset && preset.attrs) || {};
  var contacts = await _entLoadContacts();

  var BIG = 'width:100%;font-size:16px;padding:12px';
  var formHtml = '';
  var fields = type.fields || [];
  for (var j = 0; j < fields.length; j++) {
    var f = fields[j];
    var v = a[f.key]; if (v === undefined || v === null) v = '';
    var label = '<label class="form-label" style="font-size:13px">' + esc(f.label || f.key) +
      (f.required ? ' *' : '') +
      (f.type === 'date' && f.reminder ? ' ' + _entReminderPill(true) : '') + '</label>';
    var input = '';
    var fid = 'ent-f-' + esc(f.key);

    if (f.type === 'select') {
      input = '<select class="form-input" id="' + fid + '" style="' + BIG + '"><option value="">—</option>' +
        (f.options || []).map(function(o) {
          return '<option value="' + esc(o.value) + '"' + (String(v) === o.value ? ' selected' : '') + '>' + esc(o.label) + '</option>';
        }).join('') + '</select>';
    } else if (f.type === 'note') {
      input = '<textarea class="form-input" id="' + fid + '" rows="3" style="' + BIG + '">' + esc(String(v)) + '</textarea>';
    } else if (f.type === 'boolean') {
      input = '<select class="form-input" id="' + fid + '" style="' + BIG + '">' +
        '<option value=""' + (v === '' ? ' selected' : '') + '>—</option>' +
        '<option value="true"'  + (v === true  ? ' selected' : '') + '>Sí</option>' +
        '<option value="false"' + (v === false ? ' selected' : '') + '>No</option></select>';
    } else {
      var itype = f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : f.type === 'phone' ? 'tel' : 'text';
      input = '<input class="form-input" id="' + fid + '" type="' + itype + '" value="' + esc(String(v)) + '" style="' + BIG + '">';
    }
    formHtml += '<div class="form-group">' + label + input + '</div>';
  }

  // Dueño / titular (persona = contacto; la cosa = esta ficha).
  // Alta desde la Ficha 360 → el cliente viene YA preseleccionado.
  var curContact = entity ? (entity.contact_id || '') : (prelinkContactId || '');
  var contactOpts = '<option value="">— Sin cliente vinculado —</option>' + contacts.map(function(c) {
    return '<option value="' + esc(c.id) + '"' + (curContact === c.id ? ' selected' : '') + '>' + esc(c.displayName || c.phone || '') + '</option>';
  }).join('');
  formHtml += '<div class="form-group"><label class="form-label" style="font-size:13px">👤 Cliente (dueño/titular)</label>' +
    '<select class="form-input" id="ent-f-contact" style="' + BIG + '">' + contactOpts + '</select>' +
    '<small style="color:var(--dim);font-size:11px">Los avisos automáticos se envían a este cliente. Sin cliente, la ficha se guarda pero no avisa.</small></div>';

  var del = entity
    ? '<button class="btn btn-d" style="color:#e17055;margin-right:auto" onclick="deleteEntity(\'' + esc(entity.id) + '\')">🗑 Eliminar</button>'
    : '';

  var presetHint = preset
    ? '<div style="color:var(--dim);font-size:12.5px;line-height:1.5;margin:-4px 0 14px">✨ Prellenado con fechas de ejemplo a partir de hoy — revisa lo que quieras, elige el cliente y guarda.</div>'
    : '';

  openModal(
    '<div class="modal-title">' + esc(type.icon || '') + ' ' + (entity ? esc(entity.display_name) : (preset ? esc(preset.label) : '+ Nuevo ' + esc(type.label_singular.toLowerCase()))) + '</div>' +
    presetHint +
    formHtml +
    '<div class="modal-actions" style="display:flex;gap:10px;align-items:center">' + del +
      '<button class="btn btn-d" onclick="closeModal()">Cancelar</button>' +
      '<button class="btn btn-accent" style="font-size:15px;padding:12px 22px" onclick="saveEntity(' + (entity ? '\'' + esc(entity.id) + '\'' : 'null') + ')">Guardar</button>' +
    '</div>'
  );
}

async function saveEntity(id) {
  // El tipo del MODAL, no el de la pestaña: la ficha pudo abrirse desde la
  // Ficha 360 de un cliente con otro tipo activo.
  var type = (_entModalTypeKey && _entTypes ? _entTypes.filter(function(t) { return t.key === _entModalTypeKey; })[0] : null) || _entType();
  if (!type) return;
  var attrs = {};
  var fields = type.fields || [];
  for (var j = 0; j < fields.length; j++) {
    var f  = fields[j];
    var el = document.getElementById('ent-f-' + f.key);
    if (!el) continue;
    var v = el.value;
    if (f.required && !String(v || '').trim()) {
      toast('Falta «' + (f.label || f.key) + '»', 'err');
      el.focus();
      return;
    }
    attrs[f.key] = v; // el servidor valida tipos/opciones y limpia
  }
  var contactEl = document.getElementById('ent-f-contact');
  var body = { attrs: attrs, contact_id: contactEl ? (contactEl.value || null) : null };

  try {
    if (id) {
      await api('/api/portal/entities/' + id, 'PATCH', body);
      toast('Ficha actualizada');
    } else {
      body.type = type.key;
      await api('/api/portal/entities', 'POST', body);
      toast(type.label_singular + ' añadido ✔');
    }
    // Editada desde la ficha viva → volver a ella (con la historia fresca)
    if (id && _entFichaCur && _entFichaCur.id === id) {
      openEntityFicha(id);
    } else {
      closeModal();
    }
    if (document.getElementById('entList')) entFetchList();
  } catch (e) {
    // 409 = duplicado por identificador (matrícula, nº de póliza…): aviso
    // amable con el mensaje del servidor, sin el prefijo de error técnico.
    if (e.status === 409) toast('⚠️ ' + e.message, 'err');
    else toast('Error: ' + e.message, 'err');
  }
}

async function deleteEntity(id) {
  var type = _entType();
  if (!confirm('¿Eliminar esta ficha' + (type ? ' de ' + type.label_plural.toLowerCase() : '') + '? Sus avisos pendientes se cancelarán.')) return;
  try {
    await api('/api/portal/entities/' + id, 'DELETE');
    toast('Ficha eliminada');
    _entFichaCur = null;
    closeModal();
    if (document.getElementById('entList')) entFetchList();
  } catch (e) {
    toast('Error: ' + e.message, 'err');
  }
}

// ════════ IMPORTACIÓN MÁGICA (v1) — su Excel → fichas en 3 pasos ═══════════
// Regla de los 60 años: grande, obvio y en cristiano. Paso 1 pegar/subir,
// paso 2 revisar el mapeo (selects por columna, revalidado en el servidor),
// paso 3 resultado con conteos y errores claros. Cero jerga.

var _entImp = null;   // { csv, preview } — estado del asistente

function openEntityImportModal() {
  var type = _entType();
  if (!type) { toast('Las fichas no están disponibles para tu negocio', 'err'); return; }
  // «← Volver» desde el paso 2 conserva lo ya pegado
  var prevCsv = (_entImp && _entImp.csv) || '';
  _entImp = { csv: prevCsv };
  openModal(
    '<div class="modal-title">📥 Importar ' + esc(type.label_plural.toLowerCase()) + ' desde tu Excel</div>' +
    '<div style="color:var(--dim);font-size:13.5px;line-height:1.6;margin-bottom:14px">' +
      'Abre tu Excel, <b>selecciona las celdas</b> (incluida la fila de títulos), cópialas y pégalas aquí abajo. También vale un archivo .csv exportado.</div>' +
    '<textarea class="form-input" id="entImpCsv" rows="9" placeholder="Pega aquí tus datos…&#10;&#10;Ejemplo:&#10;Matrícula\tMarca\tTeléfono\tPróxima ITV&#10;1234ABC\tSeat\t612345678\t15/03/2027" ' +
      'style="width:100%;font-size:13px;font-family:ui-monospace,monospace;white-space:pre;overflow-x:auto">' + esc(prevCsv) + '</textarea>' +
    '<div style="margin-top:10px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">' +
      '<label class="btn btn-d" style="cursor:pointer;font-size:14px">📄 O elegir archivo CSV' +
        '<input type="file" accept=".csv,.txt,.tsv" style="display:none" onchange="entImpFile(this)"></label>' +
      '<span id="entImpFileName" style="color:var(--dim);font-size:12px"></span>' +
    '</div>' +
    '<div class="modal-actions">' +
      '<button class="btn btn-d" onclick="closeModal()">Cancelar</button>' +
      '<button class="btn btn-accent" style="font-size:15px;padding:12px 22px" onclick="entImpPreview()">Continuar →</button>' +
    '</div>'
  );
}

function entImpFile(input) {
  var f = input.files && input.files[0];
  if (!f) return;
  var reader = new FileReader();
  reader.onload = function() {
    var el = document.getElementById('entImpCsv');
    if (el) el.value = String(reader.result || '');
    var nm = document.getElementById('entImpFileName');
    if (nm) nm.textContent = '✓ ' + f.name;
  };
  reader.readAsText(f);
}

// Paso 1→2 (y re-mapeos): analiza en el SERVIDOR — la UI nunca inventa conteos
async function entImpPreview(mapping) {
  var type = _entType();
  if (!type || !_entImp) return;
  var el = document.getElementById('entImpCsv');
  if (el) _entImp.csv = el.value;
  if (!_entImp.csv || !_entImp.csv.trim()) { toast('Pega tus datos o elige el archivo primero', 'err'); return; }
  var body = { type: type.key, csv: _entImp.csv };
  if (mapping) body.mapping = mapping;
  var r;
  try {
    r = await api('/api/portal/entities/import/preview', 'POST', body);
  } catch (e) { toast('Error: ' + e.message, 'err'); return; }
  _entImp.preview = r;
  entImpRenderStep2(type, r);
}

function entImpRemap(i, v) {
  if (!_entImp || !_entImp.preview) return;
  var m = (_entImp.preview.mapping || []).slice();
  // un destino solo puede venir de UNA columna: si ya estaba en otra, la libera
  if (v) { for (var k = 0; k < m.length; k++) { if (k !== i && m[k] === v) m[k] = ''; } }
  m[i] = v;
  entImpPreview(m);
}

function entImpRenderStep2(type, r) {
  var fields = type.fields || [];
  var i, j;

  // Mapeo: una fila por columna detectada, con select grande
  var mapRows = '';
  for (i = 0; i < r.headers.length; i++) {
    var opts = '<option value="">— No usar esta columna —</option>' +
      '<option value="_phone"' + (r.mapping[i] === '_phone' ? ' selected' : '') + '>📱 Teléfono del cliente</option>' +
      '<option value="_name"'  + (r.mapping[i] === '_name'  ? ' selected' : '') + '>👤 Nombre del cliente</option>';
    for (j = 0; j < fields.length; j++) {
      opts += '<option value="' + esc(fields[j].key) + '"' + (r.mapping[i] === fields[j].key ? ' selected' : '') + '>' +
        esc(fields[j].label || fields[j].key) + (fields[j].type === 'date' && fields[j].reminder ? ' 🔔' : '') + '</option>';
    }
    mapRows += '<div style="display:flex;gap:10px;align-items:center;padding:7px 0;border-bottom:1px solid var(--border)">' +
      '<div style="flex:1;font-weight:700;font-size:14px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
        esc(r.headers[i] || ('Columna ' + (i + 1))) + '</div>' +
      '<div style="color:var(--dim);flex:none">→</div>' +
      '<select class="form-input" style="flex:1.3;font-size:15px;padding:10px" onchange="entImpRemap(' + i + ', this.value)">' + opts + '</select>' +
    '</div>';
  }

  // Muestra: las primeras fichas TAL Y COMO quedarán
  var sample = '';
  if (r.sample && r.sample.length) {
    var labelByKey = {};
    for (j = 0; j < fields.length; j++) labelByKey[fields[j].key] = fields[j].label || fields[j].key;
    sample = '<div style="font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:var(--dim);margin:16px 0 8px">Así quedarán las primeras fichas</div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px">' +
      r.sample.map(function(s) {
        var rows = '';
        for (var k in s.attrs) {
          if (k === 'is_draft') continue;
          var val = s.attrs[k];
          rows += '<div style="display:flex;justify-content:space-between;gap:8px;font-size:12.5px;padding:2px 0">' +
            '<span style="color:var(--dim)">' + esc(labelByKey[k] || k) + '</span>' +
            '<span style="font-weight:600;text-align:right">' + esc(Array.isArray(val) ? val.join(', ') : String(val)) + '</span></div>';
        }
        var owner = s.phone
          ? '<div style="font-size:11.5px;color:var(--accent-l);margin-top:6px">📱 ' + esc(s.contactName ? s.contactName + ' · ' : '') + esc(s.phone) + ' → recibirá los avisos</div>'
          : '<div style="font-size:11.5px;color:var(--dim);margin-top:6px">Sin teléfono — la ficha se guarda pero no avisa</div>';
        return '<div style="padding:12px;border:1px solid var(--border);border-radius:12px;background:rgba(255,255,255,.02)">' +
          rows + (s.isDraft ? '<div style="margin-top:6px">' + _entDraftBadge(true) + '</div>' : '') + owner + '</div>';
      }).join('') + '</div>';
  }

  // Resumen en grande (la verdad del servidor)
  var chips =
    '<div style="display:flex;gap:10px;flex-wrap:wrap;margin:14px 0 4px">' +
      '<div style="padding:10px 16px;border:1px solid rgba(196,245,70,.35);border-radius:12px;background:rgba(196,245,70,.06)">' +
        '<span style="font-size:22px;font-weight:800;color:var(--accent-l)">' + r.ready + '</span> ' +
        '<span style="font-size:13px">fichas listas</span></div>' +
      '<div style="padding:10px 16px;border:1px solid var(--border);border-radius:12px">' +
        '<span style="font-size:22px;font-weight:800">' + r.withPhone + '</span> ' +
        '<span style="font-size:13px">con teléfono → avisos automáticos 🔔</span></div>' +
      (r.skippedCount ? '<div style="padding:10px 16px;border:1px solid rgba(225,112,85,.4);border-radius:12px;background:rgba(225,112,85,.06)">' +
        '<span style="font-size:22px;font-weight:800;color:#e17055">' + r.skippedCount + '</span> ' +
        '<span style="font-size:13px">con problemas (se saltarán)</span></div>' : '') +
    '</div>' +
    (r.drafts ? '<div style="color:var(--dim);font-size:12.5px;margin:4px 0">' + r.drafts + ' entrarán como borrador «completar ficha» (les falta algún dato obligatorio).</div>' : '') +
    (r.truncated ? '<div style="color:#e0a030;font-size:12.5px;margin:4px 0">⚠️ Tu archivo tiene ' + r.totalRows + ' filas — en esta pasada entran las primeras ' + r.maxRows + '. Repite la importación con el resto después.</div>' : '');

  var skippedHtml = '';
  if (r.skipped && r.skipped.length) {
    skippedHtml = '<details style="margin:8px 0"><summary style="cursor:pointer;font-size:13px;color:#e17055">Ver los problemas (' + r.skippedCount + ')</summary>' +
      '<div style="font-size:12.5px;color:var(--dim);margin-top:6px;line-height:1.7">' +
      r.skipped.map(function(s) { return 'Fila ' + s.row + ': ' + esc(s.reason); }).join('<br>') +
      (r.skippedCount > r.skipped.length ? '<br>… y ' + (r.skippedCount - r.skipped.length) + ' más' : '') +
      '</div></details>';
  }

  openModal(
    '<div class="modal-title">📥 Paso 2 de 3 — Revisa las columnas</div>' +
    '<div style="color:var(--dim);font-size:13.5px;line-height:1.6;margin-bottom:12px">' +
      'Hemos reconocido tus columnas. Comprueba que cada una va a su sitio — puedes cambiarlas aquí mismo.</div>' +
    '<div style="max-height:38vh;overflow-y:auto;padding-right:4px">' + mapRows + '</div>' +
    chips + skippedHtml + sample +
    '<div class="modal-actions">' +
      '<button class="btn btn-d" onclick="openEntityImportModal()">← Volver</button>' +
      '<button class="btn btn-accent" id="entImpGo" style="font-size:15px;padding:12px 22px" ' +
        (r.ready ? '' : 'disabled ') + 'onclick="entImpCommit()">Importar ' + r.ready + ' ' +
        esc(r.ready === 1 ? type.label_singular.toLowerCase() : type.label_plural.toLowerCase()) + '</button>' +
    '</div>'
  );
}

// Paso 3: crear de verdad (timeout largo: 500 filas tardan)
async function entImpCommit() {
  var type = _entType();
  if (!type || !_entImp || !_entImp.preview) return;
  var btn = document.getElementById('entImpGo');
  if (btn) { btn.disabled = true; btn.textContent = 'Importando… no cierres esta ventana'; }
  var r;
  try {
    r = await api('/api/portal/entities/import/commit', 'POST',
      { type: type.key, csv: _entImp.csv, mapping: _entImp.preview.mapping }, 120000);
  } catch (e) {
    toast('Error: ' + e.message, 'err');
    if (btn) { btn.disabled = false; btn.textContent = 'Importar'; }
    return;
  }

  var skippedHtml = '';
  if (r.skipped && r.skipped.length) {
    skippedHtml = '<details style="margin:10px 0;text-align:left"><summary style="cursor:pointer;font-size:13px;color:#e17055">' +
      r.skippedCount + ' filas no entraron — ver por qué</summary>' +
      '<div style="font-size:12.5px;color:var(--dim);margin-top:6px;line-height:1.7">' +
      r.skipped.map(function(s) { return 'Fila ' + s.row + ': ' + esc(s.reason); }).join('<br>') +
      (r.skippedCount > r.skipped.length ? '<br>… y ' + (r.skippedCount - r.skipped.length) + ' más' : '') +
      '</div></details>';
  }

  var totalOk = (r.created || 0) + (r.updated || 0);
  openModal(
    '<div class="modal-title">✅ Paso 3 de 3 — ¡Hecho!</div>' +
    '<div style="text-align:center;padding:10px 0 4px">' +
      '<div style="font-size:44px;font-weight:800;color:var(--accent-l);line-height:1">' + totalOk + '</div>' +
      '<div style="font-size:15px;font-weight:700;margin-top:4px">' +
        esc(totalOk === 1 ? type.label_singular.toLowerCase() : type.label_plural.toLowerCase()) + ' en tu panel</div>' +
      '<div style="color:var(--dim);font-size:13.5px;line-height:1.7;margin-top:10px">' +
        (r.updated ? '✨ ' + r.created + (r.created === 1 ? ' ficha nueva' : ' fichas nuevas') +
          ' · 🔁 ' + r.updated + (r.updated === 1 ? ' actualizada' : ' actualizadas') +
          ' (ya existían — datos refrescados, sin duplicados)<br>' : '') +
        (r.linked ? '📱 ' + r.linked + ' con cliente vinculado — sus avisos ya están en marcha 🔔<br>' : '') +
        (r.contactsCreated ? '👤 ' + r.contactsCreated + ' clientes nuevos creados desde el Excel<br>' : '') +
        (r.drafts ? '📝 ' + r.drafts + ' como borrador «completar ficha»' : '') +
      '</div>' +
    '</div>' +
    skippedHtml +
    '<div class="modal-actions">' +
      '<button class="btn btn-accent" style="font-size:15px;padding:12px 22px" onclick="closeModal();entFetchList()">Ver mis ' +
        esc(type.label_plural.toLowerCase()) + '</button>' +
    '</div>'
  );
  _entImp = null;
  if (document.getElementById('entList')) entFetchList();
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
