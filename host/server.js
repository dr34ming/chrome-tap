const { WebSocketServer } = require('ws');
const { URL } = require('url');
const { validateToken } = require('./auth');

function createServer(port, onConnection) {
  const wss = new WebSocketServer({
    host: '127.0.0.1',
    port,
    verifyClient: ({ req }, cb) => {
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
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

  return wss;
}

module.exports = { createServer };
