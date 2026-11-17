# Brownout — FRC Logging Landscape & Log Viewer Requirements

*Research context for the Brownout project (FRC log viewer / log comparison app). Compiled 2026-11-07. Companion doc: `frc-log-format-reference.md` covers byte layouts, key names and time bases.*

**How to use this doc.** It is background for design decisions. Claims are sourced (see Sources). Items marked **[verify]** come from memory or a single secondary source. "→ Implication" lines are recommendations, not decisions.

## Decisions log

| Date | Decision | Consequences |
|---|---|---|
| 2026-11-08 | **Brownout will be a desktop app.** | Pulling logs from the robot over FTP and watching the FIRST DS log folder become normal features. (Hoot import through owlet was also enabled by this, but is dropped by the next decision.) Shell: **Electron** (decided the same day; see the last row). |
| 2026-11-08 | **WPILOG (`.wpilog`) is the only supported input format.** Brownout is for viewing the logs a team records itself. | No NI `.dslog`/`.dsevents`, `.hoot`, `.revlog`, RLOG or CSV import. Still covered: everything written by DataLogManager, Epilogue, the 2027 Telemetry API, AdvantageKit and DogLog; **2027 FIRST Driver Station logs** (they are WPILOG); and hoot/revlog files a team has already converted to WPILOG (with owlet, `revlog-converter` or AdvantageScope). Power and comms analysis must come from what the robot logs itself (battery voltage, brownout flag, PDH currents, loop timing), so Brownout should detect when these are missing and show teams how to log them (e.g. `DataLogManager` + `DriverStation.startDataLog`, AdvantageKit `SystemStats`/`PowerDistribution`, DogLog extras). The desktop choice still stands for robot FTP downloads and folder watching; owlet is no longer needed. |
| 2026-11-08 | **Brownout is a general WPILOG viewer *and* a comparison tool, with custom features added later.** | It must stand on its own for single-log viewing (teams shouldn't need AdvantageScope alongside it), while comparison remains the differentiator. Custom features are planned but not yet defined, so the architecture needs extension points from the start: pluggable panels, analyzers and derived fields on top of a shared data core (see §9 "Extensibility"). Supersedes the earlier "complement, don't clone AdvantageScope" positioning. |
| 2026-11-08 | **Vision and pathing support are required.** Brownout must show which AprilTags the robot can see, and support PathPlanner at minimum. | Covered in `brownout-vision-and-pathing-spec.md`. Visible-tag lines on the 2D field and a "Tags seen" timeline track, built from logged tag IDs plus season AprilTag layouts (welded/AndyMark) or from logged tag poses. A PathPlanner overlay (active path, target pose, actual pose) with path-following error analysis, auto routine detection and cross-match comparison, from PathPlanner's NT telemetry or its logging callbacks. Robot project import (`deploy/pathplanner/`) in v1.1. Choreo later. Requires handling both field frames (blue wall ≤2026, field center 2027) and per-season alliance flipping. |
| 2026-11-08 | **Brownout is built with Electron + TypeScript.** | Chosen over Tauri and native Rust (egui) for three reasons: reuse of AdvantageScope's BSD-3 code (WPILOG reader, struct/protobuf decoders, robot-state keys, units); identical Chromium rendering on Windows, macOS and Linux (Tauri's Linux WebView can put canvas/WebGL on a slow path); and one language students can learn and hand down. Accepted costs: installers of roughly 80–150 MB, higher idle memory, and Electron upgrades about twice a year. Speed comes from design: index once, lazy decode in Web Workers, per-pixel min/max. The proposed stack (React, dockview, uPlot, Three.js later, electron-builder), process architecture, repo layout and reuse plan are in `brownout-tech-stack.md`. |
| 2026-11-08 | **Brownout is vibe coded.** Most code is written by AI coding agents from prompts; people steer, test and review. | The repo carries agent instructions (`AGENTS.md`, imported by `CLAUDE.md`), copies of these specs in `docs/`, and checks that run without a person: `npm run check` (typecheck, lint, tests), a core-purity check, `npm run smoke` (launch + screenshot), `npm run bench` against a 106 MB log, and CI. Mainstream tools (Electron, TypeScript, React, Vite) were kept partly because AI tools know them best. A single npm package replaced the proposed workspaces. New decisions should be added to this log. Details: `brownout-tech-stack.md` §9. A starter project (open a WPILOG, list every signal with type, count, metadata and first values) was built the same day. |
| 2026-11-17 | **The timeline covers the match by default, and dragging in its lanes scrubs.** The owner: people want the timeline from auto to the end of teleop, and the overview's edges were hard to grab with no sign of a drag. | The overview and the view limits use the match (auto start to teleop end) unless switched to the whole log. A plain drag in the lanes moves the cursor (the time ruler, the middle button and the wheel pan), drags snap to mode changes, and every drag shows what it is doing. |
| 2026-11-17 | **Video sync gets its own view; seeks run one at a time.** The owner: the video stutters when dragged frame by frame. | Setting the video's time on every mouse move made Chromium restart seeks from the last keyframe. `chaseSeek` keeps one seek running and jumps to the newest target. The sync view unlinks video and log until Apply, so it can use its own keys and controls without breaking "only the timeline moves time". The sync is still one number. |
| 2026-11-17 | **Brownout flags where vision and the robot position disagree.** The owner: a large difference may be what threw off an action. | Two findings: a camera estimate 0.5 m or more from the robot pose for 0.25 s while enabled, and a pose step faster than a robot drives (a vision snap). Jumps in the first 0.5 s of a mode are left out, because code resets the pose there on purpose (the demo logs did exactly that at teleop start). Each finding names the auto path and the commands running, most specific first. They are point events of kind `vision`, so the timeline, console, Compare Matches and the report pick them up. |
| 2026-11-17 | **A video sync can carry a clock speed.** The owner's video drifted further out of sync as the match went on; the app itself was measured keeping a 1080p video within 5 ms of the timeline for 40 s, so the drift is in the recording. | The sync stays one number unless the user pairs a second moment; then `video = rate * (raw - logMinusVideo)`, with `rate` limited to 0.8 to 1.25 (outside that the pairing is taken as a mistake). One pair keeps the rate a video already has. This reverses part of the earlier "one number" decision, only when asked for. |
| 2026-11-17 | **Brownout offers a log's match video by its file name.** The owner approved it after the plan named the limits. | The main process lists video files (names and paths only) in two places: the folder of a log it read this run, and one videos folder the user picked through its dialog. A video named like the match is offered; it gets a playable address only when the user clicks "Use it". "Not now" is remembered per log file and video. |
| 2026-11-14 | **v1 app built** (P0 scope plus parts of P1), and the **line graph is a custom Canvas 2D renderer** rather than uPlot. | The app opens N WPILOGs, aligns them (auto start / teleop start / first enable / log start / wall clock / raw + manual nudge), and compares them in every panel: overlay / stacked / A−B graphs, per-log columns in tables and statistics, ghost robots on the 2D field with alliance normalization, interleaved console, a Compare Matches metrics table, a power report and path analysis per log. Five role-based presets, a track-based timeline, layouts as JSON, CSV export. uPlot was dropped because discrete lanes, mode shading and the comparison modes needed custom drawing anyway. Not yet built: protobuf decoding, swerve/mechanism/joystick/vision panels, robot FTP download and the library, bundled AprilTag layouts (a WPILib field JSON can be loaded), installers and signing. See `docs/implementation-status.md` in the repo. |

---

## 0. TL;DR

1. **WPILOG is the common format.** WPILib DataLog, Epilogue, AdvantageKit, DogLog and, from 2027, the FIRST Driver Station all write `.wpilog`. CTRE `.hoot` and REV `.revlog` are normally converted to WPILOG before viewing. Nailing WPILOG, including struct/protobuf schemas and metadata, covers most of the ecosystem.
2. **2027 resets the control system.**
   - Systemcore replaces the roboRIO and is required for 2027.
   - The new FIRST Driver Station writes its logs as WPILOG. NI `.dslog`/`.dsevents` become legacy (2010–2026).
   - Systemcore timestamps count from device boot. WPILib's APIs moved to nanoseconds internally, but files stay in microseconds.
   - Key names change: a `DS:controlWord` struct, "Utility" replacing "Test", OpModes, and renamed swerve/chassis structs.
   - → Implication: support both eras.
3. **One match produces many files.** A robot WPILOG, one hoot file per CAN bus (in a per-boot subfolder), a revlog, DS logs, and maybe video. Teams report about 30 MB per match, or about 80 MB of robot logs plus about 40 MB of hoot logs. Grouping a match's files and aligning their clocks are core problems.
4. **AdvantageScope is the incumbent.**
   - It ships with WPILib, is BSD-3 licensed, reads every format, and has excellent single-log visualizations.
   - Its multi-log mode merges files into one field tree (`Log0`, `Log1`, …) and aligns them by the first enable edge.
   - We found no cross-match summaries, trends or automatic diagnostics.
   - → Implication: Brownout must cover general single-log viewing well (decided 2026-11-08), but its differentiators are comparison, diagnostics, event-wide views and team-specific custom features.
5. **Teams look at power and comms first.**
   - Battery sag and brownouts: roboRIO stage 2 is at 6.3 V; roboRIO 2 defaults to 6.75 V and can be changed in code.
   - Per-channel current, trip time and packet loss, CAN utilization, loop overruns, faults, console errors.
   - The project's name fits: a power/brownout report is a natural flagship feature.
6. **What a good viewer needs:**
   - Fast loading of 100 MB+ files (index first, decode lazily, off the main thread).
   - Downsampling that preserves spikes.
   - A cursor synced across views.
   - Robot-state detection that works across key variants.
   - Unit awareness.
   - Flexible alignment for comparison.
   - Saved layouts and sessions, and export.

---

## 1. Control system context: 2026 vs 2027

| Aspect | ≤2026 (roboRIO + NI DS) | 2027+ (Systemcore + FIRST DS) |
|---|---|---|
| Robot controller | roboRIO 1 / 2 | Systemcore. Required for 2027; every team gets a 4 GB unit in the Kickoff Kit; storefront sales start 2026-11-18. |
| Driver Station | NI LabVIEW FRC DS (Windows only) | FIRST Driver Station, built by WPILib, on Windows/macOS/Linux (x64 and arm64). FMS works only on Windows or an approved appliance. |
| DS logs | `.dslog` + `.dsevents` in `C:\Users\Public\Documents\FRC\Log Files` | `.wpilog` with `FIRST_DS` in the name, in `~/.firstds` (Unix) or `Public Documents/FIRSTDriverStation/Logs` (Windows). Local web server at `http://localhost:6768` with an AdvantageScope Lite viewer at `/ascope`. |
| Robot log folder / name | `/home/lvuser/logs` or `/u/logs` (USB); `FRC_*.wpilog` | `/home/systemcore/logs` or `/u/logs`; `WPILIB_*.wpilog`. USB drives mount at `/U`, `/V`, … |
| Timestamps | FPGA µs since program start | Time since device boot (Systemcore and simulation), so values can start large. API in ns; files in µs. |
| Robot modes | Disabled / Auto / Teleop / Test | Disabled / Autonomous / Teleoperated / **Utility**, plus OpModes. `ControlWord` carries an `opModeHash`. |
| CAN | One roboRIO bus, plus CANivore | Several buses (`can_s0`–`can_s4`), plus vendor buses |
| User telemetry APIs | SmartDashboard, NT, DataLog, Epilogue | New `Telemetry` / `TelemetryTable` facade (default NT backend at `/Telemetry`), unit metadata via properties, and a `Tunable` API for dashboard inputs |
| Kinematics struct names | `ChassisSpeeds`, `SwerveModuleState` | `ChassisVelocities`, `SwerveModuleVelocity` |
| AdvantageScope | Desktop app (Electron) | Desktop app, plus AdvantageScope Lite in the browser, served by the FIRST DS and installable on Systemcore |

→ Implication: 2026 logs stay relevant through the offseason and for history, while 2027 kickoff is about two months away. Put robot-state and match-info lookups behind a key-mapping layer (format reference §1.10) so both eras work.

---

## 2. Who produces logs

| Producer | Output | On by default? | What it captures | Notes |
|---|---|---|---|---|
| **WPILib DataLog / DataLogManager** | `.wpilog` | Opt-in (`DataLogManager.start()`) | Every NT change by default (`NT:` prefix); optional DS and joystick data (`DS:`); `messages`; console output; `systemTime` about every 5 s | File I/O runs on a separate thread; each log call is mostly a mutex plus a copy; default flush period 0.25 s. File names go TBD → date → date + event + match. When free space drops below 50 MB it deletes the oldest logs, keeping at least 10 files. |
| **Epilogue** (WPILib 2025+, Java) | NT by default, or a file backend | Opt-in (`@Logged`, `Epilogue.bind`) | Annotated fields and methods under `/Robot/...` | Importance levels. Logging runs half a period offset from the main loop, so it can lag control data slightly. Works with CTRE's `HootEpilogueBackend`. |
| **WPILib Telemetry API** (2027) | Through backends (NT by default; DataLog possible) | Used by robot code | Hierarchical tables, struct/protobuf values, `TelemetryLoggable` objects | Units travel as entry properties. Typed tables carry a `.type` entry. Duplicates may be suppressed. The design doc says tools must tolerate fields appearing over time. |
| **AdvantageKit** (Team 6328) | `.wpilog` (2023+); `.rlog` in 2022 | Opt-in; requires an IO-layer code structure | All inputs (via `@AutoLog` IO layers), outputs (`Logger.recordOutput`), plus built-ins | Deterministic replay. Built-ins include `DriverStation`, `SystemStats`, `PowerDistribution`, `LoggedRobot/*` timing, `Console`, alerts, `RadioStatus` (VH-109, about every 5 s) and metadata such as the git SHA. Every value in a loop cycle shares one synchronized timestamp. Live streaming via NT4 or the RLOG server. 2027 alpha builds are v27.x. |
| **DogLog** (Java, by Jonah Snider) | NT + `.wpilog` | Opt-in | `DogLog.log(key, value)`; optional "extras" (PDH currents, CAN usage, radio); faults reported as Alerts; tunables; timing helpers; units | 2027 builds are rewritten on the WPILib Telemetry API and capture all Systemcore stats. |
| **Monologue** | NT / DataLog | Opt-in | Annotation-based | Listed in WPILib docs through 2024; superseded by Epilogue [verify status]. |
| **PyKit** (Team 1757) | `.wpilog` [verify] | Opt-in | Deterministic logging and replay for Python robot code | — |
| **CTRE Phoenix 6 SignalLogger** | `.hoot` (proprietary) | **Yes**: roboRIO 2, or roboRIO 1 with USB. Starts ≥1 s after program start once enabled, or ≥5 s after start once the DS connects. | Every status signal at its configured rate, with CAN timestamps, independent of the robot loop. Custom signals with units, structs and latency compensation. | One file per CAN bus; in 2026, one subfolder per program run. Stops below 5 MB free. Without a Pro device in the log, only a free subset of signals exports. |
| **REV StatusLogger** (REVLib 2026+) | `.revlog` | **Yes**, at the first REVLib device | Raw CAN status frames from SPARK MAX/Flex, Servo Hub, MAXSpline Encoder | `REV_YYYYMMDD_HHMMSS.revlog`. Free-space safeguards at 100 / 50 / 5 MB. Converted with AdvantageScope or `revlog-converter`. |
| **URCL** (unofficial, from 6328) | Publishes to NT → captured in `.wpilog` | Opt-in | Periodic CAN frames from REV devices | The predecessor to StatusLogger; both are available in 2026. |
| **NI Driver Station** (≤2026) | `.dslog` + `.dsevents` | **Always**, on the DS laptop | 50 Hz trip time, packet loss, battery voltage, CPU, CAN %, Wi-Fi dB/Mb, mode/brownout/watchdog flags, PD channel currents; events (errors, FMS info, reboots) | CSAs check these first. |
| **FIRST Driver Station** (2027+) | `.wpilog` | **Always** | Console lines, `ErrorInfo`, `ProgramCrashInfo`, control word, match info | Gamepad axes are now 16-bit. Full field list not yet documented [verify with samples]. |
| **Coprocessors** (PhotonVision, Limelight) | NT topics → robot WPILOG | n/a | Vision results | Captured by DataLogManager or AdvantageKit. PhotonVision publishes custom structs. |
| **Live sources** | NT4 (port 5810), AdvantageKit RLOG server, Phoenix diagnostics, FTC Dashboard | — | Live values | AdvantageScope supports all of these. |

---

## 3. A match produces a bundle of files

A typical competition match can leave behind:

- **Robot:** `FRC_20260321_183045_NYROC_Q23.wpilog` (2027: `WPILIB_…`). It holds DataLogManager or AdvantageKit data, plus any Epilogue/DogLog data in the same file.
- **CTRE:** a per-boot subfolder named by program start time, containing one `.hoot` per CAN bus (e.g. the rio bus plus a CANivore).
- **REV:** `REV_20260321_183012.revlog`.
- **DS laptop:** `2026_03_21 18_30_40 Sat.dslog` + `.dsevents` (≤2026), or `FIRST_DS…wpilog` (2027).
- **Video:** from The Blue Alliance, YouTube or local files. FMS logs exist but are not published to teams.

**Sizes.** One team reported match logs around 30 MB from power-on to power-off. Another averaged about 80 MB of data logs plus about 40 MB of hoot logs per match. Plan for 100+ MB per match bundle with heavy logging, which adds up to several GB per event (extrapolated).

**Why bundles are hard**
- Files start at different moments (power-on vs DS connect vs FMS connect) and use different clocks.
- File names mix UTC (DataLogManager) and local time (NI DS).
- DataLogManager renames its file once the DS connects and again once the FMS supplies the match number.
- Hoot and REV files are named by their own start times.

→ Implication: make **Match / Session** a first-class object: a set of sources plus per-source time offsets. Group files automatically using event and match tokens in names, wall-clock overlap (`systemTime`, `EpochTimeMicros`, DS header time) and enable-edge matching, with manual override.

---

## 4. How log data is processed, end to end

### 4.1 On the robot: capture → serialize → buffer → write

- **DataLog.**
  - `append` = take a mutex + copy into a buffer; a background thread writes to disk (DataLogManager flushes every 0.25 s by default).
  - Each entry begins with a Start control record. Struct and protobuf schemas go under `/.schema/...` on first use.
  - The NT mirror subscribes to every topic and logs each change with an `NT:` prefix. Its metadata is `{"properties":…,"source":"NT"}`.
  - When a topic is unpublished, its entry is Finished; republishing starts a new entry with the same name.
- **AdvantageKit.**
  - Each loop cycle: read inputs → record them → run user code → record outputs.
  - The FPGA timestamp is read once per cycle and injected into WPILib, so every value in a cycle shares that time.
  - Data receivers run on a separate thread; their backlog shows up as `Logger/QueuedCycle`.
- **CTRE.** Phoenix's native layer records status frames as they arrive on CAN, at their configured rates, unaffected by robot-loop timing or Java GC.
- **REV.** StatusLogger records raw CAN frames. Bits are decoded into named signals later, during conversion.
- **NI DS.** The DS laptop writes one status record every 20 ms, plus event text.

### 4.2 Getting logs off the robot

- **USB stick in the robot.** FAT32 for the roboRIO; Systemcore mounts drives at `/U`, `/V`, ….
- **Network download.**
  - AdvantageScope "Download Logs" works on roboRIO and Systemcore. In 2026 it switched from SFTP to FTP, which is 2–4× faster, and it can download hoot subfolders.
  - WPILib DataLogTool: SFTP download (user `lvuser`, blank password, on the roboRIO) and CSV export.
  - The NI DS "Upload WPILogs" button copies logs to `C:\Users\Public\Documents\FRC\Log Files\WPILogs`.
  - Phoenix Tuner X downloads hoot files.
  - The FIRST DS web server serves DS logs.
- **Storage pressure.** Every logger auto-deletes old files when space runs low (DataLogManager below 50 MB, REV below 50 MB, CTRE at 50 MB with a hard stop at 5 MB). Teams that don't pull logs promptly lose them.

→ Implication: a pit workflow that pulls every new log from the robot and the DS folder into a local library is valuable (P1).

### 4.3 Conversion

- **hoot → WPILOG/MCAP:** `owlet -f wpilog in.hoot out.wpilog`, or Tuner X's Log Extractor. Requires CTRE EULA acceptance and an owlet build matched to the log's version ("compliancy"). AdvantageScope downloads owlet automatically and converts to a temporary WPILOG.
- **revlog → WPILOG:** `@rev-robotics/revlog-converter` (Node CLI or library), or AdvantageScope.
- **WPILOG → CSV:** DataLogTool or AdvantageScope. **WPILOG → MCAP** (for Foxglove): AdvantageScope. Data recorded with URCL must be exported through AdvantageScope with "Include Generated" before SysId can read it.
- **DS logs:** parsed directly; no official converter exists. Third-party readers: DSLOG Reader 2 (part of the CSA USB tool) and AdvantageScope.

### 4.4 Decoding inside a viewer: AdvantageScope as reference architecture

- **WPILOG indexing.** A WASM indexer (C compiled with Emscripten) scans the file once and records each record's entry ID, byte offset and the min/max timestamps. Fields are then decoded **lazily** in a worker when the user asks for them. Robot-state keys are decoded eagerly so the timeline can be drawn immediately.
- **Struct and protobuf values** expand into "generated" child fields (shown gray; exported with "Include Generated").
- **Robot state** (enabled / auto / teleop / utility) comes from a priority list of known keys across AdvantageKit, DataLog before and after 2027, FIRST DS, NI DS, Phoenix and NT. Control words are decoded with bit masks.
- **Units**, in order of precedence: native units of known structs, then metadata `unit`/`units`, then a unit suffix in the field name (e.g. `PositionMeters`).
- **DS logs** are parsed in a worker, and `.dslog`/`.dsevents` are paired by basename.
- **Hoot and revlog** are converted to WPILOG in the main Electron process, then parsed as WPILOG.

### 4.5 Time alignment (the heart of comparison)

**Clocks.** Robot DataLog uses FPGA µs (roboRIO) or time since boot (Systemcore). Wall-clock anchors are DataLogManager's `systemTime` (µs Unix UTC) and AdvantageKit's `SystemStats/EpochTimeMicros`. NI DS logs have an absolute LabVIEW start time and an implied 20 ms record period. Hoot and revlog files have their own time bases [verify]. Video has frame times.

**Strategies**
1. **First-enable edge.** AdvantageScope's `mergeWith()` shifts the added log by (target's first enable time − source's first enable time). It is simple and works for sources from the same match, but fails if a source missed the enable or contains several enables.
2. **Phase anchors:** auto start, teleop start, match end.
3. **Wall clock:** `systemTime`, `EpochTimeMicros`, the DS header time.
4. **Manual nudge.**
5. **Signal cross-correlation**, e.g. battery voltage in the DS log vs the robot log.

**Comparing different matches** (different days, different boots) needs *relative* alignment ("t = 0 at auto start", or match time), not absolute clocks. **Video** syncs by OCR of the score overlay (AdvantageScope's automatic mode) or by marking the start of auto by hand.

→ Implication: alignment should be explicit, set per source, editable, shown in the UI, and saved with the session.

---

## 5. What teams actually analyze

A post-match checklist, from CSA guidance, Chief Delphi threads and community tools:

1. **Power**
   - Battery voltage: minimum and average while enabled, and sag under load.
   - Time spent below thresholds, brownout events, per-channel PDH/PDP current (which mechanism was drawing at the dip), total current, energy used, battery identity and health across matches.
   - roboRIO brownout stages:
     - Stage 1 at 6.8 V: the 6 V rail starts to drop.
     - Stage 2 at 6.3 V: outputs disabled until voltage recovers above 7.5 V. The roboRIO 2 default is 6.75 V, settable with `RobotController.setBrownoutVoltage()`.
     - Stage 3 at 4.5 V: device blackout.
   - Brownouts increment the DS "12V fault" counter and are recorded in the DS log.
   - Systemcore thresholds are not yet documented separately [verify for 2027].
   - Useful physics:
     - $V_{\text{term}} = V_{\text{oc}} - I\,R_{\text{int}}$
     - $R_{\text{int}} \approx -\Delta V/\Delta I$ at current peaks
     - $E = \int V(t)\,I(t)\,dt$, with $E_{\text{Wh}} = E_{\text{J}}/3600$
   - The "Juice" analyzer computes internal resistance at peaks above 15 A, an open-circuit voltage estimate, time below 8.5 V and below 6.3 V, and energy against a 216 Wh battery. Teams also compare brownout counts per battery across matches.
2. **Comms**
   - Trip time, packet loss, radio status (VH-109), DS/FMS connect and disconnect events.
   - "Robot Program Starting" in the events means a reboot.
3. **Code health**
   - Loop time, e.g. `LoggedRobot/FullCycleMS` above the 20 ms loop period; loop-overrun messages; GC time; CPU; memory.
4. **CAN**
   - Utilization: the DS-log trace is noisy, so read the stable baseline.
   - Bus errors, device faults (sticky faults in hoot/revlog), missing devices.
5. **Mechanisms**
   - Setpoint vs measured error, stator/supply current at limits, temperatures, stalls.
6. **Drivetrain and localization**
   - Odometry vs vision poses, pose jumps, autonomous path-following error, un-commanded yaw, swerve module states.
7. **Driver inputs**
   - Joystick axes and buttons vs robot response.
8. **Events**
   - Console errors and warnings, crash info, WPILib persistent alerts, DS events.
9. **Code version**
   - Git SHA, branch and build date (AdvantageKit metadata or the `/Metadata` table), so matches can be compared across code versions.

**Evidence of demand**
- CSA training material says to check logs early, using DSLOG Reader 2 or AdvantageScope. For "robot and RSL jittering on field", the DS log shows voltage dips and brownouts; the fix is the power path, the battery and the current draw.
- R U HURT (Team 8592) checks motor power loss, CAN faults, un-commanded swerve yaw and connected motors across AdvantageKit WPILOG, revlog and hoot files.
- The "Juice" web analyzer computes battery metrics from DS logs.

→ Implication: build an **automatic per-match report** (in the spirit of PX4 Flight Review) covering these checks with configurable thresholds. Every finding should link to its moment on the timeline.

---

## 6. Existing tools

| Tool | Type | Strengths | Gaps relevant to Brownout |
|---|---|---|---|
| **AdvantageScope** (6328) | Desktop (Electron) + Lite (web); BSD-3 | Reads WPILOG, DS logs, hoot, revlog, Road Runner, CSV, RLOG; live NT4 / Phoenix / RLOG / FTC Dashboard. Line graph (unit-aware, integrate/differentiate, discrete tracks, robot-mode and alert overlays). 2D and 3D field, table, console (filter, `!` to exclude, ANSI colors), statistics (histogram, many measures, filters for full log / enabled / auto / teleop, reference and relative-error mode), video with automatic sync, joysticks, swerve, mechanism, points, metadata. Export to CSV, WPILOG or MCAP. Layout import/export, pop-out windows, log download from the robot. | Multi-log alignment uses one strategy (first enable), and we saw no user-editable offset in the docs [verify]. Added logs nest under `LogN/`, so comparing means dragging `Log0/...` and `Log1/...` by hand. No cross-match summaries, trends or automatic diagnostics. |
| **NI DS Log Viewer** (≤2026, Windows) | Desktop | The official DS-log view: trip time, lost packets, voltage, CPU, mode, events; filters | DS logs only; one log at a time; legacy after 2026. |
| **DSLOG Reader 2** | Desktop | DS-log viewer used by CSAs (part of the CSA USB tool) | DS logs only. |
| **WPILib DataLogTool** | Desktop | SFTP download, CSV export | Not a viewer. |
| **Glass / OutlineViewer / Elastic / Shuffleboard** | Live dashboards | Live NT viewing; Glass has plots | Not built for log analysis. |
| **Phoenix Tuner X** | Desktop / mobile | Live plots, hoot extraction, Hoot Replay (non-deterministic) | CTRE devices only. |
| **SysId** | Desktop | Reads WPILOG for system identification | Single-purpose. |
| **Foxglove / PlotJuggler** | General robotics viewers | Foxglove: comparison mode across data sources, layouts, TypeScript user scripts, MCAP indexing. PlotJuggler: drag-and-drop, Lua transforms, saved layouts, millions of points. | Don't read WPILOG natively (MCAP/CSV only); no FRC semantics. |
| **Community analyzers** | Various | R U HURT (Python, multi-format health checks); Juice (web, battery analytics); `wpilog-parser` (TS, MIT, CLI plus agent skill); RobotPy `DataLogReader`; AI-assisted analysis experiments | Fragmented, single-purpose, mostly command-line. |

→ Positioning (updated 2026-11-08): **a complete WPILOG viewer that is best at many logs.** Single-log viewing must be good enough to use on its own; comparison, summaries, diagnostics, event workflow and custom features are where Brownout stands out. Heavy visualizations AdvantageScope already does well (3D field, video sync) can come later or be handed off via WPILOG export.

---

## 7. General must-haves for log viewers

Distilled from AdvantageScope, PlotJuggler, Foxglove and FRC needs.

**A. Ingest**
- Open by drag-and-drop, file dialog or whole folder; many files at once. (General viewers also pair companion files such as `.dslog` + `.dsevents`; not needed for Brownout's WPILOG-only scope.)
- Detect formats by magic bytes (`WPILOG`), not extension.
- Tolerate truncated tails, unknown types, duplicate entry names, entry-ID reuse and out-of-order timestamps.
- Decode struct/protobuf values from schemas inside the same log; fall back to raw bytes.

**B. Performance and scale**
- Open 100–500 MB logs with thousands of fields within seconds.
- Index first, decode lazily, and keep parsing off the UI thread (workers, WASM). Use columnar typed arrays; show progress; allow cancel.
- **Downsample with per-pixel min/max** so one-sample brownout dips and current spikes stay visible. Averaging and LTTB-style decimation can drop them.

**C. Data model and navigation**
- A hierarchical field tree built from `/` paths, with fuzzy search, type and unit badges, and metadata tooltips.
- Hide internals (`/.schema/...`, `$` meta topics) by default. Favorites/pins.

**D. Time and synchronization**
- One cursor and selection shared by every panel. Zoom, pan, range selection, delta measurement, keyboard shortcuts, playback with speed and loop.
- Shade by robot mode and match phase; jump to enable / auto / teleop.
- Time display modes: from zero, original, match time.

**E. Visualization**
- **Line graph:** multiple axes, discrete/boolean/enum state tracks, step rendering (sample-and-hold), per-series styles, auto or locked ranges, legend values at the cursor.
- **Table** of value changes; **console/events** with filter, severity highlighting and ANSI colors; **histograms and statistics**.
- **2D field** with pose trails, plus swerve, mechanism and joystick views; 3D later. Tiers and details are in `brownout-viewer-ui-spec.md`.

**F. Analysis**
- Derived fields: arithmetic, derivative, integral, filters, expressions.
- Setpoint-vs-measured error; statistics over ranges and match phases; threshold and anomaly events; unit conversion.

**G. Comparison (Brownout's core)**
- Overlay the same signal across N logs, one color per source.
- Alignment modes: first enable, auto start, teleop start, wall clock, manual offset, cross-correlation. Normalize to match time.
- Difference view ($A - B$ after resampling with the previous value). Small multiples. A summary table of per-log metrics. Trend charts across an event.
- Real vs replay comparison for AdvantageKit (`RealOutputs` vs `ReplayOutputs`).

**H. Persistence and sharing**
- Save and load layouts (JSON) and sessions (files + offsets + layout).
- Export the selection as CSV, PNG/SVG, WPILOG or MCAP. Shareable reports (HTML/PDF). Annotations and bookmarks.

**I. Robustness and UX**
- Clear errors (unsupported version, missing schema). Dark mode. Colorblind-safe palettes.
- **Works offline**: venue internet is unreliable. Cross-platform.

---

## 8. Proposed requirements for Brownout (prioritized draft)

> **UI and views:** the timeline, panel catalog (2D field, swerve, mechanism, 3D), grid layout and presets are specified in more detail in `brownout-viewer-ui-spec.md` (proposal, 2026-11-08). Where its tiers differ from the lists below, that spec is the more detailed proposal.
>
> **Vision and pathing:** visible-tag lines, the "Tags seen" track, vision pose ghosts, the PathPlanner overlay and path-following analysis are specified in `brownout-vision-and-pathing-spec.md` (2026-11-08). Its §4 says what lands in v1 vs v1.1.

### P0 — MVP: open, align, compare, diagnose power

1. Parser: WPILOG v1.0 only (decided 2026-11-08) — all standard types, `struct:`/`proto:` with schemas, metadata. This also opens FIRST DS logs (2027) and hoot/revlog files already converted to WPILOG. Other formats get a clear "convert to WPILOG first" message.
2. Robot-state and match-info extraction across key variants (format reference §1.10), including 2027 `DS:controlWord`.
3. Loader: index plus lazy decode in a worker, progress, truncated-file tolerance.
4. Field browser with search, types and units.
5. Time-series panel: multiple axes, discrete tracks, synced cursor, zoom/pan, delta, phase shading, min/max decimation.
6. Multi-log sessions: add N logs; per-log offsets; alignment modes (first enable, auto start, teleop start, wall clock, manual); overlay one field across logs; match-time x-axis.
7. Match bundles: group WPILOG files from the same match (robot log, 2027 FIRST DS log, converted vendor logs) by time and file name; one merged timeline per match.
8. Per-match power report (from robot-logged data; flag missing signals and explain how to log them):
   - Minimum and average voltage while enabled; time below thresholds.
   - Brownout count and duration, from logged brownout state (e.g. AdvantageKit `SystemStats`, or `RobotController.isBrownedOut()` logged by the team) or inferred from voltage below the threshold.
   - The highest-current channels at each voltage minimum; energy in Wh.
   - Every finding links to its moment on the timeline.
9. Console/events panel with filtering and severity highlighting, plus a table panel of value changes (both needed for general single-log viewing).
10. Save/load layouts; CSV export of chosen fields over a chosen range.
    - Also proposed for P0 by the UI spec: a 2D field panel, a dockable multi-panel grid, a customizable track-based timeline, and four built-in presets.

### P1 — Event-scale comparison and diagnostics

11. ~~Hoot/REVLOG import~~ — dropped (WPILOG only). Instead: a "logging health" check that lists which recommended signals (battery, brownout, PDH, loop time, DS state, git SHA) a log is missing, with setup snippets.
12. Event dashboard: every match in a sortable table with key metrics (power, comms, loop timing, CAN, faults), sparklines and trends; filters by match type.
13. Rule-based diagnostics with editable thresholds: loop overruns, CAN %, packet loss, trip time, motor faults, temperatures, current-limit saturation, pose jumps. Each match gets a findings list.
14. Statistics and distributions per match phase and per log (overlaid histograms, percentiles).
15. Derived fields and expressions (error, summed currents, derivative, integral).
16. 2D field with pose overlays from several logs, e.g. to compare autos as "ghosts" (the UI spec proposes moving the 2D field to v1). Swerve, mechanism, joystick and XY-plot panels (v1.1 in the UI spec).
17. Code-version awareness: show git SHA/branch/build per log; group comparisons by version.
18. Pull `.wpilog` files from the robot (FTP) and watch the FIRST DS log folder, importing everything into a local library.

### P2 — Later / differentiators

19. Battery tracking: tag the battery used in each match; estimate $R_{\text{int}}$ and health trends.
20. AdvantageKit real vs replay difference view.
21. The Blue Alliance / FRC Events integration: schedule, results, alliance partners, video links.
22. Live NT4: record a session and compare it against a reference run.
23. Video sync and 3D field (or a handoff to AdvantageScope).
24. Exportable reports (HTML/PDF) for drive teams and CSAs; MCAP/Parquet export; optional AI-written summaries.
25. Custom features (to be defined), built on the extension points in §9. Internal-only at first; a public plugin API can come later if wanted.

**Non-functional:**
- Offline-first.
- Open a 100 MB WPILOG in about 3 s or less on a typical team laptop (target to validate).
- Bounded memory use.
- Cross-platform; accessible color palettes.

---

## 9. Architecture implications

**Platform: desktop (decided 2026-11-08).** With WPILOG as the only input, owlet is no longer a factor; desktop is still the better fit for FTP downloads from the robot and watching the DS log folder. Keeping the parsing/analysis core as a separate library is still worthwhile so a CLI for batch event reports can reuse it later.

**Desktop shell: Electron + TypeScript (decided 2026-11-08).** Stack, process architecture, performance rules and the AdvantageScope reuse plan are in `brownout-tech-stack.md`. The comparison below is kept as the rationale.

| Option | Pros | Cons |
|---|---|---|
| **Electron** (TypeScript) | Same stack as AdvantageScope, so its BSD-3 WPILOG/struct/proto decoders and `wpilog-parser` (MIT) drop in directly; mature tooling; FTP libraries readily available | Large installers (~100 MB+) and higher memory use; Chromium updates to track |
| **Tauri** (Rust core + web UI) | Small installers and low memory; Rust is well suited to fast WPILOG indexing and min/max decimation; WPILOG is simple enough that writing a Rust parser is a small job | No mature Rust WPILOG reader to reuse (the `wpilog` crate looks writer-focused); system WebView differs per OS (WebKitGTK on Linux, WebKit on macOS), so rendering must be tested on each; smaller FRC precedent |

Requirements:
- Windows, macOS and Linux builds (x64 and arm64, matching the FIRST DS), since the 2027 DS runs on all three.
- Works fully offline.
- Code signing and auto-update (Windows SmartScreen and macOS Gatekeeper otherwise block unsigned apps).
- Parsing in Web Workers, never on the UI thread.

**Data model sketch**
- `Source`: file, format, time base, offset.
- `Field`: path, type, metadata, unit.
- Column storage per field: timestamps (int64 µs or float64 s) plus typed values. Strings dictionary-encoded.
- Struct/proto child fields generated lazily; derived fields computed lazily and cached.
- A comparison is a list of (source, field, alignment) triples.

**Extensibility (needed because custom features come later)**

Build the built-in features the same way future custom features will be built, so adding one never means reworking the core:
- **Data core:** loads logs, owns sessions, alignment and the shared cursor/selection. Everything else reads from it through one query API (fields, samples in a time range, robot-state ranges, metadata).
- **Panels:** line graph, table, console, statistics, field, power report… each registered with an ID, a settings schema and a render function. Layouts store panel IDs plus settings, so new panel types slot into saved layouts.
- **Analyzers:** functions that take a log (or a match bundle) and return metrics and timestamped findings. The power report, logging-health check and event dashboard are all analyzers; the event dashboard just runs analyzers across many logs.
- **Derived fields:** computed signals (expressions, filters, error, summed currents) that appear in the field tree like real fields and can be used by any panel or analyzer.
- **Key mappings:** the robot-state/match-info key tables (format reference §1.10) live in data, not code, so new loggers or a team's own naming can be added.

Keep these as internal TypeScript interfaces at first; only harden them into a public plugin API once the custom features show what's actually needed.

**Semantics**
- Samples are sample-and-hold. Resample with "previous value" for differences and tables.
- Never interpolate booleans or enums.

**Performance**
- Index pass, then lazy decode (AdvantageScope uses a WASM indexer written in C).
- Per-pixel min/max decimation; canvas or WebGL rendering (charting library still open).

**Reuse candidates**

| Candidate | License | Notes |
|---|---|---|
| AdvantageScope | BSD-3 | WPILOG indexer/decoder, robot-state key tables, struct/proto decoders. Keep the notice; no endorsement use of names. |
| `wpilog-parser` | MIT | TypeScript WPILOG reader |
| allwpilib `DataLogReader`, `wpilog.ksy` | BSD | Reference reader and Kaitai spec |
| RobotPy `DataLogReader` | BSD [verify] | Python tooling |

---

## 10. Open questions for the team

1. ~~Web, desktop or hybrid?~~ **Decided: desktop** (2026-11-08). ~~Electron or Tauri?~~ **Decided: Electron + TypeScript** (2026-11-08; see `brownout-tech-stack.md`).
2. Primary users: programmers, CSAs, drive team / strategy, mentors? This changes the defaults (deep analysis vs one-page health report).
3. Season scope: 2026 roboRIO logs and 2027 Systemcore from day one (recommended)?
4. Should P0 include live NT4, or stay file-only?
5. ~~Complement AdvantageScope or aim for parity?~~ **Decided: general viewer + comparison, with custom features later** (2026-11-08). Open: which custom features, and roughly when?
6. Brownout's own license, which matters if AdvantageScope code is reused (BSD-3 is permissive, but its notice must be kept).
7. Event library storage: plain folders plus an index file, or an embedded database?
8. Where do we get sample WPILOG files to use as test fixtures (2026 matches from DataLogManager, AdvantageKit, Epilogue and DogLog; 2027 Systemcore and FIRST DS beta logs; owlet/revlog-converter output)?
9. ~~Which formats?~~ **Decided: WPILOG only** (2026-11-08).

---

## 11. Glossary

| Term | Meaning |
|---|---|
| **WPILOG / DataLog** | WPILib's binary log format, and the library that writes it |
| **NT4** | NetworkTables v4: WebSocket pub/sub between robot, dashboards and coprocessors |
| **FPGA time** | roboRIO microsecond clock, starting at about program start |
| **DS / FIRST DS** | Driver Station software: NI's (≤2026) and WPILib's new one (2027+) |
| **FMS** | Field Management System, which runs official matches |
| **PDP / PDH** | Power distribution boards (CTRE PDP; REV PDH, 24 channels) that report per-channel current |
| **CSA** | Control System Advisor, a volunteer who helps teams debug at events |
| **AK** | AdvantageKit |
| **Struct** | WPILib packed fixed-size binary serialization with a text schema |
| **Hoot / owlet** | CTRE log format, and CTRE's CLI that converts it |
| **revlog** | REV raw CAN status-frame log |
| **Brownout** | Battery voltage sagging below the controller's protection threshold; outputs are disabled until it recovers |
| **Trip time / packet loss** | DS↔robot round-trip latency and dropped control packets |
| **Utility mode** | 2027 name for Test mode |
| **OpMode** | Selectable robot program mode (from FTC), new to FRC in 2027 |

---

## Sources

Primary specs and source code (read directly):
- WPILib Data Log spec: https://github.com/wpilibsuite/allwpilib/blob/main/datalog/doc/datalog.adoc
- WPILib struct spec: https://github.com/wpilibsuite/allwpilib/blob/main/wpiutil/doc/struct.adoc
- NT4 spec: https://github.com/wpilibsuite/allwpilib/blob/main/ntcore/doc/networktables4.adoc
- WPILib 2027 Telemetry API design: https://github.com/wpilibsuite/allwpilib/blob/main/telemetry/doc/telemetry.md
- AdvantageScope source and docs (BSD-3): https://github.com/Mechanical-Advantage/AdvantageScope · https://docs.advantagescope.org

Official docs:
- WPILib DataLog: https://docs.wpilib.org/en/stable/docs/software/telemetry/datalog.html
- Downloading and processing logs: https://docs.wpilib.org/en/stable/docs/software/telemetry/datalog-download.html
- Epilogue: https://docs.wpilib.org/en/stable/docs/software/telemetry/robot-telemetry-with-annotations.html
- New for 2027: https://docs.wpilib.org/en/latest/docs/yearly-overview/yearly-changelog.html
- FIRST DS log viewer: https://docs.wpilib.org/en/latest/docs/software/firstdriverstation/first-driver-station-log-viewer.html
- The 2027 FIRST Driver Station (WPILib blog, 2026-04-24): https://wpilib.org/blog/the-2027-first-driver-station
- Systemcore pricing and availability (FIRST): https://www.firstinspires.org/community-blog/2026-systemcore-pricing-and-availability
- Systemcore testing repo: https://github.com/wpilibsuite/SystemcoreTesting
- NI DS Log File Viewer: https://docs.wpilib.org/en/stable/docs/software/driverstation/driver-station-log-viewer.html
- roboRIO brownouts: https://docs.wpilib.org/en/stable/docs/software/roborio-info/roborio-brownouts.html
- Third-party telemetry libraries: https://docs.wpilib.org/en/stable/docs/software/telemetry/3rd-party-libraries.html
- AdvantageKit (built-in logging, deterministic timestamps, replay comparison): https://docs.advantagekit.org
- CTRE Signal Logging: https://v6.docs.ctr-electronics.com/en/stable/docs/api-reference/api-usage/signal-logging.html
- REV Status Logger: https://docs.revrobotics.com/revlib/logs
- revlog-converter: https://www.npmjs.com/package/@rev-robotics/revlog-converter
- URCL: https://docs.advantagescope.org/more-features/urcl
- DogLog: https://doglog.dev

Community:
- Logging overhead and log sizes: https://www.chiefdelphi.com/t/logging-overhead/464372
- AdvantageKit vs hoot logging: https://www.chiefdelphi.com/t/advantagekit-logging-vs-ctre-hoot-logging/522532
- R U HURT static log analyzer: https://www.chiefdelphi.com/t/frc-static-log-analyzer/518058
- wpilog-parser / AI analysis: https://www.chiefdelphi.com/t/analyzing-log-files-with-ai/520492
- Juice battery analyzer: https://polar-edge.pages.dev/how-to-use
- Power usage / brownouts per battery: https://www.chiefdelphi.com/t/yet-another-power-usage-thread/519109
- CSA debugging slides: https://docs.google.com/presentation/d/1nkFq1Jb-8dZck_TdVQCSuRntTy7cLwQtZqVEKL8VRMk/htmlpresent
- PlotJuggler: https://github.com/PlotJuggler/plotjuggler
- Foxglove docs: https://docs.foxglove.dev
