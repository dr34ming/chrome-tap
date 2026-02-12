// Direct CDP client — connects to Chrome's browser-level WebSocket.
// Uses Target domain to manage tabs, flattened sessions for per-tab commands.
// Provides same interface as the extension bridge.

const WebSocket = require('ws');

class CdpClient {
  constructor(browserWsUrl) {
    this._browserWsUrl = browserWsUrl;
    this._ws = null;
    this._nextId = 1;
    this._pending = new Map();
    this._sessions = new Map(); // tabId -> sessionId
    this._targets = new Map();  // tabId -> targetInfo
    this._onEvent = null;       // callback for CDP events
  }

  connect() {
    return new Promise((resolve, reject) => {
      this._ws = new WebSocket(this._browserWsUrl);

      this._ws.on('open', () => resolve());
      this._ws.on('error', reject);

      this._ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }

        // Response to a command
        if (typeof msg.id !== 'undefined' && this._pending.has(msg.id)) {
          const { resolve, reject } = this._pending.get(msg.id);
          this._pending.delete(msg.id);
          if (msg.error) reject(msg.error);
          else resolve(msg.result);
          return;
        }

        // Event from a session (tab)
        if (msg.method && msg.sessionId && this._onEvent) {
          const tabId = this._tabIdForSession(msg.sessionId);
          if (tabId !== null) {
            this._onEvent({
              type: 'event',
              tabId,
              method: msg.method,
              params: msg.params
            });
          }
        }

        // Browser-level events (Target.targetCreated, etc.) — ignore for now
      });

      this._ws.on('close', () => {
        for (const [, { reject }] of this._pending) {
          reject({ message: 'CDP connection closed' });
        }
        this._pending.clear();
      });
    });
  }

  _tabIdForSession(sessionId) {
    for (const [tabId, sid] of this._sessions) {
      if (sid === sessionId) return tabId;
    }
    return null;
  }

  _send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = this._nextId++;
      this._pending.set(id, { resolve, reject });

      const msg = { id, method, params };
      if (sessionId) msg.sessionId = sessionId;

      this._ws.send(JSON.stringify(msg));

      setTimeout(() => {
        if (this._pending.has(id)) {
          this._pending.delete(id);
          reject({ message: `CDP timeout: ${method}` });
        }
      }, 30000);
    });
  }

  async listTargets() {
    const { targetInfos } = await this._send('Target.getTargets');
    const targets = targetInfos
      .filter((t) => t.type === 'page')
      .map((t) => ({
        tabId: this._tabIdFromTargetId(t.targetId),
        targetId: t.targetId,
        title: t.title,
        url: t.url,
        attached: this._sessions.has(this._tabIdFromTargetId(t.targetId))
      }));
    return { targets };
  }

  // Map targetId to a stable numeric "tabId" for API compatibility
  _tabIdFromTargetId(targetId) {
    for (const [tabId, info] of this._targets) {
      if (info.targetId === targetId) return tabId;
    }
    // Assign new numeric ID
    const tabId = this._targets.size + 1;
    this._targets.set(tabId, { targetId });
    return tabId;
  }

  _targetIdFromTabId(tabId) {
    const info = this._targets.get(tabId);
    if (!info) throw { message: `Unknown tabId ${tabId}` };
    return info.targetId;
  }

  async attach(tabId) {
    if (this._sessions.has(tabId)) return { status: 'already_attached' };
    const targetId = this._targetIdFromTabId(tabId);
    const { sessionId } = await this._send('Target.attachToTarget', {
      targetId,
      flatten: true
    });
    this._sessions.set(tabId, sessionId);
    return { status: 'attached' };
  }

  async detach(tabId) {
    const sessionId = this._sessions.get(tabId);
    if (!sessionId) return { status: 'not_attached' };
    await this._send('Target.detachFromTarget', { sessionId });
    this._sessions.delete(tabId);
    return { status: 'detached' };
  }

  async sendCommand(method, tabId, cdpParams = {}) {
    const sessionId = this._sessions.get(tabId);
    if (!sessionId) throw { message: `Tab ${tabId} not attached` };
    return this._send(method, cdpParams, sessionId);
  }

  async createTab(url = 'about:blank') {
    const { targetId } = await this._send('Target.createTarget', { url });
    const tabId = this._tabIdFromTargetId(targetId);
    return { tabId, targetId };
  }

  close() {
    if (this._ws) this._ws.close();
  }
}

module.exports = { CdpClient };
