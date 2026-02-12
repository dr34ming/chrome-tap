// chrome-tap service worker
// Bridges native messaging host <-> chrome.debugger API

const HOST_NAME = 'com.chrometap.host';

let port = null;
let hostReady = false;
let attachedTabs = new Map(); // tabId -> debuggee

// --- Native messaging ---

function connectHost() {
  port = chrome.runtime.connectNative(HOST_NAME);

  port.onMessage.addListener((msg) => {
    if (msg.type === 'host-ready') {
      hostReady = true;
      console.log('[chrome-tap] Host ready on port', msg.port);
      return;
    }
    handleHostMessage(msg);
  });

  port.onDisconnect.addListener(() => {
    const err = chrome.runtime.lastError?.message || 'unknown';
    console.error('[chrome-tap] Host disconnected:', err);
    hostReady = false;
    port = null;
    // Retry after 2s
    setTimeout(connectHost, 2000);
  });
}

function sendToHost(msg) {
  if (!port) return;
  port.postMessage(msg);
}

// --- Message handling ---

async function handleHostMessage(msg) {
  if (typeof msg.id === 'undefined' || !msg.method) return;

  try {
    const result = await dispatch(msg.method, msg.params || {});
    sendToHost({ id: msg.id, result });
  } catch (err) {
    sendToHost({ id: msg.id, error: { message: err.message } });
  }
}

async function dispatch(method, params) {
  switch (method) {
    case 'chrome-tap.listTargets':
      return listTargets();
    case 'chrome-tap.attach':
      return attach(params);
    case 'chrome-tap.detach':
      return detach(params);
    default:
      return cdpSend(method, params);
  }
}

// --- Meta commands ---

async function listTargets() {
  const tabs = await chrome.tabs.query({});
  return {
    targets: tabs.map((t) => ({
      tabId: t.id,
      title: t.title,
      url: t.url,
      attached: attachedTabs.has(t.id)
    }))
  };
}

async function attach({ tabId }) {
  if (!tabId) throw new Error('tabId required');
  if (attachedTabs.has(tabId)) return { status: 'already_attached' };

  const debuggee = { tabId };
  await chrome.debugger.attach(debuggee, '1.3');
  attachedTabs.set(tabId, debuggee);
  return { status: 'attached' };
}

async function detach({ tabId }) {
  if (!tabId) throw new Error('tabId required');
  const debuggee = attachedTabs.get(tabId);
  if (!debuggee) return { status: 'not_attached' };

  await chrome.debugger.detach(debuggee);
  attachedTabs.delete(tabId);
  return { status: 'detached' };
}

// --- CDP passthrough ---

async function cdpSend(method, params) {
  const { tabId, cdpParams } = params;
  if (!tabId) throw new Error('tabId required in params');

  const debuggee = attachedTabs.get(tabId);
  if (!debuggee) throw new Error(`Tab ${tabId} not attached. Call chrome-tap.attach first.`);

  const result = await chrome.debugger.sendCommand(debuggee, method, cdpParams || {});
  return result;
}

// --- Event forwarding ---

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (!source.tabId) return;
  sendToHost({
    type: 'event',
    tabId: source.tabId,
    method,
    params
  });
});

chrome.debugger.onDetach.addListener((source, reason) => {
  if (!source.tabId) return;
  attachedTabs.delete(source.tabId);
  sendToHost({
    type: 'event',
    tabId: source.tabId,
    method: 'chrome-tap.detached',
    params: { reason }
  });
});

// --- Popup communication ---

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'getStatus') {
    sendResponse({
      connected: hostReady,
      attachedTabs: Array.from(attachedTabs.keys())
    });
    return true;
  }
});

// --- Init ---

connectHost();
