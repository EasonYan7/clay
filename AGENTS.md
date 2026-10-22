# Repository Guidelines

## Project Structure & Module Organization

Clay is a local-first macOS Electron app for visually editing HTML with GrapesJS.

- `app/main.js`: native windows, menus, file access, workspace persistence, and PDF export.
- `app/preload.js`: controlled IPC bridge between main and renderer.
- `app/renderer/`: editor orchestration (`app.js`), HTML import/export, translations, styles, icons, and samples. Bundled runtimes live in `vendor/`.
- `app/tests/`: Electron regression suites and Node-based runners.
- `experiment/`: standalone editor experiments and sample HTML.
- `docs/readme/` and `scripts/readme-assets/`: README media and generation scripts; `app/build/` contains packaging assets.
- `.github/workflows/`: CI and release automation.

## Windows Mainline

- Windows development now targets A (`C:\dev\clay-a`, branch `win-port-a`). B is historical reference, not a second delivery target; do not modify, launch, or delete it during A work.
- Keep macOS behavior and bundled vendor files intact. Windows shell differences use `process.platform` and the existing preload platform bridge; retain native window controls and imported-page color-scheme fidelity.
- Run `npm run test:platform`, `npm run test:windows`, and `npm run test:windows-shell` for Windows changes, including 150% scale. Use isolated `CLAY_USERDATA` and run desktop sessions serially.
- Launch the verified Windows build with `START-WINDOWS.cmd`. See `WINDOWS-PORT.md` for evidence, limitations, packaging, and cleanup rules. Never claim the macOS-only update UI suite passes on Windows.

## Build, Test, and Development Commands

Use Node.js 22.12+ and npm. Run these commands from `app/`:

```bash
npm ci                 # Install locked dependencies
npm start              # Launch the desktop app
npm run test:static    # Check JavaScript syntax
npm test               # Run static checks and all Electron suites
npm run test:fidelity  # Check HTML import, canvas, and export
npm run test:undo-canvas # Check canvas repaint after undo/redo
npm run test:updater    # Check release detection and verified downloads
npm run dist           # Build arm64/x64 macOS DMGs into app/dist/
```

Install Poppler (`brew install poppler`) for full PDF inspection. CI also runs `npm audit --audit-level=high`.

## Coding Style & Naming Conventions

Follow existing plain JavaScript: two-space indentation, semicolons, single-quoted strings, `camelCase` functions/variables, and `UPPER_SNAKE_CASE` constants. Main/preload use CommonJS; renderer modules use browser globals and IIFEs. Reuse CSS custom properties in `styles.css` and update both English and Chinese translations. No formatter or linter is configured; avoid unrelated reformatting and hand-editing bundled vendor files.

## Testing Guidelines

Tests use Node's `assert` with custom Electron harnesses. Follow existing `*.e2e.js` or `*-regression-test.js` naming and wire new suites into `package.json`. No coverage percentage is enforced. Add focused regressions for behavioral fixes; verify import → edit → undo/redo → save/export → reopen for fidelity changes. Isolate workspaces in temporary directories using `CLAY_USERDATA` or Electron's test user-data path. Run GUI suites on macOS; Linux CI covers a subset under Xvfb.

## Commit & Pull Request Guidelines

Recent commits use prefixes such as `fix:`, `feat:`, `docs:`, and `chore:` with short imperative summaries. Keep changes focused. PRs should explain the problem, resulting behavior, reproduction steps, and checks run; link relevant issues and include before/after screenshots for UI changes. Sanitize shared HTML fixtures. Preserve IPC sender/path validation and imported-script isolation. Version tags matching `v*` trigger release publishing, so create them only for an intended release.
