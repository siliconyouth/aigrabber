#!/bin/bash
# Register AIGrabber Native Messaging Host for Chrome and Firefox

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
HOST_DIR="$PROJECT_DIR/packages/app/native-host"
HOST_MANIFEST="$HOST_DIR/com.aigrabber.app.json"

echo "AIGrabber Native Messaging Host Registration"
echo "============================================="
echo ""

# Update manifest with absolute path
HOST_SCRIPT="$HOST_DIR/aigrabber-host.sh"
cat > "$HOST_MANIFEST" << EOF
{
  "name": "com.aigrabber.app",
  "description": "AIGrabber Native Messaging Host",
  "path": "$HOST_SCRIPT",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://*/"
  ]
}
EOF

echo "✓ Updated manifest with absolute path: $HOST_SCRIPT"

# Detect OS
case "$(uname -s)" in
  Darwin)
    # macOS
    CHROME_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
    FIREFOX_DIR="$HOME/Library/Application Support/Mozilla/NativeMessagingHosts"
    ;;
  Linux)
    CHROME_DIR="$HOME/.config/google-chrome/NativeMessagingHosts"
    FIREFOX_DIR="$HOME/.mozilla/native-messaging-hosts"
    ;;
  *)
    echo "Unsupported OS. Please register manually."
    exit 1
    ;;
esac

# Register for Chrome
echo ""
echo "Registering for Chrome..."
mkdir -p "$CHROME_DIR"
cp "$HOST_MANIFEST" "$CHROME_DIR/com.aigrabber.app.json"
echo "✓ Chrome: $CHROME_DIR/com.aigrabber.app.json"

# Register for Firefox (needs different allowed_extensions format)
echo ""
echo "Registering for Firefox..."
mkdir -p "$FIREFOX_DIR"
cat > "$FIREFOX_DIR/com.aigrabber.app.json" << EOF
{
  "name": "com.aigrabber.app",
  "description": "AIGrabber Native Messaging Host",
  "path": "$HOST_SCRIPT",
  "type": "stdio",
  "allowed_extensions": [
    "aigrabber@example.com"
  ]
}
EOF
echo "✓ Firefox: $FIREFOX_DIR/com.aigrabber.app.json"

echo ""
echo "============================================="
echo "Registration complete!"
echo ""
echo "Next steps:"
echo "1. Load the extension in Chrome: chrome://extensions"
echo "2. Click 'Load unpacked' and select:"
echo "   $PROJECT_DIR/packages/extension/dist"
echo ""
