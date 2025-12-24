# AIGrabber

A video downloader with browser extension and desktop companion app. Supports HLS and DASH streams from websites.

## Features

- **Browser Extension** - Detects video streams on web pages (Chrome + Firefox)
- **Stream Detection** - Automatically identifies HLS (.m3u8) and DASH (.mpd) streams
- **Quality Selection** - Choose from available resolutions (1080p, 720p, etc.)
- **Desktop App** - Electron-based companion app for downloading
- **FFmpeg Integration** - Merges segments and converts formats
- **DRM Detection** - Identifies protected content (cannot download DRM streams)

## Project Structure

```
aigrabber/
├── packages/
│   ├── extension/     # Browser extension (Chrome/Firefox)
│   ├── app/           # Electron companion app
│   └── shared/        # Shared types and parsers
├── package.json
└── pnpm-workspace.yaml
```

## Prerequisites

- Node.js 18+
- pnpm 8+
- FFmpeg (optional, for segment merging)

## Installation

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build
```

## Development

```bash
# Run all packages in dev mode
pnpm dev

# Build extension only
pnpm build:extension

# Build desktop app only
pnpm build:app
```

## Installing the Extension

### Chrome
1. Open `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select `packages/extension/dist`

### Firefox
1. Open `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on"
3. Select `packages/extension/dist-firefox/manifest.json`

## How It Works

1. **Detection**: The browser extension intercepts network requests to detect video streams
2. **Parsing**: Manifests (M3U8/MPD) are parsed to extract quality options
3. **Communication**: Extension communicates with desktop app via Native Messaging
4. **Download**: Desktop app downloads segments and merges with FFmpeg

## Supported Formats

| Format | Detection | Download |
|--------|-----------|----------|
| HLS (.m3u8) | ✅ | ✅ |
| DASH (.mpd) | ✅ | ✅ |
| Direct MP4 | ✅ | ✅ |
| DRM Protected | ✅ (detected) | ❌ (blocked) |

## Tech Stack

- **TypeScript** - Full stack type safety
- **React** - Extension popup and app UI
- **Vite** - Build tool
- **Electron** - Desktop app framework
- **pnpm** - Package manager with workspaces

## Legal Notice

This tool is designed for downloading **unprotected** video content only. It cannot and will not bypass DRM (Digital Rights Management) protection. Downloading copyrighted content without permission may violate applicable laws. Use responsibly.

## License

MIT
