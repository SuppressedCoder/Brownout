# Brownout — instructions for coding agents

Brownout is an Electron + TypeScript + React log viewer / comparison tool for FRC WPILOG files. Most code here is written by AI agents from prompts; people steer, test and review. New to the project? Read `HANDOFF.md` first: where things stand, why they are built this way, and what to do next. Then read the spec that matches your task in `docs/` before changing behavior:

- `docs/frc-log-format-reference.md` — WPILOG bytes, struct grammar, key names, robot-state key priority (§1.10)
- `docs/brownout-viewer-ui-spec.md` — timeline, panels, grid, presets, comparison behavior
- `docs/brownout-vision-and-pathing-spec.md` — AprilTags, PathPlanner overlay, field frames and alliance flipping
- `docs/brownout-tech-stack.md` — stack decisions, performance rules
- `docs/frc-logging-landscape-and-viewer-requirements.md` — requirements and the decisions log (add new decisions there)

## Commands

```
npm run check     # typecheck (3 configs) + vitest — must pass before you finish
npm run smoke     # headless launch + screenshot in smoke/; fails on renderer errors
npm run bench     # reader speed vs the 3 s per 100 MB budget
npm run uitest    # Playwright drives the real Electron app (menus, presets, dialogs, time, zoom, settings, video, report); add a check when you add UI behavior, and look at the screenshots it writes to smoke/ui-*.png
npm run reallog   # the real app on every log in fixtures/local/ (real team logs, git-ignored): screenshots + summary in smoke/real-*
npm run make-demo # regenerate fixtures/demo/*.wpilog and src/renderer/public/demo (Settings → Demo logs)
npm run dev       # run the app
```

## Architecture rules

1. **`src/core` is pure.** No DOM, Node or Electron imports (enforced by `tsconfig.core.json`, which has no DOM/Node lib). It runs in the log worker, in tests and in scripts. Put parsing, decoding, robot state, alignment math and analyzers here, with unit tests in `src/core/core.test.ts` (reader, robot state, power) or `src/core/viewers.test.ts` (cameras, controllers, commands, match report).
2. **Heavy work runs in the worker** (`src/renderer/src/worker/logWorker.ts`). The renderer asks for series through `client.getSeries` / `client.peekSeries` and caches them. Add new analyses to `summarize()` in the worker and to `LogSummary` in `protocol.ts`.
3. **Time:** every series keeps raw log seconds; `aligned = raw + log.offset`. Panels draw in aligned time. Never store aligned times in series.
4. **Canvas panels draw outside React.** Use `useCanvas` (ResizeObserver + rAF) and subscribe to `timeStore` / `sessionStore` / `panelStore` directly. React renders toolbars, tables and menus only. Moving the cursor must not re-render React trees.
5. **Panels** live in `src/renderer/src/panels/`, settings types in `state/panels.ts`, registration in `components/Grid.tsx` (`components` map + `PANEL_TITLES` + menu in `src/main/index.ts`). A panel reads its settings from `panelStore` by id and accepts dropped fields through `addFieldToPanel`.
6. **Roles, not keys.** Presets and analyzers find fields by role (`src/core/roles.ts`). Add key patterns there instead of hard-coding keys in panels. The robot-state key tables are in `src/core/robotState.ts`.
7. **Per-pixel min/max** for anything drawn against time (`src/core/decimate.ts`); whole signals never go to the canvas unless they are smaller than 2× the pixel width.
8. **Security:** keep context isolation and the sandbox on; add main-process capabilities only through `src/preload/api.ts` + `index.ts` + an `ipcMain.handle`. Local video is served only through the `brownout-media://` scheme, which hands out one opaque address per file the user picked and only for video file types; don't widen it or the CSP. Offering a match video (`list-videos-near`) lists names only, and only in the folder of a log the main process read and the videos folder picked through its own dialog; a file gets an address only after the user accepts it. Pictures inside a robot profile must be inline `data:image/...` URLs (`normalizeProfile` drops anything else), so an imported profile can never make the app fetch something. The match report page has no scripts and no outside requests and is printed in a window with JavaScript off.
9. **Only the timeline moves shared time.** Panels must not call `setView` / `setCursor` from wheel, drag or plain clicks unless `settingsStore.get().panelsMoveTime` is on. Explicit "jump to this moment" links (console rows, findings, min/max cells) are fine. The view is clamped to the session extent in `state/time.ts`; don't write `timeStore.view` directly.
10. **Theme, never hex.** CSS uses the variables set by `lib/theme.ts`; canvas code calls `T()` for the palette and `modeSolid()` / `modeFill()` / `toneColor()` for semantic colors. Log colors come from `log.color`.
11. **Commands go in the action registry** (`lib/actions.ts`). Keybinds, the native menu (`action:<id>`) and the help sheet are generated from it; don't add `keydown` handlers or Electron menu accelerators.
12. **No `prompt()` / `confirm()` / `alert()`** (they don't work in Electron). Use `askText`, `confirmDialog`, `askChoice`, `askChecklist` and `toast` from `state/ui.ts`.
13. **Don't re-render on the cursor.** Lists highlight the current row with `useCursorEffect`; view-dependent tables use `useSettledView`. Cache anything a canvas computes from the view (see `decimated()` in GraphPanel, `stripRuns()` in Timeline) so hover/cursor redraws are cheap. Respect `dc.potato` in draw functions.
14. **Icons, never emoji.** The interface has no emoji, pictograph, arrow or geometric-shape characters. Add an icon to `lib/icons.ts` (16 x 16 grid, path data, one line weight) and use `<Icon name>` in React or `drawIcon()` on a canvas. The UI test fails if such a character shows up in visible text.
15. **Toolbars are one row.** Build them with `Toolbar` (or `OverflowRow`) and its controls (`ToolButton`, `ToolSelect`, `ToolGroup`, `ToolSpacer`, `MenuButton`): what does not fit goes into the overflow menu by itself. Put controls in priority order and mark the less-used ones `low`; they leave first in compact view. Icon-only buttons need `text` (their label inside the overflow menu). Panels read `useCompact()`. The toolbar row clips its contents, so anything that pops out of a toolbar must be a `MenuButton` (its menu is drawn in a floating layer on `document.body`), never an absolutely positioned child. A lit (`active`) button means “switched on”; a button that only does something (Fit, Clear) is never lit, and is `disabled` when there is nothing for it to do.
16. **What describes the robot goes in the robot profile** (`state/profiles.ts`), not in panel settings or presets: subsystems, cameras, appearance layers, swerve settings, robot size, controller layout, favorites, role overrides. Panel setup buttons edit the profile of the log they show.
17. **`useStore` selectors must not close over props or state.** The hook caches its result per store state, so `useStore(store, (s) => s.items.find((x) => x.id === propId))` goes stale when `propId` changes. Select the collection, then look up outside the selector. (A panel's own `id` is fine: it never changes.)
18. **Design for the log that lacks things.** The first real log (CURIE Q89) has no battery voltage, no total current, no PDH channels and no loop time. Built-in presets add only fields that exist (`present()` in `lib/presets.ts`), fall back to what the log does have, and give an empty panel a `note` saying what is missing and how to log it. Never state a conclusion the data cannot support: "no brownouts" needs voltage or a brownout flag. Unit tests that pin down real-log layouts go in `src/core/reallog.test.ts`.
19. **Every data source is optional.** Vision, controllers and commands differ from team to team: a camera is whichever of its three fields the robot logs (pose estimate, tag IDs, tag poses), and whatever is missing is simply not drawn or reported. Detect the common layouts from field names (`detectCameras`, `controllerKeys`, `detectCommandSources` in `src/core`) so things work with no setup, and always leave a way to pick the field by hand.
20. **A menu item that opens a dialog closes its menu first** (`onClick={() => (close(), open())}`), or the menu stays open behind the dialog.
21. **Reusing AdvantageScope code** (BSD-3, Littleton Robotics) is allowed: copy into `src/core/vendor/advantagescope/` with its license header and add the notice to `THIRD_PARTY_NOTICES.md`.

## Adding things

- **New panel:** settings interface + `defaultSettings` + a `PANEL_CATALOG` entry in `state/panels.ts` → component in `panels/` → register in `Grid.tsx` → menu entry in `src/main/index.ts` → optionally a built-in preset in `lib/presets.ts`. View state that shouldn't mark a preset “(modified)” goes in `VIEW_KEYS` in `state/presets.ts`.
- **New view** (a fixed full-window layout like Video review or Power): a value in `AppView` (`state/session.ts`), a component in `components/Views.tsx` placing `StandalonePanel`s, a button in the header's view switch, an action and a View menu entry. Its panels use ids starting with `view:` (`VIEW_PANEL_PREFIX`), created with `ensurePanel`; they are never saved into layouts or presets, so anything that walks all panel settings must skip them (`isViewPanel`).
- **New command / shortcut:** one entry in `ACTIONS` (`lib/actions.ts`).
- **New per-robot setting:** a field in `RobotProfile` with a default in `blankProfile()` and a guard in `normalizeProfile()` (`state/profiles.ts`), a control in `components/RobotSettings.tsx`.
- **New field season:** add the picture and tag JSON under `src/renderer/src/assets/fields/`, an entry in `fields.json`, the imports in `lib/fieldAssets.ts`, and the season in `SEASONS` (`src/core/field.ts`).
- **New setting:** field + default in `state/settings.ts`, a control in `components/Settings.tsx`.
- **New thing drawn on the robot:** it is a `Layer` in the profile, drawn by `drawLayers` (`lib/robotDraw.ts`) for both the 2D field and the editor preview; the canvas is already at the robot's center and heading (+x forward, -y left).
- **New report section:** `src/core/report.ts` (pure, HTML-escaped with `esc`, sections with no data left out) plus the matching field in `ReportInput` and `lib/report.ts`; extend the test in `viewers.test.ts`.
- **New analyzer:** `src/core/analyzers/<name>.ts` (pure function of `LogData` + mode ranges) → call it in the worker's `summarize()` → surface in a panel. Findings carry raw-time stamps so the UI can jump to them.
- **New derived field:** add it in `summarize()` with `addDerived('/Brownout/...')`; it appears in the field tree like any field.
- **New key source (logger):** extend the tables in `robotState.ts` / `roles.ts` and add a fixture.

Commit after each step that works. Keep `npm run check` green.
