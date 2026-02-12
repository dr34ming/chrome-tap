const { WebSocketServer } = require('ws');
const { URL } = require('url');
const { validateToken } = require('./auth');

function createServer(port, onConnection, opts = {}) {
  const host = opts.host || process.env.CHROME_TAP_HOST || '127.0.0.1';

  const wss = new WebSocketServer({
    host,
    port,
    verifyClient: ({ req }, cb) => {
      // Allowlist check (if configured)
      if (opts.allowlist?.length) {
        const remote = req.socket.remoteAddress;
        const allowed = opts.allowlist.some((a) => remote === a || remote === `::ffff:${a}`);
        if (!allowed) {
          cb(false, 403, 'Forbidden');
          return;
        }
      }

      const url = new URL(req.url, `http://${host}:${port}`);
      const token = url.searchParams.get('token');
      if (!token || !validateToken(token)) {
        cb(false, 401, 'Unauthorized');
        return;
      }
      cb(true);
    }
  });

  wss.on('connection', (ws, req) => {
    onConnection(ws, req);
  });

  wss.on('error', (err) => {
    process.stderr.write(`[chrome-tap] WS error: ${err.message}\n`);
  });

  return { wss, host };
}

module.exports = { createServer };
