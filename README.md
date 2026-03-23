Orion Browser

A lightweight desktop browser built with Electron. Orion offers a clean interface with essential features for everyday browsing.

🚀 Quick Start (For Users)

If you just want to use the browser, you do not need Node.js or npm. Simply download the pre-built binaries:

Windows (.exe)

Installer: Orion Setup x.x.x.exe (Standard installation)

Portable: Orion x.x.x.exe (Run directly without installing)

🛠️ Development (For Contributors)

The commands below are only necessary if you are looking to modify the source code or build the application from scratch.

Prerequisites

Node.js (LTS recommended)

npm (comes with Node.js)

Setup & Local Run

To test changes without packaging the app:

# Install dependencies
npm install

# Run the app in development mode
npm start


📦 Building the Executable

To package the source code into a redistributable format (like a .exe or .dmg):

# Windows (Generates NSIS installer + portable .exe)
npm run dist:win

# macOS (Generates DMG)
npm run dist:mac

# Linux (AppImage / deb)
npm run dist:linux


All packaged files will be located in the dist/ directory.

✨ Features

Tabs — Multiple tabs with optional vertical tab layout.

Bookmarks — Save and organize favorites with a bookmark bar.

History — Browse and search browsing history.

Downloads — Track and manage downloads.

Adblock — Custom block rules to remove ads and trackers.

Extensions — Chrome extension support via chrome://extensions.

Themes — Customize accent colors and UI layouts.

Search — Toggle between Google, DuckDuckGo, Brave, and more.

🤝 Credits

Initial build by Qwen

Further development by Antigravity, Codex and Cursor

📄 License

This project is open-source. Feel free to edit, improve, and submit pull requests.
