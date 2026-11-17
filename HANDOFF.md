# Brownout handoff

Written 2026-11-16 by the model that built the app so far, and last updated 2026-11-17, after **v0.5.1 was published** and the work moved into the repo on the owner's computer. It is for the model that continues the work, and assumes no memory of the conversations behind it.

**Where the code is.** On GitHub: **https://github.com/SuppressedCoder/Brownout**. Work from `main`; it holds everything. Pull requests #1 to #5 are merged:
- #1 added the app in 12 step-by-step commits
- #2 added the AI disclaimer at the top of the README
- #3 added the release workflow
- #4 made releases startable from the Actions tab
- #5 updated this handoff after the v0.5.1 release

**Brownout 0.5.1 is published** as a pre-release with Windows, macOS and Linux installers: https://github.com/SuppressedCoder/Brownout/releases/tag/v0.5.1. The owner also has an older `brownout.zip` of the same code; GitHub is the source of truth now.

**Where the work happens now.** The owner and the model work in the cloned repo on the owner's own computer, in **VS Code with Claude Code**. A local session usually starts with the clone already open: run `npm install` and `npm run make-demo` and you are ready. A cloud session (claude.ai) instead attaches the repo with push access (`add_repo`, owner `SuppressedCoder`, repo `Brownout`) and clones it. Either way, the owner's real log is not in the repo; ask for it if you need it (section 2).

**This file in the repo is the main copy.** Edit `HANDOFF.md` here; the copy in the Claude Project named "Brownout" is synced afterwards, by hand, from a claude.ai chat. Never update only the Project copy, and when the two disagree the repo wins. The Claude Project holds only documents: this handoff, the status and plan, the log format reference, and the specs. Do not rebuild the app from the documents.

**What a Claude session can and cannot do on GitHub** (the Claude GitHub App is installed on the SuppressedCoder account). What you can do depends on where the session runs:
- **A local session** (VS Code with Claude Code) uses the owner's own git and `gh` credentials, so everything works: push branches, **push tags**, **delete branches** (`git push origin --delete <branch>`), and open pull requests with `gh pr create`. The limits in the next bullet do not apply to it.
- **A cloud session** works through the git proxy and is narrower:
  - **Can:** push branches, and open pull requests through the REST API (`gh api repos/SuppressedCoder/Brownout/pulls --method POST --input body.json`). `gh pr create` fails there because the GraphQL API is not available. Reading anything works.
  - **Cannot:** create tags (`git push` of a tag is cut off, and the API answers "Write access to this GitHub API path is not permitted through this proxy"), or delete branches (`git push --delete` is cut off). Don't look for other ways around these limits. The owner deletes branches in the browser; releases are started with the Actions button (section 10).
- **Leave merging to the owner,** wherever the session runs. They merge pull requests themselves; tell them which merge method to use when it matters.

## 0. Read this first

1. This file, top to bottom.
2. `AGENTS.md`: the architecture rules. They are binding, and each one exists because something broke without it.
3. `docs/implementation-status.md`: what is built, item by item, with honest notes on what is partial.
4. The spec in `docs/` that matches your task (listed in `AGENTS.md`).

State in one paragraph: the app works end to end, every planned feature from the last two plans is built, and v0.5.1 is released with installers for all three operating systems. `npm run check` (45 unit tests) and `npm run uitest` (181 checks) pass, locally and in CI on GitHub. **One real robot log has been checked:** CURIE Q89 from the 2026 Championship, a DataLogManager log with no AdvantageKit and no battery voltage. It exposed ten real bugs, all fixed in v0.5.1; section 6 lists them. Everything that needs battery voltage or PDH currents has still only been run on the synthetic demo logs. Getting more real logs is the first job (section 7).

Work on a branch and open a pull request; don't push to `main` unless the owner asks.

**One conversation per big task.** The owner was told to start a new conversation for each major piece of work (a feature, a batch of fixes from a real log), because very long conversations get compressed and details are lost. So you may be starting cold on a narrow task: this file and `AGENTS.md` are your memory. Before you finish a task, update this file (sections 6 to 8 at least) so the next conversation starts from the truth; the Claude Project copy is synced from it afterwards.

## 1. What Brownout is

A local desktop app for FRC (FIRST Robotics Competition) teams to look at robot logs. It opens WPILOG files (`.wpilog`) from WPILib DataLogManager, Epilogue, AdvantageKit, DogLog and the 2027 FIRST Driver Station.

What sets it apart from AdvantageScope is **comparison**: several logs open at once, lined up at auto start (or teleop start, first enable, wall clock, or by hand), with every panel able to overlay, stack or difference them. The second emphasis is **power**: why the robot browned out and which mechanism caused it.

Who uses it: students and mentors in the pit, often on small or slow laptops, often not programmers. That drives several rules below (plain wording, compact view, Potato mode, nothing that needs setup before it shows something).

It is a general team tool, not built for one robot. Teams log different things under different names, so every data source is optional and found by pattern, with a manual pick as the fallback.

### Built so far

- **Reader:** WPILOG v1.0, struct schemas, truncated files, units, robot state and match info from several loggers' key names.
- **Session:** many logs, alignment modes, manual nudge, session restore.
- **Timeline:** the one place that moves time. Mode lanes per log, events, battery strip, user tracks, tags-seen tracks, bookmarks, playback.
- **Panels:** line graph, table, console, 2D field, swerve, controller, commands, video, statistics, power, path analysis, compare matches, log info.
- **Power by subsystem** and battery health.
- **Cameras and AprilTags** on the 2D field.
- **Robot profile:** subsystems, cameras, robot parts, swerve settings, size, controller layout, favorites, field-name corrections.
- **Robot editor:** shapes, pictures and SVGs, parts linked to logged angles.
- **Match report** as a one-page PDF.
- **Presets** (layouts), compact view, Potato mode, themes, rebindable shortcuts, own icon set, copy panel as image, CSV export, browser build.

`README.md` describes each in a sentence or two; `docs/implementation-status.md` is the detailed table.

### Planned and not built

From `docs/implementation-status.md` (rows marked ✗ or ◐) and `docs/frc-logging-landscape-and-viewer-requirements.md` section 8, which is the authority on priorities P0 to P2:

- PhotonVision raw results (needs protobuf decoding)
- Download logs from the robot, watch the Driver Station log folder, a log library
- Mechanism (side view) panel, XY plot, field heatmaps. A 3D field is deliberately deferred: the UI spec decides against it at first, because AdvantageScope already does it well and it costs a field model every season
- More built-in presets named in the UI spec: Drivetrain, Mechanism Tuning (Match Replay covers most of the planned Driver Review)
- Derived expressions in graphs
- Timeline: drag to reorder tracks, a findings track
- Export a filtered WPILOG, SVG export
- Workspace tabs, pop-out windows
- Code signing and auto-update
- The 2027 field picture and tag map (after kickoff)

Section 7 puts all of this in order with steps.

## 2. Run and test

```bash
npm install            # also downloads the Electron binary (scripts/ensure-electron.mjs)
npm run make-demo      # writes three synthetic 2026 match logs: fixtures/demo and src/renderer/public/demo
npm run dev            # the app, with hot reload
```

| Command | What it does | When |
|---|---|---|
| `npm run check` | typecheck with three tsconfigs, then vitest | before you call anything done |
| `npm run uitest` | builds, then Playwright drives the real Electron app; screenshots to `smoke/ui-*.png` | after any UI change |
| `npm run uitest -- --no-build` | same, reusing `out/` | when only the test script changed |
| `npm run smoke` | headless launch with two demo logs, fails on renderer errors | quick sanity |
| `npm run bench` | reader speed against the budget of 3 s per 100 MB, on the demo logs and every log in `fixtures/local/` | after touching `src/core` reading or analysis |
| `npm run reallog` | opens every log in `fixtures/local/` in the real app, sets up suggested subsystems, applies each preset, captures the camera view and the match report; writes `smoke/real-*.png`, `real-report.pdf`, `real-summary.json` | after any change, when real logs are available; read the summary and look at every picture |
| `npm run web` / `web:build` | the UI in a plain browser, no Electron | after touching anything that calls `window.brownout` |
| `npm run dist` | installers for the OS you're on, through electron-builder | releases are built by GitHub instead (section 10) |

Things to know about the tests:

- **Demo logs must exist** (`npm run make-demo`) before `smoke`, `uitest` and `bench`. They are git-ignored, so a fresh clone doesn't have them.
- **Real logs go in `fixtures/local/`** (git-ignored, so never in the repo). The owner's CURIE Q89 log (71.5 MB) is not in the repo: ask them to attach it again if you need it. `src/core/reallog.test.ts` keeps its key names and quirks as small hand-built logs, so the unit tests cover it without the file.
- On Linux with no display, `uitest` and `smoke` re-run themselves under `xvfb-run`. Install `xvfb`.
- `uitest` generates a test video with `ffmpeg` (libx264) if `smoke/ui-test-video.mp4` is missing. `ffmpeg` must be on the PATH.
- Each test run uses a throwaway profile folder through the `BROWNOUT_USER_DATA` environment variable, so it never touches real settings.
- The renderer exposes its stores on `window.__brownout` (`src/renderer/src/main.tsx`) for the test and for DevTools.
- **Look at the screenshots.** Passing checks have missed real bugs more than once (section 5, "Testing lessons").
- **CI runs on GitHub on every push and pull request** (`.github/workflows/ci.yml`): install, demo logs, `npm run check`, bench, build, smoke and the UI test. It has passed on every pull request so far. The runner has no GPU, so CI sets `BROWNOUT_DISABLE_GPU=1` (software rendering). Without it, window captures fail with Chromium's `UnknownVizError`. Set the same variable on any machine without a GPU.

Command-line flags, on the dev build and the packaged app: `--open <file.wpilog>` (repeatable), `--demo`, `--preset <id>` (`quick`, `power`, `autos`, `compare`, `code`, `replay`), `--screenshot <png>`.

## 3. Architecture

### Processes

```
src/main/       Electron main: window, native menu, dialogs, IPC, CLI flags, video protocol, PDF printing
src/preload/    the window.brownout bridge (api.ts declares it, index.ts implements it)
src/renderer/   React UI
  src/worker/   the log worker: owns every loaded log, decodes and analyzes off the UI thread
  src/state/    stores: session, time, panels, presets, profiles, settings, ui, videos
  src/panels/   one file per panel type
  src/components/  header, sidebar, timeline, grid, menus, toolbars, editors, dialogs
  src/lib/      drawing helpers, icons, actions, presets, theme, persistence, report, vision, power
src/core/       pure TypeScript: reader, structs, robot state, roles, analyzers, vision, controller, commands, report
scripts/        make-demo, smoke, uitest, bench, ensure-electron
```

`src/core` has no DOM, Node or Electron imports. `tsconfig.core.json` enforces it by having none of those libraries. That is what lets the same code run in the worker, in unit tests and in scripts.

### Data flow

1. A file is read into an `ArrayBuffer` and transferred to the worker (`{type:'open'}` in `src/renderer/src/worker/protocol.ts`).
2. The worker builds a `LogData` (`src/core/log.ts`): one index pass over the records, then lazy decoding per field into column arrays, cached.
3. `summarize()` in `logWorker.ts` runs the analyzers and returns a `LogSummary`: field list, robot state, match info, events, power report, health, roles. Derived fields are added under `/Brownout/...` and appear in the field tree like any other.
4. Panels ask for series with `client.getSeries(logId, key)` (a promise) or `client.peekSeries` (the cached value or undefined, and it starts the fetch). Canvases redraw when a series arrives.
5. Two analyses depend on the robot profile and run after opening, as separate requests carrying a sequence number so a stale answer is dropped: `subsystems` (power by subsystem) and `cameras`. Their results land on the log entry as `log.subsystems` and `log.cameras`. `undefined` means still computing; `null` or an empty list means nothing is set up.

### Time

Every series keeps raw log seconds. A log has one number, `offset`, and

$$t_{\text{aligned}} = t_{\text{raw}} + \text{offset}$$

Panels draw in aligned time. Aligned times are never stored in data. Changing the alignment mode only changes offsets.

Only the timeline moves shared time (cursor, visible range, playback). Panels may offer an explicit "jump to this moment" click and nothing more, unless the user turns on the setting that lets graphs and the field move time. The owner asked for this explicitly.

### State

Small stores made with `createStore` (`state/store.ts`), read in React with `useStore(store, selector)`, read anywhere with `store.get()`.

`useStore` caches its result per store state, so a selector must not close over props or state. Select the collection, then look up outside:

```ts
// wrong: stale when profileId changes
const p = useStore(profileStore, (s) => s.profiles.find((x) => x.id === profileId));
// right
const p = useStore(profileStore, (s) => s.profiles).find((x) => x.id === profileId);
```

Persistence is `localStorage`, one key per concern:

| Key | Holds |
|---|---|
| `brownout.settings.v1` | theme, colors, keybinds, compact, potato, and so on |
| `brownout.session.v1` | last session's log paths and nudges |
| `brownout.layout.v1` | the current panel layout |
| `brownout.presets.v1`, `brownout.presetState.v1` | saved layouts and which one is active |
| `brownout.profiles.v1` | robot profiles, per-log assignments, battery labels and history |
| `brownout.videos.v1` | per log file name: video path and sync |
| `brownout.prefs.v1` | alignment mode, season, alliance normalization, timeline size, sidebar state, tag map choice |

Custom field pictures are files under Electron's `userData/fields/<id>/`.

### Preset versus profile

A **preset** says where the panels go. A **robot profile** describes the robot and applies whichever preset or log is open. Anything that is true of the robot goes in the profile (`state/profiles.ts`): subsystems, cameras, robot parts, swerve order, robot size, controller layout, favorites, role overrides. A profile is chosen per log: a remembered assignment, else the best field-name match (score at least 0.5 when there are several profiles), else the last used one.

### Drawing

Canvas panels draw outside React through `useCanvas(draw, stores, deps)` in `lib/useCanvas.ts`. React renders toolbars, tables and menus. Moving the cursor must never re-render a React tree. Anything drawn against time uses per-pixel min/max decimation (`src/core/decimate.ts`).

### Roles, not keys

Analyzers and built-in presets find fields by role (battery voltage, robot pose, and so on) through pattern tables in `src/core/roles.ts`, and robot state through priority tables in `src/core/robotState.ts`. A team can correct a wrong guess, and the correction is saved in the profile as a role override. The same idea covers vision (`detectCameras`), controllers (`controllerKeys`) and commands (`detectCommandSources`).

### Feature notes you will need

- **Power by subsystem** (`src/core/analyzers/subsystems.ts`): all current sources are resampled onto one time base with zero-order hold. Energy is $E = \int V(t)\,I(t)\,dt$. Unassigned is total minus assigned. For each brownout it reports who was drawing at the dip and over the 0.5 s before.
- **Battery health:** a straight-line fit of $V = V_0 - I R$ gives resistance $R$. The rating thresholds (18 and 25 mΩ) are a rule of thumb and include wiring resistance.
- **Cameras** (`src/core/vision.ts`): a camera is a name plus up to three optional fields (pose estimate, tag IDs, tag poses) and an optional mount position. Limelight `botpose*` arrays carry the tag count at index 7 and tag IDs at index $11 + 7k$. A blind stretch is 2 s or more with no tag while enabled.
- **Video** (`panels/VideoPanel.tsx`, `state/videos.ts`): the sync is one number, `logMinusVideo`, and

  $$t_{\text{video}} = t_{\text{cursor}} - \text{offset} - \text{logMinusVideo}$$

  While playing, the video runs at the timeline's speed and is re-seeked when it drifts more than 0.3 s. The main process serves the file through the `brownout-media://` scheme with byte ranges; each picked file gets an opaque address, and only video file types are accepted.
- **Robot parts** (`lib/robotDraw.ts`): `drawLayers` is used by both the 2D field and the editor preview. The canvas is already at the robot's center and heading, with +x forward and −y to the robot's left. A picture's top edge is the robot's front. Limits: 24 parts, raster pictures downscaled to 512 px, SVGs up to 300 kB, all stored as inline `data:` URLs.
- **Match report** (`src/core/report.ts` builds the page, `lib/report.ts` gathers the data): a self-contained page with no scripts and no outside requests, printed by a hidden window with JavaScript off.

## 4. Key decisions and why

| Decision | Why |
|---|---|
| Electron + TypeScript + React, local only | Teams need it offline at events on Windows, macOS and Linux. Details in `docs/brownout-tech-stack.md`. |
| Pure `src/core` | One implementation for the worker, tests and scripts; analysis is testable without a browser. |
| All heavy work in a worker | A 100 MB log must not freeze the window. |
| Raw time in data, one offset per log | Re-aligning is instant and cannot corrupt data. |
| Only the timeline moves time | The owner's explicit request. |
| Roles and pattern tables, never hard-coded keys | It has to work on any team's logs. |
| Every data source optional | The owner: "if they don't have the April tag id, then they don't fill out that field." |
| Robot profile separate from presets | A layout is about the screen; subsystems and cameras are about the robot and must follow it across layouts and logs. |
| Own icon set, no emoji | The owner's rule: "never use emojis, use custom made icons." The UI test fails on any pictograph character in visible text. |
| One-row toolbars that overflow into a three-dot menu | Small screens. The owner sent a screenshot of cluttered panels and asked that extra buttons collapse into a triple dot. |
| Menus drawn in a floating layer on `document.body` | Toolbar rows clip their contents; menus inside them were invisible (a shipped bug in v0.4). |
| Blue highlight means "switched on" | A v0.4 bug lit "Fit" when the view was not fitted. Action buttons are never lit; they are disabled when there is nothing to do. |
| Field pictures and tag maps bundled | Works offline. They are WPILib's (BSD), credited in `THIRD_PARTY_NOTICES.md`. |
| Video synced by hand | There is no reliable automatic anchor between a phone video and a log. One number is easy to understand and to fix. |
| Report as script-free HTML printed to PDF | No PDF library needed, and log text can never execute. |
| Commands read from the scheduler's name list | The owner pointed out it is published to NetworkTables automatically. Limit: it lists top-level commands only. |

New decisions go in the decisions log at the top of `docs/frc-logging-landscape-and-viewer-requirements.md`.

## 5. Conventions

`AGENTS.md` has the full rules. The ones most often relevant:

- TypeScript strict. Prettier (`.prettierrc`). Run `npx prettier --write "src/**/*.{ts,tsx,css}" "scripts/*.mts"` once at the end of a change, not in the middle: it reflows long lines, and any text-matching edit you planned against the old layout will then fail.
- No hex colors in components. CSS uses theme variables; canvas code calls `T()` from `lib/theme.ts`. Log colors come from `log.color`.
- Commands go in the action registry (`lib/actions.ts`). Shortcuts, the native menu and the help sheet are generated from it.
- No `prompt()`, `confirm()` or `alert()`. Use `askText`, `confirmDialog`, `askChoice`, `askChecklist` and `toast` from `state/ui.ts`.
- Toolbars are built from `Toolbar`, `ToolButton`, `ToolSelect`, `ToolGroup`, `ToolSpacer` and `MenuButton`. Mark less-used controls `low`. Icon-only buttons need `text`.
- A menu item that opens a dialog closes its menu first.
- New capability in the main process: `preload/api.ts`, `preload/index.ts` and an `ipcMain.handle`, always with a browser fallback in the renderer (`window.brownout` is undefined in the browser build).
- Interface wording: plain words, written for someone who has never seen the app. Say what a thing does, not what it is called internally. When data is missing, say what is missing and how to log it.
- Recipes for adding a panel, a setting, a profile field, an analyzer, a derived field or a report section are at the end of `AGENTS.md`.

### Testing lessons

- Playwright scrolls a clipped element into view before clicking it, so a menu no user could see still passed. `menuState(page)` in `scripts/uitest.mts` checks that a menu is on screen and topmost at its corners. Use it for new menus.
- A new panel opens as a tab in the active group, and a hidden tab's content is unmounted. Click the tab (`.dv-default-tab` with the panel's title) before looking for its canvas.
- `page.waitForFunction` with a string breaks the app's Content Security Policy. Pass a function. `page.evaluate` with a string is fine.
- Canvas content cannot be read from the DOM. Compare a screenshot of the canvas with a feature on and off, and then look at the picture yourself.

## 6. Verification status

| Area | Checked how | Not checked |
|---|---|---|
| Reader, robot state, match info | unit tests, demo logs, **CURIE Q89** | an AdvantageKit log; a 2027 log |
| Power report, brownouts, battery health | unit tests, demo logs | any real log with battery voltage, total current or PDH channels |
| Power by subsystem | unit tests, demo logs, CURIE Q89 (per-motor current, no voltage: 12 V estimate) | real logs with voltage or PDH channels |
| Cameras | unit tests, demo logs, CURIE Q89 (three Limelights, `botpose_orb_wpiblue`; estimate error 0.07 to 0.23 m) | AdvantageKit vision template and PhotonVision in a real log |
| Controller | unit tests, demo logs, CURIE Q89 (`DS:joystick<N>`; numbering confirmed against the team's own button fields) | AdvantageKit joystick fields in a real log; PlayStation |
| Commands | unit tests, demo logs, CURIE Q89 (`Scheduler/Names`, 22 commands) | AdvantageKit `Commands*` folders in a real log |
| PathPlanner paths, swerve | demo logs, CURIE Q89 | |
| Video | a generated 20 s H.264 clip, on Linux | real match footage, long files, phone formats, Windows, macOS |
| Match report | one demo log and CURIE Q89, rendered and looked at; one page each | a log with many brownouts or long error text |
| Performance | `bench`: demo logs about 1 to 1.7 s per 100 MB; CURIE Q89 (71.5 MB) indexed in 0.23 s and opened in the app in about 1 s | a slow laptop; several large logs at once |
| Platforms | Linux under xvfb only | Windows and macOS, in any form |
| Installers | built by the release workflow on GitHub for Windows (installer + portable), macOS (Apple silicon + Intel, DMG and zip) and Linux (AppImage + .deb), all unsigned; published as the v0.5.1 pre-release; one download link checked; the packaged Linux app was launched and opened the demo logs | no installer has been installed or run on Windows or macOS |

### What the first real log found (all fixed in v0.5.1)

1. **Timestamps read as unsigned:** Limelight values logged before its clock synced have negative times, which made the log 584,000 years long. Now read as signed, and impossible times are placed at the previous record (`reader.ts`, `repairedTimestamps`).
2. **Built-in layouts opened empty graphs** for battery voltage, total current, loop time and CAN utilization, which this robot doesn't log. This is very likely the owner's unexplained "empty elevator graphs" report on v0.4. Presets now use only fields that exist, fall back to motor currents, logged watts or robot speed, and an empty panel says what is missing and how to log it (`lib/presets.ts`).
3. **The Power report said "no brownouts, the battery stayed above 6.75 V"** for a log with no voltage. It now says brownouts are not known.
4. **Robot pose was PathPlanner's `currentPose`**, which exists only during auto paths. Roles now skip vision, target and setpoint fields and prefer the field that covers the most of the log (`roles.ts`).
5. **Swerve states and the auto chooser were not found** under the team's names (`Current Modules States`, `Robot Container/Autonomous/active`).
6. **Subsystem suggestions put every motor in one subsystem called "Subsystems".** The folder after `Subsystems/` is now the subsystem.
7. **Subsystem energy was zero without battery voltage.** It is now estimated at 12 V and labeled so. Averages are over enabled time, and the time base keeps every motor's samples. A current field that swings below −10 A gets a stator-current warning.
8. **Console events:** WPILib's `Warning at ...` lines were counted as errors, the normal start-up message was counted as a restart, 21 identical joystick warnings made 21 events, and alerts in a team-named group (`Power`) were missed. All fixed; an overrun now names its slowest part.
9. **PathPlanner keeps the last active path after it ends**, so the last auto path appeared to last 218 s. A path now ends when its target pose stops updating.
10. **Pose jumps from vision corrections produced 30 m/s robot speeds.** Steps faster than 8 m/s are left as gaps in `/Brownout/Pose/Speed`.

Also from that pass:

- Command names are shortened with an ellipsis instead of squeezed, in a wider column.
- Camera tracks on the timeline are labeled by camera.
- The match report puts its credit line in the header, so it stays on one page. It lists the longest overruns while enabled and labels estimated energy.

## 7. Remaining work, in priority order

### P0: do these first

**1. Get more real logs.** One real log has been checked (section 6). Ask the owner for any of these; each covers features that have only run on synthetic data:
- a log with battery voltage, total current or PDH channel currents, for brownouts, battery health and the subsystem math with real voltage
- an AdvantageKit log, for its key names for robot state, vision, joysticks and commands
- a match where the robot browned out

For each log:
- Put it in `fixtures/local/`, then run `npm run reallog`.
- Read `smoke/real-summary.json`: robot state ranges, match info, roles, events, subsystems, cameras.
- Look at every `smoke/real-*.png` and `real-report.pdf`. Ask whether each panel shows what the log has, and whether each empty panel says why.
- Run `npm run bench`; it includes `fixtures/local/`.
- For every fix, add a hand-built case to `src/core/reallog.test.ts` with the real key names, and record the layout in `docs/frc-log-format-reference.md` (section 7a has the first one).

**2. Find out how the installers do on real computers.** v0.5.1's Windows and macOS installers built on GitHub, but nobody has installed them yet, and the owner's own operating system is not confirmed.
- Ask the owner (or their team) to install from the release page and try: open a log, each panel, a real video, the match report, copy panel as image.
- Likely trouble spots:
  - file paths in the video protocol (`registerVideo` and the `protocol.handle` in `src/main/index.ts`)
  - the clipboard
  - the PDF page size
  - on Apple-silicon Macs, an unsigned app may be reported as "damaged": the release notes give the `xattr -cr` fix
- When it has been confirmed on a platform, update the verification table (section 6) and consider taking the next release out of pre-release.

**3. Confirm the empty-graph bug is gone.** On v0.4 the owner sent screenshots of two graph panels of elevator fields with nothing drawn. It was never reproduced. The real log showed built-in layouts opening graphs for fields the log lacks (section 6, item 2), which is the likely cause.
- Ask the owner whether it still happens on v0.5.1.
- If it does, ask which layout and which fields. Other suspects: a field type the graph cannot plot, or values that are all NaN. A graph with fields that draw nothing should say why; it doesn't yet.

### P1: next

**4. PhotonVision raw results.** They are protobuf, which the reader shows as raw bytes.
- Port a protobuf decoder into `src/core` (AdvantageScope's `ProtoDecoder.ts` is BSD-3 and may be reused: `AGENTS.md` rule 21). Schemas are in the log under `/.schema/proto:*`.
- Surface decoded messages as fields, with generated children like structs.
- Add a PhotonVision case to `detectCameras`, `tagIdsFromValue` and `poseFromValue`, with unit tests.
- Teams that already log PhotonVision's pose estimate as a struct work today through the camera editor.

**5. 2027 control system check.** The 2027 key names were written from documentation, not from a log.
- With a real 2027 log, verify the controller button numbering and D-pad encoding (`controllerKeys(..., era2027)`), the scheduler field name, and robot state.
- After kickoff, add the 2027 field picture and tag map: recipe "New field season" in `AGENTS.md`.

**6. Performance on a real machine.**
- Open a 100 MB log on an ordinary team laptop. Watch load time, memory, and scrubbing with several graphs open.
- If slow: check that caches are hit (`decimated()` in `GraphPanel.tsx`, `stripRuns()` in `Timeline.tsx`), then that the Potato mode offer appears.
- The commands panel rebuilds its rows per series identity, and the controller panel redraws on every cursor move; profile both with three logs open.

**7. Close the gaps against the plan** (`docs/next-version-plan.md` lists them).
- Camera mount as a full 3D transform, if a team needs lines drawn from the true camera position. Today it is forward and left only. Extend `Camera.mount` in `state/profiles.ts` (with a guard in `normalizeProfile`), the editor, and the drawing in `FieldPanel.tsx`.
- Bumper colors in the robot editor. Today bumpers follow the alliance.
- Draw the robot's parts in the swerve panel too, through `drawLayers`.

**8. Video.**
- Detect HEVC and say so before the generic error where possible.
- Sound is muted on purpose, for autoplay and because several logs may have videos. Consider an unmute button for the selected log.
- Consider a "sync to the first robot movement" helper that jumps the timeline to the first non-zero drive output.

**9. Match report.**
- Let the user choose sections, and test with a log that has many brownouts to confirm it paginates cleanly.
- An event summary across several logs (one row per match) is a natural next step and fits the app's purpose.

### P2: later

Each of these is a self-contained feature. Follow the matching recipe in `AGENTS.md`, and read the UI spec section first.

| Item | Where to start |
|---|---|
| Timeline: drag to reorder tracks, findings track | `components/Timeline.tsx`; tracks are the `timelineTracks` list in `state/session.ts` |
| Prefer the logged match time over the derived one | `MATCH_TIME_KEYS` in `src/core/robotState.ts`, the time formats in `state/time.ts` |
| Derived expressions in graphs | a small expression evaluator in `src/core`, evaluated in the worker, shown as a derived field |
| Field heatmaps | `panels/FieldPanel.tsx`, binned in the worker |
| Mechanism (side view), XY plot | new panels; `docs/brownout-viewer-ui-spec.md` section 3. Leave the 3D field until someone asks for it |
| Drivetrain and Mechanism Tuning presets | `lib/presets.ts`; find fields by role, as the existing six do |
| Download from the robot, Driver Station folder watching, a log library | main process work; requirements doc section 8, P1 |
| Export a filtered WPILOG | `src/core/wpilog/writer.ts` exists and is used by tests and the demo generator |
| SVG export, workspace tabs, pop-out windows | see the status table |
| Code signing and auto-update | `docs/brownout-tech-stack.md` section 6 |

## 8. Known issues and risks

- **Only one real log has been checked**, and it lacks battery voltage. Detection may still miss on other teams' layouts, AdvantageKit's in particular. The app falls back to manual picking rather than crashing, but first impressions depend on detection working.
- **Demo logs are written by the same author as the detection code.** They prove the plumbing, not the assumptions.
- **Repaired timestamps** (negative or absurd times) are placed at the previous record's time. That is right for a device whose clock had not synced, but such a sample can land a few milliseconds off.
- **Robot speed ignores pose steps faster than 8 m/s** (vision corrections). A genuine teleport-like jump is hidden too, by design.
- **Without battery voltage, subsystem energy is an estimate at 12 V**, and without total current the shares are of the listed motors only. Both are stated in the panel and the report.
- **The controller panel offers ports 0 to 5** even when a port only holds one empty sample, as ports 2 to 5 do in CURIE Q89.
- **Generic command names** (`FunctionalCommand`, `SequentialCommandGroup`) appear as rows. They come from commands the team did not name; the app cannot do better.
- **Cameras prefer Limelight `botpose*` arrays.** CURIE Q89 also logs the team's own per-camera `Pose` and `Perceived April Tags`, which the camera editor can select instead.
- **Profiles live in `localStorage`** (roughly 5 MB per origin). Pictures are inline `data:` URLs. Several large pictures across several profiles could hit the limit, and the save then fails silently (`state/profiles.ts` catches the error). Fix: warn on failure, or move pictures to files under `userData`.
- **Video paths are remembered as absolute paths.** If the file moves, the panel asks for it again and keeps the sync.
- **Videos are keyed by log file name.** Two different logs with the same file name would share a video.
- **The tags-seen track colors** are assigned per distinct value, so a busy camera produces many colors. Readable, not pretty.
- **With three or more logs at the same spot,** the field's camera lines and labels overlap heavily. The Display menu can turn cameras off.
- **`npm install` reports six moderate vulnerabilities and some deprecation warnings.** They come from development dependencies; which packages was not investigated. Do not run `npm audit fix --force`: it upgrades across major versions and breaks the build.
- **Electron 45 specifics:** there is no `clipboard.writeImage`; `lib/capture.ts` uses `clipboard.write([new ClipboardItem(...)])`. H.264 playback relies on the codecs Electron ships.
- **Running the Release workflow twice at once** (a double tap on "Run workflow") makes one run release and the other fail with "Tag v… already exists". That failure is the guard working and changes nothing; it happened once for v0.5.1.
- **"Automatically delete head branches" is off** in the repo settings, so merged branches stay until someone deletes them: the owner in the browser, or a local session with `git push origin --delete <branch>`. Suggest turning it on if branches pile up.
- **The README's AI disclaimer quotes test counts** (45 unit tests, 181 UI checks) and lists the owner's main ideas. Keep both true when they change (section 10).
- **"Error: Electron uninstall"** on first run means the Electron binary did not download. `scripts/ensure-electron.mjs` handles it; behind a proxy, set `ELECTRON_MIRROR`. The owner hit this once.

## 9. Working with the owner

- The owner (RoboticsIsEpik on the license and commits, `SuppressedCoder` on GitHub) is building this for their FRC team. They steer by trying the app and sending screenshots, usually with a short note. Read the screenshots closely: which button is lit, which panel is empty. Their v0.4 report ("some of the categories don't work") turned out to be every toolbar menu being invisible.
- They often want an **outline first** ("do not edit anything yet"), then say "do it". When they ask for an outline, do not touch code.
- **They are often on their phone.** They cannot run a terminal there. Do the git and GitHub steps yourself, and give them steps they can do in a phone's browser: merging pull requests, deleting branches, running the Release workflow, editing and publishing releases. The GitHub app does not cover all of these; say "in your phone's browser" and mention switching to the desktop site if a button is missing.
- They get the code from GitHub now, and they have a clone on their computer which they open in VS Code with Claude Code. Send a zip only if they ask (section 10 has the command).
- **In a local session the terminal is theirs, not a sandbox.** What you run touches their real checkout, and a push uses their own credentials. Branch, commit and open the pull request yourself; still leave merging and publishing to them.
- They prefer math written in LaTeX in replies.
- Standing rules from them: no emoji, custom icons only; only the timeline moves time; it must stay usable on small screens; vision and everything else must be general, never tied to one team's field names.
- They asked for the large disclaimer at the top of the README saying the project is written entirely by AI from their ideas. Keep it, and keep it accurate.
- Never put a team's own log in the repo or a zip.
- Tell them plainly what was and was not tested.
- Asking for a real log is worth repeating. It unblocks more than any feature.

## 10. Release checklist

1. `npx prettier --write "src/**/*.{ts,tsx,css}" "scripts/*.mts"`
2. `npm run check`, `npm run uitest`, `npm run smoke`, `npm run bench`, `npm run web:build`, and `npm run reallog` when there are logs in `fixtures/local/`
3. Open every new or changed screenshot in `smoke/`, including `real-*.png` and `real-report.pdf`.
4. Update `README.md` (including the test counts and feature list in the AI disclaimer at the top), `AGENTS.md` if a rule changed, `docs/implementation-status.md`, and this file (sections 6 to 8).
5. The Claude Project holds copies of the docs under `claude/` (`brownout-implementation-status.md`, `brownout-next-version-plan.md`, `HANDOFF.md`, and the five specs). The files in the repo are the main copies; the Project copies are synced afterwards from a claude.ai chat. Change the repo file first, then tell the owner which Project copies need re-uploading.
6. Bump `version` in `package.json` and in the first two `version` fields of `package-lock.json`. Do not search-and-replace version strings in the lockfile: dependency versions can collide with the app's. The version is chosen by hand, following semantic versioning as explained to the owner:
   - PATCH (0.5.1 → 0.5.2) for fixes only
   - MINOR (0.5 → 0.6) for new features
   - MAJOR stays 0 until the owner decides it is ready, a sensible point being after it has been installed on Windows and Macs and used at an event
   - a dash (`0.6.0-beta.1`) for test builds, which the workflow publishes as pre-releases
7. Commit on a branch, push, and open a pull request; CI must pass.
8. **To publish a release:** after the version bump is merged, either run the **Release** workflow on `main` from the Actions tab with "Make a draft release" ticked (the workflow creates the tag `v<version>` itself), or push a tag (`git tag v0.5.1 && git push origin v0.5.1`). A version with a dash such as `0.6.0-beta.1` makes a pre-release. `.github/workflows/release.yml` builds the installers on Windows, macOS and Linux and creates a **draft** release with them attached; if a release for the tag already exists, it adds the installers to it. The owner reviews and publishes it. Only start a release when the owner asks. **A cloud session cannot create tags** (the git proxy and the GitHub API both refuse; branches and pull requests work), so from one the owner starts the release with the Actions button, or you trigger it with `gh api repos/SuppressedCoder/Brownout/actions/workflows/release.yml/dispatches --method POST -f ref=main -F 'inputs[release]=true'` if that endpoint is allowed. **A local session can push the tag itself** (`git tag v0.5.2 && git push origin v0.5.2`), which starts the same workflow. The same workflow test-builds the installers on any pull request that touches packaging (`electron-builder.yml`, `package.json`, `build/`, the workflow).
9. Releases so far: **v0.5.1** (2026-11-17, pre-release, started from the Actions tab by the owner).
10. If the owner also wants a zip, build it from the parent folder:

```bash
zip -qr brownout.zip brownout -x "brownout/node_modules/*" "brownout/out/*" "brownout/dist/*" \
  "brownout/smoke/*" "brownout/fixtures/demo/*" "brownout/fixtures/local/*" "brownout/src/renderer/public/demo/*" "brownout/.git/*"
```

## 11. File map

The files you will open most:

| File | What is in it |
|---|---|
| `src/core/log.ts` | `LogData`, `FieldInfo`, series types, lazy decode |
| `src/core/robotState.ts`, `roles.ts` | key tables: robot state, match info, roles |
| `src/core/analyzers/*.ts` | power, subsystems, events, health, stats, paths |
| `src/core/vision.ts`, `controller.ts`, `commands.ts`, `report.ts` | the v0.5 features' logic |
| `src/core/core.test.ts`, `viewers.test.ts` | unit tests |
| `src/core/reallog.test.ts` | unit tests built from the first real log's key names and quirks |
| `src/renderer/src/worker/protocol.ts`, `logWorker.ts`, `client.ts` | worker messages, analysis, the renderer-side client |
| `src/renderer/src/state/session.ts` | open logs, alignment, per-log results |
| `src/renderer/src/state/time.ts` | cursor, view, playback; the view is clamped here |
| `src/renderer/src/state/panels.ts` | panel types, settings, `PANEL_CATALOG`, what each panel accepts |
| `src/renderer/src/state/profiles.ts` | the robot profile and its guards |
| `src/renderer/src/components/Grid.tsx` | panel registration, panel frame, drops |
| `src/renderer/src/components/Toolbar.tsx`, `Menu.tsx` | one-row toolbars, floating menus |
| `src/renderer/src/components/Timeline.tsx` | the timeline |
| `src/renderer/src/panels/GraphPanel.tsx`, `FieldPanel.tsx`, `PowerPanel.tsx` | the three largest panels |
| `src/renderer/src/lib/actions.ts`, `presets.ts`, `icons.ts`, `theme.ts` | commands, built-in presets, icons, palette |
| `src/main/index.ts` | everything in the main process |
| `scripts/make-demo.mts` | the synthetic match generator; extend it when a feature needs new data |
| `scripts/uitest.mts` | the UI test; add a check for every UI behavior you add |
| `scripts/reallog.mts` | the real-log check (screenshots and a summary, no pass or fail) |
