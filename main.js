/**
 * main.js — Electron Main Process
 * Handles: window, IPC, model loading/inference, file I/O, HuggingFace downloads
 */

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path  = require('path');
const fs    = require('fs');
const https = require('https');
const http  = require('http');

// ─── Paths ────────────────────────────────────────────────────────────────────
const MODELS_DIR = path.join(app.getPath('userData'), 'models');
if (!fs.existsSync(MODELS_DIR)) fs.mkdirSync(MODELS_DIR, { recursive: true });

// ─── LLM state ────────────────────────────────────────────────────────────────
let llama, currentModel, currentContext, currentSession;
let LlamaChatSession;

// ─── Window ───────────────────────────────────────────────────────────────────
let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0e0e12',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: path.join(__dirname, 'src', 'icon.png'),
  });

  win.loadFile(path.join(__dirname, 'src', 'index.html'));

  // Window controls
  ipcMain.on('win-minimize', () => win.minimize());
  ipcMain.on('win-maximize', () => win.isMaximized() ? win.unmaximize() : win.maximize());
  ipcMain.on('win-close',    () => win.close());

  win.on('maximize',   () => win.webContents.send('win-state', 'maximized'));
  win.on('unmaximize', () => win.webContents.send('win-state', 'normal'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ─── IPC: List local models ───────────────────────────────────────────────────
ipcMain.handle('list-models', () => {
  const files = fs.readdirSync(MODELS_DIR).filter(f => f.endsWith('.gguf'));
  return files.map(f => {
    const full = path.join(MODELS_DIR, f);
    const stat = fs.statSync(full);
    return {
      name: f,
      path: full,
      size: stat.size,
      sizeMB: (stat.size / 1024 / 1024).toFixed(1),
      sizeGB: (stat.size / 1024 / 1024 / 1024).toFixed(2),
      modified: stat.mtime,
    };
  });
});

ipcMain.handle('get-models-dir', () => MODELS_DIR);
ipcMain.on('open-models-dir',    () => shell.openPath(MODELS_DIR));

// ─── IPC: Delete model ────────────────────────────────────────────────────────
ipcMain.handle('delete-model', (_, modelPath) => {
  fs.unlinkSync(modelPath);
  return true;
});

// ─── IPC: Load model ─────────────────────────────────────────────────────────
ipcMain.handle('load-model', async (_, modelPath) => {
  try {
    win.webContents.send('model-status', { state: 'loading', msg: 'Initialising llama.cpp…' });

    if (!llama) {
      const mod = await import('node-llama-cpp');
      llama = await mod.getLlama();
      LlamaChatSession = mod.LlamaChatSession;
    }

    // unload previous
    if (currentContext) { try { await currentContext.dispose(); } catch {} }
    if (currentModel)   { try { await currentModel.dispose();   } catch {} }

    win.webContents.send('model-status', { state: 'loading', msg: 'Loading model weights…' });

    currentModel = await llama.loadModel({ modelPath });
    currentContext = await currentModel.createContext({
      contextSize: Math.min(currentModel.trainContextSize, 131072),
    });
    currentSession = new LlamaChatSession({
      contextSequence: currentContext.getSequence(),
      systemPrompt: 'You are an expert coding assistant. Write clean, efficient, well-documented code. Always use markdown code blocks with the correct language tag.',
    });

    win.webContents.send('model-status', { state: 'ready', msg: 'Model ready' });
    return { ok: true, contextSize: currentContext.contextSize };
  } catch (err) {
    win.webContents.send('model-status', { state: 'error', msg: err.message });
    return { ok: false, error: err.message };
  }
});

// ─── IPC: Chat (streaming) ────────────────────────────────────────────────────
ipcMain.handle('chat', async (_, { messages, systemPrompt }) => {
  if (!currentSession) return { ok: false, error: 'No model loaded' };

  try {
    // Rebuild session if system prompt changed
    if (systemPrompt && currentSession._systemPrompt !== systemPrompt) {
      currentSession.dispose?.();
      currentSession = new LlamaChatSession({
        contextSequence: currentContext.getSequence(),
        systemPrompt,
      });
      currentSession._systemPrompt = systemPrompt;
    }

    const lastUser = messages.filter(m => m.role === 'user').at(-1)?.content || '';

    await currentSession.prompt(lastUser, {
      onTextChunk: (chunk) => {
        win.webContents.send('chat-chunk', chunk);
      },
      maxTokens: -1,   // unlimited
      temperature: 0.7,
    });

    win.webContents.send('chat-done');
    return { ok: true };
  } catch (err) {
    win.webContents.send('chat-error', err.message);
    return { ok: false, error: err.message };
  }
});

// ─── IPC: Reset session ───────────────────────────────────────────────────────
ipcMain.handle('reset-session', async () => {
  if (!currentContext) return;
  currentSession = new LlamaChatSession({
    contextSequence: currentContext.getSequence(),
    systemPrompt: 'You are an expert coding assistant.',
  });
  return true;
});

// ─── IPC: Download model from HuggingFace ────────────────────────────────────
ipcMain.handle('download-model', async (_, { url, filename }) => {
  const dest = path.join(MODELS_DIR, filename);

  return new Promise((resolve) => {
    const doDownload = (downloadUrl, redirectCount = 0) => {
      if (redirectCount > 5) { resolve({ ok: false, error: 'Too many redirects' }); return; }

      const proto = downloadUrl.startsWith('https') ? https : http;
      const req = proto.get(downloadUrl, {
        headers: { 'User-Agent': 'CodeMind/1.0' },
      }, (res) => {
        // Handle redirects
        if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
          res.resume();
          doDownload(res.headers.location, redirectCount + 1);
          return;
        }
        if (res.statusCode !== 200) {
          resolve({ ok: false, error: `HTTP ${res.statusCode}` });
          return;
        }

        const total = parseInt(res.headers['content-length'] || '0', 10);
        let downloaded = 0;
        const stream = fs.createWriteStream(dest);

        res.on('data', (chunk) => {
          downloaded += chunk.length;
          stream.write(chunk);
          const pct = total > 0 ? Math.round((downloaded / total) * 100) : -1;
          const mb  = (downloaded / 1024 / 1024).toFixed(1);
          const tot = total > 0 ? (total / 1024 / 1024 / 1024).toFixed(2) + ' GB' : '?';
          win.webContents.send('download-progress', {
            filename, pct, mb, total: tot, downloaded,
          });
        });

        res.on('end', () => {
          stream.end();
          resolve({ ok: true, path: dest });
        });

        res.on('error', (err) => {
          stream.destroy();
          fs.unlinkSync(dest);
          resolve({ ok: false, error: err.message });
        });
      });

      req.on('error', (err) => resolve({ ok: false, error: err.message }));
    };

    doDownload(url);
  });
});

// ─── IPC: Cancel download ─────────────────────────────────────────────────────
// (simplified — just remove partial file)
ipcMain.handle('cancel-download', (_, filename) => {
  const dest = path.join(MODELS_DIR, filename);
  if (fs.existsSync(dest)) fs.unlinkSync(dest);
  return true;
});

// ─── IPC: File system ─────────────────────────────────────────────────────────
ipcMain.handle('save-file', async (_, { defaultName, content }) => {
  const { filePath } = await dialog.showSaveDialog(win, {
    defaultPath: defaultName,
    filters: [
      { name: 'Source Files', extensions: ['py','js','ts','jsx','tsx','html','css','json','md','txt','java','cpp','c','rs','go','rb','sh','sql'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (filePath) { fs.writeFileSync(filePath, content, 'utf8'); return { ok: true, path: filePath }; }
  return { ok: false };
});

ipcMain.handle('open-file', async () => {
  const { filePaths } = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [
      { name: 'Source Files', extensions: ['py','js','ts','jsx','tsx','html','css','json','md','txt','java','cpp','c','rs','go','rb','sh','sql','yaml','yml','toml'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (filePaths.length) {
    const content = fs.readFileSync(filePaths[0], 'utf8');
    return { ok: true, path: filePaths[0], name: path.basename(filePaths[0]), content };
  }
  return { ok: false };
});
