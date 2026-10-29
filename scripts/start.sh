#!/bin/bash
# CloudCoder launcher (macOS).
#   ./scripts/start.sh             -> build web (if needed) and start the server
#   ./scripts/start.sh --rebuild   -> force rebuild of the web app first
#   ./scripts/start.sh --install   -> register a LaunchAgent that starts CloudCoder at login
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/com.mykolasruth.cloudcoder.plist"

if [[ "${1:-}" == "--install" ]]; then
  mkdir -p "$HOME/Library/LaunchAgents" "$ROOT/logs"
  # CLOUDCODER_ALLOWED_LOGINS=you@github ./scripts/start.sh --install
  # bakes the Tailscale login allowlist into the agent.
  ENV_XML=""
  if [[ -n "${CLOUDCODER_ALLOWED_LOGINS:-}" ]]; then
    ENV_XML="<key>EnvironmentVariables</key><dict><key>CLOUDCODER_ALLOWED_LOGINS</key><string>$CLOUDCODER_ALLOWED_LOGINS</string></dict>"
  fi
  cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.mykolasruth.cloudcoder</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$ROOT/scripts/start.sh</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>StandardOutPath</key><string>$ROOT/logs/cloudcoder.log</string>
  <key>StandardErrorPath</key><string>$ROOT/logs/cloudcoder.log</string>
  $ENV_XML
</dict></plist>
PLIST
  launchctl unload "$PLIST" 2>/dev/null || true
  launchctl load "$PLIST"
  echo "LaunchAgent installed and started (com.mykolasruth.cloudcoder)."
  echo "Logs: $ROOT/logs/cloudcoder.log"
  exit 0
fi

cd "$ROOT"

if [[ "${1:-}" == "--rebuild" || ! -f "$ROOT/web/dist/index.html" ]]; then
  echo "Building web app..."
  npm run build --workspace web
fi

if [[ ! -f "$ROOT/server/dist/index.js" ]]; then
  echo "Building server..."
  npm run build --workspace server
fi

echo "Starting CloudCoder server on ${CLOUDCODER_HOST:-127.0.0.1}:${CLOUDCODER_PORT:-4060}..."
exec node server/dist/index.js
