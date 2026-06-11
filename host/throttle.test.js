const { test } = require('node:test');
const assert = require('node:assert/strict');

const { ClientThrottle } = require('./throttle');
const { Router } = require('./router');

// --- ClientThrottle ---

test('no config => unlimited firehose', () => {
  const t = new ClientThrottle();
  assert.equal(t.hasLimits(), false);
  for (let i = 0; i < 1000; i++) {
    assert.equal(t.allow('Console.messageAdded', 0), true);
  }
  assert.equal(t.drainDropped(), null);
});

test('per-method cap drops within the window and reports counts', () => {
  const t = new ClientThrottle({ 'Console.messageAdded': 3 });
  const now = 1000;
  const sent = [];
  for (let i = 0; i < 10; i++) {
    sent.push(t.allow('Console.messageAdded', now));
  }
  assert.equal(sent.filter(Boolean).length, 3);
  assert.deepEqual(t.drainDropped(), { 'Console.messageAdded': 7 });
  // draining resets
  assert.equal(t.drainDropped(), null);
});

test('window resets after WINDOW_MS', () => {
  const t = new ClientThrottle({ 'Network.responseReceived': 2 });
  assert.equal(t.allow('Network.responseReceived', 0), true);
  assert.equal(t.allow('Network.responseReceived', 0), true);
  assert.equal(t.allow('Network.responseReceived', 0), false);
  // next window
  assert.equal(t.allow('Network.responseReceived', 1000), true);
});

test('wildcard applies to unlisted methods, explicit overrides wildcard', () => {
  const t = new ClientThrottle({ '*': 1, 'Console.messageAdded': 5 });
  // wildcard: 1/window for an unlisted method
  assert.equal(t.allow('Network.dataReceived', 0), true);
  assert.equal(t.allow('Network.dataReceived', 0), false);
  // explicit override: 5/window
  for (let i = 0; i < 5; i++) {
    assert.equal(t.allow('Console.messageAdded', 0), true);
  }
  assert.equal(t.allow('Console.messageAdded', 0), false);
});

test('zero limit drops everything', () => {
  const t = new ClientThrottle({ 'Console.messageAdded': 0 });
  assert.equal(t.allow('Console.messageAdded', 0), false);
  assert.deepEqual(t.drainDropped(), { 'Console.messageAdded': 1 });
});

// --- Router integration ---

// Minimal fake WS that records frames and reports a controllable bufferedAmount.
function fakeWs() {
  return {
    sent: [],
    bufferedAmount: 0,
    _handlers: {},
    on(ev, fn) { this._handlers[ev] = fn; },
    send(data) { this.sent.push(JSON.parse(data)); }
  };
}

function events(ws) {
  return ws.sent.filter((m) => m.type === 'event' && m.method !== 'chrome-tap.throttled');
}
function throttledNotices(ws) {
  return ws.sent.filter((m) => m.method === 'chrome-tap.throttled');
}

test('attach without eventThrottle leaves client unthrottled', () => {
  const router = new Router(() => {});
  const ws = fakeWs();
  router.addClient(ws);
  router.handleClientMessage(ws, { id: 1, method: 'chrome-tap.attach', params: { tabId: 7 } });

  for (let i = 0; i < 50; i++) {
    router.handleExtensionEvent({ type: 'event', tabId: 7, method: 'Console.messageAdded', params: {} });
  }
  assert.equal(events(ws).length, 50);
});

test('attach strips eventThrottle before forwarding to extension', () => {
  const forwarded = [];
  const router = new Router((m) => forwarded.push(m));
  const ws = fakeWs();
  router.addClient(ws);
  router.handleClientMessage(ws, {
    id: 1,
    method: 'chrome-tap.attach',
    params: { tabId: 7, eventThrottle: { 'Console.messageAdded': 5 } }
  });
  assert.equal('eventThrottle' in forwarded[0].params, false);
  assert.equal(forwarded[0].params.tabId, 7);
});

test('throttled client only receives up to the cap and gets a drop notice', () => {
  const router = new Router(() => {});
  const ws = fakeWs();
  router.addClient(ws);
  router.handleClientMessage(ws, {
    id: 1,
    method: 'chrome-tap.attach',
    params: { tabId: 7, eventThrottle: { 'Console.messageAdded': 5 } }
  });

  for (let i = 0; i < 20; i++) {
    router.handleExtensionEvent({ type: 'event', tabId: 7, method: 'Console.messageAdded', params: {} });
  }
  assert.equal(events(ws).length, 5);

  router._flushDropped();
  const notices = throttledNotices(ws);
  assert.equal(notices.length, 1);
  assert.deepEqual(notices[0].params.dropped, { 'Console.messageAdded': 15 });

  router.removeClient(ws);
});

test('backpressure drops events for a slow consumer', () => {
  const router = new Router(() => {});
  const ws = fakeWs();
  router.addClient(ws);
  router.handleClientMessage(ws, {
    id: 1,
    method: 'chrome-tap.attach',
    params: { tabId: 7, eventThrottle: { '*': 1000 } }
  });

  ws.bufferedAmount = 8 * 1024 * 1024; // over BACKPRESSURE_BYTES
  for (let i = 0; i < 10; i++) {
    router.handleExtensionEvent({ type: 'event', tabId: 7, method: 'Network.dataReceived', params: {} });
  }
  assert.equal(events(ws).length, 0);

  router._flushDropped();
  assert.deepEqual(throttledNotices(ws)[0].params.dropped, { 'Network.dataReceived': 10 });

  router.removeClient(ws);
});

test('throttle does not affect other clients on the same tab', () => {
  const router = new Router(() => {});
  const slow = fakeWs();
  const fast = fakeWs();
  router.addClient(slow);
  router.addClient(fast);
  router.handleClientMessage(slow, {
    id: 1, method: 'chrome-tap.attach', params: { tabId: 7, eventThrottle: { 'Console.messageAdded': 2 } }
  });
  router.handleClientMessage(fast, {
    id: 1, method: 'chrome-tap.attach', params: { tabId: 7 }
  });

  for (let i = 0; i < 10; i++) {
    router.handleExtensionEvent({ type: 'event', tabId: 7, method: 'Console.messageAdded', params: {} });
  }
  assert.equal(events(slow).length, 2);
  assert.equal(events(fast).length, 10);
});

test('removeClient stops the flush timer when no throttles remain', () => {
  const router = new Router(() => {});
  const ws = fakeWs();
  router.addClient(ws);
  router.handleClientMessage(ws, {
    id: 1, method: 'chrome-tap.attach', params: { tabId: 7, eventThrottle: { '*': 10 } }
  });
  assert.notEqual(router._flushTimer, null);
  router.removeClient(ws);
  assert.equal(router._flushTimer, null);
});
