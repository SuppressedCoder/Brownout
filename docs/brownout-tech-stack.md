# Brownout — Tech Stack & Architecture

*2026-11-08.* **Decided:** Brownout is built with **Electron + TypeScript**, and it is **vibe coded**: most code is written by AI coding agents from prompts (§9). A starter project was built the same day; the parts marked "In the starter" below exist in it. Everything else is a proposal until the team confirms it.

*2026-11-14 update:* the v1 app in this repository implements the stack below with one change: the line graph is a **custom Canvas 2D renderer** rather than uPlot (see `implementation-status.md`).

Builds on: `frc-logging-landscape-and-viewer-requirements.md` (decisions log, requirements, §9 architecture), `brownout-viewer-ui-spec.md` (panels, grid, presets), `brownout-vision-and-pathing-spec.md` and `frc-log-format-reference.md` (WPILOG details, reuse candidates).

---

## 0. The decision

**Electron + TypeScript**, chosen 2026-11-08.

**Why**
1. **Reuse.** AdvantageScope is built with Electron and TypeScript and is BSD-3 licensed. Brownout can reuse its WPILOG reader, struct and protobuf decoders, robot-state key tables and unit handling, as long as the license notice is kept (§5). These are the hardest, most bug-prone parts of a log viewer.
2. **Same rendering everywhere.** Electron ships its own Chromium, so graphs and field drawings look and perform the same on Windows, macOS and Linux. Tauri uses each OS's built-in WebView. On Linux that is WebKitGTK, and Tauri's own docs warn that canvas and WebGL can silently fall onto a slow path. Brownout is mostly charts and field drawings, and the 2027 FIRST DS runs on all three OSes.
3. **Learnable and maintainable.** TypeScript reads a lot like Java, which FRC programmers already know. One language covers the UI, the log parsing and the analysis, which matters on a team where members graduate every year.

**Costs we accept**
- Installers of roughly 80–150 MB and roughly 150–300 MB of memory at idle (typical published figures), versus about 2–10 MB and 30–50 MB for Tauri.
- An Electron upgrade every few months (§6).

**Alternatives considered**

| Option | Why not (for now) |
|---|---|
| **Tauri** (Rust core + web UI) | Much smaller and lighter, but two languages, the Linux rendering risk above, and slow bulk transfers between Rust and the UI (an informal test took about 200 ms on Windows to move 10 MB), so the design would have to keep all data in Rust. |
| **Native Rust + egui** | The most efficient option. Rerun, a robotics data viewer, is built this way, and WPILib's Glass and DataLogTool are native C++ apps on Dear ImGui/ImPlot. But it is Rust-only, has fewer ready-made UI parts, and none of AdvantageScope's code carries over. |

**When to revisit.** If memory with many logs open is still the bottleneck after following §3, move only the data core (not the UI) to Rust, compiled to WebAssembly. The core sits behind one API (§2), so the UI would not change.

---

## 1. Stack

| Part | Pick | Status | Notes |
|---|---|---|---|
| App shell | **Electron** | Decided; in the app (v45) | |
| Language | **TypeScript**, strict mode | Decided; in the app (6.0) | 6.0 rather than 7.0, because typescript-eslint only supports versions below 6.1 so far. |
| Build tool | **electron-vite** + **Vite** | In the app (6.0 / 8.x) | One config file (`electron.vite.config.mts`) builds main, preload and renderer. |
| Installers and updates | **electron-builder** | In the app (config only) | Windows, macOS and Linux installers. Signing and auto-update are not set up yet (§6). AdvantageScope uses it. |
| UI framework | **React** | In the app (19) | Largest ecosystem, and what AI coding tools know best (§9). dockview has React bindings. |
| Panel grid | **dockview** (MIT) | In the app (8.x, `dockview-react`) | Tabs, drag and drop, floating panels, pop-out windows, save/restore of layouts (`toJSON`/`fromJSON`). |
| App state | Small built-in store on `useSyncExternalStore` | In the app | No library. Components subscribe to one slice, so fast-changing state won't re-render everything. |
| Line graph | **Custom Canvas 2D** | In the app | Chosen over uPlot: discrete lanes, mode shading, stacked/difference comparison and per-log styling all needed custom drawing anyway, and the shared-cursor store integrates directly. uPlot stays an option if axis features outgrow the custom code. |
| Timeline tracks, 2D field, swerve, mechanism | **Custom Canvas 2D** | Timeline and 2D field in the app | Simple shapes, full control. |
| 3D field (later) | **Three.js** | Proposed | What AdvantageScope uses. |
| Data core | **`src/core`**, plain TypeScript in a Web Worker | In the app | WPILOG index and lazy decode, struct decoding, robot state, alignment, decimation, analyzers (power, health, events, stats, paths), CSV. No DOM, Node or Electron imports, so it also runs in tests and scripts. |
| WebAssembly | Only if profiling says so | Not needed so far | The TypeScript indexer reads at roughly 80–300 MB/s in Node (`npm run bench`). AdvantageScope's C indexer remains the reference. |
| Robot download (FTP), folder watching | Main process | Proposed | Candidate libraries: `basic-ftp`, `chokidar`. Verify when building. |
| Tests | **Vitest** for the core; built-in smoke test for the app | In the app | `npm run smoke` launches the app headless (xvfb on Linux), opens two demo logs and saves a screenshot. |
| Lint and format | Prettier config; ESLint proposed | Prettier in the app | A core-purity check is done by `tsconfig.core.json` (no DOM/Node libs). |
| CI | GitHub Actions: `npm run check`, bench, build, smoke | In the app | Runs once the repo is on GitHub. |

---

## 2. Process architecture

```
Main process (Node)              Renderer (React UI)                  Web Workers
- windows, menus, dialogs   <->  - dockview layout, settings     <->  - data core: index, decode,
- file reads, FTP, watching      - canvas panels (graph, field)        decimate, run analyzers
- auto-update                    - talks to main only via preload
```

- **Security: keep Electron's defaults.** Context isolation and the sandbox stay on; Node integration stays off. A preload script exposes a small typed API (`openLogDialog`, `readFile`, `saveFile`, `openJsonDialog`, `onOpenFiles`, `onCommand`, …). The renderer never gets raw Node access.
- **Log bytes move once.** Main reads the file and sends the bytes to the renderer. The renderer hands them to a worker as a transferable buffer (moved, not copied). Drag-and-drop reads the file directly in the renderer with the web File API.
- **One query API.** Panels and analyzers ask the core for fields, series, robot-state ranges and metadata (requirements §9 "Extensibility"). In the app: `client.getSeries(logId, key)` / `client.peekSeries` with a renderer-side cache.
- **Pop-out windows.** dockview pop-outs open a new window; in Electron that goes through `setWindowOpenHandler`. Shared state (cursor, selection, sessions) lives in stores, not in a window. Verify during prototyping.

---

## 3. Performance rules (from day one)

1. **Index once, decode lazily.** One pass over the file records each record's entry ID, byte offset and timestamp. A field is decoded only when a panel asks for it.
2. **Column storage.** Per field: a `Float64Array` of timestamps plus typed values.
3. **Per-pixel min/max.** A graph $w$ pixels wide gets at most about $4w$ points per signal (first/min/max/last per bucket). Whole signals never go to the canvas.
4. **Canvas panels draw outside React.** Graphs, the timeline and the field redraw in a `requestAnimationFrame` loop that reads from the shared cursor/time store. React renders only layout, menus and settings.
5. **Moving the cursor must not re-render React trees.** Panels subscribe to the cursor store directly.
6. **Budgets** (targets to validate):
   - Open a 100 MB WPILOG in about 3 s or less on a typical team laptop (`npm run bench` checks this).
   - Pan and zoom at 60 fps with a 2×3 grid of panels (proposed).
   - Memory grows with the fields actually viewed, not with file size (proposed).
7. **Measure with real logs.** Keep a fixture set: AdvantageKit, DataLogManager, Epilogue and DogLog logs, a 2027 FIRST DS log when available, and at least one 100 MB+ match log (in `fixtures/local/`, git-ignored).

---

## 4. Repository layout

```
brownout/
├─ src/
│  ├─ core/              WPILOG reader and writer, structs, robot state, alignment, analyzers, CSV
│  ├─ main/              Electron main process: window, menu, dialogs, IPC, CLI flags
│  ├─ preload/           the window.brownout bridge (typed API in api.ts)
│  └─ renderer/          React app: state stores, log worker, panels, timeline, grid, presets
├─ scripts/              make-demo, smoke, bench
├─ fixtures/             demo logs (generated); fixtures/local/ for large or private logs (git-ignored)
├─ docs/                 copies of the project specs, for coding agents
├─ AGENTS.md, CLAUDE.md  instructions for AI coding agents (§9)
└─ THIRD_PARTY_NOTICES.md
```

One npm package: it is simpler to vibe code (one install, one set of scripts). `src/core` stays isolated by `tsconfig.core.json`, so it can still move into its own package when a CLI is built.

---

## 5. Reusing AdvantageScope code

**License:** BSD-3-Clause, Copyright (c) 2021–2026 Littleton Robotics.
- Keep the copyright notice and license text in every copied file and in the app's notices (`THIRD_PARTY_NOTICES.md` and an About → Licenses screen).
- Don't use Littleton Robotics' or its contributors' names to endorse or promote Brownout without permission.

**Candidates** (paths in the AdvantageScope repo):

| File(s) | What it does | Plan |
|---|---|---|
| `src/hub/dataSources/wpilog/WPILOGDecoder.ts`, `WPILOGShared.ts` | WPILOG record parsing | Brownout has its own reader; use as a cross-check |
| `src/hub/dataSources/wpilog/indexer/wpilogIndexer.c` | Fast index pass in WebAssembly | Reference; adopt if the TypeScript indexer is too slow |
| `src/shared/log/StructDecoder.ts` | WPILib struct schemas and decoding | Brownout has its own; cross-check edge cases |
| `src/shared/log/ProtoDecoder.ts` | Protobuf decoding (uses `protobufjs`) | Port into `core` (not yet done) |
| `src/shared/log/PhotonStructDecoder.ts` | PhotonVision `photonstruct` decoding | Needed for v1.1 vision |
| `src/shared/log/RobotState.ts` | Key lists for enabled, autonomous, utility, alliance, DS and system time | Key priority adapted into `src/core/robotState.ts` |
| `src/shared/units.ts` | Unit handling and conversion | Reference |

Copy files into `src/core/vendor/advantagescope/` with their headers intact and adapt them there, so it stays clear what came from where.

---

## 6. Distribution and maintenance

- **Platforms:** Windows, macOS and Linux, each on x64 and arm64, matching the FIRST DS.
- **Code signing:** a Windows code-signing certificate (otherwise SmartScreen warns users), and macOS Developer ID signing plus notarization, which needs an Apple Developer account. Budget for both before a public release.
- **Auto-update:** electron-builder's updater, with GitHub Releases as the feed.
- **Electron upgrades:** Electron ships a new major version every 8 weeks and supports the latest three, so each version gets about six months of fixes. Plan two upgrades a year: one before kickoff and one after championships.
- **Offline:** nothing needs the network at runtime. Logs never leave the machine unless the user exports them.

---

## 7. Build order

1. **Skeleton** (done 2026-11-08): Electron + React + dockview window; open a WPILOG; field tree.
2. **Graph and timeline** (done 2026-11-14): canvas line graph fed by per-pixel min/max, shared cursor, mode bands from robot state.
3. **Multi-log** (done 2026-11-14): add more logs, align by auto start / first enable / teleop / wall clock / manual, overlay / stack / difference across logs.
4. **2D field and presets** (done 2026-11-14): pose trails, ghosts, PathPlanner overlay, saved layouts, five presets. AprilTag lines need a field JSON (bundled layouts pending).
5. **Next:** swerve and mechanism panels, vision panel, protobuf decoding, robot FTP download, bundled AprilTag layouts, installers and signing.

---

## 8. Open items

1. ~~React or Svelte?~~ React.
2. ~~uPlot or a custom canvas renderer?~~ Custom canvas (2026-11-14); revisit only if axis features outgrow it.
3. ~~npm workspaces or pnpm?~~ One npm package (§4).
4. Brownout's own license (requirements §10, question 6). BSD-3 code can be used under any license as long as its notices are kept.
5. Code-signing budget, and who owns the Apple and Windows signing accounts.

---

## 9. Vibe coding setup

**Decided 2026-11-08:** Brownout is vibe coded. Most code is written by AI coding agents (Claude Code, Cursor, GitHub Copilot, Codex) from prompts, while people steer, try the app and review. The repo is set up so agents can work safely:

- **Agent instructions.** `AGENTS.md`, which most tools read, holds the commands, the folder map, the rules from §2–§3, and how to add panels, analyzers and derived fields. `CLAUDE.md` imports it for Claude Code.
- **Specs in the repo.** These project docs are copied into `docs/` so agents can read them. The project copy is the original; update both when a decision changes.
- **Checks that run without a person:**
  - `npm run check`: strict typecheck (three configs) and unit tests.
  - A core-purity check (`tsconfig.core.json` with no DOM or Node types).
  - `npm run smoke`: launches the app, opens two demo logs, saves a screenshot and fails on renderer errors.
  - `npm run bench`: times the reader against the 3 s / 100 MB budget.
  - CI runs the checks, bench, build and smoke on every push.
- **Test data.** `fixtures/demo/` holds three synthetic 2026 matches (AdvantageKit + DataLogManager keys, structs, a brownout, loop overruns, a camera disconnect, PathPlanner-style paths, different alliances and pre-match idle times). `npm run make-demo` regenerates them.
- **Mainstream choices.** Electron, TypeScript, React and Vite are what AI tools know best, which is one more reason not to switch frameworks later.
- **Working habits.** One feature per prompt, pointing at the spec. Commit after each step that works. Record new decisions in the requirements doc's decisions log.

---

## Sources

- AdvantageScope source and LICENSE (BSD-3): https://github.com/Mechanical-Advantage/AdvantageScope
- Electron release cadence: https://electronjs.org/blog/8-week-cadence
- Tauri docs, Linux graphics issues: https://v2.tauri.app/develop/debug/linux-graphics/
- dockview: https://dockview.dev/docs/overview/introduction
- uPlot: https://github.com/leeoniya/uPlot
- Rerun (Rust, wgpu, egui): https://github.com/rerun-io/rerun
- WPILib source (Glass, DataLogTool): https://github.com/wpilibsuite/allwpilib
