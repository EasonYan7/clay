# Clay

<p align="center">
  <a href="./README.md"><img src="https://img.shields.io/badge/简体中文-阅读中文版-EDEDF0?style=for-the-badge&amp;labelColor=26262B" alt="简体中文" /></a>
  <a href="./README.en.md"><img src="https://img.shields.io/badge/English-Current_language-6D4AFF?style=for-the-badge" alt="English" /></a>
</p>

<p align="center"><strong>Turn AI-generated HTML into an editable visual canvas.</strong><br />A macOS desktop app for non-technical creators.</p>

<p align="center">
  <img src="docs/screenshots/editor.png" width="800" alt="Clay editor" />
</p>

## What is Clay?

AI-generated HTML/CSS is often a black box for product, operations, and marketing teams. A small copy, spacing, or layout change can mean another prompt and another unpredictable rewrite. Clay opens or pastes existing HTML, turns it into a selectable component tree, lets you edit it visually, and exports clean HTML or a faithful PDF.

## Features

- Semantic layers instead of a tree of anonymous `div` elements
- Visual editing for typography, color, spacing, borders, layout, and more
- Direct text editing, image replacement, and structure-preserving drag and drop
- Desktop, tablet, and mobile previews
- Human-readable edit history with jump-to-state navigation
- Direct saving: ⌘S writes to the source file and ⇧⌘S saves a copy
- Automatic refresh when the source file changes in another app, with conflict protection for unsaved Clay edits
- Clean export that preserves original CSS and keeps Clay changes separate
- English and Simplified Chinese across the home screen, editor, dialogs, and macOS menus; first launch follows the system language
- A clean home screen on every normal launch, with recent files still available
- Local-first workflow: the editor runtime is bundled and does not require an account

## Run locally

```bash
cd app
npm install
npm start
```

## Tests

```bash
cd app
npm run test:editor
npm run test:fidelity
npm run test:i18n
```

## Build

```bash
cd app
npm run dist
```

Build artifacts are written to `app/dist/`. The app is not currently code-signed or notarized.

## Project structure

```text
app/
  main.js              # Electron main process, native dialogs, files, and PDF rendering
  preload.js           # Controlled bridge between main and renderer processes
  renderer/
    app.js             # Application state, editor wiring, history, and save state
    i18n.js            # Locale dictionaries and language state
    importer.js        # HTML parsing and semantic layer naming
    exporter.js        # Fidelity-oriented HTML export
    styles.css         # Clay interface design system
  tests/               # Editor behavior, fidelity, and localization regressions
```

## Add another language

Translations live in `app/renderer/i18n.js`. Extend `MESSAGES`, add the locale to the language switcher, use `t(key, vars)` for dynamic copy, and use the `data-i18n` attributes for static markup. Run `npm run test:i18n` before submitting a translation.

## Known limitations

- No code signing or notarization yet
- URL import is not supported; use a local HTML file or paste its source
- A page's own `prefers-color-scheme: dark` variants can currently be overridden by Clay edits
