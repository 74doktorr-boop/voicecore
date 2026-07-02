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
        '<a class="btn btn-g btn-sm" href="tel:' + esc(tel) + '" style="text-decoration:none">📞</a> ' +
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
    return '<tr>' +
      '<td><strong>' + esc(o.phone) + '</strong>' + (o.count>1?' <span class="badge bp" style="font-size:10px">'+o.count+' llamadas</span>':'') + '</td>' +
      '<td style="color:var(--dim);font-size:12px">' + (o.lastCall?timeAgo(o.lastCall):'—') + '</td>' +
      '<td style="text-align:right;white-space:nowrap">' +
        '<button class="btn btn-accent btn-sm" onclick="oppAiCall(\'' + esc(tel) + '\')">🤖 Que le llame</button> ' +
        '<a class="btn btn-g btn-sm" href="tel:' + esc(tel) + '" style="text-decoration:none" data-tip="Llamar tú">📞</a> ' +
        '<a class="btn btn-sm" style="background:#25d366;color:#fff;text-decoration:none" href="https://wa.me/' + esc(tel.replace(/\+/g,'')) + '" target="_blank" data-tip="WhatsApp">💬</a>' +
      '</td></tr>';
  }).join('');
  box.innerHTML =
    '<div class="card" style="margin-bottom:14px;background:rgba(253,203,110,.06);border-color:rgba(253,203,110,.25)">' +
      '<div style="font-size:13px;color:var(--dim);line-height:1.6">💡 Estas personas llamaron en los últimos ' + (d.sinceDays||14) + ' días pero <strong style="color:var(--text)">no llegaron a reservar cita</strong>. Una llamada o un WhatsApp puede convertirlas en clientes.</div>' +
    '</div>' +
    '<div class="table-wrap"><table><thead><tr><th>Teléfono</th><th>Última llamada</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>';
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
    await api('/api/portal/calls/outbound', 'POST', { to: phone });
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

// ════════ Mis tareas (mini-agenda CRM) ════════════════════════════════════════
async function loadTareas() {
  var box = document.getElementById('tareas-body');
  if (!box) return;
  box.innerHTML = skelPanel();

  var data;
  try { data = await api('/api/portal/tasks'); }
  catch (e) { box.innerHTML = '<div class="empty-state"><div>Error: ' + esc(e.message) + '</div></div>'; return; }

  var tasks = data.tasks || [];
  var pend = tasks.filter(function(t){ return !t.done; });
  var done = tasks.filter(function(t){ return t.done; });
  var today = new Date().toISOString().slice(0,10);

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

  box.innerHTML =
    // Añadir tarea
    '<div class="card" style="margin-bottom:18px">' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
        '<input class="form-input" id="newTaskTitle" placeholder="¿Qué tienes que hacer? (ej. Llamar a Ana)" style="flex:2;min-width:200px" onkeydown="if(event.key===\'Enter\')addTask()">' +
        '<input class="form-input" id="newTaskDue" type="date" style="flex:1;min-width:140px">' +
        '<button class="btn btn-accent" onclick="addTask()">+ Añadir</button>' +
      '</div>' +
    '</div>' +
    // Pendientes
    '<div class="card" style="margin-bottom:18px">' +
      '<div style="font-size:14px;font-weight:700;margin-bottom:6px">Pendientes <span style="color:var(--dim);font-weight:400">(' + pend.length + ')</span></div>' +
      (pend.length ? pend.map(taskRow).join('') : '<div style="color:var(--dim);font-size:13px;padding:10px 0">🎉 Nada pendiente. ¡Todo al día!</div>') +
    '</div>' +
    // Completadas
    (done.length ? '<div class="card">' +
      '<div style="font-size:14px;font-weight:700;margin-bottom:6px;color:var(--dim)">Completadas (' + done.length + ')</div>' +
      done.slice(0,20).map(taskRow).join('') +
    '</div>' : '');
}

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
    '<div style="display:flex;gap:24px;flex-wrap:wrap;margin-bottom:30px">' + wins + '</div>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:30px">' + pills + '</div>' +
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
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">' +
      '<div><div class="nf-hero-greet">' + greet + ', ' + esc(d.businessName) + '</div>' +
      '<div class="nf-hero-date">' + dateStr + (d.daysActive ? ' · tu asistente lleva ' + d.daysActive + ' días contigo' : '') + '</div></div>' +
      status +
    '</div>' +
    '<div class="nf-hero-lead">' + lead + '</div>' +
    (wins ? '<div class="nf-wins nf-stagger">' + wins + '</div>' : '') +
    (wins && d.valueEstToday && d.avgTicketConfigured === false
      ? '<div style="font-size:12px;color:var(--dim);margin-top:10px">El € está calculado con un ticket medio genérico (35€). ' +
        '<a onclick="navigate(\'configuracion\')" style="color:var(--accent-l);cursor:pointer;text-decoration:underline">Pon el tuyo</a> y será exacto.</div>'
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
  return '<div style="margin-bottom:24px">' + out + '</div>';
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
        '<div><div class="crit-date">' + (isToday ? '<span style="color:var(--accent-l)">Hoy</span>' : fmtDate(a.date)) + ' · ' + esc(a.time) + '</div>' +
        '<div class="crit-days">' + (stBadge[a.status] || stBadge.pending) + '</div></div></div>';
    }
  } else {
    html = '<div style="color:var(--dim);font-size:13px;padding:8px 0">Aún no hay citas próximas. Cuando tu asistente reserve una, aparecerá aquí.</div>';
  }
  return '<div class="card"><div class="card-title">Próximas citas</div>' + html +
    '<button class="btn btn-d btn-sm" style="margin-top:12px" onclick="navigate(\'citas\')">Ver agenda →</button></div>';
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
function dashSetup(d) {
  if (localStorage.getItem('nf_banner_dismissed') === '1') return '';
  if ((d.totalCalls || 0) !== 0) return '';
  var steps =
    '<div class="setup-step done">✅ Pago confirmado — tu cuenta está activa</div>' +
    '<div class="setup-step" style="cursor:pointer" onclick="navigate(\'asistente\')">⚙️ <strong>Configura tu asistente</strong> — nombre, voz, idioma y servicios <span style="color:var(--accent-l)">→</span></div>' +
    '<div class="setup-step" style="cursor:pointer" onclick="navigate(\'configuracion\')">📋 <strong>Completa los datos del negocio</strong> — dirección, horarios, tu WhatsApp <span style="color:var(--accent-l)">→</span></div>' +
    (d.onboarding && d.onboarding.number_assigned
      ? '<div class="setup-step" style="cursor:pointer" onclick="navigate(\'asistente\')">▶ <strong>Escúchalo antes de desviar</strong> — tu asistente te llama al móvil <span style="color:var(--accent-l)">→</span></div>' +
        '<div class="setup-step" style="cursor:pointer" onclick="navigate(\'configuracion\')">📞 <strong>Activa el desvío de llamadas</strong>' +
        (d.nodeflowNumber ? ' — tu número NodeFlow: <strong style="color:var(--accent-l)">' + esc(d.nodeflowNumber) + '</strong>' : '') +
        ' <span style="color:var(--accent-l)">→</span></div>'
      : '<div class="setup-step" style="opacity:.6">⏳ <strong>Número NodeFlow asignándose…</strong> — recibirás un email con los códigos de desvío</div>');
  return '<div class="card" id="setup-banner" style="border-color:rgba(196,245,70,.25)">' +
    '<div class="card-title">🚀 Primeros pasos</div>' +
    '<div style="display:flex;flex-direction:column;gap:8px">' + steps + '</div>' +
    '<button class="btn btn-d btn-sm" style="margin-top:14px" ' +
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

  // Contadores accionables (en paralelo, tolerante a fallos)
  var act = { opps: 0, tasks: 0, wait: 0, unanswered: 0 };
  try {
    var r = await Promise.all([
      api('/api/portal/missed-opportunities').catch(function () { return {}; }),
      api('/api/portal/tasks').catch(function () { return {}; }),
      api('/api/portal/waitlist').catch(function () { return {}; }),
      api('/api/portal/knowledge/unanswered').catch(function () { return {}; }),
    ]);
    act.opps  = (r[0].opportunities || []).length;
    act.tasks = (r[1].tasks || []).filter(function (t) { return !t.done; }).length;
    act.wait  = (r[2].waitlist || []).filter(function (w) { return w.status === 'waiting'; }).length;
    var dismissed = _kbDismissedSet();
    act.unanswered = (r[3].questions || []).filter(function (x) { return !dismissed.has(_kbQKey(x.question)); }).length;
  } catch (e) {}

  sec.innerHTML =
    dashHero(d) +
    dashSetup(d) +
    dashRecos(act) +
    dashContinue() +
    dashQuick(act) +
    '<div class="two-col nf-stagger">' + dashUpcoming(d) + dashFeed(d.recentActivity) + '</div>' +
    referralCta('dashboard');

  startDashLive();
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
    '<div class="section-header"><div class="section-title">Llamadas</div></div>' +
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
var _citasView = localStorage.getItem('nf_citas_view') || 'semana';
var _citasWeekOffset = 0;

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
      '<div class="section-title">Citas</div>' +
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
      '<div class="section-title">Informes</div>' +
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
          '<div class="crit-meta"><span class="badge ' + urgClass + '">' + esc(critTypeLabel(e.type)) + '</span>' + (e.notes ? ' · ' + esc(e.notes) : '') + '</div></div>' +
        '<div><div class="crit-date">' + fmtDate(e.dueDate) + '</div><div class="crit-days">' + daysText + '</div></div>' +
        '<button class="btn btn-r btn-sm" onclick="deleteCritDate(\'' + esc(e.id) + '\')">✕</button>' +
        '</div>';
    }
  } else {
    critRows = '<div class="empty-state" style="padding:24px"><div class="empty-state-text">No hay fechas críticas activas</div></div>';
  }

  sec.innerHTML =
    '<div class="section-header"><div class="section-title">Automatizaciones</div></div>' +
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
        '<div class="auto-desc">Recordatorio cuando un cliente lleva tiempo sin venir</div>' +
      '</div><label class="toggle"><input type="checkbox" id="togRebooking" ' + (reb.enabled !== false ? 'checked' : '') +
        ' onchange="patchAuto(\'rebooking\',{enabled:this.checked})"><span class="slider"></span></label></div>' +
      '<div class="auto-footer"><span class="auto-label">Días sin venir:</span><div class="auto-hours">' +
        '<input type="number" id="daysRebooking" value="' + (reb.daysThreshold || nfReactivationDays() || 42) + '" min="7" max="365"' +
        ' onchange="patchAuto(\'rebooking\',{daysThreshold:parseInt(this.value)})"></div></div>' +
      (nfReactivationDays() ? '<div style="font-size:11px;color:var(--dim);margin-top:8px">Recomendado para tu sector: <strong style="color:var(--text)">' + nfReactivationDays() + ' días</strong></div>' : '') +
      '</div>' +
      // Recuperación de no-shows card
      '<div class="auto-card"><div class="auto-row"><div>' +
        '<div class="auto-name">🔁 Recuperación de no-shows</div>' +
        '<div class="auto-desc">Si un cliente falta a su cita, la IA le escribe automáticamente para reagendar</div>' +
      '</div><label class="toggle"><input type="checkbox" id="togNoshow" ' + ((auto.noshow && auto.noshow.enabled !== false) ? 'checked' : '') +
        ' onchange="patchAuto(\'noshow\',{enabled:this.checked})"><span class="slider"></span></label></div></div>' +
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
  var SECTORS = ['generico','restaurante','fisioterapia','clinica','dental','peluqueria','barberia',
    'estetica','gimnasio','academia','veterinaria','farmacia','asesoria','taller','hotel',
    'inmobiliaria','optica','psicologia','coaching','nutricion','podologia','autoescuela',
    'estetica_avanzada','yoga','pilates','guarderia_canina','abogados','notaria',
    'agencia_viajes','reformas','otro'];
  var SECTOR_LABELS = {
    generico: 'Genérico', restaurante: 'Restaurante', fisioterapia: 'Fisioterapia',
    clinica: 'Clínica / Centro médico', dental: 'Clínica dental', peluqueria: 'Peluquería',
    barberia: 'Barbería', estetica: 'Estética', gimnasio: 'Gimnasio', academia: 'Academia',
    veterinaria: 'Veterinaria', farmacia: 'Farmacia', asesoria: 'Asesoría / Gestoría',
    taller: 'Taller mecánico', hotel: 'Hotel / Alojamiento', inmobiliaria: 'Inmobiliaria',
    optica: 'Óptica', psicologia: 'Psicología', coaching: 'Coaching', nutricion: 'Nutrición',
    podologia: 'Podología', autoescuela: 'Autoescuela', estetica_avanzada: 'Estética avanzada',
    yoga: 'Yoga', pilates: 'Pilates', guarderia_canina: 'Guardería canina',
    abogados: 'Abogados', notaria: 'Notaría', agencia_viajes: 'Agencia de viajes',
    reformas: 'Reformas', otro: 'Otro',
  };
  var sectorOpts = SECTORS.map(function(s) {
    return '<option value="' + s + '" ' + (c.sector === s ? 'selected' : '') + '>' +
      (SECTOR_LABELS[s] || s) + '</option>';
  }).join('');

  sec.innerHTML =
    '<div class="section-header"><div class="section-title">Configuración</div></div>' +
    '<div class="card" style="max-width:860px;margin-left:auto;margin-right:auto">' +
      '<div class="form-section-title">Información general</div>' +
      '<div class="form-row">' +
        '<div class="form-group"><label class="form-label">Nombre del negocio</label>' +
          '<input class="form-input" id="cfgName" value="' + esc(c.name || '') + '"></div>' +
        '<div class="form-group"><label class="form-label">Email del propietario</label>' +
          '<input class="form-input" readonly value="' + esc(c.ownerEmail || '') + '">' +
          '<small style="color:var(--dim);font-size:11px">Para cambiar el email, contacta con soporte</small></div>' +
      '</div>' +
      '<div class="form-row">' +
        '<div class="form-group"><label class="form-label">Teléfono del negocio</label>' +
          '<input class="form-input" readonly value="' + esc(c.phone || '—') + '">' +
          '<small style="color:var(--dim);font-size:11px">Número provisionado — no editable</small></div>' +
        '<div class="form-group"><label class="form-label">Idioma de la IA</label>' +
          '<div style="font-size:12px;color:var(--dim);padding:9px 0;line-height:1.5">Se configura en <a onclick="navigate(\'asistente\')" style="color:var(--accent-l);cursor:pointer;text-decoration:underline">Asistente</a> para no tenerlo en dos sitios. Actual: <strong style="color:var(--text)">' + ({ es: 'Castellano', eu: 'Euskera', gl: 'Galego' }[c.language] || 'Castellano') + '</strong>.</div></div>' +
      '</div>' +
      '<div class="form-group"><label class="form-label">Sector</label>' +
        '<select class="form-input" id="cfgSector">' + sectorOpts + '</select></div>' +
      '<div class="form-section-title">Servicios y horarios</div>' +
      '<div class="form-group"><label class="form-label">Servicios y precios <span style="color:var(--dim);font-weight:400">— la IA se los dice a tus clientes con exactitud</span></label>' +
        '<div class="svc-head"><span>Servicio</span><span>Precio</span><span>Duración</span><span>Detalle (opcional)</span><span></span></div>' +
        '<div id="svcList"></div>' +
        '<button type="button" class="btn btn-d btn-sm" style="margin-top:10px" onclick="addServiceRow()">+ Añadir servicio</button></div>' +
      '<div class="form-group"><label class="form-label">Horarios</label>' +
        '<textarea class="form-input" id="cfgSchedule" rows="3" placeholder="L-V 9:00-20:00, Sáb 9:00-14:00">' + esc(c.schedule || '') + '</textarea></div>' +
      '<div class="form-section-title">Configuración de la IA</div>' +
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
      '<div class="form-row">' +
        '<div class="form-group"><label class="form-label">Tu WhatsApp personal <span style="color:var(--dim);font-weight:400">(confirmaciones y cancelaciones)</span></label>' +
          '<input class="form-input" id="cfgAlertPhone" type="tel" placeholder="+34 612 345 678"' +
            ' value="' + esc(c.alertPhone || '') + '">' +
          '<small style="color:var(--dim);font-size:11px">Recibirás un WhatsApp cuando un cliente confirme o cancele su cita. Debe ser diferente al número del negocio.</small></div>' +
        '<div class="form-group"><label class="form-label">Email para notificaciones <span style="color:var(--dim);font-weight:400">(resumen diario y alertas)</span></label>' +
          '<input class="form-input" id="cfgNotifyEmail" type="email" placeholder="tu@email.com"' +
            ' value="' + esc(c.notifyEmail || '') + '"></div>' +
      '</div>' +

      '<div class="form-section-title">Acceso al portal</div>' +
      '<div class="form-group"><label class="form-label">Contraseña de acceso <span style="color:var(--dim);font-weight:400">(opcional — para entrar sin esperar el enlace)</span></label>' +
        '<div style="display:flex;gap:10px;align-items:center">' +
          '<input class="form-input" id="cfgPassword" type="password" placeholder="Mínimo 6 caracteres" autocomplete="new-password" style="flex:1">' +
          '<button type="button" class="btn btn-d" style="white-space:nowrap" onclick="setPortalPassword()">Guardar contraseña</button>' +
        '</div>' +
        '<small style="color:var(--dim);font-size:11px">Entra con tu email y esta contraseña. El enlace por email seguirá funcionando igual.</small></div>' +

      '<div style="display:flex;gap:12px;margin-top:24px">' +
        '<button class="btn btn-accent" onclick="saveConfig()">Guardar cambios</button>' +
        '<a href="https://wa.me/34666351319?text=Necesito%20ayuda%20con%20mi%20portal" target="_blank"' +
           ' class="btn btn-d" style="text-decoration:none">Contactar soporte</a>' +
      '</div>' +
    '</div>' +
    // BUG FIX: usar outboundNumber (número NodeFlow asignado), NO c.phone (teléfono del propietario)
    (c.outboundNumber
      ? renderDesvioGuide(c.outboundNumber)
      : '<div class="card" style="max-width:860px;margin-left:auto;margin-right:auto;margin-top:24px;border-color:rgba(249,202,36,.3);background:rgba(249,202,36,.04)">' +
          '<div class="card-title" style="color:#f9ca24">⏳ Número NodeFlow pendiente de asignación</div>' +
          '<p style="font-size:13px;color:var(--dim);margin:0">Tu número dedicado se está asignando automáticamente. En cuanto esté listo recibirás un email con las instrucciones de desvío y aquí aparecerán los códigos.<br><br>' +
          '¿Necesitas ayuda? <a href="https://wa.me/34666351319?text=Hola%20Unai%2C%20mi%20n%C3%BAmero%20NodeFlow%20a%C3%BAn%20no%20aparece" target="_blank" style="color:#d6ff5c">Escríbenos →</a></p>' +
        '</div>');

  // Render de servicios+precios existentes (o una fila vacía para empezar)
  (Array.isArray(c.serviceList) && c.serviceList.length ? c.serviceList : [{}]).forEach(addServiceRow);
}

// Editor de servicios+precios (filas dinámicas)
function addServiceRow(s) {
  s = s || {};
  var box = document.getElementById('svcList');
  if (!box) return;
  var row = document.createElement('div');
  row.className = 'svc-row';
  row.innerHTML =
    '<input class="form-input svc-name" placeholder="Ej. Corte de pelo" value="' + esc(s.name || '') + '">' +
    '<input class="form-input svc-price" placeholder="Ej. 15€" value="' + esc(s.price || '') + '">' +
    '<input class="form-input svc-dur" placeholder="Ej. 30 min" value="' + esc(s.duration || '') + '">' +
    '<input class="form-input svc-notes" placeholder="Ej. incluye lavado y peinado" value="' + esc(s.notes || '') + '">' +
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
    var bg  = accent ? 'rgba(56,225,200,.07)' : 'rgba(255,255,255,.03)';
    var bdr = accent ? 'rgba(56,225,200,.25)' : 'var(--border)';
    var clr = accent ? 'var(--green2)' : 'var(--dim)';
    var lblClr = accent ? 'var(--green)' : 'var(--dim)';
    var lbl = accent ? 'ACTIVAR' : 'DESACTIVAR';
    return '<div style="display:flex;align-items:center;gap:6px;background:' + bg + ';border:1px solid ' + bdr + ';border-radius:8px;padding:7px 12px;min-width:0">' +
      '<span style="font-size:9px;color:' + lblClr + ';font-weight:700;text-transform:uppercase;white-space:nowrap">' + lbl + '</span>' +
      '<code id="' + id + '" style="font-size:13px;font-weight:700;color:' + clr + ';letter-spacing:.02em;white-space:nowrap">' + code + '</code>' +
      '<button onclick="copyCode(\'' + id + '\')" style="background:none;border:none;cursor:pointer;font-size:13px;padding:0 0 0 2px;color:' + lblClr + ';flex-shrink:0" title="Copiar al portapapeles">📋</button>' +
    '</div>';
  }

  var rows = tipos.map(function(t, i) {
    var actId   = 'dv-act-'   + i;
    var deactId = 'dv-deact-' + i;
    var recBadge = t.recommended
      ? '<span style="display:inline-block;background:rgba(56,225,200,.15);color:var(--green);border:1px solid rgba(56,225,200,.3);border-radius:20px;font-size:10px;font-weight:700;padding:2px 8px;margin-left:8px;vertical-align:middle">Recomendado</span>'
      : '';
    var border = t.recommended ? '1px solid rgba(56,225,200,.25)' : '1px solid var(--border)';
    var bg     = t.recommended ? 'rgba(56,225,200,.04)' : 'transparent';
    return '<div style="border:' + border + ';border-radius:12px;padding:16px;margin-bottom:10px;background:' + bg + '">' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">' +
        '<span style="font-size:18px">' + t.icon + '</span>' +
        '<span style="font-weight:700;font-size:13px">' + t.label + '</span>' +
        recBadge +
      '</div>' +
      '<div style="font-size:11px;color:var(--accent-l);font-weight:600;margin-bottom:4px">⚡ ' + t.when + '</div>' +
      '<div style="font-size:12px;color:var(--dim);margin-bottom:12px;line-height:1.6">' + t.desc + '</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
        codeBlock(actId,   t.activate,   true) +
        codeBlock(deactId, t.deactivate, false) +
      '</div>' +
    '</div>';
  }).join('');

  var steps =
    '<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:20px">' +
      '<div style="display:flex;align-items:center;gap:10px;font-size:13px">' +
        '<div style="width:24px;height:24px;border-radius:50%;background:var(--accent);color:#0a0b0d;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">1</div>' +
        '<span>Elige el tipo de desvío que mejor se adapta a tu negocio (ver abajo)</span>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:10px;font-size:13px">' +
        '<div style="width:24px;height:24px;border-radius:50%;background:var(--accent);color:#0a0b0d;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">2</div>' +
        '<span>Pulsa <strong>📋</strong> para copiar el código de activación</span>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:10px;font-size:13px">' +
        '<div style="width:24px;height:24px;border-radius:50%;background:var(--accent);color:#0a0b0d;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">3</div>' +
        '<span>Abre el marcador de tu móvil, pega el código y pulsa <strong>llamar ✅</strong></span>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:10px;font-size:13px">' +
        '<div style="width:24px;height:24px;border-radius:50%;background:rgba(56,225,200,.2);color:var(--green);font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">4</div>' +
        '<span style="color:var(--dim)">Para desactivarlo en cualquier momento, copia y marca el código <strong>Desactivar</strong></span>' +
      '</div>' +
    '</div>';

  return '<div class="card" style="max-width:860px;margin-left:auto;margin-right:auto;margin-top:24px">' +
    '<div class="card-title" style="margin-bottom:4px">📲 Activar el desvío de llamadas</div>' +
    '<div style="font-size:12px;color:var(--dim);margin-bottom:16px">' +
      'Tu número de NodeFlow (destino del desvío): ' +
      '<strong style="color:var(--accent-l);font-family:monospace;font-size:13px">+' + digits + '</strong>' +
    '</div>' +
    steps +
    '<div style="font-size:12px;font-weight:700;color:var(--dim);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">Elige tu tipo de desvío</div>' +
    rows +
    '<div style="margin-top:14px;padding:12px 14px;background:rgba(249,202,36,.06);border:1px solid rgba(249,202,36,.15);border-radius:10px;font-size:11px;color:#f9ca24;line-height:1.6">' +
      '<strong>¿Con qué operador tienes el teléfono del negocio?</strong><br>' +
      '• Movistar, Vodafone, Jazztel, Yoigo, MásMóvil, Euskaltel → los códigos de arriba funcionan tal cual<br>' +
      '• Orange → cambia <code style="background:rgba(0,0,0,.3);padding:1px 4px;border-radius:3px">**21</code> por <code style="background:rgba(0,0,0,.3);padding:1px 4px;border-radius:3px">*21</code> (sin el asterisco doble inicial)<br>' +
      '• Centralita fija (Grandstream, Panasonic, Asterisk…) → la configuración es diferente, ' +
      '<a href="https://wa.me/34666351319?text=Necesito%20ayuda%20para%20configurar%20el%20desv%C3%ADo%20en%20mi%20centralita" target="_blank" style="color:#f9ca24">escríbenos y lo hacemos juntos →</a>' +
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
      '<div class="section-header"><div class="section-title">Clientes</div></div>' +
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
      cardsHtml += '<div class="nf-client" role="button" tabindex="0" ' +
        'onclick="openContactProfile(\'' + esc(c.id) + '\')" ' +
        'onkeydown="if(event.key===\'Enter\')openContactProfile(\'' + esc(c.id) + '\')">' +
        '<div class="nf-client-top">' +
          '<div class="nf-client-avatar">' + esc(initial) + '</div>' +
          '<div style="min-width:0;flex:1">' +
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
    tagFilter = '<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:14px">' +
      '<span style="font-size:12px;color:var(--dim);margin-right:4px">Filtrar:</span>' +
      '<span onclick="setClientesTag(\'\')" style="cursor:pointer;border-radius:20px;padding:3px 12px;font-size:12px;font-weight:600;' +
        (!_clientesTag ? 'background:var(--accent);color:#0a0b0d' : 'background:var(--bg2);color:var(--dim);border:1px solid var(--border)') + '">Todos</span>' +
      data.allTags.map(function(t){
        var on = _clientesTag === t;
        return '<span onclick="setClientesTag(\'' + esc(t) + '\')" style="cursor:pointer;border-radius:20px;padding:3px 12px;font-size:12px;font-weight:600;' +
          (on ? 'background:var(--accent);color:#0a0b0d' : 'background:var(--bg2);color:var(--dim);border:1px solid var(--border)') + '">' + esc(t) + '</span>';
      }).join('') + '</div>';
  }

  // Chip de filtro "necesita atención" — conecta el CRM con la promesa de reactivación
  var attnFilter = '';
  if (attentionCount > 0 || _clientesAttention) {
    attnFilter = '<div style="margin-bottom:14px">' +
      '<span onclick="toggleClientesAttention()" style="cursor:pointer;border-radius:20px;padding:4px 13px;font-size:12px;font-weight:700;' +
        (_clientesAttention ? 'background:var(--yellow);color:#0a0b0d' : 'background:rgba(246,197,68,.12);color:var(--yellow);border:1px solid rgba(246,197,68,.3)') + '">' +
        '⚠ Necesita atención · ' + attentionCount + '</span>' +
      (_clientesAttention ? ' <span onclick="toggleClientesAttention()" style="cursor:pointer;font-size:12px;color:var(--dim);margin-left:8px">✕ quitar filtro</span>' : '') +
    '</div>';
  }

  sec.innerHTML =
    '<div class="section-header" style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">' +
      '<div class="section-title">Clientes</div>' +
      '<div style="display:flex;align-items:center;gap:10px">' +
        '<span style="font-size:13px;color:var(--dim)">' + (data.count || 0) + ' contactos</span>' +
        '<button class="btn btn-d btn-sm" onclick="exportClientes(this)">⬇ Exportar CSV</button>' +
      '</div>' +
    '</div>' +
    '<div class="search-bar">' +
      '<input class="search-input" id="clientesSearch" placeholder="Buscar por nombre, teléfono o email…"' +
        ' value="' + esc(q) + '" oninput="onClientesSearch()">' +
    '</div>' +
    attnFilter +
    tagFilter +
    cardsHtml;
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
  (data.appointments || []).forEach(function(a){
    var when = a.date ? new Date(a.date + 'T' + (a.time||'00:00')) : null;
    var cancelled = a.status === 'cancelled';
    events.push({ t: when, icon: cancelled?'❌':'📅', color: cancelled?'#e17055':'#00b894',
      title: (cancelled?'Cita cancelada':'Cita') + (a.service ? ' — ' + esc(a.service) : ''),
      meta: (a.time||'') , action:'' });
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
    // Prefill del "Llámame y pruébalo" con el teléfono del dueño
    var tp = document.getElementById('testCallPhone');
    if (tp && !tp.value && _orgInfo && _orgInfo.phone) tp.value = _orgInfo.phone;
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
    await api('/api/portal/calls/outbound', 'POST', { to: phone });
    msg.style.display = 'block'; msg.style.color = 'var(--green2)';
    msg.innerHTML = '📱 <strong>Te estamos llamando.</strong> Descuelga y háblale como un cliente. ' +
      'Después la verás en <a onclick="navigate(\'llamadas\')" style="cursor:pointer;text-decoration:underline;color:var(--accent-l)">Llamadas</a>, con su transcripción.';
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

function loadVoiceCatalog() {
  var grid = document.getElementById('voice-grid');
  fetch('/api/voices')
    .then(function(r) { return r.json(); })
    .then(function(d) { _voiceCatalog = (d && d.voices) || []; renderVoiceGrid(); })
    .catch(function() { if (grid) grid.innerHTML = '<div class="voice-empty">No se pudo cargar el catálogo de voces.</div>'; });
}

function setVoiceFilter(g, btn) {
  _voiceFilter = g;
  var chips = document.querySelectorAll('.vf-chip');
  for (var i = 0; i < chips.length; i++) chips[i].classList.toggle('active', chips[i] === btn);
  renderVoiceGrid();
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
  grid.innerHTML = list.map(function(v) {
    var g = v.gender === 'female' ? 'fem' : (v.gender === 'male' ? 'mal' : '');
    var ico = v.gender === 'female' ? '👩' : (v.gender === 'male' ? '👨' : '🎙️');
    var sub = [v.accent, v.age].filter(Boolean).join(' · ') || (v.gender || '');
    var chips = (v.labels || []).slice(0, 3).map(function(t) { return '<span class="vc-tag">' + _voiceEsc(t) + '</span>'; }).join('');
    var id = _voiceEsc(v.id);
    return '<div class="voice-card ' + g + (v.id === sel ? ' selected' : '') + '" onclick="selectVoice(\'' + id + '\')">'
      + '<button type="button" class="vc-play" title="Escuchar muestra" onclick="event.stopPropagation();previewVoice(\'' + id + '\',this)">▶</button>'
      + '<div class="vc-top"><div class="vc-avatar">' + ico + '</div><div><div class="vc-name">' + _voiceEsc(v.name) + '</div><div class="vc-sub">' + _voiceEsc(sub) + '</div></div></div>'
      + '<div class="vc-desc">' + _voiceEsc((v.description || '').slice(0, 95)) + '</div>'
      + (chips ? '<div class="vc-chips">' + chips + '</div>' : '')
      + '<div class="vc-check">✓</div></div>';
  }).join('');
}

function selectVoice(id) {
  var h = document.getElementById('asis-voice'); if (h) h.value = id;
  renderVoiceGrid();
  previewVoice(id);
}

function previewVoice(voice, btn) {
  var statusEl = document.getElementById('portal-demo-status');
  if (_voicePreviewAudio) { _voicePreviewAudio.pause(); _voicePreviewAudio = null; }
  if (btn) btn.textContent = '⏳';
  var _pvNegocio = _asisOrgName || 'tu negocio';
  var _pvNombre  = (document.getElementById('asis-name') || {}).value || '';
  var previewText = '¡Hola! Ha llamado a ' + _pvNegocio + '. ' + (_pvNombre ? 'Soy ' + _pvNombre + ', su' : 'Soy su') + ' asistente virtual. ¿En qué puedo ayudarle?';
  fetch('/api/demo/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + _token },
    body: JSON.stringify({ text: previewText, voice: voice }),
  })
  .then(function(res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.blob(); })
  .then(function(blob) {
    if (btn) btn.textContent = '▶';
    _voicePreviewAudio = new Audio(URL.createObjectURL(blob));
    if (statusEl) statusEl.textContent = '🔊 Reproduciendo muestra…';
    _voicePreviewAudio.onended = function() { if (statusEl) statusEl.textContent = 'Pulsa para probar tu asistente'; };
    _voicePreviewAudio.play().catch(function() { if (statusEl) statusEl.textContent = 'Escucharás la voz en la prueba de llamada'; });
  })
  .catch(function() { if (btn) btn.textContent = '▶'; if (statusEl) statusEl.textContent = 'Escucharás la voz en la prueba de llamada'; });
}

function renderAsistenteForm() {
  var c = _asisConfig;
  var setVal = function(id, val) { var el = document.getElementById(id); if (el) el.value = val || ''; };

  setVal('asis-name',  c.assistantName || '');
  setVal('asis-lang',  c.language || 'es');
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
    return '<div style="margin-bottom:10px">' +
      '<div style="display:grid;grid-template-columns:80px 1fr;gap:10px;align-items:center">' +
        '<label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--dim);cursor:pointer">' +
          '<input type="checkbox" id="asis-day-' + d + '"' + (slot ? ' checked' : '') + ' onchange="toggleAsisDayClosed(\'' + d + '\')">' +
          ' ' + _DAY_LABELS[d] + '</label>' +
        '<div id="asis-slots-' + d + '" style="display:' + (slot?'block':'none') + '">' +
          '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
            '<input type="time" class="form-ctrl" id="asis-open-' + d + '" value="' + (slot?slot.open:'09:00') + '" style="width:90px">' +
            '<span style="color:var(--dim);font-size:11px">–</span>' +
            '<input type="time" class="form-ctrl" id="asis-close-' + d + '" value="' + (slot?slot.close:'14:00') + '" style="width:90px">' +
            '<button type="button" id="asis-pm-btn-' + d + '" class="btn btn-sm" style="font-size:11px;padding:3px 8px" ' +
              'onclick="toggleAsisAfternoon(\'' + d + '\')">' +
              (hasAfternoon ? '– Tarde' : '+ Tarde') +
            '</button>' +
          '</div>' +
          '<div id="asis-pm-' + d + '" style="display:' + (hasAfternoon?'flex':'none') + ';gap:8px;align-items:center;flex-wrap:wrap;margin-top:4px">' +
            '<span style="color:var(--dim);font-size:11px;width:80px">Tarde</span>' +
            '<input type="time" class="form-ctrl" id="asis-pm-open-' + d + '" value="' + (hasAfternoon?slot.afternoon_open:'16:00') + '" style="width:90px">' +
            '<span style="color:var(--dim);font-size:11px">–</span>' +
            '<input type="time" class="form-ctrl" id="asis-pm-close-' + d + '" value="' + (hasAfternoon?slot.afternoon_close:'20:00') + '" style="width:90px">' +
          '</div>' +
        '</div>' +
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
  return '<div class="form-group" style="display:flex;align-items:center;gap:8px;margin-top:4px">' +
    '<input type="checkbox" id="' + id + '"' + (checked ? ' checked' : '') +
    ' style="width:16px;height:16px;accent-color:var(--accent)">' +
    '<label for="' + id + '" class="form-label" style="margin:0;cursor:pointer">' + label + '</label></div>';
}
function _segurosBlock(arr) {
  return '<div class="form-group"><label class="form-label">Seguros aceptados</label>' +
    '<div id="asis-seguros-chips" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px">' +
    (arr||[]).map(function(s) {
      return '<span style="background:rgba(196,245,70,.12);border:1px solid rgba(196,245,70,.2);border-radius:20px;padding:3px 10px;font-size:11px;display:flex;align-items:center;gap:4px">' +
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
  var html = '<div style="background:rgba(196,245,70,.08);border:1px solid rgba(196,245,70,.25);border-radius:10px;padding:14px 16px;margin-bottom:16px;display:flex;gap:14px;align-items:center;flex-wrap:wrap">' +
    '<div style="flex:1;min-width:200px;font-size:12px;color:var(--dim);line-height:1.6">' +
      '<strong style="color:var(--text)">Servicios y precios</strong> se gestionan como lista estructurada que la IA dice con exactitud. Lo de aquí abajo es solo contexto adicional opcional.</div>' +
    '<button class="btn btn-accent btn-sm" onclick="navigate(\'configuracion\')" style="white-space:nowrap">Gestionar servicios y precios →</button>' +
  '</div>';
  html += _ta('asis-services', 'Servicios generales', services, 3, 'Describe los servicios que ofrece el negocio…');

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
  span.style.cssText = 'background:rgba(196,245,70,.12);border:1px solid rgba(196,245,70,.2);border-radius:20px;padding:3px 10px;font-size:11px;display:flex;align-items:center;gap:4px';
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
    var results  = await Promise.all([
      api('/api/billing/usage'),
      api('/api/billing/invoices'),
      api('/api/portal/reports?period=month').catch(function(){ return {}; }),
    ]);
    var usage    = results[0];
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

  // Plan único Negocio €49 — sin upsell a Pro (plan retirado).
  var proUpsell = '';

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

  var vm = monthVal || {};
  var valueStrip = ((vm.totalCalls || 0) > 0 || (vm.bookings || 0) > 0)
    ? '<div class="card" style="padding:18px 20px;background:linear-gradient(135deg,rgba(196,245,70,.10),rgba(56,225,200,.05));border-color:rgba(196,245,70,.25)">' +
        '<div style="font-size:11px;color:var(--accent-l);text-transform:uppercase;letter-spacing:.08em;font-weight:700;margin-bottom:12px">Lo que NodeFlow te dio este mes</div>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:14px">' +
          '<div><div style="font-size:22px;font-weight:900">' + (vm.totalCalls || 0) + '</div><div style="font-size:11px;color:var(--dim)">llamadas atendidas</div></div>' +
          '<div><div style="font-size:22px;font-weight:900;color:var(--green2)">' + (vm.bookings || 0) + '</div><div style="font-size:11px;color:var(--dim)">citas capturadas</div></div>' +
          '<div><div style="font-size:22px;font-weight:900;color:var(--green2)">€' + (vm.revenueEst || 0) + '</div><div style="font-size:11px;color:var(--dim)">en reservas (est.)</div></div>' +
          '<div><div style="font-size:22px;font-weight:900;color:#60a5fa">' + (vm.hoursSaved || 0) + 'h</div><div style="font-size:11px;color:var(--dim)">ahorradas</div></div>' +
        '</div>' +
        '<div style="font-size:12px;color:var(--dim);margin-top:12px">Todo esto por <strong style="color:var(--text)">' + planPrice + '</strong>.</div>' +
      '</div>'
    : '';

  sec.innerHTML =
    '<div class="section-header">' +
      '<h2 class="section-title">Facturación</h2>' +
      '<p class="section-sub">Gestiona tu plan y consulta tus facturas</p>' +
    '</div>' +
    valueStrip +

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
        'Minutos este mes: <strong style="color:var(--text)">' +
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
      '<div style="font-size:11px;color:var(--dim);margin-top:4px">Minutos extra: <strong style="color:var(--text)">€' +
        (usage.overageRate != null ? usage.overageRate.toFixed(2).replace('.', ',') : '0,20') + '/min</strong> · solo si superas tu plan</div>' +
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
    '</div>' +
    referralCta('facturacion');
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

// (flujo 360dialog eliminado — la conexión de número propio la gestiona NodeFlow vía admin connect-meta)

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
        'Número de WhatsApp de empresa propio, con tu nombre y tu logo. Nos encargamos de todo: alta con Meta, verificación y plantillas.' +
      '</div>' +
      '<button class="btn btn-accent btn-sm" onclick="openWaUpgrade()" style="white-space:nowrap">Quiero mi número →</button>' +
    '</div>' +
  '</div>';
}

// Solicitud del nivel premium (alta gestionada por NodeFlow)
function openWaUpgrade() {
  var biz = (_orgInfo && _orgInfo.name) || '';
  var subject = encodeURIComponent('Quiero mi propio número de WhatsApp — ' + biz);
  var body = encodeURIComponent(
    'Hola,\n\nQuiero que los avisos por WhatsApp de ' + biz + ' salgan desde nuestro propio número de empresa.\n\n' +
    '· ¿Tenéis ya un número de WhatsApp de empresa? (sí/no)\n· Teléfono de contacto: \n\nGracias.');
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
      '<a class="btn btn-accent" style="text-decoration:none" href="mailto:unai@nodeflow.es?subject=' + subject + '&body=' + body + '" onclick="closeModal();toast(\'✅ Te contactamos en menos de 24h\')">Solicitar</a>' +
    '</div>');
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
        '<div class="section-title">Integraciones</div>' +
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
          '<td><a href="tel:' + esc(c.phone) + '" style="color:var(--accent-l)">' + esc(c.phone) + '</a></td>' +
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
