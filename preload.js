/**
 * preload.js — Context Bridge
 * Safely exposes main-process APIs to the renderer
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Window controls
  minimize:     ()      => ipcRenderer.send('win-minimize'),
  maximize:     ()      => ipcRenderer.send('win-maximize'),
  close:        ()      => ipcRenderer.send('win-close'),
  onWinState:   (cb)    => ipcRenderer.on('win-state', (_, s) => cb(s)),

  // Models
  listModels:   ()      => ipcRenderer.invoke('list-models'),
  getModelsDir: ()      => ipcRenderer.invoke('get-models-dir'),
  openModelsDir:()      => ipcRenderer.send('open-models-dir'),
  deleteModel:  (p)     => ipcRenderer.invoke('delete-model', p),
  loadModel:    (p)     => ipcRenderer.invoke('load-model', p),
  resetSession: ()      => ipcRenderer.invoke('reset-session'),

  // Model status events
  onModelStatus:(cb)    => ipcRenderer.on('model-status', (_, d) => cb(d)),

  // Chat
  chat:         (d)     => ipcRenderer.invoke('chat', d),
  onChunk:      (cb)    => ipcRenderer.on('chat-chunk', (_, c) => cb(c)),
  onDone:       (cb)    => ipcRenderer.on('chat-done',  ()    => cb()),
  onChatError:  (cb)    => ipcRenderer.on('chat-error', (_, e) => cb(e)),

  // Download
  downloadModel:(d)     => ipcRenderer.invoke('download-model', d),
  cancelDownload:(f)    => ipcRenderer.invoke('cancel-download', f),
  onProgress:   (cb)    => ipcRenderer.on('download-progress', (_, d) => cb(d)),

  // File system
  saveFile:     (d)     => ipcRenderer.invoke('save-file', d),
  openFile:     ()      => ipcRenderer.invoke('open-file'),

  // Remove listeners
  removeAll:    (ch)    => ipcRenderer.removeAllListeners(ch),
});
