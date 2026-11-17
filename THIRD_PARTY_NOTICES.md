# Third-party notices

Brownout bundles code from these open-source projects:

| Project | License |
|---|---|
| Electron (with Chromium and Node.js) | MIT; Chromium's licenses ship inside Electron builds |
| React, React DOM | MIT |
| dockview, dockview-core, dockview-react | MIT |

The robot-state key tables in `src/core/robotState.ts` and the WPILOG parsing approach follow the published WPILib specifications and were adapted from the key priority documented in the project's format reference, which in turn was adapted from AdvantageScope (`src/shared/log/RobotState.ts`), BSD-3-Clause, Copyright (c) 2021-2026 Littleton Robotics. No AdvantageScope source files have been copied verbatim. When one is, keep its header and add the full BSD-3-Clause text below.

## Field pictures and AprilTag maps

The field pictures in `src/renderer/src/assets/fields/` (`2024.webp`, `2025.webp`, `2026.webp`, resized and re-encoded from the originals, with corner positions in `fields.json`) and the AprilTag layouts (`tags-*.json`, unmodified) come from WPILib (`fieldImages` and `apriltag` in https://github.com/wpilibsuite/allwpilib, release v2026.2.1) under this license:

```
Copyright (c) 2009-2026 FIRST and other WPILib contributors
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:
   * Redistributions of source code must retain the above copyright
     notice, this list of conditions and the following disclaimer.
   * Redistributions in binary form must reproduce the above copyright
     notice, this list of conditions and the following disclaimer in the
     documentation and/or other materials provided with the distribution.
   * Neither the name of FIRST, WPILib, nor the names of other WPILib
     contributors may be used to endorse or promote products derived from
     this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY FIRST AND OTHER WPILIB CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY NONINFRINGEMENT AND FITNESS FOR A PARTICULAR
PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL FIRST OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

The games and field designs themselves are FIRST's. Brownout is not affiliated with or endorsed by FIRST or WPILib.
