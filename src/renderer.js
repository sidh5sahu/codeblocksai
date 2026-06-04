/* ═══════════════════════════════════════
   renderer.js — CodeMind Desktop UI
═══════════════════════════════════════ */

// ─── Curated Model Catalogue ─────────────────────────────────────────────────
const CATALOGUE = [
  {
    icon: '🦙',
    name: 'Qwen2.5-Coder 7B Instruct (Q4 — 4.7 GB)',
    desc: 'Best overall coding model. Excellent at Python, JS, debugging and explaining code. Highly recommended.',
    tags: ['Python','JavaScript','Debugging','4.7 GB','Recommended'],
    url:  'https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct-GGUF/resolve/main/qwen2.5-coder-7b-instruct-q4_k_m.gguf',
    filename: 'qwen2.5-coder-7b-instruct-q4_k_m.gguf',
  },
  {
    icon: '🔥',
    name: 'DeepSeek-Coder V2 Lite Instruct (Q4 — 9 GB)',
    desc: 'State-of-the-art code generation. Supports 338 programming languages. Ideal for complex tasks.',
    tags: ['All Languages','Complex Code','9 GB'],
    url:  'https://huggingface.co/bartowski/DeepSeek-Coder-V2-Lite-Instruct-GGUF/resolve/main/DeepSeek-Coder-V2-Lite-Instruct-Q4_K_M.gguf',
    filename: 'deepseek-coder-v2-lite-instruct-q4_k_m.gguf',
  },
  {
    icon: '⚡',
    name: 'CodeLlama 7B Instruct (Q4 — 3.8 GB)',
    desc: 'Fast, lightweight coding assistant from Meta. Great for quick completions and smaller machines.',
    tags: ['Fast','Low RAM','3.8 GB','Meta'],
    url:  'https://huggingface.co/TheBloke/CodeLlama-7B-Instruct-GGUF/resolve/main/codellama-7b-instruct.Q4_K_M.gguf',
    filename: 'codellama-7b-instruct-q4_k_m.gguf',
  },
  {
    icon: '🧠',
    name: 'Llama 3.2 3B Instruct (Q4 — 2 GB)',
    desc: 'Ultra lightweight, runs on any machine. Good for general coding tasks and limited VRAM.',
    tags: ['2 GB','Ultra Fast','Any Machine'],
    url:  'https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf',
    filename: 'llama-3.2-3b-instruct-q4_k_m.gguf',
  },
  {
    icon: '💎',
    name: 'Mistral 7B Instruct v0.3 (Q4 — 4.4 GB)',
    desc: 'Excellent general-purpose model with strong coding and instruction following.',
    tags: ['General','Coding','4.4 GB'],
    url:  'https://huggingface.co/bartowski/Mistral-7B-Instruct-v0.3-GGUF/resolve/main/Mistral-7B-Instruct-v0.3-Q4_K_M.gguf',
    filename: 'mistral-7b-instruct-v0.3-q4_k_m.gguf',
  },
  {
    icon: '🐟',
    name: 'Phi-3.5 Mini Instruct (Q4 — 2.2 GB)',
    desc: "Microsoft's small but mighty model. Punches above its weight for coding tasks.",
    tags: ['Microsoft','2.2 GB','Efficient'],
    url:  'https://huggingface.co/bartowski/Phi-3.5-mini-instruct-GGUF/resolve/main/Phi-3.5-mini-instruct-Q4_K_M.gguf',
    filename: 'phi-3.5-mini-instruct-q4_k_m.gguf',
  },
];

// ─── State ────────────────────────────────────────────────────────────────────
const S = {
  files:     {},    // id → { name, content, modified }
  tabs:      [],
  activeId:  null,
  messages:  [],
  streaming: false,
  loadedModel: null,
  activeTab: 'editor',
  dlActive:  null,
};
let fc = 0;
const uid = () => `f${++fc}_${Date.now()}`;

// ─── Boot ─────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  newFile();            // blank file on startup
  buildCatalogue();
  setupDivider();
  setupKeys();
  setupMenuClose();
  switchTab('editor');

  const dir = await api.getModelsDir();
  const inp = document.getElementById('models-dir-inp');
  if (inp) inp.value = dir;
  document.getElementById('models-path').textContent = '📁 ' + dir;

  refreshModelsList();

  // Subscribe to events from main process
  api.onModelStatus(onModelStatus);
  api.onChunk(onChunk);
  api.onDone(onDone);
  api.onChatError(onChatError);
  api.onProgress(onProgress);
  api.onWinState(s => {
    document.getElementById('wc-max').textContent = s === 'maximized' ? '❐' : '□';
  });
});

// ─── Tab switching (activity bar) ─────────────────────────────────────────────
function switchTab(name) {
  S.activeTab = name;
  document.querySelectorAll('.tab-view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.act').forEach(b => b.classList.remove('active'));
  const view = document.getElementById(`tab-${name}`);
  const btn  = document.getElementById(`act-${name}`);
  if (view) view.classList.add('active');
  if (btn)  btn.classList.add('active');
  closeMenus();
}

// ─── Menu ─────────────────────────────────────────────────────────────────────
function toggleMenu(id) {
  const d = document.getElementById(id);
  const isOpen = d.classList.contains('open');
  closeMenus();
  if (!isOpen) d.classList.add('open');
}
function closeMenus() {
  document.querySelectorAll('.menu-drop').forEach(d => d.classList.remove('open'));
}
function setupMenuClose() {
  document.addEventListener('click', e => {
    if (!e.target.closest('.tb-menu')) closeMenus();
  });
}

// ─── File / Tab management ────────────────────────────────────────────────────
const EXTS = {py:'Python',js:'JavaScript',ts:'TypeScript',jsx:'React JSX',tsx:'React TSX',
  html:'HTML',css:'CSS',json:'JSON',md:'Markdown',txt:'Text',java:'Java',cpp:'C++',
  c:'C',rs:'Rust',go:'Go',rb:'Ruby',php:'PHP',sh:'Shell',yaml:'YAML',sql:'SQL'};
const ICONS= {py:'🐍',js:'⚡',ts:'💙',jsx:'⚛',tsx:'⚛',html:'🌐',css:'🎨',json:'📋',
  md:'📝',java:'☕',cpp:'⚙',c:'⚙',rs:'🦀',go:'🐹',rb:'💎',sh:'💻',sql:'🗄'};
const xext = n => n.split('.').pop()?.toLowerCase() || '';
const xlang= n => EXTS[xext(n)] || 'Text';
const xicon= n => ICONS[xext(n)] || '📄';

function newFile(name, content = '') {
  const id = uid();
  name = name || `untitled-${fc}.py`;
  S.files[id] = { name, content, modified: false };
  S.tabs.push(id);
  activateTab(id);
  renderTabs();
  switchTab('editor');
}

function activateTab(id) {
  S.activeId = id;
  const f = S.files[id];
  if (!f) return;
  g('editor').value = f.content;
  g('active-filename').textContent = f.name;
  g('tb-center').title = f.name;
  g('col-lang').textContent = xlang(f.name);
  g('lang-info').textContent = xlang(f.name);
  g('unsaved').style.display = f.modified ? 'inline' : 'none';
  updateGutter(); updateCursor(); renderTabs();
}

function closeTab(id, e) {
  e?.stopPropagation();
  const i = S.tabs.indexOf(id);
  if (i < 0) return;
  S.tabs.splice(i, 1);
  delete S.files[id];
  if (!S.tabs.length) { newFile(); return; }
  activateTab(S.tabs[Math.max(0, i - 1)]);
}

function renderTabs() {
  const bar = g('tabs-bar');
  bar.innerHTML = '';
  S.tabs.forEach(id => {
    const f = S.files[id];
    if (!f) return;
    const t = document.createElement('div');
    t.className = 'tab-item' + (id === S.activeId ? ' active' : '');
    t.innerHTML = `<span>${xicon(f.name)}</span><span>${f.name}</span>${f.modified ? '<span style="color:var(--yellow);font-size:9px">●</span>' : ''}<span class="tab-x" onclick="closeTab('${id}',event)">✕</span>`;
    t.onclick = () => activateTab(id);
    bar.appendChild(t);
  });
}

// ─── Editor ───────────────────────────────────────────────────────────────────
function onEdit() {
  const f = S.files[S.activeId];
  if (!f) return;
  f.content = g('editor').value;
  f.modified = true;
  g('unsaved').style.display = 'inline';
  updateGutter();
}

function updateGutter() {
  const lines = (g('editor').value.match(/\n/g)||[]).length + 1;
  g('gutter').textContent = Array.from({length:lines},(_,i)=>i+1).join('\n');
}

function syncGutter() { g('gutter').scrollTop = g('editor').scrollTop; }

function updateCursor() {
  const ed = g('editor');
  const txt = ed.value.slice(0, ed.selectionStart);
  const ls = txt.split('\n');
  g('cursor-pos').textContent = `Ln ${ls.length}, Col ${ls.at(-1).length+1}`;
}

function editorKey(e) {
  const ed = g('editor');
  const s = ed.selectionStart, end = ed.selectionEnd;
  if (e.key === 'Tab') {
    e.preventDefault();
    ed.value = ed.value.slice(0,s)+'    '+ed.value.slice(end);
    ed.selectionStart = ed.selectionEnd = s+4;
    onEdit();
  }
  const pairs = {'(':')','{':'}','[':']','"':'"',"'":"'"};
  if (pairs[e.key] && !e.ctrlKey && s === end) {
    e.preventDefault();
    ed.value = ed.value.slice(0,s)+e.key+pairs[e.key]+ed.value.slice(end);
    ed.selectionStart = ed.selectionEnd = s+1; onEdit();
  }
  if (e.key === 'Enter') {
    const ls = ed.value.lastIndexOf('\n',s-1)+1;
    const line = ed.value.slice(ls,s);
    const indent = line.match(/^(\s*)/)[1];
    const extra = /[:({[]\s*$/.test(line.trimEnd()) ? '    ' : '';
    e.preventDefault();
    const ins = '\n'+indent+extra;
    ed.value = ed.value.slice(0,s)+ins+ed.value.slice(end);
    ed.selectionStart = ed.selectionEnd = s+ins.length; onEdit();
  }
}

function formatCode() {
  const ed = g('editor'); let d=0;
  ed.value = ed.value.split('\n').map(raw=>{
    const t=raw.trim(); if(!t) return '';
    if(/^[}\])]/.test(t)&&d>0) d--;
    const out='    '.repeat(d)+t;
    if(/[{(\[:]$/.test(t)) d++;
    return out;
  }).join('\n');
  onEdit(); toast('Formatted ✓');
}

function clearEditor() {
  if (!S.files[S.activeId]) return;
  S.files[S.activeId].content='';
  g('editor').value=''; onEdit();
}

function getCode() { return g('editor').value.trim(); }

// ─── File open / save ─────────────────────────────────────────────────────────
async function openFile() {
  const r = await api.openFile();
  if (r.ok) { newFile(r.name, r.content); closeMenus(); }
}
async function saveFile() {
  const f = S.files[S.activeId]; if(!f) return;
  const r = await api.saveFile({defaultName: f.name, content: f.content});
  if (r.ok) { f.modified=false; g('unsaved').style.display='none'; renderTabs(); toast('Saved ✓'); }
  closeMenus();
}
async function saveFileAs() { await saveFile(); }

// ─── Model Management ─────────────────────────────────────────────────────────
async function refreshModelsList() {
  const models = await api.listModels();
  const grid = g('models-grid');
  if (!models.length) {
    grid.innerHTML = `<div class="empty-state"><div style="font-size:48px">📦</div><h3>No models yet</h3><p>Go to <strong>Download Models</strong> to get a coding LLM</p><button class="btn-pri" style="margin-top:12px" onclick="switchTab('download')">Download Now</button></div>`;
    return;
  }
  grid.innerHTML = '';
  models.forEach(m => {
    const card = document.createElement('div');
    card.className = 'model-card' + (S.loadedModel === m.path ? ' active' : '');
    card.innerHTML = `
      <div class="mc-icon">${m.sizeGB > 5 ? '🧠' : '⚡'}</div>
      <div class="mc-info">
        <div class="mc-name">${m.name}</div>
        <div class="mc-meta">${m.sizeGB} GB &nbsp;·&nbsp; ${new Date(m.modified).toLocaleDateString()}</div>
      </div>
      <span class="mc-badge ${S.loadedModel===m.path?'loaded':''}">${S.loadedModel===m.path?'✓ Loaded':'GGUF'}</span>
      <div class="mc-actions">
        <button class="btn-load" onclick="event.stopPropagation();loadModel('${m.path}','${m.name}')">▶ Load</button>
        <button class="btn-del"  onclick="event.stopPropagation();deleteModel('${m.path}','${m.name}')">🗑</button>
      </div>`;
    card.onclick = () => loadModel(m.path, m.name);
    grid.appendChild(card);
  });
}

async function loadModel(modelPath, name) {
  toast(`Loading ${name}…`);
  setModelPill('loading', `Loading ${name}…`);
  const r = await api.loadModel(modelPath);
  if (r.ok) {
    S.loadedModel = modelPath;
    setModelPill('ready', name);
    g('chat-model-tag').textContent = name;
    g('model-status-bar').textContent = `🟢 ${name}`;
    toast(`✓ ${name} ready — context: ${(r.contextSize/1024).toFixed(0)}K tokens`);
    refreshModelsList();
    switchTab('editor');
  } else {
    setModelPill('error', 'Load failed');
    toast('✗ Failed to load model: ' + r.error);
  }
}

async function deleteModel(modelPath, name) {
  if (!confirm(`Delete ${name}? This cannot be undone.`)) return;
  await api.deleteModel(modelPath);
  if (S.loadedModel === modelPath) {
    S.loadedModel = null;
    setModelPill('', 'No model loaded');
    g('chat-model-tag').textContent = 'No model';
    g('model-status-bar').textContent = '⚪ No model';
  }
  refreshModelsList();
  toast(`Deleted ${name}`);
}

function onModelStatus(d) {
  setModelPill(d.state === 'ready' ? 'ready' : d.state === 'error' ? 'error' : 'loading', d.msg);
  if (d.state === 'error') toast('Error: ' + d.msg);
}

function setModelPill(cls, label) {
  const dot = g('mpill-dot');
  dot.className = 'mpill-dot' + (cls ? ` ${cls}` : '');
  g('mpill-label').textContent = label;
}

// ─── Download ─────────────────────────────────────────────────────────────────
function buildCatalogue() {
  const cat = g('catalogue');
  cat.innerHTML = '';
  CATALOGUE.forEach(m => {
    const card = document.createElement('div');
    card.className = 'cat-card';
    card.innerHTML = `
      <div class="cat-icon">${m.icon}</div>
      <div class="cat-info">
        <div class="cat-name">${m.name}</div>
        <div class="cat-desc">${m.desc}</div>
        <div class="cat-tags">${m.tags.map(t=>`<span class="tag">${t}</span>`).join('')}</div>
      </div>
      <button class="btn-pri" onclick="startDownload('${m.url}','${m.filename}')">Download</button>`;
    cat.appendChild(card);
  });
}

async function downloadCustom() {
  const url = g('custom-url').value.trim();
  if (!url || !url.includes('.gguf')) { toast('Please enter a valid .gguf URL'); return; }
  const filename = url.split('/').pop().split('?')[0];
  startDownload(url, filename);
}

async function startDownload(url, filename) {
  if (S.dlActive) { toast('A download is already in progress'); return; }
  S.dlActive = filename;
  g('dl-filename').textContent = filename;
  g('dl-pct').textContent = '0%';
  g('dl-mb').textContent = '0 MB';
  g('dl-total').textContent = '';
  g('prog-fill').style.width = '0%';
  g('dl-progress-area').style.display = 'block';
  toast(`Starting download: ${filename}`);

  const r = await api.downloadModel({ url, filename });
  S.dlActive = null;
  g('dl-progress-area').style.display = 'none';

  if (r.ok) {
    toast(`✓ Downloaded ${filename}!`);
    refreshModelsList();
    switchTab('models');
  } else {
    toast(`✗ Download failed: ${r.error}`);
  }
}

function onProgress(d) {
  g('dl-pct').textContent  = d.pct >= 0 ? d.pct + '%' : '…';
  g('dl-mb').textContent   = d.mb + ' MB';
  g('dl-total').textContent= '/ ' + d.total;
  if (d.pct >= 0) g('prog-fill').style.width = d.pct + '%';
}

async function cancelDl() {
  if (!S.dlActive) return;
  await api.cancelDownload(S.dlActive);
  S.dlActive = null;
  g('dl-progress-area').style.display = 'none';
  toast('Download cancelled');
}

// ─── Chat ─────────────────────────────────────────────────────────────────────
function q(text)   { g('ci').value = text; updateTok(); g('ci').focus(); sendMsg(); }
function getCode() { return g('editor').value.trim(); }

function insertCode() {
  const c = getCode();
  if (!c) { toast('Editor is empty'); return; }
  const f = S.files[S.activeId];
  const tag = xext(f?.name||'')||'code';
  g('ci').value += `\n\`\`\`${tag}\n${c}\n\`\`\`\n`;
  updateTok(); g('ci').focus();
}

function insertSel() {
  const ed = g('editor');
  const sel = ed.value.slice(ed.selectionStart, ed.selectionEnd);
  if (!sel) { toast('No text selected'); return; }
  const f = S.files[S.activeId];
  const tag = xext(f?.name||'')||'code';
  g('ci').value += `\n\`\`\`${tag}\n${sel}\n\`\`\`\n`;
  updateTok(); g('ci').focus();
}

function updateTok() {
  const n = g('ci').value.length;
  g('tok-count').textContent = `~${Math.ceil(n/4).toLocaleString()} tokens`;
}

function ciKey(e) {
  if (e.key==='Enter' && (e.ctrlKey||e.metaKey)) { e.preventDefault(); sendMsg(); }
}

let currentAiEl = null;
let currentBody = null;
let fullResponse = '';

async function sendMsg() {
  if (S.streaming) return;
  const inp = g('ci');
  const text = inp.value.trim();
  if (!text) return;
  if (!S.loadedModel) { toast('Load a model first — go to the Models tab'); return; }

  inp.value = ''; updateTok();
  document.querySelector('.welcome')?.remove();

  S.messages.push({ role:'user', content:text });
  addMsg('user', text);

  const typing = addTyping();
  S.streaming = true;
  g('ci-send').disabled = true;
  fullResponse = '';

  const r = await api.chat({
    messages: S.messages.slice(-60),
    systemPrompt: g('sys-prompt')?.value || 'You are an expert coding assistant.',
  });

  if (!r.ok) {
    typing.remove();
    addMsg('ai', `**Error:** ${r.error}`);
    S.streaming = false;
    g('ci-send').disabled = false;
  }
  // Response streams in via onChunk / onDone / onChatError
  typing.remove();
  currentAiEl = addMsg('ai', '', true);
  currentBody = currentAiEl.querySelector('.msg-body');
  currentBody.classList.add('stream-cur');
}

function onChunk(chunk) {
  fullResponse += chunk;
  if (currentBody) {
    currentBody.innerHTML = renderMd(fullResponse);
    currentBody.classList.add('stream-cur');
  }
  scrollChat();
}

function onDone() {
  if (currentBody) currentBody.classList.remove('stream-cur');
  S.messages.push({ role:'assistant', content:fullResponse });
  currentAiEl = null; currentBody = null; fullResponse = '';
  S.streaming = false;
  g('ci-send').disabled = false;
}

function onChatError(err) {
  if (currentBody) { currentBody.classList.remove('stream-cur'); currentBody.innerHTML = `<strong>Error:</strong> ${err}`; }
  S.streaming = false;
  g('ci-send').disabled = false;
  currentAiEl = null; currentBody = null;
}

async function resetSession() {
  await api.resetSession();
  S.messages = [];
  toast('Session reset');
}

// ─── Message DOM ──────────────────────────────────────────────────────────────
function addMsg(role, content, streaming=false) {
  const wrap = g('messages');
  const el = document.createElement('div');
  el.className = `msg ${role}`;
  const av = role==='user'?'U':'🤖';
  const nm = role==='user'?'You':(S.loadedModel?.split('/').pop()?.replace('.gguf','')||'AI');
  el.innerHTML = `
    <div class="msg-hdr">
      <div class="avatar">${av}</div>
      <span class="msg-name">${nm}</span>
      <span class="msg-time">${new Date().toLocaleTimeString()}</span>
    </div>
    <div class="msg-body">${streaming?'':renderMd(content)}</div>`;
  wrap.appendChild(el);
  scrollChat(); return el;
}

function addTyping() {
  const wrap = g('messages');
  const el = document.createElement('div');
  el.className = 'msg ai';
  el.innerHTML = `
    <div class="msg-hdr"><div class="avatar">🤖</div><span class="msg-name">AI</span></div>
    <div class="msg-body"><div class="typing-body"><div class="dots"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div><span style="font-size:11px;color:var(--t3)">Generating…</span></div></div>`;
  wrap.appendChild(el); scrollChat(); return el;
}

function scrollChat() {
  const m = g('messages'); m.scrollTop = m.scrollHeight;
}

function clearChat() {
  S.messages = []; g('messages').innerHTML=''; toast('Cleared');
}

function exportChat() {
  const md = S.messages.map(m=>`## ${m.role.toUpperCase()}\n\n${m.content}`).join('\n\n---\n\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([md],{type:'text/markdown'}));
  a.download = `codemind-${Date.now()}.md`; a.click();
}

// ─── Markdown renderer ────────────────────────────────────────────────────────
function renderMd(text) {
  text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const esc = code.trimEnd().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    return `<div class="code-hdr"><span class="code-tag">${lang||'code'}</span><div class="code-acts"><button class="cbtn" onclick="cpCode(this)">Copy</button><button class="cbtn ins" onclick="insCode(this)">→ Editor</button></div></div><pre><code>${esc}</code></pre>`;
  });
  text = text.replace(/`([^`\n]+)`/g,'<code>$1</code>');
  text = text.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
  text = text.replace(/\*(.+?)\*/g,'<em>$1</em>');
  text = text.replace(/^### (.+)$/gm,'<h4 style="color:var(--purple2);margin:8px 0 4px">$1</h4>');
  text = text.replace(/^## (.+)$/gm,'<h3 style="color:var(--purple2);margin:10px 0 5px">$1</h3>');
  text = text.replace(/^# (.+)$/gm,'<h2 style="color:var(--purple2);margin:10px 0 6px">$1</h2>');
  text = text.replace(/^[-*] (.+)$/gm,'<li style="margin-left:16px;margin-bottom:2px">$1</li>');
  text = text.replace(/\n\n/g,'<br><br>').replace(/\n/g,'<br>');
  return text;
}

function cpCode(btn) {
  const code = btn.closest('.msg-body').querySelector('pre code').textContent;
  navigator.clipboard.writeText(code).then(()=>{ btn.textContent='Copied!'; setTimeout(()=>btn.textContent='Copy',2000); });
}

function insCode(btn) {
  const code = btn.closest('.msg-body').querySelector('pre code').textContent;
  const ed = g('editor'); const s = ed.selectionStart;
  ed.value = ed.value.slice(0,s)+code+ed.value.slice(ed.selectionEnd);
  ed.selectionStart = ed.selectionEnd = s+code.length;
  onEdit(); toast('Inserted into editor ✓'); switchTab('editor');
}

// ─── Split divider ────────────────────────────────────────────────────────────
function setupDivider() {
  const div = g('split-div');
  const left = g('editor-col');
  let drag=false, startX=0, startW=0;
  div.addEventListener('mousedown', e=>{
    drag=true; startX=e.clientX; startW=left.offsetWidth;
    div.classList.add('dragging');
    document.body.style.cursor='col-resize';
    document.body.style.userSelect='none';
  });
  document.addEventListener('mousemove', e=>{
    if(!drag) return;
    const w = Math.min(window.innerWidth*0.78, Math.max(240, startW+e.clientX-startX));
    left.style.width=w+'px';
  });
  document.addEventListener('mouseup', ()=>{
    drag=false; div.classList.remove('dragging');
    document.body.style.cursor=''; document.body.style.userSelect='';
  });
}

// ─── Settings ─────────────────────────────────────────────────────────────────
function saveSettings() {
  toast('Settings saved ✓');
}

// ─── Keyboard shortcuts ───────────────────────────────────────────────────────
function setupKeys() {
  document.addEventListener('keydown', e => {
    if (e.ctrlKey||e.metaKey) {
      if (e.key==='n') { e.preventDefault(); newFile(); }
      if (e.key==='o') { e.preventDefault(); openFile(); }
      if (e.key==='s') { e.preventDefault(); saveFile(); }
    }
  });
}

// ─── Toast ────────────────────────────────────────────────────────────────────
let tt;
function toast(msg) {
  const el = g('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(tt); tt = setTimeout(()=>el.classList.remove('show'), 2800);
}

// ─── Util ─────────────────────────────────────────────────────────────────────
function g(id) { return document.getElementById(id); }
