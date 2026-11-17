# Brownout

> [!IMPORTANT]
> ## This project was written entirely by AI
>
> **Every line of code, every test, every script and every document in this repository was written by AI** (Claude, made by Anthropic), working from prompts. No person wrote or edited the code by hand. That includes the specs in `docs/`, which the AI researched and wrote.
>
> **The ideas behind it are human.** What Brownout is for and what it does came from its author, RoboticsIsEpik, who designed the app, decided every feature, tried each version, and reported what was wrong. Among them:
>
> - a log viewer built around **comparing matches**, even ones recorded at different times
> - a **Power button** that breaks energy use down by subsystem and shows what was drawing current when the robot browned out
> - **AprilTag and camera views** on the 2D field, showing which camera sees which tag and where each camera thinks the robot is
> - **match video** synced to the timeline by hand
> - a fully **customizable robot** drawing, with parts that move with logged angles
> - **swerve, controller and command** viewers
> - **real field pictures**, a **compact view** for small screens, and **custom icons instead of emoji**
> - layouts as **presets**, a **"potato mode"** for slow laptops, and the rule that **only the timeline moves time**
>
> **What this means if you use it:** treat Brownout like any software you did not write and cannot fully vouch for. It has automated tests (45 unit tests and 205 checks that drive the real app) and has been checked against one real robot log, but AI-written code can have mistakes that tests miss. Before making a decision at an event, such as retiring a battery or blaming a mechanism for a brownout, check the conclusion against the raw data in the graphs.

A desktop log viewer and **log comparison tool** for FRC robots. It opens WPILOG files (`.wpilog`) written by WPILib DataLogManager, Epilogue, AdvantageKit, DogLog and the 2027 FIRST Driver Station, and is built to look at **several logs at once**: matches from different days line up at auto start (or first enable, teleop start, wall clock, or by hand), and every panel can overlay, stack or difference them.

Electron + TypeScript + React. Works fully offline. Windows, macOS and Linux.

## Run it

```bash
npm install
npm run make-demo      # three synthetic 2026 match logs in fixtures/demo
npm run dev            # launch the app with hot reload
```

> **"Error: Electron uninstall"** when starting? The Electron binary didn't download during `npm install`. Run `node node_modules/electron/install.js` (the `postinstall`/`predev` hooks now do this automatically; behind a proxy set `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` first).

Open logs with **File → Open logs…** (Ctrl+O) or drag `.wpilog` files onto the window. No logs handy? **Settings, Demo logs** loads three example matches and a demo robot profile. Opening a log with an empty grid applies the *Quick Look* preset, and the app reopens your last session's logs on launch.

Other commands:

| Command | What it does |
|---|---|
| `npm run check` | strict typecheck (app, pure core, node scripts) + unit tests |
| `npm run smoke` | builds, launches the app headless with two demo logs, screenshots to `smoke/screenshot.png` |
| `npm run uitest` | drives the real app with Playwright: menus, presets, dialogs, time control, zoom, settings, keybinds, session restore, icons, compact view, multi-select, robot profiles, power by subsystem, field pictures, swerve, cameras, controller, commands, the robot editor, video sync, the match report (205 checks; screenshots in `smoke/ui-*.png`) |
| `npm run bench` | times the reader on every fixture against the 3 s / 100 MB budget |
| `npm run reallog` | opens every log in `fixtures/local/` (git-ignored; put a team's real logs there) in the real app, applies each preset, and writes screenshots, the match report and a summary to `smoke/real-*` |
| `npm run build` / `npm run dist` | production build / installers via electron-builder (see below) |
| `npm run web` | the same UI in a plain browser (no Electron; open files by drag-and-drop) |
| `electron . --open a.wpilog --open b.wpilog --preset compare` | open logs and a preset from a shell |

## Build a real app (installer / standalone .exe)

**Releases are built by GitHub.** Bump `version` in `package.json` and merge it to `main`, then either:

- **From the website (works on a phone):** open the repo's **Actions** tab, choose **Release**, tap **Run workflow**, leave the branch on `main`, tick **Make a draft release**, and run it. The workflow tags the commit `v<version>`.
- **From a terminal:** `git tag v0.5.1` and `git push origin v0.5.1`. The tag must match the version in `package.json`.

`.github/workflows/release.yml` builds the installers on Windows, macOS and Linux (about 10 minutes) and creates a **draft release** with them attached. Open the repo's Releases page, check the draft, and click Publish. A version with a dash (`0.6.0-beta.1`) becomes a pre-release. If you already made a release for the tag on the website, the installers are added to it instead. Running the workflow without ticking the box, or a pull request that changes the packaging setup, only builds the installers.

To build on your own computer instead:

```bash
npm run make-demo   # so Settings → Demo logs works in the packaged app
npm run dist        # builds, then packages for the OS you're on
```

Output lands in `dist/`:

| OS | What you get |
|---|---|
| Windows | `Brownout-Setup-0.5.1.exe` (installer: Start-menu + desktop shortcut, `.wpilog` file association) and `Brownout-0.5.1-portable.exe` (single file, no install). `dist/win-unpacked/Brownout.exe` also runs directly. |
| macOS | `Brownout-0.5.1-arm64.dmg` (Apple silicon) and `Brownout-0.5.1-x64.dmg` (Intel), plus zips. Unsigned: right-click → Open the first time; if macOS says the app is damaged, run `xattr -cr /Applications/Brownout.app`. |
| Linux | `Brownout-0.5.1.AppImage` (`chmod +x`, run) and `brownout_0.5.1_amd64.deb`. |

Notes:
- Build on the OS you want to ship for (Windows builds on Windows, etc.); the release workflow does all three.
- The builds are **unsigned**, so Windows SmartScreen shows "unrecognized app" → *More info → Run anyway*. Code signing needs a certificate (see `docs/brownout-tech-stack.md` §6).
- On Windows, if electron-builder fails with *"Cannot create symbolic link"* while extracting `winCodeSign`, run the terminal once as Administrator (or turn on Windows *Developer Mode*) and rerun `npm run dist`.
- A quick unpacked build for testing: `npx electron-builder --dir`.
- Command-line flags work on the packaged app too: `Brownout.exe --open a.wpilog --open b.wpilog --preset compare`, `Brownout.exe --demo`.
- On a machine without a GPU (CI, some virtual machines), set `BROWNOUT_DISABLE_GPU=1`.

## What's in it

- **Reader (src/core):** WPILOG v1.0 index pass + lazy decode, struct schemas (incl. bit-fields and the 2027 `ControlWord`), truncated-tail tolerance, entry-ID reuse, out-of-order timestamps, unit detection, per-pixel min/max decimation. No DOM/Node imports; runs in a Web Worker, in tests and in scripts.
- **Robot state:** enabled / auto / teleop / utility and match info resolved through priority key tables covering AdvantageKit, DataLogManager ≤2026 and 2027, the FIRST DS and Phoenix-converted logs. Era detection (blue-wall vs field-center frame).
- **Sessions & alignment:** N logs, one color each; alignment modes auto start / teleop start / first enable / log start / wall clock / raw, plus a manual nudge per log (Alt-drag its lane on the timeline).
- **Timeline (the one place that moves time):** covers the match (auto start to the end of teleop) unless switched to the whole log; press or drag in the lanes to scrub the cursor (it snaps to mode changes; Alt for none), drag the time ruler to pan; overview strip with a window you resize by its grips and move by its middle, showing its times while dragged; one mode lane per log, event markers (brownouts, reboots, loop overruns, errors, alerts, disconnects), battery strip, user tracks (boolean / state / numeric strip), bookmarks, playback, match-time readout. Click `t =` to type a time to jump to; the zoom box takes a typed span (`10`, `500ms`, `1:30`); drag the top edge to resize. Hover previews are ignored during playback.
- **Panels (dockable grid):** line graph (overlay / stacked / A−B, discrete lanes, thresholds, own time range when unlinked, independent value-axis zoom, one-line legend strip that opens on click), table, console & events, 2D field (the real 2024 to 2026 field pictures, built-in AprilTag maps, your own field picture, ghost robots, trails, PathPlanner active path + target pose, alliance normalization, wheel zoom / drag pan), swerve drive (module speeds and angles measured against setpoints, chassis velocity and rotation, one diagram per log), controller, commands, video, statistics, power report, path analysis, compare matches, log info & logging health. Add them from **Add panel**.
- **Power by subsystem (the Power button):** group motors into subsystems by PDH / PDP channel or by logged current field, and the report shows who used the energy, each subsystem's highest current peak, the lowest voltage dips, and for every brownout what was drawing at the dip and over the half second before it. A stacked current chart follows the timeline, and each subsystem's current becomes a field you can graph (`/Brownout/Subsystems/<name>/Current`). With a time selection the numbers cover the selection.
- **Cameras and AprilTags (2D field, Display menu):** for each camera the field shows a line to every tag it sees, the tag lit up with its ID, a ghost robot where the camera thinks the robot is, and a readout of how far that is from the logged pose. Every part is optional: a camera is a name plus whichever of three fields the robot logs (pose estimate, tag IDs, tag poses), and whatever is missing is not drawn. The AdvantageKit vision template and Limelight `botpose` arrays are found with no setup; anything else is picked by hand in the camera editor. Each camera also gets fields to graph or put on the timeline (`/Brownout/Vision/<camera>/TagsSeen`, `TagCount`, `EstimateError`).
- **Controller viewer:** the driver's sticks, triggers, D-pad and buttons at the cursor, one pad per log, from AdvantageKit (`/DriverStation/Joystick<N>/...`) or DataLogManager (`DS:joystick<N>/...`) fields. Xbox, PlayStation or a plain numbered list.
- **Commands viewer:** which commands ran when, one row per command and one lane per log, read from the command scheduler's `Scheduler/Names` list (or AdvantageKit's one-flag-per-command folders). Click a run to jump to its start.
- **Video:** attach a match video to a log and sync it in the sync view: a large video with frame-by-frame controls, slow playback and sound, next to the log's auto start, first robot movement and teleop markers and its robot speed. Pick the moment, find its frame, pair, check, apply. From then on it follows the timeline, including playback speed, and dragging keeps the picture moving. The file and the sync are remembered per log. MP4 (H.264) and WebM play.
- **Maximize a panel:** the button at its top right, a double-click on its tab, or Ctrl+Enter; the timeline stays.
- **Robot appearance (Settings, Robot, or the field's Display menu):** draw the robot from rectangles, ellipses, pictures and SVGs placed by typing or dragging. A part can stay still or turn with a logged angle (radians, degrees or rotations) about a pivot. Stored in the robot profile.
- **Match report (File menu):** one page as a PDF for the pit: battery voltage over the match, every brownout with what was drawing the most, power by subsystem, battery resistance, loop overruns, restarts, and per camera how often it saw a tag and where it was blind.
- **Battery health:** resistance estimated from the slope of voltage against current, a rating, and a battery label per log so one battery can be followed across matches.
- **Robot profile (Settings, Robot):** what describes the robot rather than the screen: power subsystems, cameras, the robot's parts, swerve module order and scale, robot size, controller layout, favorite fields and field-name corrections. It applies to every log from that robot, is picked by best field-name match when you have several, and exports as one file.
- **Presets = layouts:** the Preset menu shows the active preset and marks it “(modified)” when you change it. Built-ins (Quick Look, Power & Brownouts, Autonomous Review, Compare Matches, Code Health, Match Replay) find fields by role (battery voltage, robot pose, …) so they work on any team's logs; your own are saved layouts you can update, rename, duplicate, delete, export (pick which) and import (overwrite / keep both / skip on a name clash).
- **Sidebar:** search, Ctrl-click and Shift-click to select several fields, drag the selection or a whole folder onto a panel (the panel says what it could not show), star fields as favorites.
- **Compact view:** every toolbar is one row; what does not fit moves into a three-dot menu. Narrow panels and windows keep only the most-used controls, collapse a graph's field chips to a count and hide the sidebar. Settings can force it everywhere.
- **Settings:** themes (dark, light, high contrast), log and robot-mode colors, every keyboard shortcut rebindable, compact view, Potato mode, whether graphs may move time, session restore, brownout threshold, AprilTag map, the robot profile, demo logs.
- **Potato mode:** for slow laptops or very dense logs: 30 fps cap, 1× resolution, coarser graphs, no cross-panel hover, short trails. The app offers it when drawing is slow.
- **Export:** CSV of the active panel's fields over the selection or visible range; any panel copied to the clipboard as a picture (Ctrl+Shift+C, or the picture button on the panel) or saved as a PNG.
- **Icons:** the interface uses its own icon set (`src/renderer/src/lib/icons.ts`) and no emoji.

Specs live in `docs/` (copies of the project docs). `AGENTS.md` explains the architecture rules for coding agents. `HANDOFF.md` is the place to start for whoever continues the work: current state, decisions and their reasons, remaining work in order, known risks.

## Layout

```
src/core/       pure TypeScript data core (reader, structs, robot state, analyzers)
src/main/       Electron main: window, menu, dialogs, IPC, CLI flags
src/preload/    the window.brownout bridge
src/renderer/   React UI: state stores, log worker, panels, timeline, grid
scripts/        make-demo, smoke, uitest, bench
fixtures/       demo logs (generated); fixtures/local/ for real logs (git-ignored)
```

Third-party notices: `THIRD_PARTY_NOTICES.md`.
