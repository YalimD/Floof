# floof changelog

Changes to floof, newest first. The source lives in this folder (git repo, `main`
branch). Release zips and unpacked builds live in `builds\` (not in git). `run-local.ps1` copies the source into the
newest unpacked Windows build, `builds\floof-<version>\floof-win32-x64`, and restarts floof from there.

## 0.22.0 (2026-10-17)

### Changed
- (fill in)

## 0.21.0 (2026-10-17)

### Changed
- The Settings window opens wide (1040×760) with its sections in two columns; narrowed below about 900 px it goes back
  to one column. A label's explanation now uses the rest of its row instead of wrapping in a narrow strip.
- `--render-docs` draws Settings at the new size, and shows a made-up Claude Code settings path and "Not connected"
  instead of yours.

## 0.22.0 (2026-10-17)

### Changed
- (fill in)

## 0.20.0 (2026-10-17)

### Added
- Run floof from source with Node.js: `npm install` brings in Electron 33.4.11 (what the release ships) and builds
  `claude-code-hook.exe`, then `npm start`, `npm run demo` or `npm run bench` start floof from this folder through
  `run-dev.js`. `run-local.ps1` still runs it inside an unpacked build, without Node.js.
- `tools\make-release.ps1` builds the portable release the way 0.19.0 was made by hand: clean-tree check, optional
  `-Bump patch|minor|major` (package.json, README, CHANGELOG's "Unreleased" becomes the version and date) and `-Tag`,
  a clean export of the tag or HEAD, the Electron runtime from the newest unpacked build, a freshly compiled
  `claude-code-hook.exe`, the zip with its size and SHA-256, and a smoke test of the unzipped copy. No Node.js or network.
- Remove pets you don't want:
  - **× Send away** in a free critter's balloon (hold the interact keys) and on its pet list row. It leaves, and that
    kind of critter doesn't come out when floof starts (`sentAway` in settings) until you add one from the tray or tick
    free critters again.
  - **Remove all free critters** in the tray menu and the pet list: they all leave, critters you added by hand too, and
    free critters are turned off.
  - **× Dismiss pet** in an agent pet's balloon and **× Dismiss** on its pet list row, for a pet whose agent will never
    send anything again. It leaves and goes on the finished list; it comes back if the agent does send something.
  - **×** on each finished list row removes just that row.
- Settings > Cloud agents:
  - A status line: Connected, Connecting, Reconnecting or Not connected, with the reason (for example `ENOTFOUND`
    when ntfy can't be reached, or an HTTP error) and when the last event came in.
  - **Send test event**: posts a real event to your topic, the way a cloud agent would, and waits for it to come back
    down floof's subscription. A "Cloud test" pet appears on the screen with Settings, says "Hello from the cloud ✓" in
    its balloon, then finishes and leaves after about 15 seconds (it isn't kept on the finished list).
  - **Copy hook command** for Claude Code on the web, with steps in the README.
- The relay takes Claude Code hook payloads as they are, so a cloud Claude Code session's hook can pipe its input to the
  topic with curl. Its pet shows what the session is doing; there's no message box or Stop, since nothing can go back.

### Fixed
- The README's "From source" steps named npm scripts that didn't exist.
- `run-local.ps1` and the release smoke test started a floof that quit at once when run from Claude Code in VS Code,
  which sets `ELECTRON_RUN_AS_NODE`. They clear it first.
- **Copy** in Settings > Cloud agents copied two labelled lines ("Send events to: ..."), which don't work as an address
  in curl or a hook. **Copy address** copies just the address.
- The relay could hang forever on a connection that went quiet (sleep, a Wi-Fi drop, a proxy) and never reconnect. It
  now opens a new connection when ntfy's keepalive hasn't arrived for 2 minutes, and when the server closes it.
- Relay messages starting with a byte order mark (as PowerShell sends text) were ignored as bad JSON.
- The README's bash curl line, run in Windows' Command Prompt, arrived as `'{id:job-42,state:working,...}'` (cmd keeps
  the single quotes and drops the double ones) and was silently ignored. The relay now reads that quote-less form
  (values can't contain commas that way), the README has PowerShell and cmd versions, and a message floof still can't
  read is shown in Settings > Cloud agents and written to the log with its first 80 characters.

## 0.22.0 (2026-10-17)

### Changed
- (fill in)

## 0.19.0 (2026-10-11)

### Changed
- The README is rewritten GitHub style: logo, badges, quick links, a feature tour with pictures, a settings table,
  collapsible code examples, privacy notes, an FAQ and credits. Its pictures use made-up monitor names.
- floof is released under the MIT license (`LICENSE`).

### Added
- Squishy landings: a pet that falls squashes flat and wide on landing, anchored at its feet, and springs back past
  round in about a third of a second. It stretches a little taller and thinner while it falls fast. The bigger the
  drop, the bigger the squish; drops of a few pixels get none. After a big drop a few pixels of dust fly from its feet,
  and about one big drop in six leaves it dizzy for a second, with stars going round over its head. It works everywhere
  pets fall: off windows and shelves, in boxes with gravity, off a plunger, and when you drop a dragged pet. Caps,
  T-shirts, plungers, the status icon and the name tag squish with it (balloons don't), custom sprites squish too, and
  it stays in whole pixels so the pixel art stays crisp. It only does work for the moment of a landing, so CPU use
  doesn't change. Settings > Pets > **Squishy landings** turns it off.
- `floof.exe --render-docs=<folder>` draws the README pictures (`docs/images`) from floof's own pixel art, styles and
  windows, offscreen, with a throwaway settings folder and made-up agents, so nothing of yours ends up in them.

### Fixed
- Under a top taskbar, the letter on a pet's cap or T-shirt was upside down; it now reads the right way up.
- The pet list showed "O" for Ollama agents instead of their model's initial when it worked out the letter itself.
- The pet list's letter and answer boxes were white in the dark theme.
- `run-local.ps1` took a floof argument such as `--log-pets` as its build folder, so `.\run-local.ps1 --demo --log-pets`
  stopped with "No floof.exe in --demo".

## 0.22.0 (2026-10-17)

### Changed
- (fill in)

## 0.18.0 (2026-10-10)

### Added
- ↗ Take me there, in an agent's balloon and its pet list row, when floof knows where the agent is:
  - Local agents: the window of the first process up the agent's parent chain that has one (Windows Terminal, VS Code,
    the Claude app...) comes to the front, restored if minimized (`src/focus.ps1`, using the Alt-key and
    AttachThreadInput tricks so it isn't just a flashing taskbar button). `claude-code-hook.exe` now sends its parent
    processes with every call; floof-run, the Node Claude Code hook and the Gemini hook send theirs too; any agent
    can send `"pids"`. Tested: a minimized window came back and became the foreground window.
  - Cloud agents: events take `"url"` (http/https only); the button opens it in the browser, with the site in its
    tooltip. floof-run and send-event take `--url`.

## 0.22.0 (2026-10-17)

### Changed
- (fill in)

## 0.17.0 (2026-10-10)

### Added
- Taskbars at the top, left or right: floof works out each screen's taskbar edge (bounds against work area; an
  auto-hidden taskbar counts as none). Pets there now and then hold on to it with big pixel plungers (red rubber cups,
  wooden handles) on their feet, for agents and free critters alike: upside down under a top taskbar, sideways on a
  side one. They walk along it, nap on it, let go after a while, and let go when dragged, when leaving, or when the
  screens change. Sprite packs get plungers at the bottom of their frame.
- The pop-up for a question comes out of the taskbar's edge next to the clock: down from a top taskbar, out of a
  side one near the bottom, holding on with plungers. Under a top taskbar the balloon hangs below the pet.
- `FLOOF_ASK_ROUTE=tray|curtain|balloon` forces how questions are asked, for testing. Tested with fake top, left and
  right taskbars (`FLOOF_FAKE_DISPLAYS`) on the 4K screen.

## 0.22.0 (2026-10-17)

### Changed
- (fill in)

## 0.16.0 (2026-10-10)

### Added
- Screens pets can use (Settings > Pets): a box per connected screen with its name, resolution, scaling and position,
  and "Identify screens" (a big number on each). Unticked screens get no overlay at all, are walls for walking pets,
  and hide their pet boxes until ticked again. Screens are remembered by id, and by name and size if the id changes;
  if none is connected, the main screen is used. Replaces "Let pets roam across all my monitors" (off becomes "only
  the main screen").
- Window rules for "Keep pets off" and "Only on the windows of the apps I tick": an app plus optional text its title
  contains, with "Pick an open window" to fill one in, editable title text and ×. Plain app names keep working. The
  window watcher now reports window titles (UTF-8, up to 200 characters). Tested with three Firefox windows: a rule
  for one title kept pets off just that one.

## 0.22.0 (2026-10-17)

### Changed
- (fill in)

## 0.15.0 (2026-10-10)

### Changed
- Manual changes.

## 0.22.0 (2026-10-17)

### Changed
- (fill in)

## 0.14.0 (2026-10-10)

### Added
- The llama: a new built-in critter (long neck, banana ears, woolly body) in every pose, also roaming free and in tray
  > Add a critter.
- Ollama agents are always llamas and wear the initial of their model, in a colour from the model family
  (`qwen2.5-coder:7b` → "Q", `library/llama3.1` → "L"). Events take an optional `model` (shown in the balloon and the
  pet list); floof-run finds it in `ollama run <model>`.
- OpenAI-compatible agents (`openai-compatible`) wear "O" or the letter in Settings > Pets. Events take an optional
  `badge` (1–2 characters), and the pet list sets a letter for one agent; yours wins, then the agent's, then the
  setting. floof-run and send-event take `--model` and `--badge`.

### Fixed
- A script error in the overlay is now written to floof's log with `--log-pets`, so a stuck pet can be explained.

## 0.22.0 (2026-10-17)

### Changed
- (fill in)

## 0.13.0 (2026-10-10)

### Added
- Message and Stop in an agent's balloon (and in the pet list): a "Message…" box and a ■ Stop button that asks for a
  second click, shown for agents that say they can take them (`"controls": ["message", "stop"]` on their events), with
  the delivery state ("waiting for its next step", "delivered"). The balloon keeps taking keys while you type, even
  after you let go of the interact keys.
  - Claude Code: floof's reply to the hook is now printed by `claude-code-hook.exe`, so a message reaches Claude as
    `additionalContext` at its next step, Stop is `{"continue": false}` at its next step, and a message after Claude
    has finished blocks its Stop hook so it carries on with it. Tested live: a message reached a running Claude Code
    session at its next tool call. Stop and the after-finishing case were tested with simulated hook calls. Stop
    needs "Step-by-step updates and live control" (the renamed "Show each step" setting).
  - floof-run: Stop ends the command's whole process tree.
  - Any agent: `GET /control/<id>` returns waiting messages and Stop; `POST /control/<id>` sends one from a script.
  - Cloud agents: messages and Stop are published to `<topic>-answers` as `{id, type, text}`.

## 0.22.0 (2026-10-17)

### Changed
- (fill in)

## 0.12.0 (2026-10-10)

### Added
- Gravity in pet boxes, per box and for new boxes (⚙ > Gravity, on by default). Off: pets float wherever they are or
  wherever you drop them, still walking sideways between the walls; new pets start at a random height.
- Custom sprite packs wear caps and T-shirts without any setup: floof finds the head and chest from the idle frame's
  pixels when `sprite.json` has no `hat` or `body` anchor.

### Fixed
- Pets on a shelf never fell asleep (or did anything new): inside a box, a pet's floor was always the box bottom, so a
  pet on a shelf counted as falling every frame. Now a shelf is its floor, and pets nap on shelves like on window tops.

## 0.22.0 (2026-10-17)

### Changed
- (fill in)

## 0.11.0 (2026-10-10)

### Added
- Agents wear a cap, a T-shirt, both, or nothing (Settings > Pets > Agents wear; replaces the on/off switch, which
  carries over as cap or nothing). The T-shirt is a pixel shirt with short sleeves in the provider's colour with its
  initial on the chest, in every pose; birds wear a scarf with a light stripe instead. Sprite packs can give a
  `"body": {x, y}` chest anchor for the shirt; without one they wear the cap. The tour's last step mentions it.

## 0.22.0 (2026-10-17)

### Changed
- (fill in)

## 0.10.0 (2026-10-10)

### Added
- The guide sheep: a tour of floof in ten steps that starts the first time floof runs, and from tray > Show me around
  or Settings > Pets > Show the tour again. Each step has Next and Skip tour, and some wait for you to try something
  (hold the keys and click it, answer its question). It shows a busy agent with progress, a question in its balloon,
  where a question goes when you can't see the pet (the curtain, or a pop-up next to the clock), sad and happy pets,
  napping, a fortune, where pets live (opens Settings), the pet list (opens it) and connecting your agents. The guide
  runs through floof's own agent events, so it's an ordinary pet (it crosses screens and is in the pet list) that wears
  a floof cap; it sends no notifications and isn't added to the finished list. `tourDone` in settings remembers it.
- `--tour` starts the tour; `--tour-auto` also clicks Next by itself (for testing).

## 0.22.0 (2026-10-17)

### Changed
- (fill in)

## 0.9.0 (2026-10-10)

### Added
- Shelves in pet boxes. ✎ on a box's title bar arranges it: "+ shelf" adds one, drag a shelf to move it, drag its ends
  to resize it, × removes it; it snaps to an 8 px grid and to the other shelves' heights; ✎ again or Esc finishes.
  While arranging, the box takes clicks; otherwise it lets them through. Shelves are stored as fractions of the box, so
  they follow when it's resized, and are at least as wide as a pet. Pets walk along them, hop up, drop off the ends and
  nap on them; pets on a shelf that moves ride along, and fall if it's removed or slides away. New boxes start with one.
- Pet box backgrounds: none, a colour or a picture (PNG, JPG, GIF, WebP; Fill, Fit or Tile), with opacity, per box,
  plus a background for new boxes and a shelf colour (wooden by default). ⚙ on a box opens its settings. Pictures
  are copied into floof's folder and removed when no box uses them. A 6000×4000 photo in a 1700×950 box on the 4K
  screen made no measurable CPU difference (about 21% of a core with the demo running).

## 0.22.0 (2026-10-17)

### Changed
- (fill in)

## 0.8.0 (2026-10-10)

### Added
- Pet list (tray > Pet list…): every pet on screen, live, with its critter and cap, name, provider, state, latest
  message, how long it has been in that state and which screen it's on. Free critters are listed separately. Clicking
  a row makes the pet hop and flash; a waiting question can be answered right in the list. "Finished" keeps agents
  whose session ended or that left the screen (result, last message, when, how long they ran) in `history.json`: the
  newest 200 from the last 30 days, with "Clear list".

## 0.22.0 (2026-10-17)

### Changed
- (fill in)

## 0.7.0 (2026-10-10)

### Added
- Agents wear their provider's colours: a little pixel cap with the provider's initial (Claude orange "C", Gemini blue
  "G", Codex dark "X", OpenAI dark "O", Copilot purple "C", Mistral orange "M"; anything else gets a colour from its
  name). Colours and letters only, no logos. The cap follows the head while walking, sleeping, sad, flying, in the
  curtain and peeking from the taskbar; free critters wear nothing. Sprite packs can give a `"hat": {"x", "y"}` anchor
  (top centre of the head, in frame pixels, facing right); without one they wear no cap. Settings > Pets has a switch.
- Settings > Claude Code: **Connect / Disconnect Claude Code** adds or removes floof's hooks in
  `%USERPROFILE%\.claude\settings.json`, keeping everything else and saving `settings.json.bak-floof` the first time.
  "Show each step in the balloon" (on by default) also hooks every tool call; off, the pet just shows busy until done.
- `tools/claude-code-hook.exe`: the hook as a 5 KB Windows program (C#, built by `tools/build-hook.ps1` with the
  compiler that ships with Windows; not kept in git). About 70 ms per call, about 40 ms when floof isn't running,
  and always exits 0.
- `POST /hook/claude-code`: floof reads a Claude Code hook payload as is, so the Claude Code hook can be a single
  `curl.exe` call (about 10–30 ms instead of about 300 ms for PowerShell). Needs neither Node.js nor PowerShell.
- `tools/claude-code-hook.ps1`: the Claude Code hook in PowerShell, for PCs without Node.js. Same events as
  `claude-code-hook.js` (session id as the pet id, project folder name as its label); never fails, and waits at most a
  second for floof.

## 0.22.0 (2026-10-17)

### Changed
- (fill in)

## 0.6.0 (2026-10-10)

### Added
- Hold keys to interact (Settings > Pets, on by default, Ctrl+Alt; also Ctrl+Shift, Alt+Shift or Ctrl+Win). Without
  the keys, pets ignore clicks, which go straight through to your windows, and hurry out of the way of the mouse
  cursor and of where you're typing (the text caret, or where you last clicked in apps that don't report one).
  Holding the keys makes pets glow; then you can click, drag and pin balloons as before. A question waiting for your
  answer, in a balloon or on a curtain, can always be clicked. Untick it to keep pets clickable all the time.
- The window watcher also reports the modifier keys held, the cursor and the caret (only while this option is on).

## 0.22.0 (2026-10-17)

### Changed
- (fill in)

## 0.5.0 (2026-10-10)

### Added
- Where pets live (Settings > Pets): everywhere (as before), only on the windows of apps you tick, or inside pet boxes.
  - Apps: pets stand and walk only on top of those apps' windows, never on the bare taskbar or other windows. With
    none of them open on a monitor, pets tuck away and look for one on the monitor next door; they drop onto an
    allowed window as soon as one appears.
  - Pet boxes: "Add a pet box" in the tray menu or in Settings drops a box on the main monitor. Drag its title bar to
    move it, the corner to resize it, × to remove it. Pets live inside: the box floor is their ground and its sides are
    walls; birds fly inside. Pets are spread across the boxes, and dragging a pet into another box moves it there. The
    rest of the box is click-through.
- Idle pets sleep until you click them (Settings > Pets, on by default). Critters with no agent and agents that are
  idle, done or in error nap where they are with 💤 after a one-off reaction (done still jumps for joy, error droops for
  a few seconds). Clicking one wakes it while its balloon is open. Only busy agents and ones waiting for an answer
  move about; a question you put off moves slowly. Untick it for the old wandering.

### Fixed
- Two pets popping up next to the clock at the same time no longer stand on the same spot.

## 0.22.0 (2026-10-17)

### Changed
- (fill in)

## 0.4.0 (2026-10-10)

### Added
- Pets cross monitors with different scaling: each such monitor gets its own overlay, and a pet walking off the shared
  edge carries on in the next one.
- Question routing: a pet in sight on the monitor you're using asks in its own balloon. A pet out of sight pulls a
  curtain on the active window. If that window is a keep-off app, full screen, or has no room above it, the pet pops up
  from the taskbar next to the clock. If you're working on the other monitor, the pet crosses over there first.
- Question timeout (Settings, default 5 minutes): the pet puts the question away and wanders again with its ❓;
  clicking it shows the question.
- Keep pets off (Settings): ticked apps plus full-screen windows. Pets don't walk into, climb or cover them; a pet
  standing where one opens walks out or tucks away until it's gone.
- Balloons close by themselves after 20 seconds unless you click "📌 Keep open". They stay open while the mouse is over
  them or you're typing; question balloons follow the question timeout instead. The time is set in Settings.
- Fortunes: clicking a pet with no agent shows a fortune now and then; an idle agent's pet says "Idle at the moment"
  with a fortune under it. Uses an installed `fortune` program (short, non-offensive only) when there is one, otherwise
  floof's own family-friendly list in `src/fortune.js`. Settings > Pets has a switch to turn them off.
- The window watcher reports each window's app name.
- `--log-pets`: logs each overlay's layout (bounds, monitors, scaling, exits), pets walking between overlays, and every
  pet's position, mode, state and monitor every 3 s.
- Source kept in a local git repo here, with this changelog, a `builds\` folder for release zips and unpacked builds,
  and `run-local.ps1` to copy the source into the build and restart floof (e.g. `.\run-local.ps1 --demo --log-pets`).

### Changed
- The window watcher is per-monitor DPI aware, so windows on a monitor with different scaling report real pixels.
- The curtain in the bottom-right corner of the screen is replaced by the pet popping up from the taskbar.
- Lower CPU use: pets redraw only when their animation frame or facing changes, styles are written only when they
  change, and the main loop is capped at 30 fps. On a 4K 175% screen with the demo running, CPU went from 44% to about
  20–30% of one core.

## 0.22.0 (2026-10-17)

### Changed
- (fill in)

## 0.3.0
- First Windows build tested on this PC (zip; the installer wasn't available for testing).
- Known limit confirmed: with mixed scaling (4K at 175% plus laptop at 125%), pets stay on the main monitor.
