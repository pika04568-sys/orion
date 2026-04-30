# Orion Browser

Orion is a lightweight desktop browser built with Electron. It pairs a clean, customizable shell with practical browsing features: tabs, profiles, bookmarks, history, downloads, reader mode, privacy controls, unpacked extensions, adblock rules, and an offline arcade fallback.

## Quick Start

If you just want to use Orion, download a pre-built release for your platform. Node.js and npm are only needed when modifying the source or building the app yourself.

## Development

### Prerequisites

- Node.js LTS
- npm, included with Node.js

### Setup And Local Run

```sh
npm install
npm start
```

### Tests

```sh
npm test
```

The test suite covers adblock behavior, privacy defaults, security helpers, reader mode extraction/session handling, offline routing and arcade rotation, localization, preload bridge scoping, and startup regressions.

## Building

Packaged output is written to `dist/`.

```sh
# Create an unpacked app directory
npm run pack

# Build using the default electron-builder target
npm run dist

# macOS DMG
npm run dist:mac

# Windows NSIS installer and portable builds for x64 and arm64
npm run dist:win
```

## Features

- Tabs with horizontal or vertical layouts, recently closed tab restore, reload and hard reload shortcuts, and quick tab switching.
- Profiles and incognito windows with separate browser state where appropriate.
- Bookmarks, a bookmark bar, and new-tab shortcuts.
- History and downloads sidebars, including range-based history clearing.
- Reader mode for extracting article-style pages into a focused reading surface.
- Search engine selection for address-bar queries, including Google, Bing, DuckDuckGo, Brave, StartPage, Yandex, Baidu, Yahoo, and Naver.
- Localization for English, French, German, and Japanese, with first-run language onboarding.
- Theme customization, accent colors, vertical tabs, and optional seconds in time widgets.
- Chrome-style unpacked extension loading through `chrome://extensions`, with extension permission inspection.
- Built-in adblock lists, cached list refreshes, per-list toggles, and custom filter rules.
- Privacy controls for HTTPS-Only Mode, anti-fingerprinting hardening, and DNS-over-HTTPS through Cloudflare secure DNS.
- Scoped internal pages for new tab, extensions, reader mode, and offline fallback.
- Offline arcade fallback with Snake, Tetris, and Pac-Man when navigation fails because the device is offline.
- Update checks through GitHub releases using Electron updater integration.

## Project Structure

- `main.js` runs the Electron main process, window and tab orchestration, sessions, permissions, updates, internal pages, and browser IPC.
- `renderer.js` drives the main browser UI, settings, panels, profiles, bookmarks, downloads, reader controls, and localization updates.
- `preload.js` exposes scoped bridges for trusted Orion pages.
- `adblock.js`, `browser-privacy.js`, and `browser-security.js` contain blocking, privacy, permission, and extension-safety helpers.
- `reader*.js` and `reader.html` power reader mode.
- `offline*.js` and `offline.html` power offline routing and arcade games.
- `localization.js` contains UI strings and platform-specific labels.
- `test/` contains the Node test suite.

## Credits

Initial build by Qwen.

Further development by Antigravity, Codex, and Cursor.

## License

This project is open source. Feel free to edit, improve, and submit pull requests.
