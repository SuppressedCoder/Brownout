# Brownout — Vision & Pathing Spec (AprilTags, PathPlanner)

*Proposal, 2026-11-08.* **Team requirement:** Brownout must support vision, showing which AprilTags the robot can see, and pathing, with PathPlanner supported at minimum. This doc says what Brownout shows, where the data comes from, and how the PathPlanner pipeline works end to end.

Builds on: `brownout-viewer-ui-spec.md` (timeline, panels, presets), `frc-log-format-reference.md` (WPILOG, structs, key names) and `frc-logging-landscape-and-viewer-requirements.md` (decisions log).

Items marked **[verify]** need checking against real logs or sources.

---

## 0. Summary

| Feature | What the user sees | Tier |
|---|---|---|
| **Visible-tag lines** | On the 2D field, a line from the robot (or the camera, if its mount is known) to every AprilTag that camera sees at the cursor time. Seen tags are highlighted; lines are colored per camera and dashed when that frame's pose estimate was rejected. | v1 |
| **"Tags seen" timeline track** | One timeline row per camera showing which tag IDs were visible over the match (e.g. `7·8`, `12`), with gaps when nothing was seen and hatching when the camera was disconnected. | v1 |
| **Vision pose ghosts** | Accepted and rejected vision pose estimates drawn as ghost robots next to the fused/odometry pose. | v1 (if logged) |
| **Vision panel** | At the cursor: per-camera visible tags (ID, distance, ambiguity), latency, accepted/rejected. Over a range: % of time with tags, rejection rate, pose jumps. | v1.1 |
| **PathPlanner overlay** | On the 2D field: the active path, the target pose (ghost) and the actual robot with a trail. | v1 |
| **Path-following analysis** | Error graphs (position and heading), commanded vs actual speed, and per-path summary (max/RMS error, end-of-path error, start-pose error). | v1 |
| **Auto routine detection** | The auto's name on the timeline, read from the auto chooser; used to group runs of the same auto. | v1 |
| **Robot project import** | Point Brownout at the robot code folder. It reads `deploy/pathplanner/` (paths, autos, settings) to show planned paths, event markers, rotation targets, path names, and the robot's size and module layout. | v1.1 |
| **Compare autos across matches** | Overlay every run of the same auto, with red-alliance runs flipped to the blue side, plus a per-path error table across runs. | v1 overlay; v1.1 table |
| **Choreo** | Same overlay and analysis for Choreo trajectories. | Later |

---

## 1. Shared foundation: field frames, AprilTag layouts, alliance flipping

Vision and pathing both draw on the 2D field, so they depend on the same three things.

### 1.1 AprilTag layouts

- WPILib's `fields` library ships one JSON file per season. Each lists the AprilTags (`field-tags`: ID + pose as translation $x, y, z$ and a quaternion), plus field size and image.
  - 2026 REBUILT has 32 tags on a 16.541 m × 8.069 m field.
- **2025 and 2026 have two layouts each: welded and AndyMark fields.** They differ slightly. AdvantageScope notes about 0.5 in misalignments if the wrong one is used.
  - Brownout should let the team pick the layout per event, remember it, and show which one is active.
- The 2027 layout arrives at kickoff (January 2027), so layouts must be loadable as data files without an app update.
- With the layout, Brownout only needs **tag IDs** to draw lines, because it can look up each tag's position. This matters: many logs record IDs but not tag poses.

### 1.2 Coordinate frames

There are two field frames in play:

| Frame | Origin | +X direction | Used by |
|---|---|---|---|
| **Blue wall** | Blue alliance wall, right-side corner | Toward the red wall | WPILib through 2026; PathPlanner `.path` files and FlippingUtil (also on PathPlanner's 2027 branch as of Oct 2026); Limelight `botpose_wpiblue` |
| **Field center** | Center of the field, on the floor | Toward the blue wall | WPILib 2027. WPILib `main` also stores *all* built-in field files, including past seasons, in this frame. |

**Rule:** Brownout keeps one internal frame (field center, matching WPILib's current field files). It tags every source with the frame it was recorded in and converts on load.
- Logs from ≤2026 are blue-wall.
- 2027 WPILib logs are center.
- PathPlanner files and Limelight blue arrays stay blue-wall until their 2027 versions say otherwise [verify at kickoff].

Conversion (WPILib's migration rule), where $L$ and $W$ are the field length and width:

$$x_c = \tfrac{L}{2} - x_b,\qquad y_c = \tfrac{W}{2} - y_b,\qquad \theta_c = \theta_b + 180^\circ$$

and back again: $x_b = \tfrac{L}{2} - x_c$, $y_b = \tfrac{W}{2} - y_c$, $\theta_b = \theta_c - 180^\circ$.

**Detecting the era:** 2027 logs have the `DS:controlWord` struct, `WPILIB_` file names, Systemcore keys or `SystemStats/Versions/WPILib`. A manual override is always available.

### 1.3 Alliance flipping

Teams draw autos on the blue side, and PathPlanner flips them at runtime for red. The flip depends on the field's symmetry. PathPlanner's `FlippingUtil` (2026) defaults to **rotational** symmetry on a 16.54 m × 8.07 m field:

| Symmetry | Position | Heading |
|---|---|---|
| Rotational | $x' = L - x,\; y' = W - y$ | $\theta' = \theta - \pi$ |
| Mirrored | $x' = L - x,\; y' = y$ | $\theta' = \pi - \theta$ |

These are in the blue-wall frame. In the center frame the rotational flip is simply $x' = -x,\; y' = -y,\; \theta' = \theta + \pi$.

The symmetry type is part of each **season preset**. Brownout uses it in two places:
1. Flipping planned paths from project files for red-alliance matches.
2. **"Normalize alliance"**, which draws all runs on one side so autos from different matches overlay.

---

## 2. Vision: "which AprilTags can it see?"

### 2.1 Questions teams want answered

1. Which tags did each camera see, and when? Were there long stretches with nothing?
2. Did a camera disconnect or freeze?
3. Were the pose estimates accepted or rejected, and why (ambiguity, too far, off-field)?
4. Did vision make the robot's pose jump? Does vision agree with odometry?
5. Where on the field does vision work well or badly?
6. Is vision better or worse this match than last match?

### 2.2 Where the data comes from

| Source | What's in the log | How Brownout gets "visible tags" |
|---|---|---|
| **AdvantageKit vision template** (PhotonVision or Limelight IO) | Inputs per camera, at `/Vision/Camera<i>/`: `Connected`; `TagIds` (int[]); `PoseObservations` (records with timestamp, `Pose3d`, ambiguity, tagCount, averageTagDistance, and a type: MegaTag 1, MegaTag 2 or PhotonVision); `LatestTargetObservation` (tx, ty). Outputs, under `/RealOutputs/Vision/Camera<i>/` and `/RealOutputs/Vision/Summary/`: `TagPoses` (Pose3d[]), `RobotPoses`, `RobotPosesAccepted`, `RobotPosesRejected` | Directly: `TagIds` and `TagPoses` per camera; accepted/rejected poses for the ghosts |
| **PhotonVision**, captured by DataLogManager's NetworkTables mirror | `NT:/photonvision/<camera>/rawBytes` (a full `PhotonPipelineResult` in PhotonVision's own "photonstruct" packing), plus simple topics such as `hasTarget`, `latencyMillis`, `targetPose` | Decode `rawBytes` (schema is in the log, AdvantageScope has a decoder) to get each target's `fiducialId`, camera-to-target transform and ambiguity, plus the multi-tag result [verify field names from schema]. PhotonVision says its simple NT topics will likely be removed in 2027, so `rawBytes` is the reliable source. |
| **Limelight**, captured by DataLogManager | `NT:/limelight[-name]/botpose_wpiblue` and `botpose_orb_wpiblue` (MegaTag 2) arrays, `rawfiducials`, `tid`, `tv`, `tl`, `cl`, `hb` (heartbeat) | Parse the arrays (layout below) |
| **Team-custom** | Anything: an int[] of IDs, a `Pose3d[]` of tags, a `Pose2d` vision estimate | Role mapping (§2.7); asked once and saved in the robot profile |

**Limelight `botpose_*` array layout** (per Limelight docs and LimelightHelpers [verify]):
- Indices 0–5: robot pose $x, y, z$ (m) and roll, pitch, yaw (deg).
- Indices 6–10: total latency, tag count, tag span, average tag distance, average tag area.
- Then 7 values **per tag**: ID, txnc, tync, area, distance to camera, distance to robot, ambiguity.

### 2.3 On the 2D field: lines to the visible tags

- **Tag markers:** every tag in the active layout is drawn as a small labeled square on the field. Tags seen at the cursor time are **highlighted**.
- **Lines:**
  - One line per visible tag per camera, drawn at the cursor time from the line origin to the tag.
  - **Origin:** the camera's position if its robot-to-camera mount is known (robot profile, or Limelight's `camerapose_robotspace`); otherwise the robot center.
  - **Style:**
    - Color per camera (e.g. front = teal, back = purple).
    - Solid when that frame's pose estimate was accepted; **dashed** when rejected.
    - Opacity scaled by ambiguity or distance (optional).
- **Freshness:** cameras update at their own rate. A "seen" set stays shown for a short hold time (default 0.25 s, adjustable) after its last update, so lines don't flicker. If no update arrives within that time, the lines fade out.
- **Pose ghosts** (when logged):
  - Accepted vision estimates as hollow ghosts in the camera's color.
  - Rejected ones with a ✕.
  - The fused estimate as the solid robot.
  - Optionally, the odometry-only pose.
- **Trails** (optional) show where vision estimates landed over the last few seconds, which makes noise and bias obvious.
- **Comparison:** with several logs open, each log's lines use its own robot's color, or the panel repeats once per log (small multiples) to avoid spaghetti.

### 2.4 On the timeline: the "Tags seen" track

- One row per camera, plus an optional "any camera" summary row.
- **Segments** while tags are visible, labeled with the IDs (`7·8`). Color intensity grows with tag count.
- **Gaps** while nothing is seen. Gaps longer than a threshold (default 2 s while enabled) can be flagged as findings.
- **Hatching** while the camera is disconnected (`Connected = false`, or the Limelight heartbeat `hb` stops increasing).
- **Markers** for rejected estimates (small ✕) and pose jumps (⚡).
- Hovering shows the IDs, tag count, latency and ambiguity at that moment.
- Like any track, it can be hidden, reordered, or switched between "all cameras" and per-camera. Presets include it.

### 2.5 Vision panel (v1.1)

**At the cursor**
- A card per camera: connected, latency, number of tags.
- A table of visible tags: ID, distance, ambiguity, area.
- The latest pose estimate (type, tag count), and whether it was accepted or rejected, with the reason if logged.

**Over the selected range or phase**
- % of time each camera saw ≥1 tag (auto vs teleop).
- Most-seen tags.
- Rejection rate.
- Mean ambiguity and distance.
- Number of pose jumps.
- Longest blind stretch.

**Comparison:** one column per log, so vision health can be compared match to match.

**Residual graph:** the distance between each vision estimate and odometry, $r = \lVert \mathbf{p}_{\text{vision}} - \mathbf{p}_{\text{odom}} \rVert$. This shows when vision and odometry disagree.

### 2.6 Vision findings (analyzer)

| Finding | Default rule (editable) |
|---|---|
| Camera disconnected | `Connected` false, or heartbeat stalled, while enabled |
| Blind stretch | No tags for more than 2 s while enabled |
| High rejection rate | More than 50% of estimates rejected over a phase |
| Pose jump | Fused pose moves more than 0.5 m within one loop without matching wheel motion |
| High latency | Pipeline latency above 100 ms |

The AdvantageKit template's own rejection rules make good defaults to display: single-tag ambiguity above 0.3, a vertical position error above 0.75 m, or a pose outside the field.

### 2.7 Logging health: vision

If no vision data is found, the logging-health panel lists what to log, best first:
1. Per-camera visible tag IDs (int[]).
2. Accepted and rejected pose estimates (`Pose3d` or `Pose2d`).
3. Camera connected state.
4. Latency.

It links to the AdvantageKit vision template, or to a two-line DataLogManager setup that captures PhotonVision/Limelight NetworkTables data.

---

## 3. Pathing: PathPlanner

### 3.1 How PathPlanner works, end to end

1. **Draw.** In the PathPlanner app, the team draws paths and builds autos on the **blue side**. They're saved as JSON in the robot project under `src/main/deploy/pathplanner/` (`paths/*.path`, `autos/*.auto`, `settings.json`, `navgrid.json`) and deployed with the code.
2. **Choose.** Before the match, the drive team picks an auto from a chooser, usually PathPlanner's `AutoBuilder.buildAutoChooser()`. The option names are the auto file names.
3. **Run.** In autonomous, the chosen auto runs its command sequence. Each path runs as a `FollowPathCommand`:
   - **At start:** if the robot is on the red alliance, the path is **flipped** using the season's symmetry. The path to be followed is then published as the "active path".
   - **Every loop:** it publishes the **current pose**, the **target pose** (where the path says the robot should be now) and the commanded vs actual velocities.
   - **At end:** it publishes an **empty** active path.
   - Event markers along the path trigger named commands (e.g. "intake down") as the robot passes them.
4. **Publish.** PathPlannerLib publishes this data in two ways at once:
   - **(a) NetworkTables telemetry** for the PathPlanner app: `/PathPlanner/activePath` (`Pose2d[]`), `/PathPlanner/targetPose` and `/PathPlanner/currentPose` (`Pose2d`), and `/PathPlanner/vel` (four numbers: actual speed, commanded speed, actual angular speed, commanded angular speed). **Turned off entirely if the code calls `PPLibTelemetry.enableCompetitionMode()`.**
   - **(b) Logging callbacks** in `PathPlannerLogging`: set callbacks for current pose, target pose and active path, and PathPlannerLib hands each value to the team's logger. This is what AdvantageKit's templates use.
5. **Record.** The data reaches the WPILOG file:
   - Through **(a)** if DataLogManager is mirroring NetworkTables (keys appear as `NT:/PathPlanner/...`).
   - Through **(b)** under whatever keys the team chose. AdvantageKit's swerve template uses `/RealOutputs/Odometry/Trajectory`, `/RealOutputs/Odometry/TrajectorySetpoint` and `/RealOutputs/Odometry/Robot`.
   - AdvantageKit does not record NetworkTables, so AdvantageKit teams need **(b)**.
6. **Review.** Brownout finds these fields automatically (§3.2). Optionally it reads the project's `deploy/pathplanner/` folder, then builds the auto review (§3.3).

Pathfinding and on-the-fly paths (e.g. `AutoBuilder.pathfindToPose` used for teleop auto-align) go through the same commands. Their active paths are logged too, so Brownout handles them the same way, even though there's no `.path` file.

### 3.2 What Brownout looks for

| Role | Keys checked, in order |
|---|---|
| Active path (`Pose2d[]`; empty = no path) | `/RealOutputs/Odometry/Trajectory` (AdvantageKit template) → `NT:/PathPlanner/activePath` → Field2d object `path` (PathPlanner docs' Field2d example) → any `Pose2d[]` named like `*Trajectory*`, `*ActivePath*`, `*Path*` |
| Target pose (`Pose2d`) | `/RealOutputs/Odometry/TrajectorySetpoint` → `NT:/PathPlanner/targetPose` → Field2d object `target pose` → names like `*TrajectorySetpoint*`, `*TargetPose*` |
| Actual pose (`Pose2d`) | The robot-pose role from the UI spec (AdvantageKit `/RealOutputs/Odometry/Robot`, etc.) → `NT:/PathPlanner/currentPose` |
| Velocities | `NT:/PathPlanner/vel`. Otherwise derived from the target pose over time and the logged chassis speeds. |
| Auto routine name | String chooser tables (`.type = "String Chooser"`, `active` / `selected`), e.g. `NT:/SmartDashboard/Auto Chooser/active`, or AdvantageKit dashboard-chooser inputs under `/NetworkInputs/...` [verify exact keys] |

If several candidates match, the user picks once and the choice is saved to the robot profile.

### 3.3 What Brownout shows

**On the 2D field** (Autonomous Review workspace):
- The **active path** as a line.
- The **target pose** as a ghost.
- The **actual robot** with a trail.
- An optional "error whisker": a short line from the actual to the target pose, so lag and drift are visible at a glance.
- With the project imported (§3.4), also:
  - The **planned path** from the `.path` file (dashed, flipped for red).
  - **Event markers** as pins.
  - **Rotation targets** as small arrows.
  - **Constraint zones** shaded.
  - The **starting pose** as an outline.

**On the timeline**
- **Auto routine:** the auto's name across the autonomous period.
- **Path active:** one segment per path, labeled with the path name when it can be matched to a project file (by comparing the logged path's start and end with each `.path`'s waypoints, flipped or not). Unmatched paths show "Path 1", "Path 2", or "Pathfinding".
- **Event markers** (v1.1): estimated times when the robot passed each marker (closest approach along the path). Exact times are available if the team logs named-command start/end.

**Graphs**
- Position error: $e_{xy}(t) = \lVert \mathbf{p}_{\text{target}}(t) - \mathbf{p}_{\text{actual}}(t) \rVert$.
- Heading error: $e_\theta(t) = \operatorname{wrap}_{\pm\pi}\!\left(\theta_{\text{target}}(t) - \theta_{\text{actual}}(t)\right)$.
- Commanded vs actual speed, and commanded vs actual angular speed.

**Per-path summary** (a row per path):

| Metric | Meaning |
|---|---|
| Duration | Time the path was active |
| Max / RMS position error | $\max e_{xy}$ and $\sqrt{\tfrac{1}{N}\sum e_{xy}^2}$ while active |
| Max heading error | $\max \lvert e_\theta \rvert$ |
| End-of-path error | Distance and heading error between the final actual pose and the path's end pose. This is what decides whether the robot can score. |
| Start-pose error (first path only) | How far the robot was from the auto's start pose when auto began. Catches robots placed wrong on the field. |

### 3.4 Robot project import (v1.1)

Point Brownout at the robot code folder, or just its `deploy/pathplanner/` folder. Brownout reads:

| File | Useful contents (PathPlanner format version `2025.0`) |
|---|---|
| `paths/*.path` | `waypoints` (anchor points + Bézier control points), `rotationTargets`, `constraintZones`, `pointTowardsZones`, `eventMarkers` (name, position along the path, command), `globalConstraints` (max velocity/acceleration), `goalEndState` (end velocity and rotation), `idealStartingState`, `reversed` |
| `autos/*.auto` | The command tree (sequential/parallel groups of `path`, `named` and `wait` commands); `resetOdom`; whether it's a Choreo auto |
| `settings.json` | Robot width/length (bumpers), mass, MOI, wheel radius, gearing, max drive speed, and **module positions** (`flModuleX`, `flModuleY`, …). These pre-fill the robot profile (field robot size, swerve frame size). |

**Rules**
- Files are in the blue-wall frame and drawn for the blue side. Brownout converts them to its internal frame (§1.2), and flips them for red-alliance matches using the season symmetry (§1.3).
- The **logged** active path is already flipped by PathPlanner. Don't flip it again.
- Event-marker positions are fractions along the waypoint segments (e.g. 0.8 = 80% of the way from waypoint 0 to 1). Brownout evaluates the Bézier curve there to place the pin.
- Matching the logged auto name to a `.auto` file shows the whole plan (paths in order, named commands) beside the match.
- Planned paths can be viewed **without any log**, e.g. to check every auto against the field before an event.

### 3.5 Comparing autos across matches

- **Group by auto routine:** "show all runs of *4 Piece Center*" opens one overlay with a ghost robot per run.
- **Normalize alliance:** red runs are flipped onto the blue side (§1.3), so every run lies on top of the others.
- **Per-path table across runs:** max/RMS/end error for each path, in each match, plus the spread. Answers "which path is inconsistent?"
- **Start-pose consistency:** a scatter of where the robot actually started in each match.
- **Code-version split:** group runs by git SHA, to see whether a code change helped.

### 3.6 Recommended logging setup (shown in logging health)

DataLogManager teams get PathPlanner data automatically, as long as they **don't** call `PPLibTelemetry.enableCompetitionMode()`. For robustness, or with AdvantageKit, log the callbacks:

```java
// AdvantageKit (as in the AdvantageKit swerve template)
PathPlannerLogging.setLogActivePathCallback(path ->
    Logger.recordOutput("Odometry/Trajectory", path.toArray(new Pose2d[0])));
PathPlannerLogging.setLogTargetPoseCallback(pose ->
    Logger.recordOutput("Odometry/TrajectorySetpoint", pose));

// WPILib 2027 Telemetry API
PathPlannerLogging.setLogActivePathCallback(path ->
    Telemetry.log("PathPlanner/ActivePath", path, Pose2d.struct));
PathPlannerLogging.setLogTargetPoseCallback(pose ->
    Telemetry.log("PathPlanner/TargetPose", pose));
```

Also log the selected auto name, the robot pose and (if possible) named-command start/end. Brownout's defaults recognize the AdvantageKit template names and `/PathPlanner/*`; other names are matched once by role.

### 3.7 Other path tools

- **Choreo (later):**
  - Choreo trajectories are time-parameterized samples (position, heading, velocities) in `.traj` files.
  - ChoreoLib can report the active trajectory through a logging callback [verify API].
  - PathPlanner can also run Choreo trajectories (`choreoAuto` in `.auto` files). Those still log through PathPlanner's callbacks, so they work in v1.
- **WPILib trajectories / custom followers:** supported through role mapping, as long as an active-path `Pose2d[]` and a target pose are logged.

---

## 4. Proposed priorities

| Tier | Vision | Pathing |
|---|---|---|
| **v1** | Visible-tag lines on the 2D field (from logged tag IDs or tag poses + the season layout); tag highlighting; "Tags seen" timeline track; accepted/rejected pose ghosts when logged; welded/AndyMark layout choice; logging-health checks | Active path + target pose + actual pose on the field; position/heading error graphs; per-path summary; auto routine track; overlay of runs with "normalize alliance"; logging-health checks |
| **v1.1** | Vision panel (at-cursor tables, range stats, residual graph); vision findings; PhotonVision `rawBytes` decoding; Limelight array parsing; camera mounts in the robot profile | Robot project import (planned paths, markers, rotation targets, constraint zones, start pose, path names, robot settings); per-path table across runs; estimated event-marker times; start-pose scatter |
| **Later** | Field heatmap of where tags were seen; camera field-of-view cones; 3D vision debugging | Choreo trajectories; planned-vs-actual timing (needs PathPlanner's trajectory generation) |

The Autonomous Review preset (UI spec §5.1) uses this pathing view. Quick Look turns on the "Tags seen" track whenever vision data is found.

---

## 5. Open questions

1. Which vision systems and path tools does our team (and our target users) use? This decides which decoders come first: AdvantageKit template, PhotonVision `rawBytes`, or Limelight arrays.
2. 2027 frames: will PathPlanner files and Limelight arrays switch to WPILib's center frame for 2027? Check at kickoff.
3. Layout choice: should Brownout guess welded vs AndyMark from the event, or always ask?
4. Camera mounts: enter them by hand in the robot profile, or read them from logged transforms when present?
5. Is a 0.25 s "seen" hold time right for 20–50 fps cameras? Tune with real logs.
6. Sample logs needed: AdvantageKit vision template (PhotonVision and Limelight), DataLogManager + PhotonVision `rawBytes`, DataLogManager + Limelight, and PathPlanner autos on both alliances.

---

## Sources

- PathPlanner source (`main`, 2026; `2027` branch, Oct 2026): `PPLibTelemetry` (NT topics, competition mode), `PathPlannerLogging` (callbacks), `FollowPathCommand` (when data is published, flipping), `FlippingUtil` (symmetry rules, field size), example `deploy/pathplanner` files. https://github.com/mjansen4857/pathplanner
- PathPlanner docs: Telemetry page, Custom Logging. https://pathplanner.dev
- AdvantageKit source (`main`, Oct 2026): vision template (`VisionIO`, `Vision`, `VisionIOLimelight`, `VisionConstants`) and swerve template (`Drive`) log keys. https://github.com/Mechanical-Advantage/AdvantageKit
- WPILib `fields` library (`main`): README (center frame, migration rule), 2026 REBUILT welded/AndyMark layouts. https://github.com/wpilibsuite/allwpilib/tree/main/fields
- AdvantageScope docs: 3D field (welded vs AndyMark note), 2D field object types; source `PhotonStructDecoder.ts`. https://docs.advantagescope.org
- PhotonVision NT API docs (2026): https://docs.photonvision.org/en/v2026.3.4/docs/additional-resources/nt-api.html
- Limelight NT API (botpose arrays, `tid`, MegaTag 2): https://docs.limelightvision.io
