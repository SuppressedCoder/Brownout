# Brownout: every feature, and how to use it

*For team members using Brownout and for whoever works on it next (people or AI agents). Most of the app explains itself, but some features only show up if you know the gesture, the key or the menu, and some panels only work once the robot code logs the right thing. Both are covered here. Keep this file complete: anything added to the app gets a line here and, if it is a gesture or a key, a line in the in-app help sheet (`components/Help.tsx`).*

Last brought up to date: 2026-11-17 (after pull request #14).

**This guide is inside the app:** press **F1**, or **?** and the **Guide** tab. It has a contents list and a search box, and panels that are missing data link straight to their part of it ("How to log this, in the guide").

**Where to start:** section 2 walks through the common jobs (why did it brown out, watch the video next to the field, compare matches, check an auto, check vision, tune a mechanism, see what the code was doing). Section 8 explains every panel: what it is for, what the robot has to log for it, and how to use it.

---

## 1. Getting logs in

- **Open logs:** File, Open logs (Ctrl+O), or drag `.wpilog` files onto the window from anywhere. Several at once is normal: comparing matches is what Brownout is for.
- **Demo logs:** Settings, Demo logs loads three made-up 2026 matches (NYROC Q12, Q18, Q23) with their own robot profile. Q18 has a brownout and a camera dropout; Q12 has a bad camera reading and the position snap that follows it. Good for trying everything below.
- **Last session:** the logs you had open come back on the next launch (Settings, General, "Reopen the last session's logs" turns it off).
- **Command line** (desktop and dev builds): `--open <file.wpilog>` (repeatable), `--demo`, `--preset <id>` (`quick`, `power`, `autos`, `compare`, `code`, `replay`), `--screenshot <png>`.
- **Browser build** (`npm run web`): the same interface in a browser, opening files you drop or pick. It cannot reopen files by path (no session restore) and does not offer match videos.

## 2. Common jobs, step by step

### 2.1 Why did the robot brown out? (the Power view)

1. Open the match's log. Press **P**, or click **Power** in the header.
2. **The graph across the top** is battery voltage (left axis) and total current (right axis), with a dashed line at the brownout threshold. Where the voltage dives under it, the robot browned out. If the log has no voltage, the graph shows motor currents instead and says what is missing.
3. **The report below it** has, from top to bottom:
   - **the totals:** lowest voltage (click to go there), peak current, energy used, time enabled;
   - **one card per brownout:** when it happened, how low the voltage went, and **what was drawing current at the dip and over the half second before it**. This needs power subsystems (step 4);
   - **power by subsystem:** how much of the energy each mechanism used, its average and peak current (click the peak to go there), and a **stacked current chart** that follows the timeline;
   - **the deepest voltage dips** and who was drawing at each;
   - **battery health:** the battery's internal resistance and a rating.
4. **Tell Brownout which motors make which mechanism** (once per robot; it is saved in the robot profile):
   1. click **Subsystems** (or "Set up subsystems" in the empty report);
   2. click **Suggest**: motor current fields are grouped by folder (`Subsystems/Elevator/...` becomes Elevator), supply current preferred over stator current;
   3. check the groups and rename them. Add a subsystem for anything missed, and give each one PDH/PDP channels (each shows its peak current) or current fields;
   4. click Done. The cards now say things like "Biggest draw: Elevator 231 A".
5. **Narrow it down:** Shift-drag a part of the timeline, then turn on **Follow selection**: the numbers cover only that part.
6. **Follow a battery across matches:** type its label (B7, say) in battery health for each log. Brownout keeps a history per battery, so a battery whose resistance keeps rising shows up.
7. **The robot must log** battery voltage, and ideally total current and PDH channel currents (section 8, Power). Without voltage, Brownout says brownouts are unknown instead of guessing. Energy is then estimated at 12 V and labeled so.

### 2.2 Watch the match video next to the field (the Video review view)

1. Open the log. Press **Ctrl+2**, or click **Video** in the header.
2. The screen splits in two, side by side at the same height: **the video on the left, the 2D field on the right**. Below them is the list of **moments to check**.
3. **Choose the video** with the left side's **Choose video**. If its name says the match (`Q12.mp4`), Brownout may already have offered it (section 11).
4. **Sync it once** in the sync view that opens:
   1. pick the log moment (Auto start is usually right);
   2. find the same frame in the video: play it at 0.5x, step frames with the arrow keys, or scroll the wheel on the video timeline to zoom in to single frames;
   3. press **"This frame is auto start"**, then Apply.

   If the video slips later in the match, also pair teleop end (section 11).
5. **Play** (Space) or **drag in the timeline**: the video and the robot on the field move together. If you sync the video at auto start, the robot on the field should start moving when the robot in the video does.
6. **Moments to check:** position jumps, camera disagreements, brownouts, connection losses and restarts, in match time. Click one to jump the video and the field there.
7. **Several logs open?** The Log menu on the video side picks which match is reviewed; the field follows it.
8. The video panel and the field work exactly like their versions in the grid: the field's Display menu, zoom and so on.

### 2.3 Compare matches side by side

1. **Open all the matches** (Ctrl+O, pick several, or drop them in). Each gets its own color, shown on its chip in the header.
2. **Line them up:** **Align** in the header, **Auto start** (the default) puts t = 0 at the start of auto in every log. To fix a small offset by eye, **Alt-drag that log's lane** on the timeline.
3. **Pick the layout:** Preset, **Compare Matches** gives:
   - **Compare matches table:** one row per log: event, match, alliance, auto routine, code version, time enabled, minimum and average voltage, brownouts, peak current, energy, battery resistance, loop overruns, errors, position vs vision findings, path errors. Click a value to go to that moment. **Add field** adds min, mean and max columns for any number, over enabled, auto, teleop or the whole log;
   - **an overlaid battery graph:** every log on the same axes, in its own color;
   - **the 2D field** with every log's robot, and a long trail so whole paths overlay;
   - **voltage statistics** per log.
4. **Change how a graph compares logs** with its comparison menu:
   - **Overlay:** every log on the same axes;
   - **Stacked:** one lane per log, one under the other: true side by side;
   - **Difference:** the first log minus the second, to see exactly where two runs differ.
5. **Compare autos on the field:** Display, **Normalize alliance** flips red-alliance runs onto the blue side so they overlay.
6. **Show or hide a log** by clicking its colored dot in the header. **Make a log the reference** by clicking its name (it gets a star): alignment and the mode shading follow it.

### 2.4 Check an autonomous routine

1. Preset, **Autonomous Review**. The timeline zooms to auto.
2. **The 2D field** shows the path being followed (PathPlanner), where the path said the robot should be (the target, joined to the robot by an error line), and the robot itself, with a 15 s trail.
3. **The path error graph** shows how far the robot was from the target over time; **Path analysis** lists every path with its error at the start, the largest and typical error, and the error at the end.
4. With several matches open and Normalize alliance on, every run's path overlays on one field.
5. **The robot must log** the robot pose, and PathPlanner's active path and target pose (section 8, Path analysis).

### 2.5 Check vision

1. Open a 2D field (Quick Look has one). Display, **Cameras**: for each camera a line to every AprilTag it sees, the tag lit up with its ID, a ghost robot where the camera thinks the robot is, and a readout of how far that is from the logged pose.
2. Display, **Tags-seen tracks on the timeline**: one row per camera showing which tags it saw, and gaps where it saw none.
3. **Where vision and the robot's position disagree** is found for you (section 10): look for the target icons on the timeline's Events row, the Moments list in Video review, or the "Position vs vision" column in Compare Matches. Each one says what was running ("Robot position jumped 0.58 m during AutoAlign").
4. Cameras with odd field names: Display, **Set up cameras** to pick each camera's fields and where it is mounted.

### 2.6 Tune a mechanism (an elevator, an arm, a shooter)

1. **Add panel**, Line graph.
2. Add the setpoint and the measured value: type the mechanism's name in the field search (`elevator`) and drag both fields onto the graph. To find all of a type at once, type `number` and press Tab.
3. Put them on the same axis (click a field's chip to move it between the left and right axis). Turn on **Modes** to shade auto and teleop.
4. Add the motor current on the right axis to see whether the mechanism was straining.
5. Zoom the time to one movement (Shift-drag it on the timeline, then S), and the value axis with the wheel over the graph.
6. Compare tuning between matches with the graph's **Stacked** or **Difference** mode.
7. **Statistics** on the error (or on the measured value) gives the mean, the 5th and 95th percentiles and a histogram over auto, teleop or a selection.

### 2.7 See what the robot code was doing (the Commands panel)

1. **Add panel**, Commands.
2. Every command that ran is a row; each run is a bar on that row, one lane per log. Hover a bar for its start and length; **click it to go there**. Commands running at the cursor light up (tinted row, bold name, how long it has run), and one that just started flashes. **Click a name** to go to that command's next run (Shift+click: the one before).
3. **No commands shown?** The robot code must record them. Section 8, Commands has the two ways, with code. You never add fields to this panel by hand: it finds the command list itself. Its **Source field** button is only for a log that keeps the list under an unusual name.

### 2.8 Check the driver's inputs (the Controller panel)

1. **Add panel**, Controller (or Preset, **Match Replay**, which puts it next to the video, the field and the commands).
2. It shows the sticks, triggers, D-pad and buttons at the cursor. Pick the Driver Station **port** (the number used in the robot code) and the layout: Xbox, PlayStation, or a numbered list for flight sticks and button boards.
3. Play or scrub the timeline to watch the driver's inputs alongside what the robot did.

### 2.9 Find code problems

- Preset, **Code Health**: loop time with the 20 ms line, CAN utilization, and the console showing errors and warnings only.
- Loop overruns are events on the timeline (clock icon); each names its slowest part when the log says.
- **Console:** type a word to filter, `!word` to hide lines with it, click a line to go there.

## 3. The header

From left to right:

- **Sidebar button** (Ctrl+B): shows or hides the field list.
- **File menu:** open logs, export CSV, copy panel as image, match report (PDF), close all logs.
- **The menu bar** (File, Edit, View, Panels, Robot, Window, Help) is hidden on Windows and Linux: press **Alt** to show it. Everything in it is also in the app, except Reload, Developer Tools, the app's own zoom and full screen (View menu) and the list of open windows (Window menu). Alt-drag gestures do not open it.
- **Undo and redo** (Ctrl+Z, Ctrl+Shift+Z, or the Edit menu): take back what you changed: panels added, removed, moved or set up, timeline tracks, logs opened or closed (a closed log opens again from its file), offsets, colors, hidden logs, the alignment mode, bookmarks and robot profiles. Moving around in time (cursor, zoom, playback) is not undone. Each step is one change you made; a toast says what was undone. In a text box, Ctrl+Z undoes your typing instead.
- **Log chips**, one per open log, in its color:
  - **click the colored dot** to hide or show that log everywhere;
  - **click the name** to make it the *primary* log (the alignment reference, and the log whose modes shade the graphs). The primary log has a star;
  - **the close button** closes it;
  - **hover** for the file name, size and alignment offset.
- **Close all**, next to the log chips when two or more logs are open, closes every log at once (also in the File menu).
- **View switch: Panels, Video, Power** (Ctrl+1, Ctrl+2, Ctrl+3). See section 9.
- **Align:** how logs are lined up (section 4).
- **Preset menu** and **Add panel** (only in the Panels view, section 7).
- **Potato mode**, **Settings** (Ctrl+,), and the **help** button: this guide and the shortcuts and tips (?, or F1 for the guide).

On a narrow window the labels turn into icons and the less-used controls move into a three-dot menu at the end of the row. The same is true of every toolbar in the app.

## 4. Time, alignment and comparing logs

- **Every log keeps its own time.** Brownout lines logs up with one offset per log; changing the alignment never changes the data.
- **Align menu (header):**
  - **Auto start** (default): t = 0 when autonomous began in each log;
  - **Teleop start**;
  - **First enable** (AdvantageScope's rule);
  - **Log start**;
  - **Wall clock:** real time, for files from the same match (a robot log and a log from another device);
  - **Raw:** no alignment.
- **Nudge one log by hand:** hold Alt and drag that log's lane on the timeline sideways. The lane shows the nudge ("nudge +0.35 s") while you drag. Log info shows it as a number you can type.
- **Time readout formats** (transport bar): aligned time, match time ("TELEOP 1:12 left"), raw log time, wall clock.

## 5. The timeline (bottom of the window)

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
- **Shift-drag** selects a range. Statistics, CSV export, the power report's "Follow selection", "zoom to selection" and loop playback use it. Drag a selection's edge (its small grip) to adjust it. Esc clears the selection and the cursor;
- **Alt-drag a log's lane** nudges that log's alignment (section 4);
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
- **events:** brownouts (lightning), program restarts, loop overruns (clock), errors, warnings, alerts, connection losses, and position and vision findings (target, section 10);
- **battery strip:** voltage color-coded, red below the brownout threshold;
- **bookmarks:** **B** adds one at the cursor with an optional note ("got hit here"). Alt-click the "Bookmarks" label to remove them all;
- **your tracks:** add any field from the field list (its "Add as a timeline track" button). On/off fields draw as bars, text and state fields as labeled segments, numbers as a color strip, with the value at the cursor at the right. Good for "has a game piece", the superstructure state, the selected auto. Alt-click a track's label to remove it;
- **tags-seen tracks**, one per camera (the 2D field's Display menu).

**Size:** drag the timeline's top edge to any height; double-click the edge for automatic height; the height button (Ctrl+T) cycles compact, standard and expanded.

## 6. The field list (sidebar)

- **Search:** words narrow by name (every word must appear). Results that sit in the same folder are boxed together under that folder, shown once, and each row shows only the rest of its name: the part that tells them apart. A result alone in its folder shows the folder dimmed in front of its name.
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
- **Inspector** (bottom of the sidebar): the selected fields' values at the cursor, per log, with structs expanded. **Click a value to copy it** (in full, not rounded); click a field's name to copy the name.
- **Width:** drag the sidebar's right edge to make it wider (remembered); double-click the edge for the default width.

## 7. Panels and the grid (the Panels view)

- **Add panel** (header) adds any panel type. New panels open as tabs in the active group.
- **Arrange:** drag a panel's tab onto another panel's edge to split it, or onto its tabs to stack it. Drag the borders between panels to resize them.
- **Maximize one panel:** the button at its top right (it shows on hover), **double-click its tab**, or **Ctrl+Enter**. The same again restores it. The timeline stays visible, and maximizing never marks a preset as changed.
- **Copy a panel as a picture:** the picture button at its top right, or Ctrl+Shift+C for the active panel. **Shift-click** the button to save a PNG instead.
- **Compact view:** narrow panels keep their most-used toolbar buttons and move the rest into a three-dot menu. Settings, General can force compact view everywhere.

**Presets** are saved layouts (header, Preset menu):

- **built-in:**
  - **Quick Look:** battery and current graph, 2D field, console, log info;
  - **Power & Brownouts:** the power report, the battery graph with the threshold, PDH channels (or electrical power), voltage statistics;
  - **Autonomous Review:** the field with the path, target and trail, the path error graph, path analysis; zoomed to auto;
  - **Compare Matches:** the compare table, an overlaid battery graph, the field with every robot, voltage statistics;
  - **Code Health:** loop time with the 20 ms line, CAN utilization, the console filtered to errors and warnings;
  - **Match Replay:** video, field with cameras, controller, commands.

  They find their fields by what they are (battery voltage, robot pose, swerve states, ...), so they work on any team's logs and only add fields the log has. A panel whose field is missing says what to log;
- the active preset shows in the menu button, with "(modified)" once you change the layout. Zoom and pan never count as a change;
- **your own:** save (Ctrl+S updates the active one), rename, duplicate, delete, export (pick which) and import (on a name clash: overwrite, keep both or skip). The copy button next to a built-in applies it and saves a copy you can edit;
- your own presets remember exact field names. Built-in ones look the fields up again in each log.

## 8. The panels: what each is for, what it needs, how to use it

Each panel below lists **what it is for**, **what it needs in the log** (and how robot code logs it), and **how to use it**.

Two ways robot code gets data into a log, used in the "needs" lines:
- **AdvantageKit:** `Logger.recordOutput("Some/Name", value)` writes a value; many things (battery, controllers, match time) are recorded automatically. AdvantageKit does not record NetworkTables.
- **WPILib DataLogManager:** `DataLogManager.start()` records everything published to NetworkTables (anything put on SmartDashboard, `SmartDashboard.putData(...)`, PathPlanner and Limelight telemetry) under `NT:/...`, plus the console. `DriverStation.startDataLog(DataLogManager.getLog())` adds the Driver Station data and controllers.

Any panel that lacks what it needs says so and how to log it, and Log info & health lists every recommended signal with a check or a cross.

### Line graph
- **For:** any number over time, for one log or several: voltage, current, speeds, setpoint against measured.
- **Needs:** any number fields (or on/off and state fields, drawn as lanes under the plot).
- **Use:**
  - **Field** adds fields (or drag them in). Each field's chip switches it between the **left and right axis**, or removes it. **Clear** removes them all;
  - **comparing logs:** **Overlay** (default), **Stacked** (a lane per log), or **Difference** (A minus B, the first two logs). The log menu picks all logs or one;
  - **Modes** shades auto and teleop; **Threshold** adds horizontal lines (e.g. the brownout voltage);
  - **Linked** (on) follows the timeline. Turn it off and the graph keeps its own time range: the wheel zooms that graph's time only;
  - **value axis:** the wheel over the plot zooms the values around the pointer (unless graphs may move time, then Ctrl+wheel); the wheel or a drag **on an axis** zooms or pans just that axis; **double-click** returns to auto-fit; the Y menu takes typed limits;
  - the one-line legend strip above the plot opens the full legend with values at the cursor. Hover shows the time between the cursor and the pointer.

### Table
- **For:** exact values: what a field changed to and when, or every chosen field's value at the cursor.
- **Needs:** any fields.
- **Use:** add fields with **Field**. **Changes** lists every change within the visible range (it updates when you stop moving); **Values at cursor** shows each field's value right now. One column per log.

### Console & events
- **For:** what the robot printed, its alerts and warnings, and the events Brownout found, in time order.
- **Needs:** console output: `DataLogManager.start()` captures it; AdvantageKit logs `RealOutputs/Console`. WPILib alerts are read too.
- **Use:**
  - every open log's lines, interleaved by time and tagged by log;
  - the **Errors / Warnings / Info / Events** buttons filter by kind;
  - the search takes words, and `!word` hides lines with that word;
  - click a line to go to that moment.

### 2D field
- **For:** where the robot was: paths, autos, vision, several matches overlaid.
- **Needs:** the robot pose as a `Pose2d`: AdvantageKit `Logger.recordOutput("Odometry/Robot", pose)`, or a pose published to NetworkTables with DataLogManager. Other positions (`Pose2d`, `Pose2d[]`, `Translation2d[]`) can be added as ghosts.
- **Use:**
  - **the field picture:** the real 2024 to 2026 fields, or your own from a WPILib or PathWeaver field JSON (Display menu); the season is picked in the toolbar;
  - **robots:** one per log, sized from the robot profile, bumpers in the alliance color, with a trail (the trail menu sets how long). The robot's parts from the robot editor turn with their logged angles;
  - **Pose field** adds other positions (a vision estimate, a setpoint), drawn as labeled ghosts;
  - **zoom and pan:** the wheel zooms (also out past the field), a drag pans (also off the field), double-click or **Fit** shows the whole field again. The view never zooms or recenters by itself;
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

### Swerve drive
- **For:** whether each module did what it was told: speed and angle, measured against the setpoint.
- **Needs:** two `SwerveModuleState[]` fields, measured and setpoint: AdvantageKit `Logger.recordOutput("SwerveStates/Measured", states)` and `"SwerveStates/Setpoints"`. Names with Measured/States and Setpoint/Desired/Target are found by themselves; others are picked in Log info & health, Field names.
- **Use:**
  - one diagram per log: each module's arrow (speed and direction), the setpoint dashed (can be turned off), chassis velocity and rotation;
  - **module order** (the order of the four modules in your arrays) and **full-scale speed** are saved in the robot profile. If the arrows look swapped, change the order.

### Controller
- **For:** what the driver pressed and how far the sticks moved, at the cursor.
- **Needs:** AdvantageKit records controllers by itself. With DataLogManager call `DriverStation.startDataLog(DataLogManager.getLog())`.
- **Use:** pick the Driver Station **port** (the number in `new CommandXboxController(0)`), and the layout: Xbox, PlayStation, or a numbered list for flight sticks and button boards (saved in the robot profile). One pad per log.

### Commands
- **For:** what the robot code was doing: which commands ran, when, for how long and how often.
- **Needs:** a record of the running commands. **You do not add fields to this panel**; it finds the record itself. One of these two in the robot code:
  - **WPILib with DataLogManager:** publish the scheduler and record NetworkTables:
    ```java
    DataLogManager.start();
    SmartDashboard.putData(CommandScheduler.getInstance());
    ```
    That logs `NT:/SmartDashboard/Scheduler/Names`, the list of commands running at each moment.
  - **AdvantageKit** (which does not record NetworkTables): log one true/false per command, in a folder named `CommandsAll` (or `Commands`, `CommandsUnique`):
    ```java
    CommandScheduler.getInstance().onCommandInitialize(c -> Logger.recordOutput("CommandsAll/" + c.getName(), true));
    CommandScheduler.getInstance().onCommandFinish(c -> Logger.recordOutput("CommandsAll/" + c.getName(), false));
    CommandScheduler.getInstance().onCommandInterrupt(c -> Logger.recordOutput("CommandsAll/" + c.getName(), false));
    ```
  - **Name your commands** (`.withName("IntakeNote")`), or rows read `SequentialCommandGroup` and `FunctionalCommand`. The scheduler only lists top-level commands: a command inside a group shows as its group.
- **Use:**
  - one row per command, one lane per log; each bar is one run. Hover for details; **click a bar to go to its start**;
  - **what runs at the cursor stands out:** its row is tinted in the log's color with a bar at its left edge, its name is bold, its run is outlined, and it says how long the run has been going ("running 2.4 s"). Everything else is dimmed;
  - **a command that just started flashes** its row for about three quarters of a second (of log time), so during playback you see which one went off;
  - **click a command's name to go to its next run**, Shift+click for the one before. Hovering a row highlights it;
  - each command's total time and run count, when it is not running;
  - **Filter commands** in the toolbar keeps only the commands whose names contain what you type;
  - with several logs, a line on top tells the lanes apart and says how many commands each log runs at the cursor;
  - **Source field** in its toolbar is only for a log that keeps the list under another name: pick a text-list (`string[]`) field. The small remove button next to a picked field goes back to finding it automatically. When it found the list itself, the toolbar says where from ("from Scheduler/Names").

### Video
- **For:** the match video, following the timeline. Also the left side of the Video review view.
- **Needs:** a video file (MP4 with H.264, or WebM); nothing in the log.
- **Use:** Choose video, then sync it once. Section 11 has the whole of it.

### Statistics
- **For:** how one number was spread: typical, worst, how often.
- **Needs:** one number field (**Choose the field**).
- **Use:**
  - pick the time it covers: the visible range, the selection, enabled time, auto, teleop or the whole log;
  - a histogram, plus samples, min, max, mean (plain and time-weighted), median, 5th and 95th percentiles, standard deviation, first and last;
  - the min and max values jump to their moment.

### Power
- **For:** what used the battery and what caused each brownout. It fills the bottom of the Power view, and section 2.1 walks through it.
- **Needs:**
  - **battery voltage:** AdvantageKit logs `SystemStats/BatteryVoltage` by itself; otherwise log `RobotController.getBatteryVoltage()` each loop;
  - **total current:** AdvantageKit with power distribution logging (`PowerDistribution/TotalCurrent`); otherwise log `PowerDistribution.getTotalCurrent()`;
  - **PDH channel currents**, to tell mechanisms apart: AdvantageKit `PowerDistribution/ChannelCurrent`; otherwise log `PowerDistribution.getAllCurrents()` as a `double[]`;
  - **or motor currents:** each motor's supply current as a number, best in a folder per mechanism (`Subsystems/Elevator/SupplyCurrentAmps`), so **Suggest** groups them;
  - **the brownout flag**, for exact brownouts: AdvantageKit `SystemStats/BrownedOut`; otherwise log `RobotController.isBrownedOut()`.
- **Use:** see section 2.1. **Subsystems** opens the subsystem editor; **Follow selection** limits the numbers to the Shift-selected time; **Brownout at** sets the threshold (6.75 V for a roboRIO 2 by default); the battery label starts a battery's history, and entries can be removed from it.

### Path analysis
- **For:** how well each auto path was followed.
- **Needs:** the robot pose, PathPlanner's **active path** and **target pose**. With AdvantageKit:
  ```java
  PathPlannerLogging.setLogActivePathCallback(path -> Logger.recordOutput("Odometry/Trajectory", path.toArray(new Pose2d[0])));
  PathPlannerLogging.setLogTargetPoseCallback(pose -> Logger.recordOutput("Odometry/TrajectorySetpoint", pose));
  ```
  With DataLogManager, PathPlanner's own NetworkTables telemetry is recorded as it is.
- **Use:** one row per path per log: the auto routine, start time, duration, error at the start, largest, typical (RMS) and final error, and the heading errors. **Error graph** opens the position and heading error over time.

### Compare matches
- **For:** one table of numbers across every open log, to see which match was different.
- **Needs:** nothing extra; each column fills in if the log has the data.
- **Use:** see section 2.3. Click a value to go there; **Add field** adds min, mean and max of any number over enabled, auto, teleop or the whole log; a button makes a log the reference.

### Log info & health
- **For:** what is in a log and what it lacks.
- **Use:**
  - the file, duration, records, era, loggers, event and match, alliance, auto routine, wall clock, where robot state was read from, first enable and auto start;
  - the alignment offset and a typed **nudge**;
  - **logging health:** every signal Brownout recommends, with a check or a cross, why it matters and how to log it;
  - **Field names:** which field Brownout uses for each role (battery voltage, robot pose, swerve states, ...). Pick a different one if it guessed wrong; it is saved in the robot profile for every log from that robot.

## 9. The views (header switch, or Ctrl+1, 2, 3)

**Panels** (Ctrl+1): your grid of panels and presets. It stays as you left it while you are in the other views.

**Video review** (Ctrl+2): made for checking the log against what really happened.

```
+-------------------------------+-------------------------------+
|  match video                  |  2D field                     |
|  (Choose video, Sync, Log)    |  (Display menu, zoom)         |
|                               |                               |
+-------------------------------+-------------------------------+
|  Moments to check: 0:58.0 teleop  Camera 0 was 1.10 m from... |
|                    0:59.0 teleop  Robot position jumped 0.58 m |
+---------------------------------------------------------------+
|  timeline                                                     |
+---------------------------------------------------------------+
```

- The video and the field sit **side by side at the same height**: both are wide, so side by side is what fits a laptop. A narrow window stacks them.
- The field shows only the log whose video is shown; the video side's **Log** menu picks it.
- **Moments to check:** position jumps, camera disagreements, brownouts, connection losses and restarts, in match time. Click one to go there. If the log has no robot pose or no camera estimates, the list says so instead of looking clean.
- Walkthrough: section 2.2.

**Power** (Ctrl+3, P, or the Power button): the battery and current graph across the top, the power report below it. Walkthrough: section 2.1.

Preset and Add panel only show in the Panels view. The views' own panels are never saved into your layouts or presets.

**Several windows** (Ctrl+Shift+N, the Window menu (press Alt), or just start Brownout again): another window on the same logs and the same time, for a second monitor. Put Video review in one and your graphs in the other.

- **Shared by all windows:** the open logs, their order, colors, offsets and hidden/shown state, the alignment mode, match or whole log, bookmarks, and time: the cursor, the zoom, the selection and playback. Open, close or line up a log in any window and the others do the same; press Play or Pause in any window.
- **Each window's own:** its view (Panels, Video review, Power), its panels and layout, the sidebar and the timeline height. The window title names its view, and the **Window** menu (press Alt) lists the windows to switch between.
- Playback keeps time even when the window you pressed Play in is minimized.
- Only the first window saves the layout and the session. A later window starts from the saved layout, and what you change in it lasts until you close it. When the first window closes, the next one takes over saving.
- Settings, presets, robot profiles and video syncs changed in one window reach the others.
- Each window reads the logs itself, so every extra window uses that memory again.
- Starting Brownout again while it runs opens a window in the running app (with any logs you started it with), never a second copy: a second copy would start with nothing and save nothing.

## 10. Things Brownout works out for you

- **Robot state and match info** (enabled, auto, teleop, event, match number, alliance) from whichever logger wrote the file: AdvantageKit, DataLogManager, the 2027 Driver Station.
- **Fields by role:** battery voltage, total current, PDH channels, robot pose, swerve states, chassis speeds, the active path and target, loop time, CAN use and more. A wrong guess is corrected once in Log info & health, Field names (or Settings, Robot) and remembered for that robot.
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
- **A match video is offered** when a log opens without one (section 11).

## 11. Match video

**Choosing a video:**

- **the video panel's "Choose video":** MP4 (H.264) and WebM play; phone HEVC clips need converting. The file and its sync are remembered per log;
- **offered automatically:** when a log opens without a video, Brownout looks for one whose name says the match (`Q12`, `qm12`, `Qual 12`, `2026nyroc_qm12`, `Match 12`). It looks in the log's own folder and in the **videos folder** set in Settings, General, and offers the best match in a message:
  - **Use it** loads it and opens the sync view; **Not now** is remembered;
  - an empty video panel lists the same matches as buttons;
  - names like `Q120`, `Practice 12` or `IMG_0012` are never matched, so rename phone clips to something like `Q12.mp4`.

**Syncing: the sync view** (opens after choosing a video, or Sync menu, "Open the sync view"):

- **Video controls of its own:** Play at 0.25x, 0.5x or 1x (Space); Left/Right one frame; Shift+Left/Right one second; comma and period five seconds; a box to type a video time; sound on or off (the start horn and the teleop bell help).
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

## 12. The robot profile (Settings, Robot)

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
  - **the preview's view is yours:** the wheel zooms around the pointer, dragging empty space (or the middle button anywhere) moves the view, and it is not held to the robot. It fits the robot when the editor opens; **Fit** or a double-click on empty space fits it again. It never refits while you drag a part;
  - **Undo and Redo** buttons in its header, and Ctrl+Z / Ctrl+Shift+Z, take back part changes (also when the editor was opened from Settings);
- **export and import** a profile as one file, pictures included, to share a setup with the team.

## 13. Reports and exports

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

## 14. Settings

- **General:**
  - Potato mode, and whether to offer it;
  - always use compact view;
  - let graphs and the field move time;
  - reopen the last session;
  - the **videos folder**;
  - brownout threshold (6.3 V roboRIO 1, 6.75 V roboRIO 2, or higher), season field, AprilTag map (built-in welded or AndyMark, or your own JSON).
- **Appearance:** dark, light or high-contrast theme; the color of each log and of each robot mode.
- **Robot:** the robot profile (section 12).
- **Keybinds:** every shortcut can be rebound. Click a key and press the new one; a key already in use moves to the new command, and the old one is unbound. Reset one or all.
- **Demo logs.**

**Potato mode** (Ctrl+Shift+P) is for slow laptops: 30 draws a second at 1x resolution, coarser graphs, no hover readouts in other panels, short trails, tables that update when you stop moving. Without it, panels draw at most 60 times a second, also on 144 Hz and faster screens, which leaves the graphics card free for the match video.

## 15. Keyboard shortcuts (defaults; all rebindable)

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
| Ctrl+Z / Ctrl+Shift+Z | Undo / redo |
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
| Ctrl+Shift+N | New window on the same logs and time |
| Ctrl+, | Settings |
| ? | Guide, shortcuts and tips |
| F1 | Open the guide |

**Number boxes take math.** Anywhere you type a number (part sizes and positions, robot size, camera mounts, graph limits, thresholds, offsets, full-scale speed), you can type a calculation instead: `0.09448 * 360`, `(27 + 3) / 39.37`, `2^12`, `sqrt(2) / 2`, `pi / 4`. It works out when you press Enter or leave the box, and the box then shows the result. It knows `+ - * / % ^`, parentheses, `pi`, and `sqrt abs sin cos tan asin acos atan round floor ceil min max hypot atan2` (angles in radians). Text that is not a number is marked red and changes nothing; Esc puts the old value back. **The box remembers the math:** while its value is still what the math gave, the number is underlined with dots and its tooltip shows the math; click into the box and the math is back, ready to edit. It is remembered per box (this part's position, this robot's length) across restarts. Time boxes (the timeline's `t =` and zoom boxes, the sync view) keep their formats such as `1:30` and `500ms`, and take math in seconds too: `60 + 12.5`.

**In the video sync view only:** Space play/pause; Left/Right one frame; Shift+Left/Right one second; comma/period five seconds; `=` / `-` zoom the video timeline; Enter apply; Esc cancel.

**In the field search only:** Tab turns the faint type into a filter; Backspace on an empty search removes the last type; Esc clears.

## 16. Mouse gestures that are easy to miss

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
| 2D field | wheel / drag / double-click | zoom / pan / fit (zoom out and pan past the field freely) |
| Commands | click a run | go to where it started |
| Console, Compare, Statistics, Power, Moments | click a line or value | go to that moment |
| Robot editor | drag the round marker (Alt-drag when it sits at the part's center) | move the pivot |
| Robot editor | wheel / drag empty space / double-click empty space | zoom / move the view / fit the robot |
| Sync view | wheel on the video timeline | zoom down to single frames |
| Sync view | Alt while picking on the log strip | no snapping to markers |

## 17. Where things are stored

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
- With several windows open, only the first one saves the layout and the session (section 9).
- Logs and videos stay where they are; Brownout remembers their paths. If a video moves, the panel asks for it again and keeps the sync.
