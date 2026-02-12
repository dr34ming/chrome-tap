#!/usr/bin/env node

const { NativeMessaging } = require('./stdio');
const { ensureToken, TOKEN_PATH } = require('./auth');
const { createServer } = require('./server');
const { Router } = require('./router');

const PORT = parseInt(process.env.CHROME_TAP_PORT, 10) || 9867;

// --- Bootstrap ---

const token = ensureToken();
const stdio = new NativeMessaging();

const router = new Router((msg) => stdio.send(msg));

const wss = createServer(PORT, (ws) => {
  router.addClient(ws);

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (_) {
      ws.send(JSON.stringify({ error: { message: 'Invalid JSON' } }));
      return;
    }
    if (typeof msg.id === 'undefined' || !msg.method) {
      ws.send(JSON.stringify({ error: { message: 'Missing id or method' } }));
      return;
    }
    router.handleClientMessage(ws, msg);
  });
});

// Messages from extension
stdio.on('message', (msg) => {
  if (msg.type === 'event') {
    router.handleExtensionEvent(msg);
  } else if (typeof msg.id !== 'undefined') {
    router.handleExtensionResponse(msg);
  }
});

stdio.on('disconnect', () => {
  process.stderr.write('[chrome-tap] Extension disconnected\n');
  wss.close();
  process.exit(0);
});

stdio.on('error', (err) => {
  process.stderr.write(`[chrome-tap] stdio error: ${err.message}\n`);
});

// Start reading from extension
stdio.start();

// Signal readiness to extension
stdio.send({ type: 'host-ready', port: PORT });

process.stderr.write(`[chrome-tap] Listening on 127.0.0.1:${PORT}\n`);
process.stderr.write(`[chrome-tap] Token: ${TOKEN_PATH}\n`);
