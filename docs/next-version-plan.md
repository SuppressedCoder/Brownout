# Brownout next version: plan (2026-11-15)

Status: **both releases built (first: v0.4; second: v0.5, 2026-11-16).** Compiled from the feature requests of 2026-11-15, the answers given the same day, and the suggestions the user accepted. `docs/implementation-status.md` has the details of what exists.

Built in v0.4: A icons, B compact view, C multi-select and favorites, D robot profile (subsystems, swerve, robot size, favorites, field-name corrections), E copy as image, 1 field images, 2 power by subsystem and battery health, 3 swerve viewer.

Built in v0.5: 4 AprilTags and cameras with the tags-seen track, 5 controller viewer, 6 commands viewer, 7 robot editor, 8 video, 9 match report, plus a Match Replay preset. The robot profile gained cameras, appearance layers and controller layout with them.

Differences from the plan as written below: a camera's mount is a position on the robot (forward, left), not a full 3D transform; the robot editor has no separate bumper colors (bumpers still follow the alliance); PhotonVision raw results are not read yet; the 2027 controller button numbering and scheduler field names are still unverified against a real 2027 log.

## Applies everywhere

### A. Custom icons, no emojis
- One in-house SVG icon set (single line weight, 16 px grid, colored by the theme) replaces every emoji and symbol character: header buttons, menus, playback controls, console severity marks, timeline event markers, preset actions.
- Rule for future work: no emoji or pictograph characters anywhere in the interface.

### B. Compact view
- Each toolbar keeps its most-used buttons and moves the rest into an overflow menu, based on the panel's actual width.
- Field chips collapse to a count ("8 fields"). The graph legend moves out of the plot into a one-line strip that expands on click.
- The header and timeline bar collapse the same way. The sidebar hides itself on narrow windows.
- Automatic by size, with a Compact switch in Settings to force it.

### C. Sidebar: multi-select and favorites
- Ctrl-click and Shift-click select several fields. Dragging one drags all, with a count badge. Dragging a folder takes everything inside.
- The panel adds every field it accepts and says what it skipped.
- Star a field to pin it at the top of the sidebar. Favorites are saved in the robot profile.

### D. Robot profile
- A preset says where the panels go; a profile describes the robot and applies whichever preset or log is open.
- **Contents:** power subsystems and their motors, cameras, robot appearance, swerve settings, controller layout, favorite fields, field-name corrections (role overrides).
- **Starting out:** the app creates one profile and fills in what it can detect. A team that never opens it loses nothing.
- **Editing:** setup buttons inside panels (Subsystems in Power, Cameras on the field) edit the same profile; one page in Settings shows all of it.
- **Matching:** new logs use the last-used profile. With several profiles, the app picks the one whose field names best match the log. Overridable per log, so two different robots can be compared.
- **Missing fields:** if a mapped field is absent from a log, the profile flags it and asks for a re-pick.
- **Sharing:** export and import as one file, pictures included.

### E. Copy panel as image
- One click copies a graph, field view or report as a picture to paste into team chat; also "Save as PNG".

## New features

### 1. Real field images
- The 2D field shows the actual top-down field picture instead of a plain rectangle.
- Source: WPILib's field images (image plus a JSON giving the playable area's corner pixels and size). Bundled in the app for 2024, 2025 and 2026 so it works offline; 2027 added after kickoff. License notice added to `THIRD_PARTY_NOTICES.md`.
- Load your own picture in the same format (offseason fields, or before an app update).
- Brightness slider and a "plain field" switch.
- AprilTag maps for the same seasons are bundled too (welded / AndyMark choice where they differ).

### 2. Power by subsystem
- **Entry:** a Power button in the header opens the power report with a Subsystems setup.
- **Setup:** add a subsystem (name, color), then assign motors. A motor is any current source: a PDH/PDP channel number or a logged current field. Guesses are prefilled from field names (`/Drive/...` goes to Drive). Saved in the robot profile.
- **Report over the log or a selection:**
  - Energy per subsystem, $E = \int V(t)\,I(t)\,dt$, ranked with percent of total.
  - Highest current peaks per subsystem, with the time; click to jump.
  - Lowest voltage dips, each with the subsystem breakdown at that moment.
  - Every brownout: who was drawing at the dip and over the half second before it, ranked.
  - "Unassigned" current (total minus everything mapped), so the percentages stay honest.
- **Views:** stacked current-by-subsystem graph; one column per log when comparing matches.
- **Battery health:** fit $V = V_0 - I R$ over the match to estimate the battery's internal resistance $R$ and flag weak batteries. A battery label per log tracks one battery across matches.
- **Limits:** needs per-channel or per-motor current in the log; the report says so when it is missing. Motor-controller fields must be supply current; stator current overstates battery draw, so fields named "Stator" get a warning.

### 3. Swerve viewer
- Four modules with measured and setpoint arrows, a chassis speed arrow and a rotation arc.
- Settings: module order, max speed. Found automatically from `SwerveModuleState[]` fields (2026 and 2027 names).
- One diagram per log, side by side.

### 4. AprilTags and cameras
- Each camera has a name, a color and four optional slots: pose estimate, tag IDs, tag poses, camera mount. Empty slots are simply not drawn.
- Pose estimate draws a ghost robot where that camera thinks the robot is. Tag IDs (or tag poses) draw a line to each seen tag and highlight it, labeled with its ID. A mount makes lines start at the camera.
- A readout at the cursor lists camera, tags seen, and the distance between the camera's estimate and the robot pose.
- Known layouts (AdvantageKit vision template, Limelight) are prefilled; PhotonVision raw results come later.
- **Tags-seen timeline track:** one row per camera showing when tags were visible, labeled with IDs, with blind stretches left empty.
- Mappings are saved in the robot profile.

### 5. Controller viewer
- A gamepad drawing showing sticks, triggers, buttons and D-pad at the cursor.
- Pick the controller (0 to 5) and a layout: Xbox, PlayStation, or a plain list.
- Reads `DS:joystick<N>/...` and the AdvantageKit `/DriverStation/Joystick<N>/...` fields.

### 6. Commands viewer
- One row per command with a bar whenever it ran. Lists what is running at the cursor and total run time. Click a bar to jump.
- Reads the scheduler's running-command list (normally `NT:/SmartDashboard/Scheduler/Names`). Also accepts any list-of-names field, or a folder of true/false fields, for logs without it (AdvantageKit does not record NetworkTables).
- Limit: the scheduler lists top-level commands only. To verify when building: 2027 field names.

### 7. Robot editor
- Size, bumper colors and a list of layers: shapes, pictures (PNG/JPG) and SVGs, each with position, size, opacity and a pivot point.
- A layer is static, or linked to a logged angle: pick the field, its unit (radians, degrees, rotations), a zero offset and an invert switch.
- Saved in the robot profile.

### 8. Video
- A Video panel plays a local file (MP4/H.264, WebM; phone HEVC clips may need converting).
- Manual sync: scrub to a moment you recognize, then "This frame = auto start" or "= cursor"; frame-step to fine-tune.
- Follows the timeline, including speed and scrubbing. One video per log; file and offset are remembered.

### 9. Match report
- A one-page PDF per log: match info, brownouts and what caused them, power by subsystem, battery health, worst loop overruns, vision blind stretches.
- Sections with no data are left out.

## Build order

- **First release:** A icons, B compact view, C multi-select and favorites, D robot profile, E copy as image, 1 field images, 2 power and battery health, 3 swerve.
- **Second release:** 4 AprilTags and tags-seen track, 5 controller, 6 commands, 7 robot editor, 8 video, 9 match report.
- The demo logs gain camera estimates, controller and command data to test with. Field names for controllers, commands and motor currents should be checked against a real log.
