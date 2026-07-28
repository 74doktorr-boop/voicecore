/* NodeFlow Chat — widget embebible. Un negocio lo añade con una línea:
   <script src="https://nodeflow.es/chat.js" data-nodeflow-org="ORG_ID"></script>
   Burbuja + panel en Shadow DOM (aislado del CSS de la web del cliente). Habla
   con POST /api/chat (mismo asistente que voz/WhatsApp: responde y reserva). */
(function () {
  'use strict';
  var me = document.currentScript;
  var ORG = (me && me.getAttribute('data-nodeflow-org') || '').trim();
  if (!ORG) return;
  var API = (function () { try { return new URL(me.src).origin; } catch (e) { return 'https://nodeflow.es'; } })();

  // Sesión estable por navegador (para que el asistente recuerde el hilo).
  var SID;
  try {
    SID = localStorage.getItem('nf_chat_sid');
    if (!SID) { SID = 's-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8); localStorage.setItem('nf_chat_sid', SID); }
  } catch (e) { SID = 's-' + Date.now().toString(36); }

  fetch(API + '/api/chat/config?orgId=' + encodeURIComponent(ORG))
    .then(function (r) { return r.json(); })
    .then(function (cfg) { if (cfg && cfg.ok) mount(cfg); })
    .catch(function () {});

  function mount(cfg) {
    var host = document.createElement('div');
    host.setAttribute('data-nodeflow-chat', '');
    document.body.appendChild(host);
    var root = host.attachShadow({ mode: 'open' });

    root.innerHTML =
      '<style>' +
      ':host{all:initial}' +
      '*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}' +
      '.nf-btn{position:fixed;bottom:20px;right:20px;width:60px;height:60px;border-radius:50%;background:#c4f546;border:none;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.28);display:flex;align-items:center;justify-content:center;z-index:2147483000;transition:transform .18s}' +
      '.nf-btn:hover{transform:scale(1.06)}' +
      '.nf-btn svg{width:28px;height:28px}' +
      '.nf-panel{position:fixed;bottom:92px;right:20px;width:370px;max-width:calc(100vw - 32px);height:560px;max-height:calc(100vh - 120px);background:#0e1013;border:1px solid rgba(255,255,255,.1);border-radius:18px;box-shadow:0 20px 60px rgba(0,0,0,.5);z-index:2147483000;display:none;flex-direction:column;overflow:hidden}' +
      '.nf-panel.open{display:flex;animation:nfup .22s ease}' +
      '@keyframes nfup{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}' +
      '.nf-head{padding:16px 18px;background:linear-gradient(180deg,rgba(196,245,70,.08),transparent);border-bottom:1px solid rgba(255,255,255,.08);display:flex;align-items:center;gap:10px}' +
      '.nf-dot{width:9px;height:9px;border-radius:50%;background:#c4f546;box-shadow:0 0 0 3px rgba(196,245,70,.18)}' +
      '.nf-title{color:#f3f5f1;font-weight:700;font-size:15px}.nf-sub{color:#8b9280;font-size:11px;margin-top:1px}' +
      '.nf-x{margin-left:auto;background:none;border:none;color:#8b9280;font-size:20px;cursor:pointer;line-height:1}' +
      '.nf-msgs{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px}' +
      '.nf-m{max-width:82%;padding:10px 13px;border-radius:14px;font-size:14px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word}' +
      '.nf-m.bot{background:#1a1e18;color:#e7ebe0;border-bottom-left-radius:4px;align-self:flex-start}' +
      '.nf-m.me{background:#c4f546;color:#0a0b0d;border-bottom-right-radius:4px;align-self:flex-end}' +
      '.nf-typing{align-self:flex-start;color:#8b9280;font-size:13px;padding:4px 6px}' +
      '.nf-typing span{display:inline-block;animation:nfblink 1.2s infinite}.nf-typing span:nth-child(2){animation-delay:.2s}.nf-typing span:nth-child(3){animation-delay:.4s}' +
      '@keyframes nfblink{0%,60%,100%{opacity:.25}30%{opacity:1}}' +
      '.nf-form{display:flex;gap:8px;padding:12px;border-top:1px solid rgba(255,255,255,.08)}' +
      '.nf-in{flex:1;background:#171a15;border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:11px 13px;color:#f3f5f1;font-size:14px;outline:none;resize:none;max-height:90px}' +
      '.nf-in:focus{border-color:rgba(196,245,70,.5)}' +
      '.nf-send{background:#c4f546;border:none;border-radius:12px;width:44px;cursor:pointer;color:#0a0b0d;font-size:18px;display:flex;align-items:center;justify-content:center}' +
      '.nf-send:disabled{opacity:.5;cursor:default}' +
      '.nf-foot{text-align:center;font-size:10px;color:#5a6152;padding:0 0 8px}' +
      '.nf-foot a{color:#7f8c6f;text-decoration:none}' +
      '</style>' +
      '<button class="nf-btn" aria-label="Abrir chat">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="#0a0b0d" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>' +
      '</button>' +
      '<div class="nf-panel" role="dialog" aria-label="Chat">' +
        '<div class="nf-head"><span class="nf-dot"></span><div><div class="nf-title"></div><div class="nf-sub">Responde al instante</div></div><button class="nf-x" aria-label="Cerrar">×</button></div>' +
        '<div class="nf-msgs"></div>' +
        '<div class="nf-typing" style="display:none"><span>●</span><span>●</span><span>●</span></div>' +
        '<form class="nf-form"><textarea class="nf-in" rows="1" placeholder="Escribe tu mensaje…" maxlength="1000"></textarea><button class="nf-send" type="submit" aria-label="Enviar">→</button></form>' +
        '<div class="nf-foot">con <a href="https://nodeflow.es" target="_blank" rel="noopener">NodeFlow</a></div>' +
      '</div>';

    var btn = root.querySelector('.nf-btn');
    var panel = root.querySelector('.nf-panel');
    var msgs = root.querySelector('.nf-msgs');
    var typing = root.querySelector('.nf-typing');
    var form = root.querySelector('.nf-form');
    var input = root.querySelector('.nf-in');
    var send = root.querySelector('.nf-send');
    root.querySelector('.nf-title').textContent = cfg.name || 'Asistente';

    var greeted = false, busy = false;
    function open() {
      panel.classList.add('open');
      if (!greeted) { greeted = true; addMsg(cfg.greeting || '¡Hola! ¿En qué te ayudo?', 'bot'); }
      setTimeout(function () { input.focus(); }, 120);
    }
    function close() { panel.classList.remove('open'); }
    btn.addEventListener('click', function () { panel.classList.contains('open') ? close() : open(); });
    root.querySelector('.nf-x').addEventListener('click', close);

    function addMsg(text, who) {
      var d = document.createElement('div');
      d.className = 'nf-m ' + (who === 'me' ? 'me' : 'bot');
      d.textContent = text;
      msgs.appendChild(d);
      msgs.scrollTop = msgs.scrollHeight;
    }

    function autosize() { input.style.height = 'auto'; input.style.height = Math.min(90, input.scrollHeight) + 'px'; }
    input.addEventListener('input', autosize);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var text = input.value.trim();
      if (!text || busy) return;
      addMsg(text, 'me');
      input.value = ''; autosize();
      busy = true; send.disabled = true; typing.style.display = 'block'; msgs.scrollTop = msgs.scrollHeight;
      fetch(API + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orgId: ORG, sessionId: SID, text: text }) })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          typing.style.display = 'none';
          addMsg((d && d.reply) || 'Ahora mismo no puedo con eso. ¿Me dejas tu teléfono y te llamamos?', 'bot');
        })
        .catch(function () { typing.style.display = 'none'; addMsg('Ups, ha fallado la conexión. Inténtalo de nuevo.', 'bot'); })
        .finally(function () { busy = false; send.disabled = false; input.focus(); });
    });
  }
})();
