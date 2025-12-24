#!/bin/bash
# AIGrabber Native Messaging Host
# This script launches the Electron app in native messaging mode

APP_DIR="$(dirname "$0")/.."
ELECTRON_APP="$APP_DIR/release/mac-arm64/AIGrabber.app/Contents/MacOS/AIGrabber"

# For development, use electron directly
if [ ! -f "$ELECTRON_APP" ]; then
  cd "$APP_DIR"
  exec npx electron . --native-messaging
else
  exec "$ELECTRON_APP" --native-messaging
fi
