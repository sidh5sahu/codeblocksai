/**
 * CodeMind — Proxy Server
 * Serves static files AND proxies Ollama API calls.
 * This completely eliminates CORS issues.
 * Usage: node server.js
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 5500;
const OLLAMA_HOST = 'localhost';
const OLLAMA_PORT = 11434;

const MIME = {
  '.html': 'text/html',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url);
  const pathname = parsed.pathname;

  // ── Proxy all /api/* calls to Ollama ─────────────────────────────────────
  if (pathname.startsWith('/api/') || pathname.startsWith('/ollama/')) {
    const ollamaPath = pathname.replace('/ollama', '');

    const options = {
      hostname: OLLAMA_HOST,
      port: OLLAMA_PORT,
      path: ollamaPath + (parsed.search || ''),
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': req.headers['accept'] || 'application/json',
      },
    };

    const proxy = http.request(options, (ollamaRes) => {
      res.writeHead(ollamaRes.statusCode, {
        'Content-Type': ollamaRes.headers['content-type'] || 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Transfer-Encoding': ollamaRes.headers['transfer-encoding'] || '',
      });
      ollamaRes.pipe(res);
    });

    proxy.on('error', (err) => {
      console.error('[Proxy Error]', err.message);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Ollama unreachable: ' + err.message }));
    });

    if (req.method === 'POST') {
      req.pipe(proxy);
    } else {
      proxy.end();
    }
    return;
  }

  // ── OPTIONS preflight ──────────────────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  // ── Serve static files ─────────────────────────────────────────────────────
  let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      // fallback to index.html
      filePath = path.join(__dirname, 'index.html');
    }
    const ext = path.extname(filePath);
    const contentType = MIME[ext] || 'text/plain';

    fs.readFile(filePath, (err2, data) => {
      if (err2) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    });
  });
});

server.listen(PORT, () => {
  console.log('');
  console.log('  ╔═══════════════════════════════════════╗');
  console.log('  ║       CodeMind Server Running         ║');
  console.log('  ╠═══════════════════════════════════════╣');
  console.log(`  ║  App  →  http://localhost:${PORT}        ║`);
  console.log(`  ║  Ollama proxied from :${OLLAMA_PORT}          ║`);
  console.log('  ╚═══════════════════════════════════════╝');
  console.log('');
  console.log('  Open http://localhost:5500 in your browser');
  console.log('  Press Ctrl+C to stop');
  console.log('');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  ✗ Port ${PORT} is already in use. Kill the old process or change PORT.\n`);
  } else {
    console.error('\n  Server error:', err.message, '\n');
  }
  process.exit(1);
});
