// Launches headless Chrome and returns the CDP WebSocket URL.
// Bypasses the extension entirely — direct CDP connection.

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  process.env.CHROME_BIN
].filter(Boolean);

function findChrome() {
  for (const p of CHROME_PATHS) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('Chrome not found. Set CHROME_BIN env var.');
}

function launchChrome(opts = {}) {
  const chromePath = opts.chromePath || findChrome();
  const port = opts.debugPort || 0; // 0 = random
  const userDataDir = opts.userDataDir || path.join(os.tmpdir(), `chrome-tap-${process.pid}`);

  const args = [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-sync',
    '--disable-translate',
    '--metrics-recording-only',
    '--mute-audio',
    '--no-sandbox',
    'about:blank'
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn(chromePath, args, { stdio: ['pipe', 'pipe', 'pipe'] });

    let stderr = '';
    const timeout = setTimeout(() => {
      reject(new Error('Chrome launch timed out (10s)'));
      proc.kill();
    }, 10000);

    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      // Chrome prints: DevTools listening on ws://127.0.0.1:PORT/devtools/browser/GUID
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timeout);
        resolve({
          process: proc,
          wsUrl: match[1],
          userDataDir,
          kill: () => {
            proc.kill();
            // Clean up temp profile
            try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
          }
        });
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    proc.on('exit', (code) => {
      clearTimeout(timeout);
      if (code) reject(new Error(`Chrome exited with code ${code}: ${stderr}`));
    });
  });
}

module.exports = { launchChrome, findChrome };
