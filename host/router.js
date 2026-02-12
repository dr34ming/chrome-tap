// Correlates request/response IDs between WS clients and the extension.
// Each WS client uses its own ID space. The router assigns internal IDs
// and maps responses back to the correct client + original ID.

class Router {
  constructor(sendToExtension) {
    this._sendToExtension = sendToExtension;
    this._nextId = 1;
    this._pending = new Map(); // internalId -> { ws, originalId }
    this._clients = new Set();
    this._subscriptions = new Map(); // ws -> Set<tabId> (for event routing)
  }

  addClient(ws) {
    this._clients.add(ws);
    this._subscriptions.set(ws, new Set());
    ws.on('close', () => this.removeClient(ws));
  }

  removeClient(ws) {
    this._clients.delete(ws);
    this._subscriptions.delete(ws);
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
    }
    if (msg.method === 'chrome-tap.detach' && msg.params?.tabId) {
      this._subscriptions.get(ws)?.delete(msg.params.tabId);
    }

    this._sendToExtension({
      id: internalId,
      method: msg.method,
      params: msg.params
    });
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
    for (const ws of this._clients) {
      const subs = this._subscriptions.get(ws);
      // Send if client is subscribed to this tab, or if no tabId (broadcast)
      if (!msg.tabId || subs?.has(msg.tabId)) {
        try {
          ws.send(event);
        } catch (_) {
          // Client disconnected
        }
      }
    }
  }
}

module.exports = { Router };
