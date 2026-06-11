// Correlates request/response IDs between WS clients and the extension.
// Each WS client uses its own ID space. The router assigns internal IDs
// and maps responses back to the correct client + original ID.

const {
  ClientThrottle,
  FLUSH_MS,
  BACKPRESSURE_BYTES
} = require('./throttle');

class Router {
  constructor(sendToExtension) {
    this._sendToExtension = sendToExtension;
    this._nextId = 1;
    this._pending = new Map(); // internalId -> { ws, originalId }
    this._clients = new Set();
    this._subscriptions = new Map(); // ws -> Set<tabId> (for event routing)
    this._throttles = new Map(); // ws -> ClientThrottle (only when opted in)
    this._flushTimer = null;
  }

  addClient(ws) {
    this._clients.add(ws);
    this._subscriptions.set(ws, new Set());
    ws.on('close', () => this.removeClient(ws));
  }

  removeClient(ws) {
    this._clients.delete(ws);
    this._subscriptions.delete(ws);
    this._throttles.delete(ws);
    if (this._throttles.size === 0) this._stopFlushTimer();
    // Clean up pending requests for this client
    for (const [id, entry] of this._pending) {
      if (entry.ws === ws) this._pending.delete(id);
    }
  }

  // WS client -> extension
  handleClientMessage(ws, msg) {
    const internalId = this._nextId++;
    this._pending.set(internalId, { ws, originalId: msg.id });

    // Track tab subscriptions for event routing
    if (msg.method === 'chrome-tap.attach' && msg.params?.tabId) {
      this._subscriptions.get(ws)?.add(msg.params.tabId);
      this._applyThrottleConfig(ws, msg.params.eventThrottle);
    }
    if (msg.method === 'chrome-tap.detach' && msg.params?.tabId) {
      this._subscriptions.get(ws)?.delete(msg.params.tabId);
    }

    // eventThrottle is a chrome-tap concern; don't leak it to the extension/CDP.
    const params = this._stripThrottle(msg.params);

    this._sendToExtension({
      id: internalId,
      method: msg.method,
      params
    });
  }

  // Install (or clear) a per-client throttle from attach params. Passing an
  // empty/omitted config leaves the client on the raw firehose (the default).
  _applyThrottleConfig(ws, eventThrottle) {
    if (eventThrottle && typeof eventThrottle === 'object') {
      const throttle = new ClientThrottle(eventThrottle);
      if (throttle.hasLimits()) {
        this._throttles.set(ws, throttle);
        this._startFlushTimer();
        return;
      }
    }
    this._throttles.delete(ws);
    if (this._throttles.size === 0) this._stopFlushTimer();
  }

  _stripThrottle(params) {
    if (!params || typeof params !== 'object' || !('eventThrottle' in params)) {
      return params;
    }
    const { eventThrottle: _ignored, ...rest } = params;
    return rest;
  }

  // Extension -> WS client (response)
  handleExtensionResponse(msg) {
    const entry = this._pending.get(msg.id);
    if (!entry) return;
    this._pending.delete(msg.id);

    const response = { id: entry.originalId };
    if (msg.error) response.error = msg.error;
    else response.result = msg.result;

    try {
      entry.ws.send(JSON.stringify(response));
    } catch (_) {
      // Client disconnected
    }
  }

  // Extension -> all interested WS clients (event)
  handleExtensionEvent(msg) {
    const event = JSON.stringify(msg);
    const now = Date.now();
    for (const ws of this._clients) {
      const subs = this._subscriptions.get(ws);
      // Send if client is subscribed to this tab, or if no tabId (broadcast)
      if (msg.tabId && !subs?.has(msg.tabId)) continue;

      const throttle = this._throttles.get(ws);
      if (throttle) {
        // Drop when over the configured rate, or when the client's send
        // buffer is backed up (slow consumer). Either way it's counted and
        // surfaced via the next chrome-tap.throttled flush.
        if (ws.bufferedAmount > BACKPRESSURE_BYTES) {
          throttle.recordDrop(msg.method);
          continue;
        }
        if (!throttle.allow(msg.method, now)) continue;
      }

      try {
        ws.send(event);
      } catch (_) {
        // Client disconnected
      }
    }
  }

  // --- Throttle drop reporting ---

  _startFlushTimer() {
    if (this._flushTimer) return;
    this._flushTimer = setInterval(() => this._flushDropped(), FLUSH_MS);
    if (typeof this._flushTimer.unref === 'function') this._flushTimer.unref();
  }

  _stopFlushTimer() {
    if (!this._flushTimer) return;
    clearInterval(this._flushTimer);
    this._flushTimer = null;
  }

  _flushDropped() {
    for (const [ws, throttle] of this._throttles) {
      const dropped = throttle.drainDropped();
      if (!dropped) continue;
      const notice = JSON.stringify({
        type: 'event',
        method: 'chrome-tap.throttled',
        params: { dropped }
      });
      try {
        ws.send(notice);
      } catch (_) {
        // Client disconnected
      }
    }
  }
}

module.exports = { Router };
