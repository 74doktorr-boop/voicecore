/* ============================================================
 * NodeFlow — Widget "¿Te llamamos?" (embebible)
 * Uso (el negocio pega esto en su web):
 *   <script src="https://nodeflow.es/widget/nf-widget.js"
 *           data-org="ORG_ID" data-color="#6c5ce7"></script>
 * ============================================================ */
(function () {
  'use strict';
  var script = document.currentScript;
  var ORG    = script && script.getAttribute('data-org');
  var COLOR  = (script && script.getAttribute('data-color')) || '#6c5ce7';
  var TEXT   = (script && script.getAttribute('data-text')) || '¿Te llamamos?';
  var API    = 'https://nodeflow.es/api/widget/callback';
  if (!ORG) { console.warn('[NodeFlow widget] falta data-org'); return; }

  // ── Estilos (scoped por prefijo nfw-) ──
  var css = '' +
    '.nfw-btn{position:fixed;bottom:22px;right:22px;z-index:2147483000;background:' + COLOR + ';color:#fff;border:none;border-radius:50px;padding:14px 22px;font:600 15px/1 -apple-system,Segoe UI,sans-serif;cursor:pointer;box-shadow:0 6px 24px rgba(0,0,0,.25);display:flex;align-items:center;gap:8px;transition:transform .15s}' +
    '.nfw-btn:hover{transform:translateY(-2px)}' +
    '.nfw-modal{position:fixed;inset:0;z-index:2147483001;background:rgba(0,0,0,.5);display:none;align-items:center;justify-content:center;padding:16px}' +
    '.nfw-modal.open{display:flex}' +
    '.nfw-card{background:#fff;border-radius:16px;max-width:360px;width:100%;padding:26px;font-family:-apple-system,Segoe UI,sans-serif;box-shadow:0 20px 60px rgba(0,0,0,.3)}' +
    '.nfw-card h3{margin:0 0 6px;font-size:19px;color:#1a1a2e}' +
    '.nfw-card p{margin:0 0 18px;font-size:13px;color:#666}' +
    '.nfw-card input,.nfw-card textarea{width:100%;box-sizing:border-box;border:1px solid #ddd;border-radius:10px;padding:11px 13px;font-size:14px;margin-bottom:10px;font-family:inherit}' +
    '.nfw-card textarea{resize:vertical;min-height:54px}' +
    '.nfw-card button.nfw-send{width:100%;background:' + COLOR + ';color:#fff;border:none;border-radius:10px;padding:13px;font-size:15px;font-weight:700;cursor:pointer}' +
    '.nfw-card button.nfw-send:disabled{opacity:.6;cursor:default}' +
    '.nfw-x{float:right;background:none;border:none;font-size:20px;color:#999;cursor:pointer;margin:-8px -8px 0 0}' +
    '.nfw-ok{text-align:center;padding:10px 0}' +
    '.nfw-ok .nfw-check{font-size:42px}' +
    '.nfw-powered{text-align:center;font-size:11px;color:#aaa;margin-top:14px}' +
    '.nfw-powered a{color:#aaa;text-decoration:none}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  // ── Botón flotante ──
  var btn = document.createElement('button');
  btn.className = 'nfw-btn';
  btn.innerHTML = '<span style="font-size:17px">📞</span>' + esc(TEXT);
  document.body.appendChild(btn);

  // ── Modal ──
  var modal = document.createElement('div');
  modal.className = 'nfw-modal';
  modal.innerHTML =
    '<div class="nfw-card">' +
      '<button class="nfw-x" aria-label="Cerrar">&times;</button>' +
      '<div class="nfw-body">' +
        '<h3>Te llamamos gratis</h3>' +
        '<p>Déjanos tu número y te llamamos en breve.</p>' +
        '<input class="nfw-name" type="text" placeholder="Tu nombre (opcional)" autocomplete="name">' +
        '<input class="nfw-phone" type="tel" placeholder="Tu teléfono" autocomplete="tel" inputmode="tel">' +
        '<textarea class="nfw-msg" placeholder="¿En qué podemos ayudarte? (opcional)"></textarea>' +
        '<button class="nfw-send">Pedir llamada</button>' +
        '<div class="nfw-powered">con <a href="https://nodeflow.es" target="_blank" rel="noopener">NodeFlow</a></div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);

  var card  = modal.querySelector('.nfw-card');
  var body  = modal.querySelector('.nfw-body');
  function open(){ modal.classList.add('open'); }
  function close(){ modal.classList.remove('open'); }
  btn.addEventListener('click', open);
  modal.querySelector('.nfw-x').addEventListener('click', close);
  modal.addEventListener('click', function(e){ if (e.target === modal) close(); });

  modal.querySelector('.nfw-send').addEventListener('click', function () {
    var phone = (card.querySelector('.nfw-phone').value || '').trim();
    if (!phone || phone.replace(/\D/g, '').length < 7) {
      card.querySelector('.nfw-phone').style.borderColor = '#e74c3c';
      return;
    }
    var sendBtn = card.querySelector('.nfw-send');
    sendBtn.disabled = true; sendBtn.textContent = 'Enviando…';

    fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orgId:   ORG,
        name:    (card.querySelector('.nfw-name').value || '').trim(),
        phone:   phone,
        message: (card.querySelector('.nfw-msg').value || '').trim(),
      }),
    })
    .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
    .then(function (res) {
      if (res.ok) {
        body.innerHTML = '<div class="nfw-ok"><div class="nfw-check">✅</div><h3>¡Recibido!</h3><p>Te llamaremos en breve. Gracias.</p></div>';
        setTimeout(close, 2600);
      } else {
        sendBtn.disabled = false; sendBtn.textContent = 'Pedir llamada';
        alert(res.d && res.d.error ? res.d.error : 'No se pudo enviar. Inténtalo de nuevo.');
      }
    })
    .catch(function () {
      sendBtn.disabled = false; sendBtn.textContent = 'Pedir llamada';
      alert('Error de conexión. Inténtalo de nuevo.');
    });
  });

  function esc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
})();
