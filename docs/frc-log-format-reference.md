# Brownout — FRC Log Format Technical Reference

*Compiled 2026-11-07 for the Brownout project (FRC log viewer / log comparison app). Primary sources: allwpilib `main` (commit of 2026-11-07), AdvantageScope `main` (commit of 2026-10-26), and vendor docs. Companion doc: `frc-logging-landscape-and-viewer-requirements.md` (ecosystem, use cases, requirements).*

**Conventions.** **[verified]** = confirmed in spec or source code. **[verify]** = from memory, a secondary source, or inference; confirm with a real file before relying on it. Byte offsets are zero-based.

**Scope (decided 2026-11-08): Brownout reads WPILOG only.** §1 (WPILOG, structs, protobuf, key names, robot-state mapping) and §7 (time bases) are the implementation spec. §2 (NI DS logs), §4 (hoot), §5 (revlog), §6 (NT4) and §8 are background only. They explain where data in converted files comes from and which signals teams *won't* have unless their robot code logs them. Converted hoot/revlog files and 2027 FIRST DS logs are WPILOG, so they open normally.

---

## 0. Format quick map

| Format | Producer(s) | Endianness | Openly specified? | How a viewer should read it |
|---|---|---|---|---|
| `.wpilog` (WPILOG v1.0) | WPILib DataLog/DataLogManager, Epilogue, AdvantageKit (2023+), DogLog, FIRST Driver Station (2027+), converted hoot/revlog | little | Yes (WPILib spec + Kaitai `.ksy`) | **Supported — the only input format** |
| `.dslog` + `.dsevents` | NI FRC Driver Station (2010–2026) | big | No (reverse-engineered) | Not supported |
| `.hoot` | CTRE Phoenix 6 SignalLogger | — | No (proprietary, EULA) | Not supported; users convert with CTRE `owlet` → WPILOG first |
| `.revlog` | REV StatusLogger (REVLib 2026+) | — | Converter is published on npm | Not supported; users convert with `@rev-robotics/revlog-converter` → WPILOG first |
| NT4 (live) | Robot NT server, coprocessors | n/a (JSON + MessagePack) | Yes (WPILib spec) | Not planned |
| `.rlog` | AdvantageKit 2022 (legacy) | — | Via AdvantageScope source | Not supported |
| CSV / MCAP | Exports (AdvantageScope, DataLogTool, owlet) | text / MCAP | Yes | Possible export targets only |

---

## 1. WPILOG (`.wpilog`) — WPILib Data Log v1.0 [verified]

Spec: `allwpilib/datalog/doc/datalog.adoc` (Revision 1.0, 0x0100, 2022-01-02). Kaitai Struct definition: `allwpilib/datalog/doc/wpilog.ksy` (can generate parsers for many languages). All multi-byte values are **little endian**. No padding anywhere.

### 1.1 File header

| Offset | Size | Field |
|---|---|---|
| 0 | 6 | ASCII magic `WPILOG` |
| 6 | 2 | Version, uint16. High byte = major, low byte = minor. v1.0 = `0x0100` |
| 8 | 4 | Length $N$ of the extra header string, uint32 |
| 12 | $N$ | Extra header string, UTF-8, contents defined by the writer |

A v1.0 file with an empty extra header begins `57 50 49 4c 4f 47 00 01 00 00 00 00`. Detect format by this magic, not by file extension.

### 1.2 Record layout

Each record is:

1. **1-byte length bitfield** (from the least significant bit):
   - bits 0–1: entry-ID length − 1 (1–4 bytes)
   - bits 2–3: payload-size length − 1 (1–4 bytes)
   - bits 4–6: timestamp length − 1 (1–8 bytes)
   - bit 7: spare (0)
2. Entry ID (unsigned, 1–4 bytes)
3. Payload size in bytes (unsigned, 1–4 bytes)
4. Timestamp in **integer microseconds** (1–8 bytes)
5. Payload

Header size is $1 + n_{\text{id}} + n_{\text{size}} + n_{\text{ts}}$, i.e. 4 to 17 bytes.

Example from the spec, int64 entry ID 1, value 3, at $t = 1\,\text{s}$ (14 bytes): `20 01 08 40 42 0f 03 00 00 00 00 00 00 00`.

### 1.3 Control records (entry ID 0)

The payload's first byte is the control type. (The spec's prose says "first 4 bytes", but its field tables, examples and every implementation use **1 byte**.)

| Type | Payload after the type byte |
|---|---|
| 0 = Start | uint32 entry ID being started; uint32 name length + UTF-8 name; uint32 type length + UTF-8 type string; uint32 metadata length + UTF-8 metadata |
| 1 = Finish | uint32 entry ID (the ID may then be reused by a later Start) |
| 2 = Set Metadata | uint32 entry ID; uint32 length + metadata (replaces the previous metadata) |

### 1.4 Parser gotchas

- **No timestamp ordering guarantee**, including for control records. A Start with a later timestamp may be followed by data with earlier timestamps. Sort each field's samples after reading.
- A Start must come before (in file order) the data records that use its ID. Several Starts for one ID without a Finish between them is unspecified behavior.
- **Duplicate names are legal.** In practice the same name re-appears after a Finish, e.g. when an NT topic is unpublished and later republished (ntcore emits Finish on unpublish and a fresh Start on republish) [verified]. Merge by name when the type matches. Decide a policy for type changes, such as splitting into `name (type)` variants.
- **Truncated tails are common** (robot power loss, brownout reboot). Stop cleanly when the remaining bytes are fewer than a header or payload. AdvantageScope's indexer does exactly this.
- **Values are change-driven, not periodic.** Treat each series as sample-and-hold. Some writers log every call (DataLogManager), some dedupe unchanged values (the 2027 Telemetry backends may suppress duplicates unless `keepDuplicates()`), so sample density varies wildly.
- **Negative timestamps exist in real logs** [verified, CURIE Q89, 2026]. NetworkTables values published by a device that connected before its clock was synchronized (a Limelight) are logged with a slightly negative time. Read as an unsigned 64-bit number that is about $2^{64}$ µs, which stretches the log to 584,000 years. Read the 8-byte timestamp as signed, and place any negative or absurd time (over $2^{53}$ µs) at the time of the record written just before it. Brownout counts these as "repaired timestamps" in Log info.
- **Timestamps:** microseconds; zero point unspecified. roboRIO uses FPGA time (≈ program start). With WPILib 2027 on Systemcore and in simulation, timestamps are time since device boot and can start at large arbitrary values. WPILib 2027's DataLog *API* takes **nanoseconds** and divides by 1000 when writing (`ToFileTimestamp` in `DataLog.cpp`), so **files stay in µs** [verified].

### 1.5 Standard data types

| Type string | Payload |
|---|---|
| `raw` | bytes |
| `boolean` | 1 byte (0/1) |
| `int64` | 8-byte signed |
| `float` | 4-byte IEEE-754 |
| `double` | 8-byte IEEE-754 |
| `string` | UTF-8 |
| `boolean[]` | 1 byte per element; count = payload length |
| `int64[]` / `float[]` / `double[]` | packed elements; count = payload length ÷ element size |
| `string[]` | uint32 count, then for each string: uint32 length + UTF-8 bytes |

Other type strings seen in FRC logs:
- `json`, `msgpack`
- `structschema`
- `struct:<Name>` and `struct:<Name>[]`
- `proto:<full.message.Name>` and `proto:FileDescriptorProto`

Mirrored NT topics map NT `int` → `int64` and `int[]` → `int64[]` [verified in `LocalDataLogger.cpp`]. Unknown type strings should fall back to a raw/hex view.

### 1.6 Metadata conventions

Metadata is a string, usually JSON (arbitrary text is allowed). Set Metadata can change it mid-log. Observed conventions:
- **NT-mirrored entries:** `{"properties":<NT topic properties JSON>,"source":"NT"}`. The metadata is updated whenever topic properties change [verified, `LocalDataLoggerEntry::MakeMetadata`]. NT properties such as `persistent`, `retained`, `cached`, or a custom `unit` therefore appear under `properties`.
- **`systemTime`:** `{"source":"DataLogManager","format":"time_t_us"}`, an int64 holding µs since the Unix epoch, UTC [verified, 2027 source].
- **Units:**
  - AdvantageScope looks for JSON keys `unit` or `units`.
  - WPILib 2027 `Telemetry.setProperty(name, "unit", "\"meters\"")` attaches them, and logging a `Measure` adds the unit automatically.
  - AdvantageKit, DogLog and CTRE `writeDouble(…, units)` also attach units.
  - **Recommendation:** check both top-level `unit`/`units` and `properties.unit`/`properties.units`.

### 1.7 Struct schemas and values [verified]

Spec: `allwpilib/wpiutil/doc/struct.adoc` (Packed Struct Serialization v1.0).

**Where schemas live.** The schema entry is named `/.schema/struct:<Name>`, with type `structschema` and the schema text as payload. Values use type `struct:<Name>`. Arrays use `struct:<Name>[]`: elements are concatenated, and count = payload length ÷ struct size. Nested types publish their own schemas. Decode lazily after indexing the whole file, because a referenced schema may appear later in file order than the first value.

**Schema grammar (summary)**
- C-like declarations separated by `;` (trailing `;` optional; empty declarations ignored).
- Standard declaration: `[enum {a=1, b=2}] <type> <name>[ [N] ]`.
- Bit-field declaration: `[enum {...}] <integer-or-bool type> <name> : <bits>`.
- Built-in types: `bool`, `char`, `int8/16/32/64`, `uint8/16/32/64`, `float`/`float32`, `double`/`float64`. Any other type name refers to another struct.

**Layout rules**
- Members are stored in order, little endian, with no alignment or padding. Arrays are contiguous; nested structs are inlined.
- Adjacent bit-fields of the **same integer width** pack from the LSB into one storage unit. A new unit starts if the width changes or the field doesn't fit.
- `bool` bit-fields default to `uint8` storage, but pack into a preceding integer bit-field if they fit.
- Bit-fields don't "look inside" nested structs.
- `char[N]` holds a fixed-length, zero-padded UTF-8 string.

**Common WPILib schemas**

| Struct | Schema |
|---|---|
| `Translation2d` | `double x;double y` |
| `Rotation2d` | `double value` (radians) |
| `Pose2d` | `Translation2d translation;Rotation2d rotation` |
| `Translation3d` | `double x;double y;double z` |
| `Quaternion` | `double w;double x;double y;double z` |
| `Rotation3d` | `Quaternion q` |
| `Pose3d` | `Translation3d translation;Rotation3d rotation` |
| `ChassisVelocities` (**2027 name**) | `double vx;double vy;double omega` |
| `SwerveModuleVelocity` (**2027 name**) | `double velocity;Rotation2d angle` |
| `ChassisSpeeds` (2024–2026 name) [verify] | `double vx;double vy;double omega` |
| `SwerveModuleState` (2024–2026 name) [verify] | `double speed;Rotation2d angle` |

The 2027 schemas were verified in WPILib `main`. Visualizations keyed on struct names (swerve vectors, field poses) must accept both the 2026 and 2027 names.

**2027 `ControlWord` struct** (8 bytes; logged by the robot as `DS:controlWord`) [verified, `hal/.../ControlWordStruct.java`]:

```
uint64 opModeHash:56;
enum{unknown=0,autonomous=1,teleoperated=2,utility=3} uint64 robotMode:2;
bool enabled:1; bool eStop:1; bool fmsAttached:1; bool dsAttached:1;
```

Bit positions within the uint64 under the packing rules:

| Bits | Field |
|---|---|
| 0–55 | `opModeHash` |
| 56–57 | `robotMode` |
| 58 | `enabled` |
| 59 | `eStop` |
| 60 | `fmsAttached` |
| 61 | `dsAttached` |

### 1.8 Protobuf values [verified]

- Value type is `proto:<message full name>`.
- Schemas are stored as entries `/.schema/proto:<file descriptor name>`, with type `proto:FileDescriptorProto` and a serialized `FileDescriptorProto` as payload. Dependencies are published before dependents.
- Decoding needs a dynamic protobuf decoder. AdvantageScope has `ProtoDecoder.ts`; WPILib 2027 uses upb for dynamic decode.
- Vendors add their own types: PhotonVision has its own struct types, and AdvantageScope ships `PhotonStructDecoder.ts`. Unknown schema → show raw bytes.

### 1.9 Entry-name conventions (who writes what)

| Source | Keys / prefixes |
|---|---|
| **DataLogManager** (WPILib) | `NT:<topic>` mirrors every NT topic change by default, e.g. `NT:/SmartDashboard/...`, `NT:/FMSInfo/...` [verified prefix]. `messages`: `DataLogManager.log()` text. `console`: robot program stdout/stderr, captured from the user-program log file (2027 path `/home/systemcore/WPILIB_UserProgram.log`) [verified]. `systemTime`: wall-clock µs UTC, written about every 5 s. `DS:*` appears only if `DriverStation.startDataLog(log)` was called. |
| **DriverStation → DataLog, ≤2026** | `DS:enabled`, `DS:autonomous`, `DS:test` [verified via AdvantageScope key table]. Likely also `DS:estop`, `DS:fms`, `DS:ds` [verify]. Joysticks: `DS:joystick<N>/buttons` (boolean[]), `/axes` (float[]), `/povs` (int64[]). |
| **DriverStation → DataLog, 2027** | `DS:controlWord` (struct `ControlWord`), `DS:opMode` (string), joystick keys as above [verified, `DriverStationBackend.java`]. |
| **NT-side DS/FMS info, ≤2026** | `/FMSInfo/FMSControlData`: bit 0 enabled, bit 1 auto, bit 2 test [verified]; bit 3 e-stop, bit 4 FMS attached, bit 5 DS attached [verify]. Also `/FMSInfo/IsRedAlliance`, `/FMSInfo/StationNumber`, `/FMSInfo/EventName`, `/FMSInfo/MatchType`, `/FMSInfo/MatchNumber`. |
| **NT-side DS/FMS info, 2027** | `/DriverStation/ControlWord/{enabled,robotMode}`, `/DriverStation/IsRedAlliance`, `/DriverStation/StationNumber`, `/DriverStation/EventName`, `/DriverStation/MatchType`, `/DriverStation/MatchNumber`. Systemcore also has `/Netcomm/Control/MatchInfo/{EventName,MatchType,MatchNumber}`. |
| **FIRST Driver Station log** (2027) | `DS:/Dscomm/Console`, `DS:/Dscomm/Control/Robot/ControlData/ControlWord`, `DS:/Dscomm/Control/Robot/MatchInfo/{EventName,MatchType,MatchNumber}`. Console fields `ConsoleLine`, `ErrorInfo`, `ProgramCrashInfo`; their full paths are not documented yet. |
| **AdvantageKit** | Inputs at table root (from IO layers). `/RealOutputs/...` and `/ReplayOutputs/...`. `/RealMetadata` and `/ReplayMetadata` (e.g. git SHA). `/DriverStation/...` (`Enabled`; `Autonomous`/`Test` ≤2026, `RobotMode` 2027; `AllianceStation`; `EventName`; `MatchType`; `MatchNumber`; joysticks). `/SystemStats/...` (incl. `EpochTimeMicros`). `/PowerDistribution/...`. `/LoggedRobot/FullCycleMS`, `UserCodeMs`, `LogPeriodicMS`, `GCTimeMS`, `GCCount`. `/Logger/...` (e.g. `QueuedCycle`). `/NetworkInputs/...`, `/Timestamp`. Console at `/RealOutputs/Console`. When streamed over NT, the same keys sit under `NT:/AdvantageKit/...`. |
| **Epilogue** | `/Robot/<field path>`. The root name `Robot` is configurable. |
| **WPILib Telemetry API** (2027) | Default backend is NT with path prefix `/Telemetry`, so a DataLogManager mirror would show `NT:/Telemetry/...` [verify]. Typed tables carry a `.type` string entry. Units are entry properties (`unit`). The design doc warns that "tools need to tolerate fields appearing over time." |
| **Phoenix hoot → WPILOG** (owlet) | Device signals. Robot state appears as `RobotEnable`, `RobotMode`, `AllianceStation`, `DS:allianceStation` and `DS:matchInfo/{eventName,matchType,matchNumber}`; post-2027 also `DS:controlWord/...` (all per AdvantageScope's key tables). Exact device signal paths [verify with a converted file]. |
| **URCL** (REV, unofficial) | Raw periodic CAN frames published to NT and captured by DataLogManager. Decoded by AdvantageScope's `URCLSchema.ts`. |
| **Internal / hidden** | `/.schema/...`. NT meta topics `$clients`, `$serverpub`, `$sub$<topic>`, etc. Hide all of these by default. |

### 1.10 Canonical robot-state mapping (priority order)

Adapted from AdvantageScope `src/shared/log/RobotState.ts` [verified]. Pick the first key present in each row.

| State | Keys, in priority order |
|---|---|
| **Enabled** | `/DriverStation/Enabled` (AK) → `NT:/AdvantageKit/DriverStation/Enabled` → `DS:controlWord/enabled` (DataLog/Phoenix, 2027+) → `DS:enabled` (DataLog ≤2026) → `DS:/Dscomm/Control/Robot/ControlData/ControlWord` (FIRST DS) → `/DSLog/Status/DSDisabled` (NI DS, **inverted**) → `RobotEnable` (Phoenix) → `NT:/DriverStation/ControlWord/enabled` (2027) → `NT:/FMSInfo/FMSControlData` (≤2026) → `RUNNING` (Road Runner) |
| **Autonomous** | `/DriverStation/RobotMode` (AK 2027, string) → `NT:/AdvantageKit/DriverStation/RobotMode` → `/DriverStation/Autonomous` (AK ≤2026) → `NT:/AdvantageKit/DriverStation/Autonomous` → `DS:controlWord/robotMode` (DataLog/Phoenix, 2027+) → `DS:autonomous` (DataLog ≤2026) → `DS:/Dscomm/Control/Robot/ControlData/ControlWord` (FIRST DS) → `/DSLog/Status/DSTeleop` (NI DS, **inverted**) → `RobotMode` (Phoenix) → `NT:/DriverStation/ControlWord/robotMode` (2027) → `NT:/FMSInfo/FMSControlData` (≤2026) |
| **Utility / Test** | `/DriverStation/RobotMode` → `NT:/AdvantageKit/DriverStation/RobotMode` → `/DriverStation/Test` → `NT:/AdvantageKit/DriverStation/Test` → `DS:controlWord/robotMode` → `DS:test` → `DS:/Dscomm/Control/Robot/ControlData/ControlWord` → `RobotMode` (Phoenix) → `NT:/DriverStation/ControlWord/robotMode` → `NT:/FMSInfo/FMSControlData` (NI DS logs have no utility/test flag) |
| **Alliance / station** | `/DriverStation/AllianceStation` (AK) → `NT:/AdvantageKit/DriverStation/AllianceStation` → FIRST DS ControlWord → `NT:/DriverStation/IsRedAlliance` / `StationNumber` (2027) → `NT:/FMSInfo/IsRedAlliance` / `StationNumber` (≤2026) → `DS:allianceStation` / `AllianceStation` (Phoenix) |
| **Event / match type / match number** | `/DriverStation/EventName` etc. (AK) → `DS:/Dscomm/Control/Robot/MatchInfo/*` (FIRST DS) → `NT:/DriverStation/*` (2027) → `NT:/FMSInfo/*` (≤2026) → `NT:/Netcomm/Control/MatchInfo/*` (Systemcore) → `DS:matchInfo/*` (Phoenix) |
| **Wall clock** | `/SystemStats/EpochTimeMicros` (AK) or `systemTime` (DataLogManager) |
| **Program start time** | `NT:/Robot/ProgramStartTime`, `/Robot/ProgramStartTime` |
| **Metadata** | `/Metadata`, `/RealMetadata`, `/ReplayMetadata`, and their `NT:` forms |

**Decode rules**
- `*FMSControlData` (number): enabled = bit 0; auto = bit 1; test = bit 2.
- `*ControlWord` stored as a number (the FIRST DS log): enabled = bit 0; mode = bits 1–2, where 1 = auto, 3 = utility, and presumably 2 = teleop. This DS-side numeric layout is **different** from the robot-side `ControlWord` struct in §1.7.
- `*RobotMode` (string): `autonomous`, `utility`, or `test`.
- NI DS flags are active-low in the file, and `DSDisabled` / `DSTeleop` need inversion to mean enabled / auto.

---

## 2. NI Driver Station logs (`.dslog` + `.dsevents`), legacy 2010–2026

**Location and naming.**
- Folder: `C:\Users\Public\Documents\FRC\Log Files\`.
- Files: `YYYY_MM_DD HH_MM_SS Day.dslog` plus a `.dsevents` with the same basename, named in DS-laptop **local time** (e.g. `2018_04_22 23_39_25 Sun.dslog`).
- To find match logs, look for the "FMS Connected" event followed by the match number.
- AdvantageScope pairs the two files automatically by basename.

**Byte order:** big-endian [verified, AdvantageScope `DSLogReader.ts`, frcture].

### 2.1 Header (both files, 20 bytes)

| Offset | Type | Field |
|---|---|---|
| 0 | int32 | Version. Current files are **4**; AdvantageScope only supports v4. |
| 4 | int64 | LabVIEW timestamp: whole seconds since 1904-01-01 00:00:00 UTC |
| 12 | uint64 | Fractional second, as $f / 2^{64}$ |

Conversion to Unix time: $t_{\text{unix}} = s_{\text{LV}} - 2{,}082{,}844{,}800 + f/2^{64}$.

AdvantageScope's `convertLVTime` uses the constant $-2{,}082{,}826{,}800$, which is 18,000 s (5 h) different from the UTC epoch offset. Validate against real files and the file name's local time before trusting either value.

### 2.2 `.dslog` records (v4)

One record per 20 ms (50 Hz). There is no per-record timestamp: $t_i = t_0 + 0.02\,i$.

**Core block (10 bytes).** Layout and scaling from AdvantageScope's parser [verified in source].

| Offset | Type | Field | Scaling |
|---|---|---|---|
| +0 | uint8 | Trip time | $\text{raw} \times 0.5$ ms |
| +1 | int8 | Packet loss | $\min(\max(\text{raw} \times 4 \times 0.01,\ 0),\ 1)$ (fraction) |
| +2 | uint16 | Battery voltage | $\text{raw}/256$ V. AdvantageScope replaces glitch values above 20 V with the previous value. |
| +4 | uint8 | roboRIO CPU | $\text{raw} \times 0.5 \times 0.01$ (fraction) |
| +5 | uint8 | Status mask, **active-low** (bit = 0 means true) | bit 7 brownout · bit 6 watchdog · bit 5 DS teleop · bit 4 unused · bit 3 DS disabled · bit 2 robot teleop · bit 1 robot auto · bit 0 robot disabled |
| +6 | uint8 | CAN utilization | $\text{raw} \times 0.5 \times 0.01$ (fraction) |
| +7 | uint8 | Wi-Fi signal | $\text{raw} \times 0.5$ dB |
| +8 | uint16 | Bandwidth | $\text{raw}/256$ Mb |

**Power-distribution block** (immediately follows the core block):
- 4-byte PD header. Byte +3 is the PD type: `33` (0x21) = REV PDH, `25` (0x19) = CTRE PDP, anything else = none.
- **REV PDH:** 1 byte; then 27 bytes of packed 10-bit currents for channels 0–19, in groups of 3 per 32 bits, each $\text{raw}/8$ A; then 4 bytes for channels 20–23, each $\text{raw}/16$ A; then 1 byte. Record size 47 bytes.
- **CTRE PDP:** 1 byte; then 21 bytes of packed 10-bit currents for 16 channels, in groups of 6 per 64 bits, each $/8$ A; then 3 bytes. Record size 39 bytes.
- **None:** record size 14 bytes.

**Caveats**
- AdvantageScope's CTRE unpack loop accumulates only 8 of the 10 bits per channel. This is likely a bug or a deliberate simplification [verify against real PDP logs].
- frcture documents a different 35-byte layout with other scalings (trip time ÷ 15, a 1-byte Wi-Fi Mb). That probably describes a pre-v4 format. Build against v4 and keep real sample files from both PD types as test fixtures.

### 2.3 `.dsevents` records

- Same 20-byte header, followed by repeated entries.
- Each entry: LabVIEW timestamp (int64 s + uint64 fraction, 16 bytes), int32 text length, UTF-8 text.
- The text contains XML-like tags: `<TagVersion>`, `<time>`, `<count>`, `<flags>`, `<Code>`, `<location>`, `<stack>`, `<message>`, `<details>`. AdvantageScope strips most of them for display.
- Event content includes errors and warnings with codes, FMS connection and match info, joystick changes, and "Robot Program Starting" (which indicates a reboot, often from a brownout or crash).
- **Recommendation:** keep and parse `<Code>`/`<flags>`/`<count>` rather than stripping them. They enable severity classification and dedup ("unique" view, like the NI viewer's filters).

---

## 3. FIRST Driver Station logs (2027+)

- **Format:** WPILOG. File names contain `FIRST_DS`.
- **Location:** `~/.firstds` on Unix-like systems, `Public Documents/FIRSTDriverStation/Logs` on Windows.
- **DS web server** at `http://localhost:6768`: Log Files (browse/download), Log Viewer (AdvantageScope Lite at `/ascope`), Override Files.
- **Known fields:** see the FIRST DS row in §1.9. `ErrorInfo` includes timestamps, sequence number, occurrence count, location and call stack.
- **DS-side control word** is numeric (see §1.10 decode rules).
- **Unknown yet:** whether DS-side trip time, packet loss, battery and PD currents are logged, and under what names. **Action:** obtain sample FIRST DS logs from Systemcore beta testers or offseason events. The FIRST DS was trialed at offseason events in fall 2026.

---

## 4. CTRE Hoot (`.hoot`)

**What it is.** A proprietary binary format, decodable only with CTRE tools: the `owlet` CLI or the Phoenix Tuner X Log Extractor. Both output WPILOG or MCAP.

**CLI usage**
- `owlet -f wpilog input.hoot output.wpilog` (CTRE docs). AdvantageScope runs `owlet <in> <out> -f wpilog`.
- `owlet <in> --check-pro`: AdvantageScope treats stdout containing "NOT" as "no Pro device" [verified in source].

**Version matching** [verified in AdvantageScope source]
- AdvantageScope reads a "compliancy" byte at file offset **70**. It must be ≥ 6 (Phoenix 2024+).
- It then selects an owlet build whose filename contains `-C<compliancy>`.
- The owlet build index lives at `https://redist.ctr-electronics.com/index.json`. AdvantageScope downloads matching builds per platform in the background.

**Licensing**
- Opening hoot logs requires accepting CTRE's EULA; AdvantageScope prompts on first use.
- Without a Pro-licensed device in the log, export is limited to a free subset of status signals plus all custom signals. With a Pro device, all signals export.
- Don't redistribute owlet without checking CTRE's terms.

**Files and lifecycle**
- One file per CAN bus.
- In 2026, all files from one run go in a subfolder named after the program start date/time.
- Auto-start (2026 docs), on a roboRIO 2 or a roboRIO 1 with USB: logging starts at the earlier of (a) ≥1 s after program start with the robot enabled, or (b) ≥5 s after program start with the DS connected.
- `SignalLogger.setPath()` changes the directory.
- Old logs are deleted at 50 MB free (2025 docs); logging stops below 5 MB free.

**Time base**
- Status signals carry CAN timestamps and are captured at their configured rates, independent of the robot loop.
- Custom signals (`write*`, including `writeStruct` and units) share the same time base, and support a latency parameter.
- The owlet output time base relative to robot FPGA time is [verify]. Align on the `RobotEnable` signal edge, as AdvantageScope does by first enable.

---

## 5. REV `.revlog`

- **Producer:** REVLib 2026+ `StatusLogger`, on by default at the first REVLib device call. It records **raw CAN status frames** from SPARK MAX, SPARK Flex, Servo Hub and MAXSpline Encoder.
- **Naming and location:** `REV_YYYYMMDD_HHMMSS.revlog`, stored in `/home/lvuser/logs/` or `/u/logs/` (USB).
- **Storage safeguards:** warning at < 100 MB free; oldest files deleted at < 50 MB; logging stops at < 5 MB.
- **Conversion:** `@rev-robotics/revlog-converter` (npm, v1.0.x).
  - CLI: `revlog-converter input.revlog -o output.wpilog`, or pipe stdin to stdout.
  - Library (ESM/CJS): `parseREVLOG(inputPathOrBuffer, outputPathOrWritable)`.
  - AdvantageScope uses this same package.
  - License not confirmed [verify before bundling].
- **Signal decoding** depends on device firmware frame definitions, so treat REV's converter as the source of truth rather than re-implementing it.

---

## 6. NetworkTables 4 (live data) [verified, `ntcore/doc/networktables4.adoc`]

- **Transport:** WebSocket `ws://<host>:5810/nt/<clientName>`; secure `wss://` on port 5811.
- **Subprotocols:** `v4.1.networktables.first.wpi.edu` (preferred) and `networktables.first.wpi.edu` (4.0).
- **Framing:**
  - Text frames carry JSON control messages: client→server `publish`, `unpublish`, `setproperties`, `subscribe`, `unsubscribe`; server→client `announce`, `unannounce`, `properties`.
  - Binary frames carry MessagePack value messages `[topicId, timestamp_us, typeId, value]`.
- **Time:** unsigned integer µs in server time. For clock sync, the client periodically sends ID −1 with its local time; the server replies with its own time, and the client estimates the offset using round-trip time.
- **Subscription options:**
  - `all` sends every value change, not just the latest. Required for logging-grade capture.
  - `prefix` matches topic-name prefixes.
  - `topicsonly` sends announcements only.
  - `periodic` sets the sweep period (default 100 ms).
  - The spec warns that subscribing to everything can cause disconnect loops on large data.
- **Properties:** `persistent`, `retained`, `cached`, plus arbitrary keys (e.g. units).
- **Type IDs:** boolean = 0, double = 1, int = 2, float = 3, plus string, json, raw, rpc, msgpack, protobuf and arrays. Struct values travel as `raw` with type string `struct:<Name>`; schemas are published under `/.schema/...` [verify NT topic naming].
- **Meta topics:** `$clients`, `$serverpub`, `$sub$<topic>`, etc. These are only announced to subscribers of the `$` prefix.

---

## 7. Time bases and alignment cheat sheet

| Source | On-disk unit | Zero point | Wall-clock anchor |
|---|---|---|---|
| roboRIO DataLog (≤2026) | µs | FPGA start (≈ program start) | `systemTime` (µs Unix UTC, about every 5 s, once the DS has synced time) |
| Systemcore DataLog (2027) | µs (API in ns) | Device boot. Early 2027 alphas wrote epoch timestamps. | `systemTime` |
| AdvantageKit | µs, one synchronized timestamp per loop cycle | As above | `/SystemStats/EpochTimeMicros` |
| NI DS log | Implicit 20 ms steps | Absolute LabVIEW start time in the header | Header and event timestamps |
| FIRST DS log (2027) | µs (WPILOG) | [verify] | [verify] |
| Hoot via owlet | µs | [verify] | Align on `RobotEnable` edge |
| REVLOG via converter | µs | [verify] | Start time in file name; otherwise align with companion logs [verify] |
| Match video | Frames | Video start | Score-overlay OCR (AdvantageScope auto-sync) or manual auto-start mark |
| NT4 live | µs, server time | Server start | Client offset estimated via ID −1 messages |

**File-name time zones**
- DataLogManager names use **UTC**.
- NI DS names use **local** time.
- On Systemcore alpha, AdvantageKit had a UTC-vs-local naming bug, fixed in Systemcore release 163.
- In early alphas, Systemcore lacked DS time sync, so names used random IDs; fixed in release 161.

---

## 7a. Observed in a real log: CURIE Q89 (2026 Championship) [verified]

A 71.5 MB, 6-minute match log from a team using WPILib DataLogManager with NetworkTables mirrored, no AdvantageKit. It is the first real log Brownout was checked against (2026-11-16). What it holds and what it lacks is typical of a DataLogManager team, so it is a good default to design for.

**Present**

| What | Key | Notes |
|---|---|---|
| Robot state | `DS:enabled`, `DS:autonomous`, `DS:test`, `DS:estop` | written by `DriverStation.startDataLog` |
| Match info | `NT:/FMSInfo/*` | `FMSControlData` int, `IsRedAlliance`, `StationNumber`, `EventName`, `MatchType` (2 = qualification), `MatchNumber` |
| Wall clock | `systemTime` | int64 µs since 1970, every 25 s |
| Controllers | `DS:joystick<N>/buttons` (boolean[]), `/axes` (float[]), `/povs` (int64[]) for N = 0..5 | ports 2 to 5 hold one empty sample. Xbox axes 0..5 = LX, LY, LT, RT, RX, RY; array index $k$ is button $k+1$ (A = 1, B = 2, X = 3, RB = 6, left stick = 9). Confirmed against the team's own `Robot Container/Controllers/Driver/*` fields. |
| Console | `console` (string, several lines per record) | WPILib prints `Warning at <class>.<method>(<File>.java:<line>): <message>`; a loop overrun is followed by Tracer lines `\t<name>(): <seconds>s` |
| Alerts | `NT:/SmartDashboard/<group>/errors`, `warnings`, `infos` (string[]) with `<group>/.type` = `Alerts` | the group is named by the team (`Power`, `PathPlanner`), not `Alerts` |
| Commands | `NT:/SmartDashboard/Scheduler/Names` (string[]), `Ids`, `Cancel` | 105 changes, 22 distinct commands, including generic `FunctionalCommand` and `SequentialCommandGroup` and the auto routine's name |
| Robot pose | `NT:/SmartDashboard/Subsystems/Drive/Robot Position 2D` (Pose2d), also `.../Field/Robot` (Field2d double[3], degrees) | the pose jumps 0.5 to 0.8 m in one 20 ms update when the estimator takes a vision measurement |
| PathPlanner | `NT:/PathPlanner/activePath`, `currentPose`, `targetPose`, `vel` | `currentPose` and `targetPose` exist only while a path runs; `activePath` keeps the last path after it ends |
| Swerve | `.../Drive/Current Modules States`, `.../Drive/Target Modules States` (SwerveModuleState[]) | angles are unwrapped (−34 rad) |
| Auto chooser | `NT:/SmartDashboard/Robot Container/Autonomous/active`, `selected`, `options` | a SendableChooser named "Autonomous" |
| Vision | `NT:/limelight-<name>/botpose*` (double[]), `tid`, `tv`, `rawfiducials` for three Limelights; the team also logs `.../Drive/Visions/<camera>/Pose` (Pose2d) and `Perceived April Tags` (Pose2d[] of tag positions) | `botpose_orb_wpiblue` has the tag count at index 7 and tag IDs at $11 + 7k$ |
| Motor current | `.../Subsystems/<Mechanism>/<Motor>/Current (Amps)`, `Power (Watts)`, `Temperature (C)` | logged on change only; one current field swings to −35 A, so it may be stator or torque current |

**Absent:** battery voltage, brownout flag, total current, PDH channel currents, loop time, CAN utilization, git SHA, match time, drivetrain motor currents. Built-in layouts must not assume any of these.

## 8. Other formats

- **CSV** (AdvantageScope import/export conventions). Columns are either `Timestamp, Key, Value` (list form) or `Timestamp, <key>, <key>, …` (table form). Timestamps are in seconds. Booleans are `true`/`false`; strings are quoted; arrays look like `[1; 2; 3]`; bytes are hex like `4d-41-…`. The conversion is lossy.
- **MCAP.** Export target for Foxglove, produced by AdvantageScope export and by owlet.
- **RLOG** (`.rlog`). AdvantageKit 2022 file format and live-stream protocol. Low priority.
- **Road Runner** `.log` (FTC). Out of scope for FRC, but FTC moves to Systemcore and WPILOG in 2027–28.

---

## 9. Reference implementations to study or reuse

| Project | License | Useful parts |
|---|---|---|
| allwpilib | BSD | `datalog/` `DataLogReader` (C++/Java), `wpilog.ksy`, struct/NT4 specs |
| RobotPy | BSD [verify] | `wpiutil.log.DataLogReader` (Python), handy for batch/CLI tools |
| AdvantageScope | **BSD-3-Clause** (Littleton Robotics). Keep the notice; no endorsement use of names. | `src/hub/dataSources/wpilog/` (`WPILOGDecoder.ts`, `indexer/wpilogIndexer.c`); `src/hub/dataSources/dslog/` (`DSLogReader.ts`, `DSEventsReader.ts`, `DSUtil.ts`); `src/shared/log/` (`StructDecoder.ts`, `ProtoDecoder.ts`, `PhotonStructDecoder.ts`, `RobotState.ts`, `LogUtil.ts`); `src/hub/dataSources/schema/URCLSchema.ts`; `src/hub/dataSources/nt4/NT4.ts`; `src/main/electron/owletInterface.ts` |
| `wpilog-parser` (npm, Jonah Snider) | MIT | TS/JS `readRecords`/`decodeRecords`; `wpilog catalog` CLI with JSON/JSONL/CSV output; agent skill for coding agents |
| `@rev-robotics/revlog-converter` (npm) | [verify] | revlog → wpilog |
| `wpilog` Rust crate 0.1.x | MIT | Appears writer-focused and early-stage [verify fitness for reading] |

---

## Sources

- WPILib Data Log spec: https://github.com/wpilibsuite/allwpilib/blob/main/datalog/doc/datalog.adoc
- WPILib Packed Struct spec: https://github.com/wpilibsuite/allwpilib/blob/main/wpiutil/doc/struct.adoc
- NetworkTables 4 spec: https://github.com/wpilibsuite/allwpilib/blob/main/ntcore/doc/networktables4.adoc
- WPILib 2027 Telemetry API design: https://github.com/wpilibsuite/allwpilib/blob/main/telemetry/doc/telemetry.md
- WPILib DataLog docs: https://docs.wpilib.org/en/stable/docs/software/telemetry/datalog.html
- FIRST Driver Station log viewer (2027): https://docs.wpilib.org/en/latest/docs/software/firstdriverstation/first-driver-station-log-viewer.html
- NI DS Log File Viewer: https://docs.wpilib.org/en/stable/docs/software/driverstation/driver-station-log-viewer.html
- frcture DS log notes: https://frcture.readthedocs.io/en/latest/driverstation/logging.html
- AdvantageScope source and docs: https://github.com/Mechanical-Advantage/AdvantageScope · https://docs.advantagescope.org
- CTRE Signal Logging: https://v6.docs.ctr-electronics.com/en/stable/docs/api-reference/api-usage/signal-logging.html
- REV Status Logger: https://docs.revrobotics.com/revlib/logs
- revlog-converter: https://www.npmjs.com/package/@rev-robotics/revlog-converter
- AdvantageKit 2027 alpha notes (Systemcore known issues): https://github.com/wpilibsuite/SystemcoreTesting
- wpilog-parser announcement: https://www.chiefdelphi.com/t/analyzing-log-files-with-ai/520492
