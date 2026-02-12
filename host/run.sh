#!/bin/bash
# Shell wrapper for chrome-tap native messaging host.
# Chrome strips PATH when launching native hosts, so we need to find node ourselves.

DIR="$(cd "$(dirname "$0")" && pwd)"

# Try common node locations
for candidate in \
  "$HOME/.asdf/shims/node" \
  "$HOME/.nvm/current/bin/node" \
  "/opt/homebrew/bin/node" \
  "/usr/local/bin/node" \
  "/usr/bin/node"; do
  if [ -x "$candidate" ]; then
    exec "$candidate" "$DIR/index.js"
  fi
done

# Last resort: if node is somehow in PATH
if command -v node &>/dev/null; then
  exec node "$DIR/index.js"
fi

echo '{"error":"node not found"}' >&2
exit 1
