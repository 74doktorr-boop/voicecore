// VoiceCore Dashboard — App Logic v2
const API_BASE = window.location.origin;
let apiKey = localStorage.getItem('voicecore_api_key') || 'voicecore-dev';
let refreshInterval = null;
let allAssistants = [];
let selectedAssistantId = null;

document.addEventListener('DOMContentLoaded', () => {
  // Auto-save default key if not set
  if (!localStorage.getItem('voicecore_api_key')) {
    localStorage.setItem('voicecore_api_key', 'voicecore-dev');
  }
  refreshAll(); startAutoRefresh();
});

// ─── Navigation ───
function showPage(page) {
  document.querySelectorAll('.page-section').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  const s = document.getElementById(`page-${page}`); if(s) s.classList.add('active');
  const n = document.querySelector(`.nav-item[data-page="${page}"]`); if(n) n.classList.add('active');
  if (page==='calls') loadCalls();
  if (page==='assistants') loadAssistants();
  if (page==='metrics') loadSystemStatus();
  if (page==='dashboard') refreshAll();
}

// ─── API ───
async function api(endpoint, opts={}) {
  const headers = {'x-api-key':apiKey,'Content-Type':'application/json',...opts.headers};
  try { const r = await fetch(`${API_BASE}${endpoint}`,{...opts,headers}); if(r.status===401){showPage('settings');return null;} return await r.json(); }
  catch(e) { console.error(`API:${endpoint}`,e); return null; }
}
function saveApiKey() { apiKey=document.getElementById('apiKeyInput').value.trim(); localStorage.setItem('voicecore_api_key',apiKey); refreshAll(); startAutoRefresh(); showPage('dashboard'); }

// ─── Refresh ───
async function refreshAll() { await Promise.all([loadMetrics(),loadRecentCalls(),loadAssistantsSummary()]); }
function startAutoRefresh() { if(refreshInterval) clearInterval(refreshInterval); refreshInterval=setInterval(refreshAll,5000); }

// ─── Metrics ───
async function loadMetrics() {
  const d = await api('/api/metrics'); if(!d?.metrics) return; const m=d.metrics;
  document.getElementById('stat-activeCalls').textContent=m.activeCalls;
  document.getElementById('stat-totalCalls').textContent=m.totalCalls;
  document.getElementById('stat-totalCost').textContent=`$${m.totalCost.toFixed(2)}`;
  document.getElementById('stat-totalMinutes').textContent=m.totalDurationMinutes.toFixed(1);
  const b=document.getElementById('activeCallsBadge');
  if(m.activeCalls>0){b.style.display='inline';b.textContent=m.activeCalls;}else{b.style.display='none';}
  const sv=document.getElementById('stat-savings');
  if(sv) sv.textContent=`$${(m.totalDurationMinutes*0.13).toFixed(2)}`;
}

// ─── Recent Calls ───
async function loadRecentCalls() {
  const d = await api('/api/calls/history?limit=5'); if(!d?.calls) return;
  const c=document.getElementById('recentCallsContainer');
  if(!d.calls.length){c.innerHTML='<div class="empty-state"><div class="icon">◎</div><h3>No calls yet</h3><p>Calls appear here when received</p></div>';return;}
  c.innerHTML=d.calls.map(call=>`<div class="call-row" onclick='showCallDetail(${JSON.stringify(call).replace(/'/g,"&#39;")})'>
    <div class="badge-status ${call.status}"><span class="dot"></span></div>
    <div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:500;color:var(--text-bright)">${call.assistantName||call.assistantId||'Default'}</div><div style="font-size:11px;color:var(--text-muted)">${call.callerNumber||'Unknown'}</div></div>
    <div style="text-align:right"><div style="font-size:13px;font-weight:600">${call.durationFormatted||'0:00'}</div><div style="font-size:11px;color:var(--accent)">$${(call.cost?.total||0).toFixed(4)}</div></div>
  </div>`).join('');
}

// ─── Calls Page ───
async function loadCalls() {
  const [ad,hd] = await Promise.all([api('/api/calls/active'),api('/api/calls/history?limit=50')]);
  const ac=document.getElementById('activeCallsContainer');
  if(ad?.calls?.length>0){ac.innerHTML=ad.calls.map(c=>`<div style="padding:14px;background:var(--bg-elevated);border-radius:8px;margin-bottom:8px;border:1px solid rgba(34,197,94,0.15)">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><div><span class="badge-status active"><span class="dot"></span> Active</span> <span style="margin-left:8px;font-weight:600;font-size:13px">${c.assistantName||'Default'}</span></div><div style="font-size:20px;font-weight:700;font-family:'JetBrains Mono',monospace">${c.durationFormatted}</div></div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;font-size:12px;color:var(--text-secondary)"><div>Caller: <span style="color:var(--text-primary)">${c.callerNumber||'-'}</span></div><div>Turns: <span style="color:var(--text-primary)">${c.turnCount}</span></div><div>Cost: <span style="color:var(--accent)">$${(c.cost?.total||0).toFixed(4)}</span></div></div></div>`).join('');}
  else{ac.innerHTML='<div class="empty-state"><div class="icon">◎</div><h3>No active calls</h3></div>';}
  const tb=document.getElementById('callHistoryTable');
  if(hd?.calls?.length>0){tb.innerHTML=hd.calls.map(c=>`<tr><td><span class="badge-status ${c.status}"><span class="dot"></span> ${c.status==='active'?'Active':'End'}</span></td><td style="font-weight:500">${c.assistantName||c.assistantId||'-'}</td><td>${c.callerNumber||'-'}</td><td style="font-family:'JetBrains Mono',monospace;font-size:12px">${c.durationFormatted||'0:00'}</td><td>${c.turnCount||0}</td><td style="color:var(--accent);font-family:'JetBrains Mono',monospace;font-size:12px">$${(c.cost?.total||0).toFixed(4)}</td><td style="font-size:12px;color:var(--text-secondary)">${c.startTime?new Date(c.startTime).toLocaleString('es-ES',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'-'}</td><td><button class="btn btn-secondary btn-sm" onclick='showCallDetail(${JSON.stringify(c).replace(/'/g,"&#39;")})'>Details</button></td></tr>`).join('');}
  else{tb.innerHTML='<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:32px">No call history</td></tr>';}
}

function showCallDetail(call) {
  document.getElementById('callModalBody').innerHTML=`
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;margin-bottom:18px">
      <div><div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);margin-bottom:4px">Status</div><span class="badge-status ${call.status}"><span class="dot"></span> ${call.status}</span></div>
      <div><div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);margin-bottom:4px">Duration</div><strong style="font-size:16px;font-family:'JetBrains Mono',monospace">${call.durationFormatted||'0:00'}</strong></div>
      <div><div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);margin-bottom:4px">Cost</div><span style="color:var(--accent);font-size:16px;font-weight:700;font-family:'JetBrains Mono',monospace">$${(call.cost?.total||0).toFixed(4)}</span></div>
    </div>
    ${call.cost?`<div style="margin-bottom:18px"><div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);margin-bottom:8px">Cost Breakdown</div>
    <div class="pipeline-cards" style="grid-template-columns:repeat(4,1fr)">
      <div class="pipeline-card stt" style="padding:10px 12px"><div class="label"><span class="dot"></span>Twilio</div><div style="font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--text-bright)">$${(call.cost.twilio||0).toFixed(4)}</div></div>
      <div class="pipeline-card stt" style="padding:10px 12px"><div class="label"><span class="dot"></span>STT</div><div style="font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--text-bright)">$${(call.cost.deepgram||0).toFixed(4)}</div></div>
      <div class="pipeline-card llm" style="padding:10px 12px"><div class="label"><span class="dot"></span>LLM</div><div style="font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--text-bright)">$${(call.cost.llm||0).toFixed(4)}</div></div>
      <div class="pipeline-card tts" style="padding:10px 12px"><div class="label"><span class="dot"></span>TTS</div><div style="font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--text-bright)">$${(call.cost.tts||0).toFixed(4)}</div></div>
    </div></div>`:''}
    <div><div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);margin-bottom:10px">Transcript</div>
    <div class="transcript">${call.transcript?.length>0?call.transcript.map(m=>`<div class="transcript-message ${m.role}"><div class="avatar">${m.role==='user'?'👤':'⚡'}</div><div class="content">${escapeHtml(m.content)}</div></div>`).join(''):'<div style="color:var(--text-muted);text-align:center;padding:16px;font-size:12px">No transcript</div>'}</div></div>`;
  openModal('callModal');
}

// ─── Assistants (Vapi 3-column) ───
async function loadAssistants() {
  const d = await api('/api/assistants'); if(!d?.assistants) return;
  allAssistants = d.assistants;
  const badge = document.getElementById('assistantCountBadge');
  if(badge){badge.style.display='inline';badge.textContent=allAssistants.length;}
  document.getElementById('assistantCount').textContent=allAssistants.length;
  renderAssistantList(allAssistants);
  if(allAssistants.length>0 && !selectedAssistantId) selectAssistant(allAssistants[0].id);
  else if(selectedAssistantId) selectAssistant(selectedAssistantId);
}

function filterAssistants(q) {
  const f = allAssistants.filter(a=>(a.name||a.id).toLowerCase().includes(q.toLowerCase()));
  renderAssistantList(f);
}

function renderAssistantList(list) {
  document.getElementById('assistantsList').innerHTML = list.length ? list.map(a=>`
    <div class="asst-list-item ${a.id===selectedAssistantId?'selected':''}" onclick="selectAssistant('${a.id}')">
      <div class="asst-avatar">⚡</div>
      <div class="asst-info">
        <div class="name">${a.name||a.id}</div>
        <div class="meta">${a.model||'gpt-4o-mini'} · ${a.voice||'nova'}</div>
      </div>
    </div>`).join('') : '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:12px">No assistants found</div>';
}

async function selectAssistant(id) {
  selectedAssistantId = id;
  document.querySelectorAll('.asst-list-item').forEach(el=>el.classList.toggle('selected',el.onclick.toString().includes(`'${id}'`)));
  const d = await api(`/api/assistants/${id}`); if(!d?.assistant) return;
  const a = d.assistant;
  const panel = document.getElementById('assistantDetail');
  panel.innerHTML = `
    <div class="detail-header">
      <div class="detail-title"><h2>${a.name||a.id}</h2><span class="asst-id">${a.id}</span></div>
      <div class="detail-actions">
        <button class="btn-talk" onclick="startTalk('${a.id}')">☏ Talk</button>
        <span class="badge-published">Active</span>
        <button class="btn btn-danger btn-sm" onclick="deleteAssistant('${a.id}')">Delete</button>
      </div>
    </div>
    <div class="detail-tabs">
      <div class="detail-tab active" onclick="switchDetailTab('assistant',this)">⚙ Assistant</div>
      <div class="detail-tab" onclick="switchDetailTab('tools',this)">⊞ Tools</div>
      <div class="detail-tab" onclick="switchDetailTab('advanced',this)">◈ Advanced</div>
    </div>
    <div class="detail-content">
      <div class="detail-tab-panel active" id="dtab-assistant">
        <div class="detail-pipeline">
          <div class="pipeline-header"><div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted)">Average Cost</div>
            <div class="avg-cost"><strong>~$0.05</strong> /min</div></div>
          <div class="pipeline-bar"><div class="segment stt"></div><div class="segment llm"></div><div class="segment tts"></div></div>
          <div class="pipeline-cards">
            <div class="pipeline-card stt"><div class="label"><span class="dot"></span> Transcriber</div><div class="name">${(a.language||'es').toUpperCase()==='ES'?'Spanish':a.language||'es'}</div><div class="provider">Deepgram · Nova 3</div><div class="meta"><span class="cost">$0.008/min</span><span class="latency">~100ms</span></div></div>
            <div class="pipeline-card llm"><div class="label"><span class="dot"></span> Model</div><div class="name">${a.model||'GPT-4o Mini'}</div><div class="provider">OpenAI</div><div class="meta"><span class="cost">$0.005/min</span><span class="latency">~400ms</span></div></div>
            <div class="pipeline-card tts"><div class="label"><span class="dot"></span> Voice</div><div class="name">${a.voice||'Nova'}</div><div class="provider">${(a.ttsProvider||'openai')==='elevenlabs'?'ElevenLabs':'OpenAI TTS'}</div><div class="meta"><span class="cost">${(a.ttsProvider||'openai')==='elevenlabs'?'$0.10/min':'$0.02/min'}</span><span class="latency">~300ms</span></div></div>
          </div>
        </div>
        <div class="form-group"><label>First Message</label><input type="text" class="form-control" id="edit-firstMessage" value="${escapeAttr(a.firstMessage||'')}" onchange="updateField('${a.id}','firstMessage',this.value)"></div>
        <div class="form-group"><label>System Prompt</label><textarea class="form-control" id="edit-systemPrompt" rows="10" onchange="updateField('${a.id}','systemPrompt',this.value)">${escapeHtml(a.systemPrompt||a.system_prompt||'')}</textarea></div>
      </div>
      <div class="detail-tab-panel" id="dtab-tools">
        <div class="form-group"><label>Tools Configuration (JSON)</label><textarea class="form-control json-editor" id="edit-tools" rows="16" onchange="updateTools('${a.id}')">${a.tools?JSON.stringify(a.tools,null,2):'[]'}</textarea></div>
      </div>
      <div class="detail-tab-panel" id="dtab-advanced">
        <div class="grid-2">
          <div class="form-group"><label>Language</label><select class="form-control" id="edit-language" onchange="updateField('${a.id}','language',this.value)"><option value="es" ${a.language==='es'?'selected':''}>Spanish</option><option value="en" ${a.language==='en'?'selected':''}>English</option><option value="multi" ${a.language==='multi'?'selected':''}>Multi</option></select></div>
          <div class="form-group"><label>Model</label><select class="form-control" id="edit-model" onchange="updateField('${a.id}','model',this.value)"><option value="gpt-4o-mini" ${a.model==='gpt-4o-mini'?'selected':''}>GPT-4o Mini</option><option value="gpt-4o" ${a.model==='gpt-4o'?'selected':''}>GPT-4o</option><option value="gpt-4.1-mini" ${a.model==='gpt-4.1-mini'?'selected':''}>GPT-4.1 Mini</option></select></div>
          <div class="form-group"><label>Voice</label><select class="form-control" id="edit-voice" onchange="updateField('${a.id}','voice',this.value)"><option value="nova" ${a.voice==='nova'?'selected':''}>Nova</option><option value="alloy" ${a.voice==='alloy'?'selected':''}>Alloy</option><option value="shimmer" ${a.voice==='shimmer'?'selected':''}>Shimmer</option><option value="echo" ${a.voice==='echo'?'selected':''}>Echo</option><option value="onyx" ${a.voice==='onyx'?'selected':''}>Onyx</option></select></div>
          <div class="form-group"><label>TTS Provider</label><select class="form-control" id="edit-ttsProvider" onchange="updateField('${a.id}','ttsProvider',this.value)"><option value="openai" ${(a.ttsProvider||'openai')==='openai'?'selected':''}>OpenAI</option><option value="elevenlabs" ${a.ttsProvider==='elevenlabs'?'selected':''}>ElevenLabs</option></select></div>
          <div class="form-group"><label>Temperature</label><input type="number" class="form-control" value="${a.temperature||0.7}" min="0" max="2" step="0.1" onchange="updateField('${a.id}','temperature',parseFloat(this.value))"></div>
          <div class="form-group"><label>Max Tokens</label><input type="number" class="form-control" value="${a.maxTokens||300}" min="50" max="2000" step="50" onchange="updateField('${a.id}','maxTokens',parseInt(this.value))"></div>
          <div class="form-group"><label>Endpointing (ms)</label><input type="number" class="form-control" value="${a.endpointing||300}" min="100" max="1000" step="50" onchange="updateField('${a.id}','endpointing',parseInt(this.value))"></div>
          <div class="form-group"><label>Utterance End (ms)</label><input type="number" class="form-control" value="${a.utteranceEndMs||1200}" min="500" max="3000" step="100" onchange="updateField('${a.id}','utteranceEndMs',parseInt(this.value))"></div>
        </div>
      </div>
    </div>`;
  renderAssistantList(allAssistants);
}

function switchDetailTab(tab, el) {
  el.parentElement.querySelectorAll('.detail-tab').forEach(t=>t.classList.remove('active')); el.classList.add('active');
  ['assistant','tools','advanced'].forEach(t=>{const p=document.getElementById(`dtab-${t}`);if(p)p.classList.toggle('active',t===tab);});
}

async function updateField(id, field, value) {
  await api(`/api/assistants/${id}`,{method:'PUT',body:JSON.stringify({[field]:value})});
}

async function updateTools(id) {
  try { const tools=JSON.parse(document.getElementById('edit-tools').value||'[]'); await api(`/api/assistants/${id}`,{method:'PUT',body:JSON.stringify({tools})}); }
  catch(e) { alert('Invalid JSON'); }
}

async function loadAssistantsSummary() {
  const d = await api('/api/assistants'); if(!d?.assistants) return;
  const c=document.getElementById('assistantsSummary');
  if(!d.assistants.length){c.innerHTML='<div class="empty-state"><div class="icon">⚙</div><h3>No assistants</h3></div>';return;}
  c.innerHTML=d.assistants.map(a=>`<div class="call-row" onclick="showPage('assistants')"><div style="width:28px;height:28px;border-radius:6px;background:var(--accent-glow);border:1px solid rgba(14,165,233,0.2);display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--accent)">⚡</div><div style="flex:1"><div style="font-size:13px;font-weight:500;color:var(--text-bright)">${a.name||a.id}</div><div style="font-size:11px;color:var(--text-muted)"><span style="color:var(--color-stt)">deepgram</span> · <span style="color:var(--color-llm)">${a.model||'gpt-4o-mini'}</span> · <span style="color:var(--color-tts)">${a.voice||'nova'}</span></div></div></div>`).join('');
}

// ─── Create / Delete ───
function showCreateAssistant() { openModal('createModal'); document.getElementById('newAsstId').value=''; document.getElementById('newAsstName').value=''; }

async function createNewAssistant() {
  const id=document.getElementById('newAsstId').value.trim();
  const name=document.getElementById('newAsstName').value.trim();
  if(!id) return alert('ID is required');
  const templates = {
    blank: {systemPrompt:'You are a helpful voice assistant.',firstMessage:'Hello, how can I help you?'},
    restaurant: {systemPrompt:'You are a professional restaurant receptionist named Laura. You help customers make reservations. Ask for: name, date, time, number of guests, and phone number. Be conversational and natural. Keep responses to 2-3 sentences max.',firstMessage:'Good afternoon, how can I help you?'},
    clinic: {systemPrompt:'You are a professional clinic receptionist named María. You help patients book appointments. Ask for: patient name, service needed, preferred date, preferred time slot, and phone number. Be warm and reassuring.',firstMessage:'Good morning, how can I help you?'},
    support: {systemPrompt:'You are a customer support agent. Help customers resolve their issues efficiently. Be empathetic, professional, and solution-oriented. Keep responses concise.',firstMessage:'Hi there, thanks for calling. How can I help you today?'}
  };
  const tpl = templates[document.getElementById('newAsstTemplate').value] || templates.blank;
  await api('/api/assistants',{method:'POST',body:JSON.stringify({id,name:name||id,model:'gpt-4o-mini',voice:'nova',language:'es',ttsProvider:'openai',...tpl,tools:[]})});
  closeModal('createModal'); selectedAssistantId=id; loadAssistants(); loadAssistantsSummary();
}

async function deleteAssistant(id) {
  if(!confirm(`Delete "${id}"?`)) return;
  await api(`/api/assistants/${id}`,{method:'DELETE'});
  selectedAssistantId=null;
  document.getElementById('assistantDetail').innerHTML='<div class="detail-empty-state"><div style="font-size:48px;opacity:0.2;margin-bottom:16px">⚡</div><h3 style="color:var(--text-secondary);font-size:16px">Select an assistant</h3></div>';
  loadAssistants(); loadAssistantsSummary();
}

// ─── System Status ───
async function loadSystemStatus() {
  try { const r=await fetch(`${API_BASE}/health`);const d=await r.json();
    document.getElementById('systemStatus').innerHTML=`<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px"><div><div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);margin-bottom:4px">Status</div><span class="badge-status active"><span class="dot"></span> ${d.status}</span></div><div><div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);margin-bottom:4px">Uptime</div><span style="font-family:'JetBrains Mono',monospace;font-size:14px">${Math.round(d.uptime/60)}m</span></div><div><div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);margin-bottom:4px">Version</div><span style="font-size:14px">${d.version}</span></div></div>`;
  } catch(e) { document.getElementById('systemStatus').innerHTML='<span style="color:var(--danger)">Server unreachable</span>'; }
}

// ─── Modals ───
function openModal(id){document.getElementById(id).classList.add('active');}
function closeModal(id){document.getElementById(id).classList.remove('active');}
document.querySelectorAll('.modal-overlay').forEach(o=>{o.addEventListener('click',e=>{if(e.target===o)o.classList.remove('active');});});

// ─── Utils ───
function escapeHtml(t){const d=document.createElement('div');d.textContent=t;return d.innerHTML;}
function escapeAttr(t){return t.replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
