# Orion Browser

Orion is a lightweight desktop browser built with Electron. It pairs a clean, customizable shell with practical browsing features: tabs, profiles, bookmarks, history, downloads, reader mode, privacy controls, managed and unpacked extensions, and an offline arcade fallback.

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
npm run test:electron
```

The test suite covers managed uBlock Origin Lite provisioning and policy, privacy defaults, security helpers, reader mode extraction/session handling, offline routing and arcade rotation, localization, preload bridge scoping, and startup regressions.

### Performance gates

Orion ships deterministic localhost performance harnesses for both desktop implementations. Each command builds the relevant release runtime, collects 20 samples by default, and reports p50/p95 measurements against the macOS budgets.

```sh
npm run perf:electron
npm run perf:swift
npm run perf
```

`perf` runs both harnesses. The Electron harness stages its matching Electron runtime outside cloud-synced project storage before launching; the Swift harness uses SwiftPM and retries with the native build system only for the known property-list initialization failure.

### Native SwiftUI implementation

The macOS SwiftUI implementation lives in `SwiftUIApp/` and can be built and tested independently:

```sh
swift build --package-path SwiftUIApp
swift test --package-path SwiftUIApp
```

If the installed SwiftPM toolchain reports its known property-list initialization error, use `--build-system native` for that invocation.

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
- An optional automatic RAM budget, sized to half of installed memory, that unloads background tabs with the highest observed memory use and restores them on selection while protecting active and audible tabs.
- Chrome Web Store installation support plus unpacked extension loading through `chrome://extensions`, with extension permission inspection.
- Mandatory uBlock Origin Lite protection for every persistent Electron profile, installed and updated from the Chrome Web Store. Web navigation stays blocked until the managed extension is ready; its popup and options remain available.
- Memory-only incognito sessions do not load extensions; this policy applies to normal persistent Electron profiles.
- Privacy controls for HTTPS-Only Mode, anti-fingerprinting hardening, and DNS-over-HTTPS through Cloudflare secure DNS.
- Scoped internal pages for new tab, extensions, reader mode, and offline fallback.
- Offline arcade fallback with Snake, Tetris, and Pac-Man when navigation fails because the device is offline.
- Update checks through GitHub releases using Electron updater integration.

## Project Structure

- `main.js` runs the Electron main process, window and tab orchestration, sessions, permissions, updates, internal pages, and browser IPC.
- `renderer.js` drives the main browser UI, settings, panels, profiles, bookmarks, downloads, reader controls, required-extension status, and localization updates.
- `preload.js` exposes scoped bridges for trusted Orion pages.
- `extension-manager.js` provisions uBlock Origin Lite per profile, configures Web Store updates, reconciles unloads, and enforces managed-extension policy.
- `browser-privacy.js` and `browser-security.js` contain privacy, permission, and extension-safety helpers.
- `reader*.js` and `reader.html` power reader mode.
- `offline*.js` and `offline.html` power offline routing and arcade games.
- `localization.js` contains UI strings and platform-specific labels.
- `test/` contains the Node test suite.

## Credits

Initial build by Qwen.

Further development by Antigravity, Codex, and Cursor.

## License

Orion is distributed under GPL-3.0-compatible terms because Chrome extension API support is provided by `electron-chrome-extensions`.
