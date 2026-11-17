# Brownout — Viewer UI Spec: Timeline, Views, Layouts & Presets

*Draft proposal, 2026-11-08. This answers the team's questions about the timeline, auto vs teleop, customizable and expandable timelines, which views to build (swerve, 2D field, 3D field), presets, and a multi-view grid. It builds on the decisions in `frc-logging-landscape-and-viewer-requirements.md`: desktop app, WPILOG only, general viewer + comparison tool, custom features later. Key names and struct formats are in `frc-log-format-reference.md`. Vision (visible AprilTags) and pathing (PathPlanner) are detailed in `brownout-vision-and-pathing-spec.md`.*

**Status: proposal.** Nothing here is decided until the team agrees. Items marked **[verify]** still need checking against real logs or sources. See `implementation-status.md` for what the app implements today.

---

## 0. Answers at a glance

| Question | Recommendation | When |
|---|---|---|
| Does it need a timeline? | **Yes.** One global timeline shared by every view. It shows where you are in the log, what's zoomed in, and what the robot was doing. | v1 |
| Should it separate auto and teleop? | **Yes.** Colored mode bands (disabled / auto / teleop / utility, plus e-stop), a match-time readout, and one-click zoom to auto or teleop. The same phases also work as filters in statistics and reports. | v1 |
| Can teams customize the timeline and turn things on/off? | **Yes.** A track-based timeline: a fixed mode band plus optional tracks that teams add, hide, reorder and color. Tracks can show brownouts, alerts, console errors, any boolean/enum/string field, bookmarks or analyzer findings. Track setups save with layouts and presets. | v1 basic; v1.1 more track types |
| Should the timeline expand? | **Yes, both ways.** Vertically: compact → standard → expanded, or drag to any height. In time: an overview strip for zooming and panning. When comparing, one lane per log. It can also open as a full panel. | v1 |
| What types of views? | **Time views:** line graph, table, console/events. **Spatial views:** 2D field, swerve, mechanism. **Analysis views:** statistics, XY plot. **Summary views:** power report, match dashboard, log info. **Input view:** joysticks. **Later:** 3D field, video, points. | §3 |
| Dedicated swerve viewer? | **Yes.** A simple 2D module diagram: measured vs setpoint vectors, chassis speed, heading. It's cheap to build and hard to replace with graphs. It hides itself when a log has no swerve data. | v1.1 (first after MVP) |
| 2D field? | **Yes.** Essential for an FRC viewer, and central to comparing autos: several matches drawn as ghost robots on one field. | v1 |
| 3D field? | **Not at first.** It's expensive (a 3D field model every season, robot CAD conversion), and AdvantageScope already does it very well. The 2D mechanism view covers arms and elevators. Revisit if a custom feature needs 3D. | Later |
| Presets? | **Yes.** Built-in workspace presets (Quick Look, Power, Autos, Compare, then Drivetrain, Code Health, Mechanism Tuning, Driver Review) that find the right fields automatically. Plus team presets saved to a file or the robot repo, robot profiles, and season/field presets. | v1: 4 presets + save/load; v1.1: the rest |
| A grid to see several views at once? | **Yes.** A dockable grid: split panes, tabs inside panes, drag to rearrange, maximize, and pop out to a second monitor. Templates for 2 side-by-side, 2×2 and 1 + 3. Every pane follows the shared timeline cursor. | v1 |

**How AdvantageScope handles these today** (from its docs and source, Oct 2026):
- **Timeline:** colors auto yellow, teleop blue and utility gray. You can zoom, shift-drag to select a range, and press `Ctrl+\` to zoom to the enabled period.
- **Extra state tracks** live inside the line graph's "discrete fields" section, not on the timeline.
- **One tab per window.** To see several views at once you open extra pop-out windows, and playback is controlled from the main window.
- **Layouts** can be exported and imported. We saw no built-in presets that pick fields automatically.

The grid, a customizable timeline, and role-aware presets are therefore real differentiators for Brownout.

---

## 1. Window anatomy

```
┌───────────────────────────────────────────────────────────────────────────────────────┐
│ Brownout  [Open] [Library]   Logs: ● Q12  ● Q18  ● Q23  [+]   Align: [Auto start ▾]   Preset: [Power ▾] │
├──────────────┬────────────────────────────────────────────────────────────────────────┤
│ Fields  🔍    │ ┌───────────── Line graph ──────────────┐ ┌──────── 2D field ─────────┐ │
│ ▸ Drive       │ │ Battery voltage, 3 logs overlaid      │ │ ghost robots Q12/Q18/Q23  │ │
│ ▸ Power       │ └───────────────────────────────────────┘ └───────────────────────────┘ │
│ ▸ Shooter     │ ┌───────────── Swerve ──────────────────┐ ┌──────── Power report ─────┐ │
│ ▸ ...         │ │ module vectors, measured vs setpoint  │ │ min 6.9 V · 2 brownouts…  │ │
│               │ └───────────────────────────────────────┘ └───────────────────────────┘ │
│ Inspector     ├────────────────────────────────────────────────────────────────────────┤
│ values at     │ ⏮ ▶ ⏭ 1×   t = +1:42.30   TELEOP 1:12 left        [compact│standard│expanded] │
│ the cursor    │ Overview ▕░░░░▓▓█████[==== visible ====]██████████░░▕                       │
│               │ Q12 mode  ░░▓▓▓▓████████████████████████░░                                   │
│               │ Q18 mode  ░▓▓▓▓████████████████████████░░░                                   │
│               │ Brownouts            ⚡         ⚡                                              │
│               │ Alerts         ▲   ●       ▲                                                 │
│               │ Intake    [idle][intaking][holding][shooting][idle]                          │
└──────────────┴────────────────────────────────────────────────────────────────────────┘
   ░ disabled   ▓ auto   █ teleop
```

| Region | Contents |
|---|---|
| **Header bar** | The logs in the session (each with its own color); alignment mode; preset picker; library / robot download |
| **Sidebar** | Field tree (search, type and unit badges), plus an inspector showing every selected field's value at the cursor, with structs expanded |
| **Grid** | Panels in a dockable layout (§4) |
| **Timeline dock** | Full width at the bottom; resizable; collapsible (§2) |

---

## 2. The timeline

### 2.1 Why it's essential

Every log viewer is organized around time. The timeline gives one shared answer to three questions in every panel:
- **Where am I?** The selected time, or cursor.
- **What am I looking at?** The visible range.
- **What was the robot doing?** Mode bands and events.

Without it, panels drift out of sync and comparing matches is impossible.

### 2.2 Robot mode bands (auto vs teleop)

**Bands**
- Disabled = neutral.
- Autonomous = amber.
- Teleoperated = blue.
- Utility/Test = purple.
- E-stop = red hatching.
- Bands also carry patterns or labels, so they work for colorblind users and in grayscale.

**Data source**
- The robot-state key mapping (format reference §1.10) covers AdvantageKit, DataLogManager before and after 2027, and FIRST DS logs.
- If no robot-state keys are found, show "Robot mode unknown — log DriverStation data" with a link to the logging-health panel.

**Extra context**
- **Endgame:** the last *N* seconds of teleop, with *N* set per season preset (AdvantageScope's heatmap has a "Teleop (No Endgame)" option).
- **FMS attached:** separates a real match from practice.
- **Alliance color stripe:** from alliance-station keys.

**Match time readout**
- Show log time and match time together, e.g. "TELEOP 1:12 left".
- Use logged match time when present (AdvantageKit logs `DriverStation/MatchTime`). Otherwise work it out from when each phase starts.

**Navigation**
- One-click zoom to enabled / auto / teleop / endgame / full log.
- Jump to the next or previous phase change.

**Reuse:** the same phase definitions drive the "auto only" and "teleop only" filters in statistics, reports and heatmaps.

### 2.3 Tracks (the customizable part)

| Track type | Shows | Examples | Default |
|---|---|---|---|
| **Mode band** | Robot mode for each log | — | Always on |
| **Event markers** | Point events with icons and counts | Brownout, robot program start (reboot), DS/FMS disconnect, loop overrun, console error/warning, WPILib alerts (error/warning/info) | Brownout, reboot and errors on |
| **Boolean** | On/off segments | Beam break, "has game piece", vision target seen, brownout flag | Added by user |
| **State (enum/string)** | Colored segments labeled by value | Superstructure state, active command, auto routine, OpMode (2027) | Added by user |
| **Numeric strip** | Compact color-mapped strip or sparkline, with thresholds | Battery voltage (red below the brownout threshold), total current, loop time | Battery strip on, if found |
| **Bookmarks** | User notes pinned to times | "Got hit by 1234 here" | On |
| **Findings** (v1.1) | Analyzer results | Power-report findings, logging-health warnings | On |
| **Tags seen** (vision) | One row per camera, segments labeled with the visible AprilTag IDs; hatched when the camera is disconnected | `7·8`, `12`, gaps when blind | On, if vision data is found |
| **Auto routine / path active** (pathing) | The selected auto's name, and one segment per followed path | "4 Piece Center", "Path 2", "Pathfinding" | On in Autonomous Review |

**Customization**
- **Add any field:** drag it from the field tree, or right-click → "Add to timeline". The track type is picked from the data type: boolean → boolean track, string or enum → state track, number → strip.
- **Arrange:** toggle visibility (eye icon), reorder by dragging, rename, group and collapse (e.g. a "Power" group).
- **Style:** color rules, such as value ranges, thresholds or one color per state.
- **Source:** each track shows one log or all logs.
- **Saved** with the layout and with presets; "Reset to preset" restores the default.
- **Guardrail:** compact height shows only the mode band and pinned tracks, so clutter never hides the essentials.

### 2.4 Expanding and zooming

- **Heights.**
  - Compact, about 28 px: mode band + cursor.
  - Standard, about 100 px: mode band + pinned tracks.
  - Expanded: drag up to about half the window to show every track, scrollable.
  - A button or shortcut cycles between them, and the splitter allows any height.
- **Overview + detail.** An overview strip always shows the whole log, with a draggable box for the visible window.
  - Drag the box's edges to zoom; drag its middle to pan.
  - The scroll wheel zooms around the mouse pointer.
  - `Shift`-drag selects a range.
- **Open as a panel.** For heavy use (say, 20 state tracks), the timeline opens as a "State timeline" panel in the grid, like Grafana's state timeline or Foxglove's State Transitions panel.
- **Comparison lanes.** Each log gets its own mode-band lane, positioned by the session's alignment, so offsets are visible at a glance. **Drag a lane sideways to nudge its alignment by hand.** A numeric offset field and a lock are also available. This is the most intuitive alignment UI for comparing matches.
- **Hover readout.** Hovering shows every track's value at that moment.

### 2.5 Cursor, selection and playback

**Time states**
- **Selected time:** click.
- **Hover time:** previewed in every panel.
- **Selected range:** `Shift`-drag. Used by statistics, export and "zoom to selection".
- **Delta readout:** the time between the selected and hover points.

**Playback**
- Play/pause.
- Speed from 0.25× to 4×.
- Loop over a range.
- Step one loop cycle (20 ms by default; AdvantageKit cycle timestamps when present).

**Time formats:** from log start (`+1:42.30`), original raw µs, match time, or wall clock (when `systemTime` or AdvantageKit's epoch time is logged).

**Keyboard (proposal)**

| Key | Action |
|---|---|
| `Space` | Play/pause |
| `←` `→` | Step one cycle |
| `Shift+←` `Shift+→` | Jump 1 s |
| `[` `]` | Previous / next phase change |
| `A` / `T` / `E` / `F` | Zoom to auto / teleop / enabled / full log |
| `B` | Add a bookmark |
| `Ctrl+1` … `Ctrl+9` | Switch workspace |

---

## 3. View types (panel catalog)

| Category | Panels | Tier |
|---|---|---|
| **Time** | Line graph, table, console/events | v1 |
| | State timeline panel | v1.1 |
| **Spatial** | 2D field | v1 |
| | Swerve, mechanism | v1.1 |
| | 3D field, points | Later |
| **Analysis** | Statistics/histogram, XY scatter, vision panel | v1.1 |
| **Summary / diagnostic** | Power report, log info + logging health | v1 |
| | Match dashboard (event view) | v1.1 |
| **Input** | Joysticks | v1.1 |
| **Media** | Video sync | Later |
| **Custom** | Team-built panels on the panel interface | Later |

### 3.1 Time views

**Line graph (v1)**
- **Axes:** left and right numeric axes plus discrete lanes for booleans, enums and strings. Rendered as steps, because values are sample-and-hold.
- **Units:** taken from struct types, then metadata, then name suffixes, with per-axis conversion.
- **Threshold lines,** e.g. brownout voltage.
- **Legend** shows each value at the cursor.
- **Spike-preserving downsampling** (min/max per pixel).
- **Derived series** (v1.1): difference, sum, derivative, integral, expressions.
- **Comparison:** overlay by default (one color per log, one line style per field), stacked lanes per log, or a difference series ($A - B$ after resampling with the previous value).

**Table (v1)**
- Two modes: one row per value change, or the values at the cursor.
- Comparison: columns per log, with rows aligned.

**Console & events (v1)**
- A merged stream of console output, `messages`, WPILib alerts and FIRST DS console/error fields.
- Severity highlighting, text filter (with exclude), and click to jump to that time.
- Comparison: interleaved by aligned time, each line tagged with its log's color.

**State timeline panel (v1.1):** timeline tracks in a full-size panel (§2.4).

### 3.2 Spatial views

**2D field (v1)**
- **Data:**
  - `Pose2d` / `Pose3d` (struct or protobuf), `Pose2d[]` (paths, vision poses) and `Translation2d[]`.
  - Field2d typed tables (`.type = "Field2d"`). In 2027 each object is logged as `Pose2d[]` (verified in WPILib main). In ≤2026 objects were `double[]` `[x, y, degrees]` [verify].
- **Objects:**
  - The robot, with bumper color by alliance.
  - Ghosts: target pose, vision estimate, other logs.
  - Path or trajectory lines; a trail of the last *N* seconds.
  - **Visible-tag lines:** a line from the robot (or camera) to every AprilTag each camera sees at the cursor, with seen tags highlighted. Works from logged tag IDs plus the season's AprilTag layout (welded or AndyMark), or from logged tag poses (vision spec §2.3).
  - **PathPlanner:** active path, target-pose ghost and error whisker; planned paths, event markers and rotation targets once the robot project is imported (vision spec §3.3).
  - Arrows; heatmaps (v1.1).
- **Field assets:**
  - WPILib's `fields` library has a JSON file plus image per season: name, season, image pixel bounds, size in meters and the AprilTag list. Built in for FRC 2018–2026 and recent FTC.
  - 2026 REBUILT is 16.541 m × 8.069 m.
  - The 2027 field arrives at kickoff (January 2027), so adding a field must not require an app update. Check image licensing before bundling [verify].
- **Coordinate systems (critical).** WPILib changed its field frame for 2027:
  - **≤2026:** origin at the blue alliance wall's right corner; +X toward red.
  - **2027:** origin at **field center**; +X toward the blue wall.
  - AdvantageScope likewise defaults to "Blue Wall" for 2023–2026 fields and "Center/Red" from 2027.
  - Brownout must choose the frame per log. Detect the era automatically (2027 logs have the `DS:controlWord` struct, `WPILIB_` file names, Systemcore keys or `SystemStats/Versions/WPILib`), with a manual override.
  - WPILib's migration rule: $x_{2027} = \tfrac{L}{2} - x_{2026}$, $y_{2027} = \tfrac{W}{2} - y_{2026}$, $\theta_{2027} = \theta_{2026} + 180^\circ$, where $L$ and $W$ are the field length and width.
- **Comparison:**
  - One robot per log, in that log's color, each with its own trail.
  - **"Normalize alliance"** flips red-alliance runs onto the blue side, so autos from different matches overlay. The flip rule is set per season and matches PathPlanner's `FlippingUtil`: rotational for 2026, mirrored for some other games (vision spec §1.3).
- **Camera:** fit the field, zoom/pan, follow the robot, and rotate to either driver-station perspective.
- **Robot size** comes from the robot profile (§5.4).

**Swerve (v1.1)**
- **Why dedicated:**
  - Swerve is widespread (YAGSL alone, one of several swerve libraries, was reported by 520 teams in 2025).
  - Module states are unreadable as eight numbers but obvious as arrows.
  - It catches wrong module offsets (a constant angle error), inverted drive motors (vector opposite the setpoint), slipping wheels and modules dropping out.
- **Data:**
  - Module states: `SwerveModuleState[]` (≤2026) or `SwerveModuleVelocity[]` (2027), for both measured and setpoint.
  - Chassis speed: `ChassisSpeeds` / `ChassisVelocities`.
  - Heading: `Rotation2d` or `Rotation3d` (or gyro yaw).
- **Shows:**
  - Four modules in the robot frame.
  - Measured and setpoint vectors in two styles, with an angle-error indicator.
  - A chassis-velocity arrow and an ω (rotation rate) arc.
  - Robot-relative or field-relative orientation.
- **Config:**
  - Module order: teams differ; AdvantageScope offers six orders such as FL/FR/BL/BR.
  - Max speed (for vector scale), frame size, orientation.
  - All stored in the robot profile.
- **Comparison:** side by side per log (default) or overlaid; a per-module error table.
- **Auto-hide** when no swerve data is present; tank-drive presets skip it.

**Mechanism (v1.1)**
- **Data:** Mechanism2d typed tables, plus AdvantageKit `LoggedMechanism2d`.
  - The table has `.type = "Mechanism2d"`, `dims` and `backgroundColor`.
  - Roots have `position` in 2027, or `x`/`y` in ≤2026 [verify].
  - Ligaments have `.type = "line"` with `angle`, `length`, `color` and `weight`.
- **Comparison:** side by side (default) or overlaid with transparency.

**3D field (later)**
- **Why defer:** it needs glTF field models per season, robot CAD conversion, camera controls and a heavier renderer. AdvantageScope already offers this, and the 2D views cover most debugging.
- **Keep the door open:** decode `Pose3d` from day one, and keep the asset format season-pluggable.

**Points (later):** arbitrary 2D points, e.g. vision corner pixels.

### 3.3 Analysis views

**Statistics (v1.1)**
- Histogram plus summary measures (min/max, mean, median, percentiles, standard deviation).
- Filter by full log / enabled / auto / teleop / selection.
- Comparison: overlaid histograms and a per-log metrics table.

**XY / scatter (v1.1)**
- Any two numeric fields, colored by time or phase, with an optional fit line. Comparison by overlay.
- **Power example:** battery voltage vs total current. The fitted slope gives internal resistance: from $V = V_{oc} - I\,R_{int}$, $R_{int} \approx -\frac{\Delta V}{\Delta I}$. This is a battery-health signal that pairs with the power report.
- **Tuning example:** velocity vs applied voltage for feedforward checks.

**Vision panel (v1.1).** Per-camera visible tags (ID, distance, ambiguity), latency, accepted vs rejected estimates at the cursor; % of time with tags, rejection rate and pose jumps over a range; a vision-vs-odometry residual graph. Details in the vision spec §2.5.

### 3.4 Summary and diagnostic views

**Power report (v1).** As specified in the requirements doc §8:
- Minimum and average voltage while enabled, and time below thresholds.
- Brownout count and duration.
- The highest-current channels at each voltage dip, and energy used.
- Every finding links to its moment on the timeline.
- Data: AdvantageKit `SystemStats/BatteryVoltage`, `SystemStats/Faults/Brownout` (2027 names), and `PowerDistribution/ChannelCurrent`, `TotalCurrent`, `Voltage`, `TotalEnergy`, or team-logged equivalents.

**Match dashboard / event view (v1.1)**
- Rows = matches/logs; columns = metrics (power, loop time, CAN, faults, auto path error…).
- Sparklines and sorting; click a row to open that match in a workspace.

**Log info & logging health (v1)**
- File, duration, entry count, era (≤2026 or 2027), event and match, git SHA and build.
- Versions, from AdvantageKit 2027's `SystemStats/Versions/*`.
- Which recommended signals are present or missing, with how-to-log snippets.

### 3.5 Input view

**Joysticks (v1.1)**
- Controller diagrams from `DS:joystick<N>/buttons|axes|povs` (DataLogManager) or AdvantageKit's `DriverStation/Joystick<N>/…`.
- The 2027 FIRST DS uses SDL controller bindings (≤2026 used NI bindings), so button and axis mapping depends on the era. AdvantageScope's joystick assets support both.
- 2027 axes are 16-bit.

### 3.6 Media (later)

**Video:** sync a match video by marking the start of auto by hand. Automatic sync can come later.

### 3.7 Custom panels (later)

Built on the panel interface (requirements doc §9 "Extensibility"). Built-in panels use the same interface, so a custom panel works exactly like a native one.

### 3.8 Smart drop

Dragging a field onto an empty grid area creates the best-fitting panel:

| Dropped field | Panel created |
|---|---|
| `Pose2d` or `Pose2d[]` | 2D field |
| Module-state array | Swerve |
| `Mechanism2d` | Mechanism |
| Number | Line graph |
| Boolean or enum | Timeline track (or a discrete lane in a graph) |
| String | Console / table |
| Chassis speeds | Graph of vx / vy / ω |

---

## 4. Multi-view grid (layout system)

**Layout mechanics**
- **Docking split tree.** Any pane can split horizontally or vertically. Drag a panel's tab onto another pane's edge to split it; resize with splitters; panes have minimum sizes.
- **Tabs within panes:** stack several panels in one slot.
- **Workspaces:** top-level tabs, each with its own grid (e.g. "Overview", "Power", "Autos"). Switch with `Ctrl+1` … `Ctrl+9`.
- **Maximize / restore** a pane with a double-click on its header.
- **Pop-out windows** for a second monitor. They stay synced, and playback works from any window.
- **Templates:** single, side by side, stacked, 2×2, 1 large + 2 small, 3 columns.

**Time and data binding**
- **Shared time:** every pane follows the global cursor and visible range. Per pane, "unlink range" keeps one graph zoomed out while the others zoom in.
- **Source binding per pane:**
  - Primary log, all logs (overlay), or one specific log.
  - **Repeat per log** (small multiples): one copy of the panel per log, laid out in a sub-grid automatically.

**Practical constraints**
- **Laptop first:** design for 1366×768 and 1920×1080 event laptops, with compact headers and a collapsible sidebar and timeline.
- **Saved as JSON:** panel type IDs, settings, split ratios and timeline-track config. Presets use the same format.

---

## 5. Presets

### 5.1 Built-in workspace presets

| Preset | Panels | Timeline tracks | Needs (roles) | Tier |
|---|---|---|---|---|
| **Quick Look** (default when opening a log) | Line graph (battery V + total current), 2D field, console, log info | Brownout, reboot, errors, alerts | Voltage, pose, robot mode | v1 |
| **Power & Brownouts** | Power report; voltage + current graph with thresholds; top PDH channels; V–I scatter (v1.1) | Brownouts, battery strip | Voltage, PDH currents, brownout flag | v1 |
| **Autonomous Review** | 2D field (PathPlanner active path, target pose and actual robot; ghost per log, alliance-normalized; visible-tag lines); position/heading error graphs; per-path summary; zoomed to auto | Auto routine, path active, tags seen | Pose, active path, target pose | v1 |
| **Compare Matches** | Overlay graph, small-multiples field, metrics table | Mode lane per log | Robot mode | v1 |
| **Drivetrain (swerve)** | Swerve view, module currents and temperatures, chassis speeds, field with trail | — | Module states | v1.1 |
| **Code Health** | Loop time, GC, CPU/memory, CAN utilization, console filtered to errors | Loop-overrun markers | Loop timing | v1.1 |
| **Mechanism Tuning** | Setpoint vs measured, error statistics, current, mechanism view, XY plot | Mechanism state | User-picked mechanism fields | v1.1 |
| **Driver Review** | Joysticks, 2D field (video later) | Button-press tracks | Joysticks | v1.1 |

PathPlanner (reported by 2,119 teams in 2025) and similar libraries make path-vs-actual views broadly useful, which is why Autonomous Review is in v1.

### 5.2 Presets find fields by role, not by exact key name

A preset asks for roles such as "battery voltage" or "robot pose". Brownout resolves each role through the key-mapping tables and struct-type detection, then remembers the answer.

| Role | How it's found (examples) |
|---|---|
| Battery voltage | AdvantageKit `SystemStats/BatteryVoltage`; DogLog extras; team keys |
| Brownout flag | AdvantageKit 2027 `SystemStats/Faults/Brownout` (older AdvantageKit versions use different names [verify]) |
| PDH currents | AdvantageKit `PowerDistribution/ChannelCurrent` (array); DogLog extras |
| Robot pose | AdvantageKit template `/RealOutputs/Odometry/Robot`; otherwise the first `Pose2d` named like `*/Pose`, `*/EstimatedPose` or `*/Odometry*`, or Field2d `Robot`. If there are several candidates, the user picks once. |
| Swerve measured / setpoint | AdvantageKit template `SwerveStates/Measured` and `SwerveStates/Setpoints`; otherwise module-state arrays named like `Measured`/`States` vs `Setpoint`/`Desired`/`Target` |
| Active path / target pose | AdvantageKit template `Odometry/Trajectory` and `Odometry/TrajectorySetpoint`; PathPlanner telemetry `NT:/PathPlanner/activePath` and `targetPose` (full list in the vision spec §3.2) |
| Visible tags | AdvantageKit vision template `Vision/Camera<i>/TagIds` and `TagPoses`; PhotonVision `rawBytes`; Limelight `botpose_*` arrays (vision spec §2.2) |
| Match time / mode | AdvantageKit `DriverStation/MatchTime`, `DriverStation/RobotMode`; format reference §1.10 |

- **Missing role:** the panel shows a placeholder with "how to log this", linked to logging health.
- **Remembered:** resolved mappings save into the robot profile, so each question is asked only once.

### 5.3 Team presets

- Save the current workspace as a preset; edit, duplicate or lock it (read-only for the drive team); "reset to preset".
- Export/import presets as JSON, to share on Discord or Drive.
- **Idea:** keep presets in the robot code repository (e.g. a `brownout/` folder). Every laptop then picks them up, and they version with the code.

### 5.4 Other presets

- **Robot profiles:** name, drivetrain type, swerve module order and frame size, max speed, bumper size, brownout threshold (if a roboRIO 2 was set to a custom value), battery labels, key-mapping overrides.
- **Season / field presets:** field image and size, AprilTags, coordinate system (blue wall ≤2026, center 2027), alliance flip rule, endgame length.
- **Threshold presets:**
  - roboRIO 1: 6.3 V.
  - roboRIO 2: 6.75 V by default, settable.
  - Systemcore: TBD [verify].
  - Loop period: 20 ms.
  - All editable.
- **Timeline track sets:** bundled with workspace presets.
- **Themes:** dark and light, with colorblind-safe palettes.

---

## 6. Comparison behavior per view

| View | Overlay | Side by side | Difference | Notes |
|---|---|---|---|---|
| Line graph | ✓ (default) | ✓ stacked lanes | ✓ $A - B$ | Log color + series style |
| 2D field | ✓ ghosts | ✓ small multiples | — | Normalize alliance |
| Swerve | ✓ transparent | ✓ (default) | Per-module error table | — |
| Mechanism | ✓ | ✓ (default) | — | — |
| Table | ✓ columns per log | — | ✓ | Aligned rows |
| Console | ✓ merged, tagged by log | — | — | — |
| Statistics | ✓ histograms | — | ✓ metric deltas | Phase filters |
| XY plot | ✓ | ✓ | — | — |
| Timeline | One lane per log | — | — | Drag a lane to nudge alignment |

---

## 7. Other essentials

- **Field tree** with search, type and unit badges, favorites; the **inspector** shows values at the cursor with structs expanded.
- **Units:** detected automatically, with per-axis conversion.
- **Bookmarks and notes,** saved with the session.
- **Sessions** reopen exactly as left: files, offsets, layout, bookmarks. Autosaved.
- **Library:** recent logs grouped by event and match; robot download over FTP; FIRST DS folder watching.
- **Export:**
  - CSV of a selection.
  - PNG/SVG of a panel.
  - Copy values.
  - Share a session file.
- **Undo/redo** for layout edits.
- **Performance budget:** smooth scrubbing (about 60 fps) with 4–6 panels open; min/max downsampling.
- **Accessibility:** never rely on color alone (patterns and icons on bands and markers); full keyboard navigation; scalable UI.
- **Help:** shortcut sheet, first-run tour, logging-health guidance.
- **Offline, no account.**

---

## 8. Proposed priorities

| Tier | Contents |
|---|---|
| **v1** | **Timeline:** mode bands, event markers, basic custom tracks, expand/zoom, per-log lanes with drag-to-align. **Grid:** split, tabs, workspaces, maximize, pop-out, templates. **Panels:** line graph, table, console/events, 2D field (with visible-tag lines and the PathPlanner overlay), power report, log info + logging health. **Pathing:** error graphs and per-path summary. **Presets:** Quick Look, Power, Autos, Compare, plus save/export; robot profile; season presets 2022–2026 with a slot for 2027. |
| **v1.1** | Swerve, mechanism, joysticks, statistics, XY plot, vision panel, match dashboard; robot project import (PathPlanner paths, autos, settings); the other presets; numeric-strip and findings tracks; smart drop. |
| **Later** | 3D field, video, points, cross-match heatmaps, custom panels / plugin API, live mode. |

These tiers refine the requirements doc's P0/P1/P2 lists. Where the two differ, this spec is the more detailed proposal for views and UI.

---

## 9. Open questions

1. The 2027 field asset and alliance flip rule are only known at kickoff (January 2027).
2. Bundle WPILib field images or download them on demand? Check licensing.
3. How many built-in presets should v1 ship? Four are suggested.
4. Should team presets live in the robot repo by default?
5. Will the team ever want 3D? If so, for which use: mechanisms, vision cameras, presentations?
6. Mode-band palette and accessibility: test with real users.
7. Who are the primary users (programmers, drive team, CSAs)? This decides which preset opens by default.

---

## Sources

- AdvantageScope docs and source (reviewed Oct 2026 commit): tab reference (2D field, swerve, 3D field, mechanism, joysticks, points), navigation (pop-out windows), keyboard shortcuts, coordinate systems, custom assets, 2D field object types and swerve module orders. https://docs.advantagescope.org
- WPILib `fields` library README (2027 field coordinate frame and migration rule) and season field JSON (2026 REBUILT dimensions, AprilTags). https://github.com/wpilibsuite/allwpilib/tree/main/fields
- WPILib source, `main`: `Field2d` (logs `Pose2d[]`), `Mechanism2d` / `MechanismLigament2d` / `MechanismRoot2d`. https://github.com/wpilibsuite/allwpilib
- AdvantageKit source, `main` (Oct 2026): `LoggedSystemStats`, `LoggedPowerDistribution`, `LoggedDriverStation` key names. https://github.com/Mechanical-Advantage/AdvantageKit
- FIRST, "More REEFSCAPE by the numbers": PathPlanner (2,119 teams), YAGSL (520 teams). https://www.firstinspires.org/community-blog/more-reefscape-by-the-numbers-new-legal-devices
- Foxglove docs (comparison mode, layouts, State Transitions panel): https://docs.foxglove.dev · PlotJuggler (layouts, XY plots, transforms): https://github.com/PlotJuggler/plotjuggler
