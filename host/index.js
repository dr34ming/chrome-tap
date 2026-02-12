#!/usr/bin/env node

const { ensureToken, TOKEN_PATH } = require('./auth');
const { createServer } = require('./server');
const { Router } = require('./router');

const PORT = parseInt(process.env.CHROME_TAP_PORT, 10) || 9867;
const HEADLESS = process.argv.includes('--headless');

// Parse --allow=IP,IP from argv
const allowFlag = process.argv.find((a) => a.startsWith('--allow='));
const allowlist = allowFlag ? allowFlag.split('=')[1].split(',') : undefined;

const token = ensureToken();

if (HEADLESS) {
  startHeadless();
} else {
  startExtensionBridge();
}

// --- Headless mode: launch Chrome, connect via CDP directly ---

async function startHeadless() {
  const { launchChrome } = require('./headless');
  const { CdpClient } = require('./cdp');

  process.stderr.write('[chrome-tap] Launching headless Chrome...\n');
  const chrome = await launchChrome();
  process.stderr.write(`[chrome-tap] Chrome CDP: ${chrome.wsUrl}\n`);

  const cdp = new CdpClient(chrome.wsUrl);
  await cdp.connect();

  // Route commands from WS clients through CDP
  const router = new Router((msg) => {
    handleCdpDispatch(cdp, msg, router);
  });

  // Forward CDP events to router
  cdp._onEvent = (event) => router.handleExtensionEvent(event);

  const { host } = createServer(PORT, wsHandler(router), { allowlist });

  process.stderr.write(`[chrome-tap] Listening on ${host}:${PORT} (headless)\n`);
  process.stderr.write(`[chrome-tap] Token: ${TOKEN_PATH}\n`);

  // Cleanup on exit
  process.on('SIGINT', () => { cdp.close(); chrome.kill(); process.exit(0); });
  process.on('SIGTERM', () => { cdp.close(); chrome.kill(); process.exit(0); });
}

async function handleCdpDispatch(cdp, msg, router) {
  try {
    let result;
    switch (msg.method) {
      case 'chrome-tap.listTargets':
        result = await cdp.listTargets();
        break;
      case 'chrome-tap.attach':
        result = await cdp.attach(msg.params?.tabId);
        break;
      case 'chrome-tap.detach':
        result = await cdp.detach(msg.params?.tabId);
        break;
      case 'chrome-tap.createTab':
        result = await cdp.createTab(msg.params?.url);
        break;
      default:
        result = await cdp.sendCommand(msg.method, msg.params?.tabId, msg.params?.cdpParams || {});
        break;
    }
    router.handleExtensionResponse({ id: msg.id, result });
  } catch (err) {
    router.handleExtensionResponse({ id: msg.id, error: { message: err.message || err } });
  }
}

// --- Extension bridge mode: native messaging on stdio ---

function startExtensionBridge() {
  const { NativeMessaging } = require('./stdio');
  const stdio = new NativeMessaging();
  const router = new Router((msg) => stdio.send(msg));

  const { host } = createServer(PORT, wsHandler(router), { allowlist });

  stdio.on('message', (msg) => {
    if (msg.type === 'event') {
      router.handleExtensionEvent(msg);
    } else if (typeof msg.id !== 'undefined') {
      router.handleExtensionResponse(msg);
    }
  });

  stdio.on('disconnect', () => {
    process.stderr.write('[chrome-tap] Extension disconnected\n');
    process.exit(0);
  });

  stdio.on('error', (err) => {
    process.stderr.write(`[chrome-tap] stdio error: ${err.message}\n`);
  });

  stdio.start();
  stdio.send({ type: 'host-ready', port: PORT });

  process.stderr.write(`[chrome-tap] Listening on ${host}:${PORT} (extension)\n`);
  process.stderr.write(`[chrome-tap] Token: ${TOKEN_PATH}\n`);
}

// --- Shared WS client handler ---

function wsHandler(router) {
  return (ws) => {
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
  };
}
