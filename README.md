# chrome-tap

Chrome DevTools Protocol over local WebSocket. No AI, no opinions — just your browser as an API.

```
Chrome Extension (MV3)           Native Host (Node.js)         Any Client
┌──────────────────┐    stdio    ┌──────────────────┐   WS    ┌──────────┐
│ chrome.debugger  │◄──────────►│ WebSocket server │◄────────►│ scripts  │
│ attach/detach    │  native     │ localhost:9867   │  auth    │ MCP      │
│ sendCommand      │  messaging  │ token auth       │  token   │ websocat │
│ onEvent forward  │            │ message routing  │         │ etc      │
└──────────────────┘            └──────────────────┘         └──────────┘
```

## Install

```bash
# 1. Load extension/  as unpacked in chrome://extensions (enable developer mode)
# 2. Copy the extension ID, then:
./install.sh <extension-id>

# 3. Restart Chrome (or disable/re-enable the extension)
```

## Test

```bash
# Get your token
cat ~/.chrome-tap/token

# Connect with websocat
websocat "ws://127.0.0.1:9867?token=$(cat ~/.chrome-tap/token)"

# List tabs
{"id":1,"method":"chrome-tap.listTargets"}

# Attach to a tab
{"id":2,"method":"chrome-tap.attach","params":{"tabId":123}}

# Run JS on the tab
{"id":3,"method":"Runtime.evaluate","params":{"tabId":123,"cdpParams":{"expression":"document.title"}}}

# Enable console events
{"id":4,"method":"Console.enable","params":{"tabId":123,"cdpParams":{}}}
```

## MCP

Add to Claude Code `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "chrome-tap": {
      "command": "node",
      "args": ["/path/to/chrome-tap/mcp/index.js"]
    }
  }
}
```

Tools: `list_targets`, `attach`, `detach`, `cdp_send`

## Wire Protocol

**Commands** from client:
```json
{"id": 1, "method": "Runtime.evaluate", "params": {"tabId": 123, "cdpParams": {"expression": "1+1"}}}
```

**Responses** from host:
```json
{"id": 1, "result": {"result": {"type": "number", "value": 2}}}
```

**Events** from host (after enabling a CDP domain):
```json
{"type": "event", "tabId": 123, "method": "Console.messageAdded", "params": {...}}
```

Meta commands use `chrome-tap.*` namespace. Everything else passes through as raw CDP.

## Config

| Env var | Default | Description |
|---------|---------|-------------|
| `CHROME_TAP_PORT` | `9867` | WebSocket server port |

Token lives at `~/.chrome-tap/token` (created on first run, `0600` perms).

## License

MIT
