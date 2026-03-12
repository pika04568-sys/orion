# Orion Browser

A lightweight desktop browser built with Electron. Orion offers a clean interface with essential features for everyday browsing.

## Features

- **Tabs** — Multiple tabs with optional vertical tab layout
- **Bookmarks** — Save and organize favorites with a bookmark bar
- **History** — Browse and search browsing history
- **Downloads** — Track and manage downloads
- **Adblock** — Custom block rules to remove ads and trackers
- **Extensions** — Chrome extension support via `chrome://extensions`
- **Themes** — Customize accent colors, vertical tabs, and more
- **Search** — Choose your default search engine (Google, DuckDuckGo, Brave, etc.)
- **Auto-updates** — Built-in update checker

## Installation

### Pre-built Windows (.exe)

Orion is packaged for Windows. Download the latest release and run:

- **Installer** — `Orion Setup x.x.x.exe` (NSIS installer)
- **Portable** — `Orion x.x.x.exe` (no install required)

## Development

```bash
npm install
npm start
```

## Building

```bash
# Build for current platform
npm run dist

# Windows (NSIS installer + portable .exe)
npm run dist:win

# macOS (DMG)
npm run dist:mac

# Unpacked build (no installer)
npm run pack
```

Outputs go to the `dist/` directory.

## Credits

- Initial build by **qwen**
- Further development by **Antigravity** and **Codex**
- Author: [kenokayasu](https://github.com/kenokayasu)

## License

Feel free to edit and improve the code. Contributions are welcome.
