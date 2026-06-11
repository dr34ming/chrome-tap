// Per-client event throttling for high-volume CDP domains.
//
// Throttling is opt-in: clients pass `eventThrottle` in chrome-tap.attach
// params, mapping a CDP event method (or "*" wildcard) to a max events/sec.
// Events over the cap inside a 1s sliding window are dropped (newest first).
// Dropped counts are surfaced to the client via chrome-tap.throttled events
// flushed on an interval, so no loss is silent.
//
//   chrome-tap.attach { tabId, eventThrottle: { "Console.messageAdded": 50, "*": 200 } }
//
// A separate backpressure guard drops events for any client whose WS send
// buffer grows past BACKPRESSURE_BYTES, regardless of throttle config.

const WINDOW_MS = 1000;
const FLUSH_MS = 100;
const BACKPRESSURE_BYTES = 4 * 1024 * 1024;

class ClientThrottle {
  // config: { method -> maxPerSec }, may include "*" wildcard. Empty => no limits.
  constructor(config = {}) {
    this._config = config;
    this._counts = new Map(); // method -> { windowStart, count }
    this._dropped = new Map(); // method -> dropped count since last flush
  }

  hasLimits() {
    return Object.keys(this._config).length > 0;
  }

  _limitFor(method) {
    if (Object.prototype.hasOwnProperty.call(this._config, method)) {
      return this._config[method];
    }
    if (Object.prototype.hasOwnProperty.call(this._config, '*')) {
      return this._config['*'];
    }
    return null; // unlimited
  }

  // Returns true if the event should be sent, false if it should be dropped.
  allow(method, now = Date.now()) {
    const limit = this._limitFor(method);
    if (limit === null) return true;
    if (limit <= 0) {
      this._dropped.set(method, (this._dropped.get(method) || 0) + 1);
      return false;
    }

    let bucket = this._counts.get(method);
    if (!bucket || now - bucket.windowStart >= WINDOW_MS) {
      bucket = { windowStart: now, count: 0 };
      this._counts.set(method, bucket);
    }

    if (bucket.count < limit) {
      bucket.count++;
      return true;
    }

    this._dropped.set(method, (this._dropped.get(method) || 0) + 1);
    return false;
  }

  // Record a drop not attributable to a rate window (e.g. backpressure).
  recordDrop(method, n = 1) {
    this._dropped.set(method, (this._dropped.get(method) || 0) + n);
  }

  // Returns { method -> droppedCount } accumulated since the last flush,
  // and resets the counters. Returns null when nothing was dropped.
  drainDropped() {
    if (this._dropped.size === 0) return null;
    const out = {};
    for (const [method, count] of this._dropped) out[method] = count;
    this._dropped.clear();
    return out;
  }
}

module.exports = { ClientThrottle, WINDOW_MS, FLUSH_MS, BACKPRESSURE_BYTES };
