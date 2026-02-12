#!/usr/bin/env node

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.CHROME_TAP_PORT, 10) || 9867;
const TOKEN_PATH = path.join(process.env.HOME, '.chrome-tap', 'token');

// --- WS client to chrome-tap host ---

let ws = null;
let wsReady = false;
let nextId = 1;
const pending = new Map();

function getToken() {
  try {
    return fs.readFileSync(TOKEN_PATH, 'utf8').trim();
  } catch {
    throw new Error(`Cannot read token from ${TOKEN_PATH}. Is chrome-tap installed?`);
  }
}

function ensureConnection() {
  return new Promise((resolve, reject) => {
    if (ws && wsReady) return resolve();

    const token = getToken();
    ws = new WebSocket(`ws://127.0.0.1:${PORT}?token=${token}`);

    ws.on('open', () => {
      wsReady = true;
      resolve();
    });

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      if (typeof msg.id !== 'undefined' && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
      // Events are dropped in MCP mode (no streaming support)
    });

    ws.on('close', () => {
      wsReady = false;
      ws = null;
      // Reject all pending
      for (const [, { reject }] of pending) {
        reject(new Error('WebSocket closed'));
      }
      pending.clear();
    });

    ws.on('error', (err) => {
      wsReady = false;
      reject(err);
    });
  });
}

function sendCommand(method, params) {
  return new Promise(async (resolve, reject) => {
    try {
      await ensureConnection();
    } catch (err) {
      return reject(err);
    }

    const id = nextId++;
    pending.set(id, { resolve, reject });

    const msg = { id, method };
    if (params) msg.params = params;

    ws.send(JSON.stringify(msg));

    // Timeout after 30s
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error('Request timed out'));
      }
    }, 30000);
  });
}

// --- MCP server ---

const TOOLS = [
  {
    name: 'list_targets',
    description: 'List all Chrome tabs available as debugger targets',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'attach',
    description: 'Attach the debugger to a Chrome tab',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: 'Tab ID to attach to' }
      },
      required: ['tabId']
    }
  },
  {
    name: 'detach',
    description: 'Detach the debugger from a Chrome tab',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: 'Tab ID to detach from' }
      },
      required: ['tabId']
    }
  },
  {
    name: 'cdp_send',
    description: 'Send a Chrome DevTools Protocol command to an attached tab. The method is any CDP method (e.g. Runtime.evaluate, DOM.getDocument, Network.enable). cdpParams are passed directly to the CDP method.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: 'Tab ID (must be attached first)' },
        method: { type: 'string', description: 'CDP method (e.g. Runtime.evaluate)' },
        cdpParams: { type: 'object', description: 'Parameters for the CDP method' }
      },
      required: ['tabId', 'method']
    }
  }
];

const server = new Server(
  { name: 'chrome-tap', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result;

    switch (name) {
      case 'list_targets':
        result = await sendCommand('chrome-tap.listTargets');
        break;
      case 'attach':
        result = await sendCommand('chrome-tap.attach', { tabId: args.tabId });
        break;
      case 'detach':
        result = await sendCommand('chrome-tap.detach', { tabId: args.tabId });
        break;
      case 'cdp_send':
        result = await sendCommand(args.method, {
          tabId: args.tabId,
          cdpParams: args.cdpParams || {}
        });
        break;
      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true
        };
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
    };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Error: ${err.message}` }],
      isError: true
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('[chrome-tap-mcp] MCP server running\n');
}

main().catch((err) => {
  process.stderr.write(`[chrome-tap-mcp] Fatal: ${err.message}\n`);
  process.exit(1);
});
