# floof

Windows-only Electron app: desktop pets that show what AI agents are doing. Plain CommonJS with no build step and no
runtime dependencies beyond Electron and Node built-ins. The README's "Project layout" table maps the folders.

## Running and testing

- `npm test` runs the unit tests (`node:test`, `test/*.test.js`). `npm start` / `npm run demo` start floof from source.
- To start Electron any other way, clear `ELECTRON_RUN_AS_NODE` first (`env -u ELECTRON_RUN_AS_NODE ...`). VS Code
  sets it, and Electron then runs `main.js` as plain Node and fails with `MODULE_NOT_FOUND` or similar.
- `--render-docs=<folder>` gives a quick visual check of a UI change. It draws the README pictures and the Settings
  window offscreen with throwaway settings, then quits. It runs alongside the user's own floof.

## README pictures

- Regenerate them with `./node_modules/.bin/electron . --render-docs=docs/images` (with `ELECTRON_RUN_AS_NODE`
  cleared). Commit only the pictures your change affects; restore the rest with `git checkout`, because some of them
  come out slightly different on every run (the pet list shows relative times).
- The pictures are published, so they must show nothing from this machine. Code that reads real machine state
  (monitor names, the Claude Code settings path, hook status) returns a made-up stand-in when `RENDER_DOCS` is set.
  See `screenList()` and `claudeStatus()` in `main.js`. Look at each regenerated picture before you commit it.

## With every user-visible change

- Add a bullet under `## Unreleased` at the top of `CHANGELOG.md` (create the heading if it's missing), under
  `### Added`, `### Changed` or `### Fixed`. `tools/make-release.ps1` turns that heading into the version and date.
  The version number is the user's to change: leave `package.json` and the README version alone.
- Update the README when a setting, feature or folder changes: the Settings table, the feature list, the project
  layout table.

## Style

- Comments are short and explain the why or the user-visible effect. A file opens with a comment saying what it is.
- Text the user sees is plain, friendly English: "floof" in lowercase, British spelling ("colour"), and no jargon in
  Settings or balloons.
- Settings defaults live in `DEFAULTS` in `src/settings.js`, and a new setting gets a test in
  `test/settings.test.js`.
