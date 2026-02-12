const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TOKEN_DIR = path.join(process.env.HOME, '.chrome-tap');
const TOKEN_PATH = path.join(TOKEN_DIR, 'token');

function ensureToken() {
  if (!fs.existsSync(TOKEN_DIR)) {
    fs.mkdirSync(TOKEN_DIR, { mode: 0o700 });
  }

  if (fs.existsSync(TOKEN_PATH)) {
    return fs.readFileSync(TOKEN_PATH, 'utf8').trim();
  }

  const token = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(TOKEN_PATH, token + '\n', { mode: 0o600 });
  return token;
}

function validateToken(candidate) {
  if (!fs.existsSync(TOKEN_PATH)) return false;
  const stored = fs.readFileSync(TOKEN_PATH, 'utf8').trim();
  return crypto.timingSafeEqual(
    Buffer.from(candidate),
    Buffer.from(stored)
  );
}

module.exports = { ensureToken, validateToken, TOKEN_PATH };
