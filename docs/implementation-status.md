# Implementation status (2026-11-16, v0.5.1)

What the app in this repository does today, mapped to the specs. ✓ built · ◐ partial · ✗ not yet.

## Reader and data core (`src/core`)

| Item | Status | Notes |
|---|---|---|
| WPILOG v1.0 index + lazy decode | ✓ | `wpilog/reader.ts`; truncated tails, entry-ID reuse, duplicate names merged by name+type, out-of-order timestamps sorted, negative 8-byte timestamps (unsynced Limelights) placed at the previous record's time and counted |
| All standard types, `json`, `raw` fallback | ✓ | |
| Struct schemas (`/.schema/struct:*`), nested, arrays, bit-fields, enums, `char[N]` | ✓ | `struct/structDecoder.ts`; well-known WPILib schemas built in, incl. 2027 `ControlWord` |
| Protobuf values | ✗ | Shown as raw bytes; port AdvantageScope's `ProtoDecoder.ts` |
| Generated children (struct leaves, array elements, `length`) | ✓ | up to 64 array elements |
| Units (struct, metadata `unit(s)`, `properties.unit(s)`, name suffix) | ✓ | `units.ts` |
| Robot state via priority key tables (AK, DataLog ≤2026/2027, FIRST DS, Phoenix, NT) | ✓ | `robotState.ts`; FIRST DS numeric control word and ≤2026 `FMSControlData` bit decode included; NI DS inverted flags handled if present |
| Match info (event, type, number, alliance, station, FMS) | ✓ | |
| Era detection (≤2026 vs 2027) | ✓ | |
| Wall clock (`systemTime`, `EpochTimeMicros`) | ✓ | |
| Alignment modes: auto start, teleop start, first enable, log start, wall clock, raw + manual nudge | ✓ | `alignment.ts` |
| Per-pixel min/max decimation | ✓ | `decimate.ts` |
| Power report (min/avg V, time below thresholds, brownouts logged or inferred, dips with top PDH channels, peak/avg current, energy, internal resistance) | ✓ | `analyzers/power.ts` |
| Logging health + how-to snippets | ✓ | `analyzers/health.ts` |
| Console/alerts/events extraction (brownout, reboot, overrun, errors, disconnects) | ✓ | `analyzers/events.ts`; WPILib `Warning at ...` lines are warnings shown by their message; repeats within 5 s fold into one event with a count; an overrun names the slowest Tracer entry; alerts from any group whose `.type` is `Alerts`; only a second program start counts as a restart |
| Statistics + histogram | ✓ | `analyzers/stats.ts` |
| Path analysis (segments, position/heading error, per-path max/RMS/end/start errors) | ✓ | `analyzers/paths.ts`; a path ends when PathPlanner stops publishing its target pose |
| CSV export (table form, sample-and-hold) | ✓ | `csv.ts` |
| WPILOG writer | ✓ | demo generator / tests; export of filtered logs not wired to the UI yet |
| Field frames (blue wall ↔ center), alliance flip (rotational / mirrored), WPILib field JSON parsing | ✓ | `field.ts`; 2024–2027 size presets; AprilTag layouts and field pictures for 2024–2026 are bundled with the app (`src/renderer/src/assets/fields`) |

## App

| Item | Status | Notes |
|---|---|---|
| Open by dialog, drag-and-drop, CLI `--open`, file association config | ✓ | per-file progress in the header (reading / indexing % / analyzing) |
| Session restore: last session's logs, manual nudges and layout reopen on launch | ✓ | desktop only; setting to turn off; skipped when files are passed on the command line |
| Multi-log session: colors, show/hide, primary log, close | ✓ | |
| Header: sidebar toggle (left), File menu, log chips, Align, Preset menu, Add panel menu, Power button, Potato toggle, Settings, Help; one row, labels drop to icons and less-used controls move to an overflow menu when narrow | ✓ | |
| Field search by type: typing the start of a type that exists in the open logs shows the rest faintly; Tab turns it into a type chip and typing goes on; several types list any of them, words narrow by name; Backspace on an empty search removes the last type, Escape clears; the sidebar's right edge drags to any width (remembered, double-click for the default) | ✓ | `typeLabels` / `completeType` / `typeMatches` in `lib/fields.ts` |
| Field tree: search, type/unit badges, per-log dots, generated toggle, double-click, add-to-timeline; Ctrl / Shift multi-select, drag the selection or a whole folder (panels report what they skipped); favorites saved in the robot profile | ✓ | |
| Inspector (values at cursor per log) | ✓ | |
| Timeline: overview + window, mode lanes per log, Alt-drag to nudge, events, battery strip, user tracks (boolean/state/numeric), tags-seen track per camera, bookmarks, compact/standard/expanded, draggable height | ✓ | drag-to-reorder tracks ✗; findings track ✗ |
| Timeline covers the match (auto start to teleop end, 2 s padding) by default; its label switches to the whole log (remembered); a jump outside the match switches by itself; Match button and `M`, Whole log in the zoom menu and `F` | ✓ | `timeBounds()` in `state/time.ts`, `matchExtent()` in `state/session.ts`; logs with no mode data use the whole log |
| Timeline handling: overview window with drawn grips (wide grab area, outside the window when it is narrow), dimmed outside, start / end / length shown while dragging; press or drag in the lanes scrubs the cursor; the time ruler and the middle button pan; drags snap to mode changes and bookmarks (Alt: no snap); selection edges draggable; Alt-drag nudge shows its amount | ✓ | |
| Visible range clamped to the timeline's range (overview window can't leave the strip) | ✓ | `clampWindow` in core |
| Go-to-time box, zoom −/+ with a typed span, quick spans and phases | ✓ | |
| Only the timeline moves shared time; hover ignored during playback | ✓ | setting "Let graphs and the field move time" restores graph click/pan/zoom |
| Playback (speed, loop over selection), step, phase jump; the view follows the playhead only when it runs off the view's edge, so a view moved by hand during playback stays put (pressing play brings the playhead into view once); the overview strip shows the playhead as a solid line with a tab | ✓ | |
| Time formats: aligned, match time, raw, wall clock | ✓ | match time derived from phases (logged `MatchTime` not yet preferred) |
| Line graph: left/right axes, discrete lanes, thresholds, legend with values, Δ readout, overlay / stacked / difference, per-panel source, own time range when unlinked | ✓ | derived expressions ✗ (built-in derived fields: path errors, pose speed, electrical power) |
| Graph value-axis zoom independent of time: wheel, axis drag, typed limits, auto-fit | ✓ | |
| Table: changes in range / values at cursor, columns per log | ✓ | |
| Console & events: merged across logs, severity filters, `!` exclude, click to jump | ✓ | |
| 2D field: real field pictures for 2024 to 2026 (WPILib images, bundled) with brightness and a plain switch, built-in AprilTag maps (welded / AndyMark), custom field picture from a WPILib / PathWeaver field JSON, robots per log sized from the profile, bumper color by alliance, trails, active path, target pose + whisker, extra pose fields, normalize alliance, era conversion, rotate, wheel zoom / drag pan / fit | ✓ | heatmaps ✗ |
| Cameras and AprilTags on the 2D field: per camera a line to each seen tag (from the camera's mount when given), the tag lit with its ID, a ghost robot at the camera's pose estimate, a readout of tags and estimate error at the cursor; tag positions from logged tag poses for teams that do not log IDs; every part optional | ✓ | `core/vision.ts`; AdvantageKit vision template and Limelight `botpose*` arrays found from field names, anything else picked in the camera editor; PhotonVision raw results (protobuf) ✗; only checked against the synthetic demo logs |
| Position and vision findings: a camera estimate 0.5 m or more from the robot pose for 0.25 s while enabled, and pose steps of 0.25 m or more faster than 8 m/s while enabled (not in the first 0.5 s of a mode, where code resets the pose), each naming the auto path and commands running; timeline markers, console, Compare Matches, match report | ✓ | `core/analyzers/poseDeviations.ts`; jumps in `summarize()`, disagreements with the camera analysis; thresholds checked only on the demo logs and CURIE Q89 (whose worst camera error, 0.23 m, flags nothing) |
| Per-camera derived fields `/Brownout/Vision/<camera>/TagsSeen`, `TagCount`, `EstimateError`; share of enabled time with a tag in view and blind stretches of 2 s or more | ✓ | computed in the worker; feeds the tags-seen tracks and the match report |
| Controller panel: sticks, triggers, D-pad, buttons at the cursor, one pad per log; Xbox / PlayStation / numbered list; controller 0 to 5 | ✓ | `core/controller.ts`; AdvantageKit `/DriverStation/Joystick<N>/...` (2026 `POVs` angles and 2027 `POVValues` bits) and DataLog `DS:joystick<N>/...`; button numbering is WPILib's through 2026, the 2027 numbering is unverified |
| Commands panel: one row per command, one lane per log, total time and run count, running-now list, hover details, click a run to jump | ✓ | `core/commands.ts`; from `.../Scheduler/Names` (string[]) or AdvantageKit `Commands(All|Unique)/` boolean folders, or a hand-picked string[] field; the scheduler lists top-level commands only |
| Video panel: local file per log, manual sync (this frame is auto start / teleop start / the cursor), Play and frame step before syncing, fine-tune by frames once synced, follows the timeline cursor, speed and playback, remembered per log file; seeks run one at a time (`lib/videoSeek.ts`) so dragging doesn't freeze the picture | ✓ | desktop serves the file through `brownout-media://` with byte ranges; MP4 (H.264) and WebM; HEVC needs converting; tested with a generated 20 s H.264 clip |
| Robot parts, more: attach a part to another (it moves with that part's turn; its own angle adds on top); pick the turn point (center, back end, front end, left, right) or drag the pivot marker (Alt-drag when it sits at the part's center); the field's Display menu hides all parts, single parts, or the robot names; robot size has no upper limit, parts may be up to 20 m out; the test angle redraws only the preview and SVGs are drawn from cached bitmaps | ✓ | `parent` on `Layer`, `enterPart` / `ancestors` in `lib/robotDraw.ts` |
| Robot appearance editor: rectangles, ellipses, pictures (downscaled to 512 px) and SVGs (up to 300 kB); place by typing or dragging; order, opacity, color; link a part to a logged angle with unit, zero offset, reverse and pivot; preview with a test angle | ✓ | `components/RobotEditor.tsx`, drawn by `lib/robotDraw.ts`; up to 24 parts; drawn on the 2D field (not in the swerve panel) |
| Match report: one-page PDF per log (match info, voltage chart with modes and brownouts, brownouts with what drew the most at the dip and 0.5 s before, power by subsystem, deepest dips, battery resistance and rating, loop overruns, restarts, connection losses, first errors, per-camera vision summary, what the log lacks) | ✓ | `core/report.ts` builds a script-free page; the desktop app prints it with `printToPDF`; the browser build downloads the page to print |
| Statistics, path analysis, compare matches, log info & logging health panels | ✓ | role overrides are saved in the robot profile |
| Power by subsystem: subsystems = PDH / PDP channels and / or logged current fields (suggestions group by the folder after `Subsystems/`); without battery voltage energy is estimated at 12 V and labeled so; averages are over enabled time; every sample time of every motor is kept; a field that swings below −10 A gets a stator-current warning; energy, share, average and peak per subsystem with an unassigned rest; who was drawing at each brownout (at the dip and 0.5 s before) and at the lowest dips; stacked current chart; one column per log; selection-aware; derived `/Brownout/Subsystems/<name>/Current` fields; suggestions from field names; stator-current and double-counting warnings | ✓ | `core/analyzers/subsystems.ts`; needs per-channel or per-motor supply current in the log; only checked against the synthetic demo logs so far |
| Battery health: resistance and resting voltage from the V-I fit, rating, battery label per log, history per battery | ✓ | rating thresholds (18 / 25 mΩ) are a rule of thumb and include wiring resistance |
| Swerve drive panel: modules measured vs setpoint, chassis velocity and rotation, one diagram per log, module order and full scale from the profile | ✓ | field-relative view ✗ |
| Robot profile: subsystems, cameras, appearance layers, swerve settings, robot size, controller layout, favorites, role overrides; chosen per log (remembered assignment, else best field-name match, else last used); missing fields flagged; export / import as one file, pictures included | ✓ | |
| Compact view: one-row toolbars with an overflow menu, `low` controls leave first, graph chips collapse to a count, one-line legend strip, sidebar hides on narrow windows; automatic by width, or forced in Settings | ✓ | |
| Own icon set (`lib/icons.ts`), no emoji or symbol characters anywhere in the UI | ✓ | checked by the UI test |
| Copy a panel to the clipboard as an image, or save it as a PNG | ✓ | desktop: any panel (visible part); browser build: canvas panels only |
| Video offering: when a log opens without a video, the video named like its match (`Q12`, `qm12`, `Qual 12`, `2026nyroc_qm12`, `Match 12`) next to the log file or in the videos folder (Settings) is offered in a message; the empty video panel lists the matches; "Not now" is remembered | ✓ | `core/videoMatch.ts` ranks, main lists (`list-videos-near`: only folders of logs this run read, and the videos folder picked through its dialog), `lib/videoOffer.ts` offers; a file gets a playable address only when the user accepts |
| Video sync view: large video with its own Play (0.25× to 1×), frame and second steps at the video's measured frame rate, sound, a typed go-to time; a video timeline and a log strip that zoom (wheel) and pan (drag the time scale) and hold still while you drag in them, the video one down to single numbered frames; this log's markers (auto start, robot starts moving, teleop start, teleop end) and robot speed; pair a frame with a marker, play to check, Apply; a second pair late in the match measures a video clock that runs slow or fast (`rate`, 0.8 to 1.25), which the panel corrects by playing the video faster or slower | ✓ | `components/VideoSync.tsx`; opens after choosing a video and from the Sync menu; nothing moves shared time until Apply |
| Views: Panels (the grid), Video review (video and field side by side at the same height, moments to check below, click to go there) and Power (battery graph above the power report); header switch and Ctrl+1/2/3; the Power button and P open the Power view; the grid stays mounted while hidden | ✓ | `components/Views.tsx`; the views' panels are ordinary panels under `view:` ids, never saved into layouts or presets (`isViewPanel`) |
| Dockable grid (split, tabs, drag, close), watermark drop target, smart drop; maximize a panel (button, double-click its tab, Ctrl+Enter) | ✓ | workspace tabs ✗; pop-out windows ✗ (dockview refuses `file:` pop-out pages and the installed app loads from `file://`) |
| Presets = layouts: built-ins add only fields the log has; without battery voltage and total current they show motor currents and logged watts, Compare Matches uses robot speed, and an empty graph says what the log lacks and how to log it; active preset shown with "(modified)"; built-ins (Quick Look, Power & Brownouts, Autonomous Review, Compare Matches, Code Health, Match Replay); user presets with save / update / rename / duplicate / delete; export chosen presets; import with overwrite / keep both / skip; confirm before discarding an unsaved layout | ✓ | user presets store exact field names (built-ins resolve roles) |
| Settings: themes (dark / light / high contrast), log colors, mode colors, rebindable keybinds with conflict handling, compact view, Potato mode, time-control switch, session restore, brownout threshold, season, AprilTag map, robot profile page, demo logs (asks before replacing open logs / unsaved layout; brings a demo robot profile) | ✓ | |
| Potato mode: 30 fps cap, 1× resolution, coarser decimation, no cross-panel hover, short trails, smaller tables; offered automatically when draws are slow | ✓ | |
| Performance: decimation and strip caches (hover/cursor redraws don't rescan data), hidden panels don't draw, console/table don't re-render on the cursor, stats/table recompute after panning settles | ✓ | measured only on the build machine's software renderer; needs checking on a team laptop with a 100 MB log |
| In-app dialogs and toasts (no `prompt()`), generated shortcut sheet | ✓ | |
| CSV export (selection or visible range) | ✓ | SVG export ✗ |
| Browser build (`npm run web`) | ✓ | |
| UI test driving the real app (`npm run uitest`, 252 checks) | ✓ | passes on Linux (CI) and on Windows 11 |
| Real-log check (`npm run reallog`): opens logs from `fixtures/local/`, sets up suggested subsystems, applies every preset, captures the camera view and the match report, writes a summary | ✓ | it checks nothing by itself; read `smoke/real-summary.json` and the screenshots |
| Mechanism (side view), XY plot, 3D field | ✗ | |
| Robot FTP download, DS folder watching, library | ✗ | P1 |
| Installers, signing, auto-update | ◐ | a release workflow builds unsigned installers on GitHub for Windows, macOS (Apple silicon and Intel) and Linux and attaches them to a draft release when a version tag is pushed; never installed on Windows or macOS yet; no signing or auto-update |

## Checked against a real robot log

One real log so far: CURIE Q89 from the 2026 Championship (DataLogManager, no AdvantageKit; its layout is in `docs/frc-log-format-reference.md` §7a). With v0.5.1 it opens in about 1 s with no errors, and these were confirmed against it:

- robot state and match info
- controller numbering (checked against the team's own button fields)
- the three Limelights and their estimate error
- commands from the scheduler
- swerve states
- PathPlanner paths
- subsystem suggestions
- the match report

That log has no battery voltage, total current or PDH channels, so brownout detection, battery health and the power math with real voltage have still only been checked on the synthetic demo logs. An AdvantageKit log and a log with PDH channel currents are the next most useful to check.
