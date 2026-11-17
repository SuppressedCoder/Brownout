# Brownout: every feature, and how to use it

*For team members using Brownout and for whoever works on it next (people or AI agents). Most of the app explains itself, but some features only show up if you know the gesture, the key or the menu. They are all here. Keep this file complete: anything added to the app gets a line here and, if it is a gesture or a key, a line in the in-app help sheet (`components/Help.tsx`).*

Last brought up to date: 2026-11-17 (after pull request #14).

---

## 1. Getting logs in

- **Open logs:** File, Open logs (Ctrl+O), or drag `.wpilog` files onto the window from anywhere. Several at once is normal: comparing matches is what Brownout is for.
- **Demo logs:** Settings, Demo logs loads three made-up 2026 matches (NYROC Q12, Q18, Q23) with their own robot profile. Q18 has a brownout and a camera dropout; Q12 has a bad camera reading and the position snap that follows it.
- **Last session:** the logs you had open come back on the next launch (Settings, General, "Reopen the last session's logs" turns it off).
- **Command line** (desktop and dev builds): `--open <file.wpilog>` (repeatable), `--demo`, `--preset <id>` (`quick`, `power`, `autos`, `compare`, `code`, `replay`), `--screenshot <png>`.
- **Browser build** (`npm run web`): the same interface in a browser, opening files you drop or pick. It cannot reopen files by path (no session restore) and does not offer match videos.

## 2. The header

From left to right:

- **Sidebar button** (Ctrl+B): shows or hides the field list.
- **File menu:** open logs, export CSV, copy panel as image, match report (PDF), close all logs.
- **Log chips**, one per open log, in its color:
  - **click the colored dot** to hide or show that log everywhere;
  - **click the name** to make it the *primary* log (the alignment reference, and the log whose modes shade the graphs). The primary log has a star;
  - **the close button** closes it;
  - **hover** for the file name, size and alignment offset.
- **View switch: Panels, Video, Power** (Ctrl+1, Ctrl+2, Ctrl+3). See section 8.
- **Align:** how logs are lined up (section 3).
- **Preset menu** and **Add panel** (only in the Panels view, section 6).
- **Potato mode**, **Settings** (Ctrl+,), **Shortcuts and tips** (?).

On a narrow window the labels turn into icons and the less-used controls move into a three-dot menu at the end of the row. The same is true of every toolbar in the app.

## 3. Time, alignment and comparing logs

- **Every log keeps its own time.** Brownout lines logs up with one offset per log; changing the alignment never changes the data.
- **Align menu (header):**
  - **Auto start** (default): t = 0 when autonomous began in each log;
  - **Teleop start**;
  - **First enable** (AdvantageScope's rule);
  - **Log start**;
  - **Wall clock:** real time, for files from the same match;
  - **Raw:** no alignment.
- **Nudge one log by hand:** hold Alt and drag that log's lane on the timeline sideways. The lane shows the nudge ("nudge +0.35 s") while you drag. Log info shows it as a number you can type.
- **Time readout formats** (transport bar): aligned time, match time ("TELEOP 1:12 left"), raw log time, wall clock.

## 4. The timeline (bottom of the window)

The timeline is the only thing that moves time: the cursor, the visible range and playback. Panels follow it. (Settings, General, "Let graphs and the field move time" lets graphs and the field do it too.)

**What it covers.** By default the timeline covers **the match**: from the earliest auto start to the latest end of teleop, with 2 s either side. The label at the left of the top strip says **Match**. Click that label to switch to **Whole log** (time before auto and after the match) and back; the choice is remembered. A link that jumps to a moment outside the match (a console line from the queue, say) switches to the whole log by itself. A log with no robot-mode data always shows the whole log.

**The overview strip** (the thin strip at the top) shows everything the timeline covers, with a window marking the part you are looking at:

- **drag a grip** (the light handles on the window's edges) to change how much is shown; it snaps to auto start, teleop start and teleop end (hold Alt for no snapping);
- **drag the middle** of the window to move it;
- **click outside the window** to bring it there;
- while you drag, the start, end and length are shown, and everything outside the window is dimmed;
- the **solid white line with a tab** is the current time.

**The lanes** (one per log, plus events, battery, bookmarks and your tracks):

- **press anywhere** to put the cursor there; **drag** to scrub it. It snaps to mode changes and bookmarks; hold **Alt** to stop the snapping. The time shows next to the cursor while you drag;
- **Shift-drag** selects a range. Statistics, CSV export, "zoom to selection" and loop playback use it. Drag a selection's edge (its small grip) to adjust it. Esc clears the selection and the cursor;
- **Alt-drag a log's lane** nudges that log's alignment (section 3);
- **double-click** shows everything the timeline covers.

**Panning and zooming:**

- **drag the time scale** along the bottom, or drag with the **middle mouse button** anywhere, to pan;
- **the wheel** zooms around the pointer; Shift+wheel or a sideways scroll pans;
- the **Zoom** box on the transport bar takes a typed span (`10`, `30s`, `500ms`, `1:30`, `2m`); minus and plus zoom out and in;
- **Match** (M) shows the match; **Auto** (A), **Teleop** (T); the **More** menu has Whole log (F), Enabled (E), Endgame (last 20 s), Selection (S) and fixed spans.

**Playback:**

- **Space** plays and pauses; the speed menu goes from 0.25x to 4x; the loop button loops over the selection;
- the view follows the playhead only when the playhead runs off its edge. If you move the view somewhere else while playing, it stays there; pressing play brings the playhead back into view once;
- hover previews are ignored while playing.

**Moving the cursor by keyboard:** Left/Right step one 20 ms loop cycle, Shift+Left/Right one second; `[` and `]` jump to the previous or next robot-mode change; **G** (or click `t =`) types a time to go to.

**Lanes and tracks:**

- **mode lanes**, one per log: disabled, auto, teleop, utility and e-stop, labeled inside wide bands;
- **events:** brownouts, program restarts, loop overruns, errors, warnings, alerts, connection losses, and position and vision findings (target icon, section 9);
- **battery strip:** voltage color-coded, red below the brownout threshold;
- **bookmarks:** **B** adds one at the cursor with an optional note. Alt-click the "Bookmarks" label to remove them all;
- **your tracks:** add any field from the field list (its "Add as a timeline track" button). On/off fields draw as bars, text and state fields as labeled segments, numbers as a color strip, with the value at the cursor at the right. Alt-click a track's label to remove it;
- **tags-seen tracks**, one per camera (the 2D field's Display menu).

**Size:** drag the timeline's top edge to any height; double-click the edge for automatic height; the height button (Ctrl+T) cycles compact, standard and expanded.

## 5. The field list (sidebar)

- **Search:** words narrow by name (every word must appear).
- **Filter by type, by typing:** start typing a type that exists in your logs (`Pose2d`, `boolean`, `number`, `SwerveModuleState[]`, ...). The rest of it shows faintly with a **Tab** hint. Press **Tab** and it becomes a type chip, then keep typing:
  - more types (Tab again) list fields of **any** of them;
  - words narrow by name;
  - **Backspace** on an empty search removes the last type; **Esc** clears it all; each chip has its own remove button.
- **Select:** click one field; **Ctrl-click** adds or removes one; **Shift-click** selects a range. The bar that appears adds the selection to the active panel, or opens it in a new panel.
- **Drag** a field, or the whole selection, onto a panel to add it. The panel says what it could not show. **Drag a folder** to add every field in it. **Drop on an empty spot** in the grid and Brownout picks the right panel: positions go to a 2D field, numbers to a graph, and so on.
- **Double-click** a field to add it to the active panel.
- **Star** a field to make it a favorite. Favorites sit at the top and are saved in the robot profile.
- **"Add as a timeline track"** button on a field row.
- **`{}` button:** shows or hides the fields Brownout made itself (`/Brownout/...`) and the parts of structs and arrays.
- **Badges** show each field's type and unit; colored dots show which open logs have it.
- **Inspector** (bottom of the sidebar): the selected fields' values at the cursor, per log, with structs expanded.
- **Width:** drag the sidebar's right edge to make it wider (remembered); double-click the edge for the default width.

## 6. Panels and the grid (the Panels view)

- **Add panel** (header) adds any panel type. New panels open as tabs in the active group.
- **Arrange:** drag a panel's tab onto another panel's edge to split it, or onto its tabs to stack it. Drag the borders between panels to resize them.
- **Maximize one panel:** the button at its top right (it shows on hover), **double-click its tab**, or **Ctrl+Enter**. The same again restores it. The timeline stays visible, and maximizing never marks a preset as changed.
- **Copy a panel as a picture:** the picture button at its top right, or Ctrl+Shift+C for the active panel. **Shift-click** the button to save a PNG instead.
- **Compact view:** narrow panels keep their most-used toolbar buttons and move the rest into a three-dot menu. Settings, General can force compact view everywhere.

**Presets** are saved layouts (header, Preset menu):

- **built-in:** Quick Look, Power & Brownouts, Autonomous Review, Compare Matches, Code Health, Match Replay. They find their fields by what they are (battery voltage, robot pose, swerve states, ...), so they work on any team's logs and only add fields the log has. A panel whose field is missing says what to log;
- the active preset shows in the menu button, with "(modified)" once you change the layout. Zoom and pan never count as a change;
- **your own:** save (Ctrl+S updates the active one), rename, duplicate, delete, export (pick which) and import (on a name clash: overwrite, keep both or skip). The copy button next to a built-in applies it and saves a copy you can edit;
- your own presets remember exact field names. Built-in ones look the fields up again in each log.

## 7. The panels

**Line graph**

- **Field** adds fields (or drag them in). Each field's chip switches it between the **left and right axis**, or removes it. **Clear** removes them all.
- **Comparing logs:** **Overlay** (default), **Stacked** (a lane per log), or **Difference** (A minus B, the first two logs). The log menu picks all logs or one.
- **Modes** shades auto and teleop; **Threshold** adds horizontal lines (e.g. the brownout voltage).
- **Linked** (on) follows the timeline. Turn it off and the graph keeps its own time range: the wheel zooms that graph's time only.
- **Value axis:**
  - the wheel over the plot zooms the values around the pointer (unless graphs may move time, then Ctrl+wheel);
  - the wheel or a drag **on an axis** zooms or pans just that axis;
  - **double-click** returns to auto-fit;
  - the Y menu takes typed limits.
- The one-line legend strip above the plot opens the full legend with values at the cursor. Hover shows the time between the cursor and the pointer.

**Table:** the **changes** of the chosen fields within the visible range (it updates when you stop moving), or their **values at the cursor**; one column per log.

**Console & events:**

- every open log's console output, messages, alerts and events, interleaved by time and tagged by log;
- filters for errors, warnings, info and events;
- the search takes words, and `!word` excludes a word;
- click a line to jump there.

**2D field:**

- **the field:** the real 2024 to 2026 field pictures, or your own picture from a WPILib or PathWeaver field JSON (Display menu);
- **robots:** one per log, sized from the robot profile, bumpers in the alliance color, with a trail (the trail menu sets how long);
- **Pose field** adds other positions (a vision estimate, a setpoint), drawn as labeled ghosts;
- **zoom and pan:** the wheel zooms, a drag pans, double-click fits the whole field; **Fit** when zoomed;
- **Display menu:**
  - field picture and its brightness;
  - the active path and the target pose (PathPlanner);
  - AprilTags (welded or AndyMark map);
  - cameras: lines to the tags each sees, a ghost where it thinks the robot is, and a readout of its error;
  - tags-seen timeline tracks;
  - **robot names**;
  - **robot parts:** hide them all, or each part by name;
  - normalize alliance (flip red runs onto the blue side so autos overlay);
  - rotate 180 degrees (the red driver station's view);
  - set up cameras; edit the robot; load or remove your own field picture;
- with "Let graphs and the field move time" on, Alt-hover over a trail previews that time and Alt-click goes there.

**Swerve drive:**

- each module's speed and angle, measured against the setpoint (dashed, can be turned off);
- chassis velocity and rotation, one diagram per log;
- module order and full-scale speed are saved in the robot profile.

**Controller:**

- the driver's sticks, triggers, D-pad and buttons at the cursor, one pad per log;
- pick the Driver Station port;
- Xbox, PlayStation or a numbered list (for flight sticks and button boards), saved in the robot profile.

**Commands:**

- which commands ran when: one row per command, one lane per log, with total time and run count;
- **click a run** to jump to its start; hover for details;
- found from the scheduler's list of running commands, or AdvantageKit's one-flag-per-command folders. A different field can be picked by hand, and "automatic" goes back.

**Video** (one video per log; section 10).

**Statistics:**

- one numeric field over the visible range, the selection, enabled time, auto, teleop or the full log;
- a histogram, and min, mean, max and more;
- min and max cells jump to that moment.

**Power** (the same report fills the Power view):

- **who used the energy**, by subsystem, with each one's peak current (click to jump there);
- **the lowest voltage dips**, and **every brownout** with what was drawing at the dip and over the half second before;
- **a stacked current chart** that follows the timeline;
- **"Follow selection"** reports on the Shift-selected part of the timeline only;
- **battery health:** resistance from how far the voltage drops as current rises, a rating, and a **battery label** per log, so one battery is followed across matches. Its history can be pruned;
- "Set up subsystems" opens the subsystem editor (section 11).

**Path analysis:** per auto path, how far the robot was from the PathPlanner target (max, RMS, at the end), with a button to graph the position and heading error.

**Compare matches:**

- one row per log, one column per metric:
  - battery: minimum voltage, peak current, energy, battery resistance;
  - loop overruns, errors and **position vs vision** findings;
  - path errors;
- **add min, mean and max columns** for any numeric field, over enabled, auto, teleop or the full log;
- click a value to jump to that moment; a button makes a log the primary.

**Log info & health:**

- the file, duration, loggers, event and match, alliance, auto routine, wall clock;
- where robot state was read from, first enable, the alignment offset, and a typed **nudge**;
- logging health: what the log lacks and how to log it.

## 8. The views (header switch, or Ctrl+1, 2, 3)

- **Panels:** your grid. It stays as you left it while you are in the other views.
- **Video review:**
  - one log's match video and its 2D field **side by side at the same height** (a narrow window stacks them); the field follows whichever log's video is picked;
  - below them, **Moments to check**: position jumps, camera disagreements, brownouts, connection losses and restarts, in match time. Click one to go there. If the log has no robot pose or no camera estimates, the list says so instead of looking clean.
- **Power:** the battery and current graph across the top, the power report below it. The Power button and **P** open it.

Preset and Add panel only show in the Panels view. The views' own panels are never saved into your layouts or presets.

## 9. Things Brownout works out for you

- **Robot state and match info** (enabled, auto, teleop, event, match number, alliance) from whichever logger wrote the file: AdvantageKit, DataLogManager, the 2027 Driver Station.
- **Fields by role:** battery voltage, total current, PDH channels, robot pose, swerve states, chassis speeds, the active path and target, loop time, CAN use and more. A wrong guess is corrected once in Settings, Robot ("Field for: ...") and remembered for that robot.
- **Cameras** from field names (AdvantageKit's vision template, Limelight `botpose` arrays). Each camera gets fields for the tags it sees, how many, and its estimate error (`/Brownout/Vision/<camera>/...`).
- **Commands, the controller, PathPlanner paths and the auto routine**, from their usual field names.
- **Events:** brownouts, program restarts (not the normal start-up), loop overruns (naming the slowest part), errors, warnings (repeats grouped), alerts, connection losses.
- **Position and vision findings:**
  - a camera's estimate stays 0.5 m or more from the robot's position for at least 0.25 s while enabled;
  - the robot's position jumps 0.25 m or more, faster than a robot drives (usually a vision correction snapping it). Jumps in the first half second of auto or teleop are left out: robot code resets the position there on purpose;
  - each finding names the auto path and commands that were running ("Robot position jumped 0.58 m during ElevatorToHeight");
  - they show on the timeline, in the console, Compare Matches, Video review and the match report;
  - the thresholds are first guesses.
- **Robot speed** from the pose (`/Brownout/Pose/Speed`), ignoring jumps; **electrical power** (V times I); **path errors**; **current per subsystem** (`/Brownout/Subsystems/<name>/Current`). All appear in the field list like logged fields.
- **Brownouts only when the data can show them:** without battery voltage or a brownout flag, the report says brownouts are unknown, never "none".
- **Potato mode is offered** when drawing gets slow.
- **A match video is offered** when a log opens without one (section 10).

## 10. Match video

**Choosing a video:**

- **the video panel's "Choose video":** MP4 (H.264) and WebM play; phone HEVC clips need converting. The file and its sync are remembered per log;
- **offered automatically:** when a log opens without a video, Brownout looks for one whose name says the match (`Q12`, `qm12`, `Qual 12`, `2026nyroc_qm12`, `Match 12`). It looks in the log's own folder and in the **videos folder** set in Settings, General, and offers the best match in a message:
  - **Use it** loads it and opens the sync view; **Not now** is remembered;
  - an empty video panel lists the same matches as buttons;
  - names like `Q120`, `Practice 12` or `IMG_0012` are never matched, so rename phone clips to something like `Q12.mp4`.

**Syncing: the sync view** (opens after choosing a video, or Sync menu, "Open the sync view"):

- **Video controls of its own:** Play at 0.25x, 0.5x or 1x (Space); Left/Right one frame; Shift+Left/Right one second; comma and period five seconds; a box to type a video time; sound on or off.
- **The video timeline:**
  - press or drag to move through the video;
  - **scroll the wheel to zoom in down to single numbered frames**, then click one to show it;
  - drag the time scale or use the middle button to pan; double-click shows the whole video; `=` and `-` zoom too.
- **Frame steps use the video's own frame rate**, measured when it loads (shown in the readout as "frame 300 · 30 fps").
- **The log strip:**
  - this log's modes, robot speed (its samples as dots when zoomed in), and markers: auto start, robot starts moving, teleop start, teleop end;
  - press or drag to pick the log moment; it snaps to markers (Alt: no snap);
  - it zooms and pans like the video timeline and holds still while you drag.
- **Pair:**
  1. pick the log moment;
  2. find the same frame in the video;
  3. press "This frame is ...".

  Play the video and a white line on the log strip moves with it; robot speed should rise when the robot starts moving. **Apply** (Enter) saves; Esc cancels.
- **A video that drifts** (its clock runs slow or fast, so the sync slips as the match goes on): pair a **second moment** late in the match (teleop end). The view says how far off the clock is ("runs 1.5% slow"), and Brownout plays the video faster or slower to match. Pairs that disagree by more than about 20% are refused as a mistake. "Clear pairs" starts over.
- Inside the sync view nothing moves the shared time until Apply, and the app's own shortcuts are paused.

**After syncing**, the video follows the timeline, including the playback speed:

- the frame buttons nudge the sync by one frame; the Sync menu also has quick "this frame is auto start, teleop start, the cursor" and "remove the sync";
- dragging the timeline keeps the picture moving. With phone video (few keyframes) it updates several times a second rather than every frame;
- the panel says when the video starts after, or ended before, the current moment.

## 11. The robot profile (Settings, Robot)

A preset says where panels go; a **robot profile** describes the robot and applies to every log from it:

- **which profile:** chosen per log (remembered per file), else the best match of field names, else the last one used. Several profiles are fine (a practice robot);
- **size** with bumpers (no upper limit), **swerve module order and full-scale speed**, **controller layout**, **favorite fields**, **field-name corrections**;
- **power subsystems** (subsystem editor):
  - **Suggest** groups motor currents by folder (`Subsystems/Elevator/...` becomes Elevator), preferring supply over stator current;
  - assign PDH or PDP channels (each shows its peak current) or logged current fields;
  - "Unassigned" is the total minus everything assigned;
  - fields that look like stator current get a warning;
- **cameras** (camera editor): a name plus any of three fields (pose estimate, tag IDs, tag poses) and where it is mounted. "Copy the cameras found" turns the detected ones into an editable list;
- **robot appearance** (robot editor, also from the field's Display menu):
  - **parts:** rectangles, ellipses, pictures and SVGs (pictures up to 512 px, SVGs up to 300 kB, kept inside the profile); place them by typing or by dragging in the preview; order, opacity and color; up to 24 parts;
  - **turning with a logged angle:** link a part to a logged angle (radians, degrees or rotations, reversed, a zero offset);
  - **turn point:** choose its center, back end, front end, left side or right side, or **drag the round pivot marker**. When the pivot sits at the part's center, a plain drag moves the part and **Alt-drag** moves the pivot;
  - **attached to another part:** the part moves with that part's turn, and its own angle adds on top (a wrist on an arm, a claw on a turret);
  - **the test angle** slider previews every linked part turning;
- **export and import** a profile as one file, pictures included, to share a setup with the team.

## 12. Reports and exports

- **Match report** (File menu): a one-page PDF per log for the pit:
  - battery voltage over the match;
  - every brownout with what drew the most;
  - power by subsystem, deepest dips, battery resistance;
  - loop overruns, restarts, connection losses, first errors;
  - per camera how often it saw a tag and where it was blind;
  - position and vision findings.

  Sections with no data are left out, and what the log lacks is listed. With several logs open it asks which one.
- **CSV** (File menu, Ctrl+E): the active panel's fields over the selection, or the visible range, one column set per log.
- **Panel pictures:** copy (Ctrl+Shift+C) or save a PNG (Shift-click the picture button).

## 13. Settings

- **General:**
  - Potato mode, and whether to offer it;
  - always use compact view;
  - let graphs and the field move time;
  - reopen the last session;
  - the **videos folder**;
  - brownout threshold (6.3 V roboRIO 1, 6.75 V roboRIO 2, or higher), season field, AprilTag map (built-in welded or AndyMark, or your own JSON).
- **Appearance:** dark, light or high-contrast theme; the color of each log and of each robot mode.
- **Robot:** the robot profile (section 11).
- **Keybinds:** every shortcut can be rebound. Click a key and press the new one; a key already in use moves to the new command, and the old one is unbound. Reset one or all.
- **Demo logs.**

**Potato mode** (Ctrl+Shift+P) is for slow laptops: 30 draws a second at 1x resolution, coarser graphs, no hover readouts in other panels, short trails, tables that update when you stop moving.

## 14. Keyboard shortcuts (defaults; all rebindable)

| Key | Does |
|---|---|
| Space | Play / pause |
| Left / Right | Step one loop cycle (20 ms) |
| Shift+Left / Shift+Right | Jump 1 s |
| `[` / `]` | Previous / next robot-mode change |
| G | Go to a typed time |
| B | Bookmark at the cursor |
| Esc | Clear the selection and the cursor |
| M | Zoom to the match |
| F | Zoom to the whole log |
| A / T / E / S | Zoom to auto / teleop / enabled / the selection |
| = / - | Zoom in / out (time) |
| Ctrl+O | Open logs |
| Ctrl+S | Save the layout as a preset (updates the active one) |
| Ctrl+E | Export CSV |
| Ctrl+Shift+C | Copy the active panel as an image |
| Ctrl+B | Show / hide the field sidebar |
| Ctrl+T | Cycle the timeline height |
| Ctrl+Enter | Maximize / restore the active panel |
| Ctrl+1 / Ctrl+2 / Ctrl+3 | Panels / Video review / Power view |
| P | Power view |
| Ctrl+Shift+P | Potato mode |
| Ctrl+, | Settings |
| ? | Shortcuts and tips |

**In the video sync view only:** Space play/pause; Left/Right one frame; Shift+Left/Right one second; comma/period five seconds; `=` / `-` zoom the video timeline; Enter apply; Esc cancel.

**In the field search only:** Tab turns the faint type into a filter; Backspace on an empty search removes the last type; Esc clears.

## 15. Mouse gestures that are easy to miss

| Where | Gesture | Does |
|---|---|---|
| Overview strip | click its label (Match / Whole log) | switch what the timeline covers |
| Overview strip | drag a grip / the middle | resize / move the visible window (snaps; Alt: none) |
| Timeline lanes | press / drag | place / scrub the cursor (snaps; Alt: none) |
| Timeline lanes | Shift-drag | select a range; drag its edge grips to adjust |
| Timeline lanes | Alt-drag a log's lane | nudge that log's alignment |
| Timeline | drag the time scale, or middle-drag | pan |
| Timeline | double-click | show everything it covers |
| Timeline | Alt-click a track label / "Bookmarks" | remove that track / all bookmarks |
| Timeline | drag / double-click its top edge | resize / automatic height |
| Header | click a log's dot / name | hide or show it / make it primary |
| Field list | type a type, then Tab | filter by that type |
| Field list | Ctrl-click / Shift-click / drag a folder | select some / a range / add a whole folder |
| Field list | double-click a field | add it to the active panel |
| Field list | drag / double-click its right edge | resize / default width |
| Grid | double-click a tab | maximize / restore that panel |
| Grid | drop fields on an empty spot | create the right panel for them |
| Any panel | Shift-click the picture button | save a PNG instead of copying |
| Graph | wheel / drag on an axis | zoom / pan that axis only |
| Graph | double-click | back to auto-fit |
| Graph | click the legend strip | open the full legend |
| 2D field | wheel / drag / double-click | zoom / pan / fit |
| Robot editor | drag the round marker (Alt-drag when it sits at the part's center) | move the pivot |
| Sync view | wheel on the video timeline | zoom down to single frames |
| Sync view | Alt while picking on the log strip | no snapping to markers |

## 16. Where things are stored

On this computer only (nothing is sent anywhere):

- **The browser storage of the app:**
  - settings and keybinds;
  - the last session's logs;
  - the current layout and your presets;
  - robot profiles (with their pictures), battery labels and history;
  - videos and their syncs;
  - timeline and view choices;
  - declined video offers.

  A robot profile export is the way to move a setup to another computer.
- **The app's data folder:** custom field pictures, and the chosen videos folder.
- Logs and videos stay where they are; Brownout remembers their paths. If a video moves, the panel asks for it again and keeps the sync.
