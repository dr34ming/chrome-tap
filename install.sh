#!/bin/bash
set -euo pipefail

# Registers the chrome-tap native messaging host with Chrome.
# Usage: ./install.sh <extension-id>
#   or:  ./install.sh  (will prompt)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOST_DIR="$SCRIPT_DIR/host"
HOST_SCRIPT="$HOST_DIR/run.sh"
HOST_NAME="com.chrometap.host"

# macOS native messaging host location
MANIFEST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"

if [ $# -ge 1 ]; then
  EXT_ID="$1"
else
  read -rp "Extension ID (from chrome://extensions): " EXT_ID
fi

if [ -z "$EXT_ID" ]; then
  echo "Error: extension ID required" >&2
  exit 1
fi

# Ensure host script is executable
chmod +x "$HOST_SCRIPT"

# Install npm deps if needed
if [ ! -d "$HOST_DIR/node_modules" ]; then
  echo "Installing host dependencies..."
  (cd "$HOST_DIR" && npm install --production)
fi

# Create manifest directory
mkdir -p "$MANIFEST_DIR"

# Write native messaging host manifest
cat > "$MANIFEST_DIR/$HOST_NAME.json" << EOF
{
  "name": "$HOST_NAME",
  "description": "chrome-tap native messaging host",
  "path": "$HOST_SCRIPT",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXT_ID/"]
}
EOF

echo "Installed native messaging host manifest:"
echo "  $MANIFEST_DIR/$HOST_NAME.json"
echo "  Extension ID: $EXT_ID"
echo "  Host path: $HOST_SCRIPT"
echo ""
echo "Next steps:"
echo "  1. Load extension from $SCRIPT_DIR/extension in chrome://extensions"
echo "  2. Token will be at ~/.chrome-tap/token"
echo '  3. Test: websocat "ws://127.0.0.1:9867?token=$(cat ~/.chrome-tap/token)"'
