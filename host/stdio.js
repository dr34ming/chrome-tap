// Native messaging protocol: length-prefixed JSON on stdin/stdout
// Chrome sends/expects: [4-byte LE uint32 length][JSON payload]

const { EventEmitter } = require('events');

class NativeMessaging extends EventEmitter {
  constructor() {
    super();
    this._buffer = Buffer.alloc(0);
    this._reading = false;
  }

  start() {
    process.stdin.on('readable', () => this._onReadable());
    process.stdin.on('end', () => this.emit('disconnect'));
    process.stdin.on('error', (err) => this.emit('error', err));
  }

  _onReadable() {
    if (this._reading) return;
    this._reading = true;

    let chunk;
    while ((chunk = process.stdin.read()) !== null) {
      this._buffer = Buffer.concat([this._buffer, chunk]);
    }

    while (this._buffer.length >= 4) {
      const msgLen = this._buffer.readUInt32LE(0);
      if (msgLen > 1024 * 1024) {
        this.emit('error', new Error(`Message too large: ${msgLen} bytes`));
        this._buffer = Buffer.alloc(0);
        break;
      }
      if (this._buffer.length < 4 + msgLen) break;

      const json = this._buffer.slice(4, 4 + msgLen).toString('utf8');
      this._buffer = this._buffer.slice(4 + msgLen);

      try {
        this.emit('message', JSON.parse(json));
      } catch (err) {
        this.emit('error', new Error(`Invalid JSON from extension: ${err.message}`));
      }
    }

    this._reading = false;
  }

  send(obj) {
    const json = JSON.stringify(obj);
    const buf = Buffer.alloc(4 + Buffer.byteLength(json));
    buf.writeUInt32LE(Buffer.byteLength(json), 0);
    buf.write(json, 4);
    process.stdout.write(buf);
  }
}

module.exports = { NativeMessaging };
