/* ═══════════════════════════════════════
   app.js — CodeMind  (clean rewrite)
   Proxy-based, no CORS, streaming chat
═══════════════════════════════════════ */

// ─── Config ───────────────────────────────────────────────────────────────────
const PROXY = window.location.origin;   // server.js proxies /api/* → Ollama

// ─── State ────────────────────────────────────────────────────────────────────
const S = {
  model:      localStorage.getItem('cm_model') || '',
  temp:       parseFloat(localStorage.getItem('cm_temp') || '0.7'),
  sysPrompt:  localStorage.getItem('cm_sys') || 'You are an expert coding assistant. Write clean, efficient, well-documented code. Always use markdown code blocks with language tags.',
  messages:   [],   // [{role, content}]
  files:      {},   // id → {name, content, modified}
  tabs:       [],
  activeId:   null,
  streaming:  false,
  connected:  false,
  tabCount:   0,
};

// ─── Language helpers ─────────────────────────────────────────────────────────
const LANGS = {py:'Python',js:'JavaScript',ts:'TypeScript',jsx:'React JSX',tsx:'React TSX',
  html:'HTML',css:'CSS',json:'JSON',md:'Markdown',txt:'Text',java:'Java',cpp:'C++',
  c:'C',rs:'Rust',go:'Go',rb:'Ruby',php:'PHP',sh:'Shell',yaml:'YAML',yml:'YAML',sql:'SQL'};
const ICONS = {py:'🐍',js:'⚡',ts:'💙',jsx:'⚛',tsx:'⚛',html:'🌐',css:'🎨',json:'📋',
  md:'📝',java:'☕',cpp:'⚙',c:'⚙',rs:'🦀',go:'🐹',rb:'💎',php:'🐘',sh:'💻',sql:'🗄'};

const ext  = name => name.split('.').pop()?.toLowerCase() || '';
const lang = name => LANGS[ext(name)] || 'Text';
const icon = name => ICONS[ext(name)] || '📄';

// ─── Boot ─────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  newFile();            // start with one blank file
  setupDivider();
  setupKeys();
  autoConnect();
});

async function autoConnect() {
  try { await loadModels(true); } catch {}
}

// ─── Model Loading ────────────────────────────────────────────────────────────
async function loadModels(silent = false) {
  const res = await fetch(`${PROXY}/api/tags`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { models = [] } = await res.json();

  S.connected = true;
  dot('ok');
  lbl(models.length ? `${models.length} models` : 'Connected — no models');

  const sel = $('model-select');
  sel.innerHTML = '<option value="">— Pick a model —</option>';
  models.forEach(m => {
    const o = document.createElement('option');
    o.value = m.name;
    o.textContent = m.name + (m.details?.parameter_size ? `  (${m.details.parameter_size})` : '');
    if (m.name === S.model) o.selected = true;
    sel.appendChild(o);
  });
  if (S.model) {
    sel.value = S.model;
    $('chat-model-label').textContent = S.model;
    $('connect-hint').style.display = 'none';
  }
  return models;
}

async function refreshModels() {
  const btn = document.querySelector('.topbar-btn.accent');
  btn.classList.add('loading');
  btn.textContent = 'Connecting…';
  dot('');
  lbl('Connecting…');
  try {
    const models = await loadModels(false);
    toast(`✓ Connected — ${models.length} model(s)`);
    $('connect-hint').style.display = 'none';
  } catch (e) {
    S.connected = false;
    dot('err');
    lbl('Ollama unreachable');
    toast('✗ Cannot reach Ollama — is it running?');
  } finally {
    btn.classList.remove('loading');
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg> Connect`;
  }
}

function onModelChange() {
  S.model = $('model-select').value;
  localStorage.setItem('cm_model', S.model);
  $('chat-model-label').textContent = S.model || 'No model selected';
  if (S.model) $('connect-hint').style.display = 'none';
}

// ─── File / Tab Management ────────────────────────────────────────────────────
let fc = 0;
function uid() { return `f${++fc}_${Date.now()}`; }

function newFile(name, content = '') {
  const id = uid();
  name = name || `untitled-${fc}.py`;
  S.files[id] = { name, content, modified: false };
  S.tabs.push(id);
  activateTab(id);
  renderTabs();
}

function activateTab(id) {
  S.activeId = id;
  const f = S.files[id];
  $('main-editor').value = f?.content || '';
  $('filename-pill').textContent = f?.name || '—';
  $('pane-lang').textContent = lang(f?.name || '');
  $('lang-badge').textContent = lang(f?.name || '');
  $('modified-badge').style.display = f?.modified ? 'inline' : 'none';
  updateGutter(); updateCursor();
  renderTabs();
}

function closeTab(id, e) {
  e?.stopPropagation();
  const idx = S.tabs.indexOf(id);
  if (idx === -1) return;
  S.tabs.splice(idx, 1);
  delete S.files[id];
  if (!S.tabs.length) { newFile(); return; }
  activateTab(S.tabs[Math.max(0, idx - 1)]);
}

function renderTabs() {
  const row = $('tab-row');
  row.innerHTML = '';
  S.tabs.forEach(id => {
    const f = S.files[id];
    if (!f) return;
    const t = document.createElement('div');
    t.className = 'tab' + (id === S.activeId ? ' active' : '');
    t.innerHTML = `<span>${icon(f.name)}</span><span>${f.name}</span>${f.modified?'<span style="color:var(--yellow);font-size:9px">●</span>':''}<span class="tab-x" onclick="closeTab('${id}',event)">✕</span>`;
    t.onclick = () => activateTab(id);
    row.appendChild(t);
  });
}

// ─── Editor ───────────────────────────────────────────────────────────────────
function onEditorChange() {
  const f = S.files[S.activeId];
  if (!f) return;
  f.content = $('main-editor').value;
  f.modified = true;
  $('modified-badge').style.display = 'inline';
  updateGutter();
}

function updateGutter() {
  const lines = ($('main-editor').value.match(/\n/g) || []).length + 1;
  $('gutter').textContent = Array.from({length: lines}, (_, i) => i + 1).join('\n');
}

function syncGutter() {
  $('gutter').scrollTop = $('main-editor').scrollTop;
}

function updateCursor() {
  const ed = $('main-editor');
  const txt = ed.value.slice(0, ed.selectionStart);
  const lines = txt.split('\n');
  $('cursor-pos').textContent = `Ln ${lines.length}, Col ${lines.at(-1).length + 1}`;
}

function editorKeydown(e) {
  const ed = $('main-editor');
  const s = ed.selectionStart, end = ed.selectionEnd;

  if (e.key === 'Tab') {
    e.preventDefault();
    ed.value = ed.value.slice(0, s) + '    ' + ed.value.slice(end);
    ed.selectionStart = ed.selectionEnd = s + 4;
    onEditorChange();
  }

  const pairs = {'(':')','{':'}','[':']','"':'"',"'":"'"};
  if (pairs[e.key] && !e.ctrlKey && !e.metaKey && s === end) {
    e.preventDefault();
    ed.value = ed.value.slice(0, s) + e.key + pairs[e.key] + ed.value.slice(end);
    ed.selectionStart = ed.selectionEnd = s + 1;
    onEditorChange();
  }

  if (e.key === 'Enter') {
    const lineStart = ed.value.lastIndexOf('\n', s - 1) + 1;
    const line = ed.value.slice(lineStart, s);
    const indent = line.match(/^(\s*)/)[1];
    const extra = /[:({[]\s*$/.test(line.trimEnd()) ? '    ' : '';
    e.preventDefault();
    const ins = '\n' + indent + extra;
    ed.value = ed.value.slice(0, s) + ins + ed.value.slice(end);
    ed.selectionStart = ed.selectionEnd = s + ins.length;
    onEditorChange();
  }
}

function formatCode() {
  // basic indent normalise
  const ed = $('main-editor');
  const lines = ed.value.split('\n');
  let depth = 0;
  ed.value = lines.map(raw => {
    const t = raw.trim();
    if (!t) return '';
    if (/^[}\])]/.test(t) && depth > 0) depth--;
    const out = '    '.repeat(depth) + t;
    if (/[{(\[:]$/.test(t)) depth++;
    return out;
  }).join('\n');
  onEditorChange();
  toast('Code formatted');
}

function clearEditor() {
  if (!S.files[S.activeId]) return;
  S.files[S.activeId].content = '';
  $('main-editor').value = '';
  onEditorChange();
}

// ─── File open / save ─────────────────────────────────────────────────────────
function openFilePicker() { $('file-picker').click(); }
function loadFile(ev) {
  const file = ev.target.files[0];
  if (!file) return;
  const r = new FileReader();
  r.onload = e => newFile(file.name, e.target.result);
  r.readAsText(file);
  ev.target.value = '';
}

function saveFile() {
  const f = S.files[S.activeId];
  if (!f) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([f.content], {type:'text/plain'}));
  a.download = f.name;
  a.click();
  f.modified = false;
  $('modified-badge').style.display = 'none';
  renderTabs();
  toast(`Saved ${f.name}`);
}

// ─── Chat helpers ─────────────────────────────────────────────────────────────
function getEditorCode() { return $('main-editor').value.trim(); }

function setPrompt(text) {
  $('chat-input').value = text;
  updateCharCount();
  $('chat-input').focus();
}

function sendEditorCode() {
  const code = getEditorCode();
  const f = S.files[S.activeId];
  if (!code) { toast('Editor is empty'); return; }
  const tag = ext(f?.name || '') || 'code';
  setPrompt(`Explain this code:\n\`\`\`${tag}\n${code}\n\`\`\``);
}

function sendSelection() {
  const ed = $('main-editor');
  const sel = ed.value.slice(ed.selectionStart, ed.selectionEnd);
  if (!sel) { toast('No text selected in editor'); return; }
  const f = S.files[S.activeId];
  const tag = ext(f?.name || '') || 'code';
  setPrompt(`Explain this:\n\`\`\`${tag}\n${sel}\n\`\`\``);
}

function updateCharCount() {
  const n = $('chat-input').value.length;
  $('token-hint').textContent = `~${Math.ceil(n/4).toLocaleString()} tokens`;
}

function chatKeydown(e) {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault(); sendMessage();
  }
}

// ─── Send / Stream ────────────────────────────────────────────────────────────
async function sendMessage() {
  if (S.streaming) return;

  const input = $('chat-input');
  const text = input.value.trim();
  if (!text) return;
  if (!S.model) { toast('Pick a model first (top bar → Connect)'); return; }
  if (!S.connected) { toast('Not connected — click Connect'); return; }

  input.value = '';
  updateCharCount();

  // remove welcome card
  document.querySelector('.welcome-card')?.remove();

  S.messages.push({ role: 'user', content: text });
  addMsg('user', text);

  const typingEl = addTyping();
  S.streaming = true;
  $('send-btn').disabled = true;

  try {
    const body = {
      model: S.model,
      stream: true,
      messages: [
        { role: 'system', content: S.sysPrompt },
        ...S.messages.slice(-60),
      ],
      options: {
        temperature: S.temp,
        num_ctx: 131072,   // 128K — effectively unlimited
        num_predict: -1,   // unlimited output tokens
      },
    };

    const res = await fetch(`${PROXY}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Ollama error ${res.status}`);

    typingEl.remove();
    const msgEl = addMsg('ai', '', true);   // streaming = true
    const body2 = msgEl.querySelector('.msg-body');
    body2.classList.add('streaming-cursor');

    let full = '';
    const reader = res.body.getReader();
    const dec = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const line of dec.decode(value, {stream:true}).split('\n')) {
        if (!line.trim()) continue;
        try {
          const d = JSON.parse(line);
          if (d.message?.content) {
            full += d.message.content;
            body2.innerHTML = renderMd(full);
            body2.classList.add('streaming-cursor');
            scrollChat();
          }
          if (d.done) { body2.classList.remove('streaming-cursor'); }
        } catch {}
      }
    }

    body2.classList.remove('streaming-cursor');
    S.messages.push({ role: 'assistant', content: full });

  } catch (err) {
    typingEl?.remove();
    addMsg('ai', `**Error:** ${err.message}\n\nMake sure Ollama is running: \`ollama serve\``);
  } finally {
    S.streaming = false;
    $('send-btn').disabled = false;
  }
}

// ─── Render Markdown ──────────────────────────────────────────────────────────
function renderMd(text) {
  // fenced code blocks
  text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const esc = escHtml(code.trimEnd());
    return `<div class="code-header">
      <span class="code-lang-tag">${lang||'code'}</span>
      <div class="code-btns">
        <button class="code-btn" onclick="copyCode(this)">Copy</button>
        <button class="code-btn insert" onclick="insertCode(this)">→ Editor</button>
      </div>
    </div><pre><code>${esc}</code></pre>`;
  });
  // inline code
  text = text.replace(/`([^`\n]+)`/g,
    '<code>$1</code>');
  // bold / italic
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // headings
  text = text.replace(/^### (.+)$/gm, '<h4 style="color:var(--purple2);margin:8px 0 4px;font-size:12px">$1</h4>');
  text = text.replace(/^## (.+)$/gm,  '<h3 style="color:var(--purple2);margin:10px 0 5px">$1</h3>');
  text = text.replace(/^# (.+)$/gm,   '<h2 style="color:var(--purple2);margin:10px 0 6px">$1</h2>');
  // lists
  text = text.replace(/^[-*] (.+)$/gm, '<li style="margin-left:16px;margin-bottom:2px">$1</li>');
  // line breaks
  text = text.replace(/\n\n/g, '<br><br>').replace(/\n/g, '<br>');
  return text;
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ─── DOM helpers ──────────────────────────────────────────────────────────────
function addMsg(role, content, streaming = false) {
  const wrap = $('messages');
  const el = document.createElement('div');
  el.className = `msg ${role}`;
  const avatar = role === 'user' ? 'U' : '🤖';
  const name   = role === 'user' ? 'You' : (S.model || 'AI');
  el.innerHTML = `
    <div class="msg-header">
      <div class="msg-avatar">${avatar}</div>
      <span class="msg-name">${name}</span>
      <span class="msg-time">${new Date().toLocaleTimeString()}</span>
    </div>
    <div class="msg-body">${streaming ? '' : renderMd(content)}</div>`;
  wrap.appendChild(el);
  scrollChat();
  return el;
}

function addTyping() {
  const wrap = $('messages');
  const el = document.createElement('div');
  el.className = 'msg ai typing-msg';
  el.innerHTML = `
    <div class="msg-header">
      <div class="msg-avatar">🤖</div>
      <span class="msg-name">${S.model}</span>
    </div>
    <div class="msg-body">
      <div class="dots">
        <div class="dot"></div><div class="dot"></div><div class="dot"></div>
      </div>
      <span style="font-size:11px">Generating…</span>
    </div>`;
  wrap.appendChild(el);
  scrollChat();
  return el;
}

function scrollChat() {
  const m = $('messages');
  m.scrollTop = m.scrollHeight;
}

// ─── Code block actions ───────────────────────────────────────────────────────
function copyCode(btn) {
  const code = btn.closest('.msg-body').querySelector('pre code').textContent;
  navigator.clipboard.writeText(code).then(() => {
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = 'Copy', 2000);
  });
}

function insertCode(btn) {
  const code = btn.closest('.msg-body').querySelector('pre code').textContent;
  const ed = $('main-editor');
  const s = ed.selectionStart;
  ed.value = ed.value.slice(0, s) + code + ed.value.slice(ed.selectionEnd);
  ed.selectionStart = ed.selectionEnd = s + code.length;
  onEditorChange();
  toast('Code inserted into editor ✓');
}

// ─── Chat actions ─────────────────────────────────────────────────────────────
function clearChat() {
  S.messages = [];
  $('messages').innerHTML = '';
  toast('Conversation cleared');
}

function exportChat() {
  const md = S.messages.map(m => `## ${m.role.toUpperCase()}\n\n${m.content}`).join('\n\n---\n\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([md], {type:'text/markdown'}));
  a.download = `codemind-${Date.now()}.md`;
  a.click();
}

// ─── Divider drag ─────────────────────────────────────────────────────────────
function setupDivider() {
  const div = $('divider');
  const left = $('editor-side');
  let drag = false, startX = 0, startW = 0;
  div.addEventListener('mousedown', e => {
    drag = true; startX = e.clientX; startW = left.offsetWidth;
    div.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });
  document.addEventListener('mousemove', e => {
    if (!drag) return;
    const w = Math.min(window.innerWidth * 0.75, Math.max(250, startW + e.clientX - startX));
    left.style.width = w + 'px';
  });
  document.addEventListener('mouseup', () => {
    drag = false; div.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });
}

// ─── Keyboard shortcuts ───────────────────────────────────────────────────────
function setupKeys() {
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'n') { e.preventDefault(); newFile(); }
      if (e.key === 'o') { e.preventDefault(); openFilePicker(); }
      if (e.key === 's') { e.preventDefault(); saveFile(); }
    }
  });
}

// ─── Status bar helpers ───────────────────────────────────────────────────────
function dot(cls) {
  $('status-dot').className = 'status-dot' + (cls ? ` ${cls}` : '');
}
function lbl(text) { $('status-label').textContent = text; }

// ─── Toast ────────────────────────────────────────────────────────────────────
let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

// ─── Utility ──────────────────────────────────────────────────────────────────
function $(id) { return document.getElementById(id); }
