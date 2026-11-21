/**
 * Header bar: sidebar toggle, File menu, the logs in the session (color,
 * visibility, primary, close, load progress), alignment mode, the preset
 * menu (shows the active preset), "Add panel", Power, Potato mode, settings,
 * help. On a narrow window (or in compact view) the labels drop to icons and
 * the less-used controls move into the overflow menu.
 */
import { sessionStore, removeLog, closeAll, setAlignMode, setLogVisible, makePrimary, type LoadingItem } from '../state/session';
import { useStore } from '../state/store';
import { settingsStore } from '../state/settings';
import { uiStore, openSettings } from '../state/ui';
import { ALIGN_MODES, type AlignMode } from '@core/alignment';
import { PRESETS } from '../lib/presets';
import {
  presetStore,
  presetLabel,
  requestPreset,
  savePresetAs,
  updateActivePreset,
  renamePreset,
  duplicatePreset,
  duplicateBuiltin,
  deletePreset,
  exportPresets,
  importPresets,
} from '../state/presets';
import { grid } from './Grid';
import { PANEL_TITLES, PANEL_CATALOG } from '../state/panels';
import { useRef } from 'react';
import { ToolButton, ToolSelect, ToolSpacer, ToolGroup, OverflowRow, useCompactWidth } from './Toolbar';
import { Icon, Caret } from './Icon';
import { MenuButton, MenuItem, MenuSeparator, MenuLabel } from './Menu';
import { fileSize } from '../lib/format';
import { runAction, togglePotato, showView } from '../lib/actions';
import { keyHint } from '../lib/keybinds';

const STAGE_LABEL: Record<LoadingItem['stage'], string> = { read: 'reading', index: 'indexing', analyze: 'analyzing' };

export function Header() {
  const view = useStore(sessionStore, (s) => s.view);
  const logs = useStore(sessionStore, (s) => s.logs);
  const alignMode = useStore(sessionStore, (s) => s.alignMode);
  const loading = useStore(sessionStore, (s) => s.loadingItems);
  const preset = useStore(presetStore, (s) => s);
  const potato = useStore(settingsStore, (s) => s.potato);
  // re-render hints when keybinds change
  useStore(settingsStore, (s) => s.keybinds);
  const ref = useRef<HTMLDivElement>(null);
  const compact = useCompactWidth(ref, 1180);
  const label = presetLabel(preset);
  const activeUser = preset.active?.kind === 'user' ? preset.active.id : null;

  return (
    <div className={`header${compact ? ' compact' : ''}`} ref={ref}>
      <ToolButton icon="menu" text="Sidebar" onClick={() => runAction('toggleSidebar')} title={`Show / hide the field sidebar (${keyHint('toggleSidebar')})`} />
      <MenuButton
        label={
          <>
            File <Caret />
          </>
        }
        testId="file-menu"
        title="Open logs, export, close"
      >
        {(close) => (
          <>
            <MenuItem icon="folder" label="Open logs…" hint={keyHint('open')} onClick={() => (close(), runAction('open'))} />
            <MenuItem
              icon="download"
              label="Export CSV…"
              description="The active panel's fields over the selection or visible range"
              hint={keyHint('exportCsv')}
              onClick={() => (close(), runAction('exportCsv'))}
            />
            <MenuItem
              icon="image"
              label="Copy panel as image"
              description="The active panel, to paste into a chat or document"
              hint={keyHint('copyImage')}
              onClick={() => (close(), runAction('copyImage'))}
            />
            <MenuItem
              icon="report"
              label="Match report (PDF)…"
              description="One page for the pit: brownouts and their causes, power, battery, vision"
              hint={keyHint('matchReport')}
              disabled={!logs.length}
              testId="match-report"
              onClick={() => (close(), runAction('matchReport'))}
            />
            <MenuSeparator />
            <MenuItem icon="close" label="Close all logs" disabled={!logs.length} onClick={() => (close(), runAction('closeAll'))} />
          </>
        )}
      </MenuButton>
      <span className="log-chips">
        {logs.map((l, i) => (
          <span
            key={l.id}
            className={`log-chip${l.visible ? '' : ' hidden-log'}`}
            style={{ borderColor: l.color }}
            title={`${l.fileName} · ${fileSize(l.size)} · offset ${l.offset.toFixed(2)} s${i === 0 ? ' · primary (alignment reference)' : ''}`}
          >
            <span className="dot" style={{ background: l.color }} onClick={() => setLogVisible(l.id, !l.visible)} title="Show / hide" />
            <span className="chip-name" onClick={() => makePrimary(l.id)} title="Click to make this the primary log">
              {i === 0 && <Icon name="starFilled" size={10} className="primary-star" />}
              {l.name}
            </span>
            <button className="chip-btn" onClick={() => removeLog(l.id)} title="Close this log" aria-label={`Close ${l.name}`}>
              <Icon name="close" size={10} />
            </button>
          </span>
        ))}
        {loading.map((it) => (
          <span key={it.id} className="log-chip loading-chip" title={it.name}>
            <span className="chip-name">{it.name.replace(/\.wpilog$/i, '')}</span>
            <span className="load-stage">
              {STAGE_LABEL[it.stage]}
              {it.stage === 'index' ? ` ${Math.round(it.fraction * 100)}%` : '…'}
            </span>
            <span className={`load-bar${it.stage === 'index' ? '' : ' busy'}`}>
              <span style={{ width: `${it.stage === 'index' ? Math.round(it.fraction * 100) : 100}%` }} />
            </span>
          </span>
        ))}
      </span>
      {logs.length > 1 && (
        <button className="chip-btn close-all-logs" onClick={() => closeAll()} title="Close all logs" data-testid="close-all-logs">
          <Icon name="close" size={10} />
          <span>Close all</span>
        </button>
      )}
      <OverflowRow className="hdr-right" compact={compact} testId="header-more" moreTitle="More: alignment, Potato mode, shortcuts">
        <ToolSpacer />
        <ToolGroup className="view-switch">
          <ToolButton
            icon="blocks"
            text="Panels"
            active={view === 'panels'}
            onClick={() => showView('panels')}
            title={`Your panels and layouts (${keyHint('viewPanels')})`}
            testId="view-panels"
          >
            <span className="hdr-text">Panels</span>
          </ToolButton>
          <ToolButton
            icon="video"
            text="Video review"
            active={view === 'video'}
            onClick={() => showView('video')}
            title={`Video review: the match video next to the field, and the moments to check (${keyHint('viewVideo')})`}
            testId="view-video"
          >
            <span className="hdr-text">Video</span>
          </ToolButton>
          <ToolButton
            icon="power"
            text="Power"
            active={view === 'power'}
            onClick={() => showView('power')}
            title={`Power: what used the battery, by subsystem, and what caused each brownout (${keyHint('viewPower')})`}
            testId="power-btn"
          >
            <span className="hdr-text">Power</span>
          </ToolButton>
          <ToolButton
            icon="robot"
            text="Robot setup"
            active={view === 'robot'}
            onClick={() => showView('robot')}
            title={`Robot setup: drag fields onto the field to say what they are (robot, cameras, path, turning parts); size, parts, power and the rest of the robot profile (${keyHint('viewRobot')})`}
            testId="view-robot"
          >
            <span className="hdr-text">Robot</span>
          </ToolButton>
        </ToolGroup>
        <ToolGroup low className="hdr-label">
          Align
          <ToolSelect
            value={alignMode}
            onChange={(v) => setAlignMode(v as AlignMode)}
            options={ALIGN_MODES.map((m) => [m.id, m.label])}
            title={ALIGN_MODES.find((m) => m.id === alignMode)?.help}
          />
        </ToolGroup>
        {view === 'panels' && (
          <ToolGroup className="hdr-label">
            <span className="hdr-text">Preset</span>
            <MenuButton
              label={
                <span className="preset-name">
                  {label} <Caret />
                </span>
              }
              className="preset-btn"
              testId="preset-menu"
              align="right"
              wide
              title="Switch layouts, or save the current one as a preset"
            >
              {(close) => (
                <>
                  <MenuLabel>Built-in (find fields automatically)</MenuLabel>
                  {PRESETS.map((p) => (
                    <MenuItem
                      key={p.id}
                      label={p.name}
                      description={p.description}
                      checked={preset.active?.kind === 'builtin' && preset.active.id === p.id}
                      onClick={() => (close(), void requestPreset({ kind: 'builtin', id: p.id }))}
                      trailing={
                        <button className="chip-btn" title="Apply, then save a copy you can edit" onClick={() => (close(), void duplicateBuiltin(p.id))}>
                          <Icon name="copy" size={12} />
                        </button>
                      }
                    />
                  ))}
                  <MenuLabel>My presets</MenuLabel>
                  {preset.user.length === 0 && <div className="menu-empty">None yet. Arrange panels, then save the layout below.</div>}
                  {preset.user.map((p) => (
                    <MenuItem
                      key={p.name}
                      label={p.name}
                      checked={activeUser === p.name}
                      onClick={() => (close(), void requestPreset({ kind: 'user', id: p.name }))}
                      trailing={
                        <>
                          <button className="chip-btn" title="Rename" onClick={() => (close(), void renamePreset(p.name))}>
                            <Icon name="pencil" size={12} />
                          </button>
                          <button className="chip-btn" title="Duplicate" onClick={() => duplicatePreset(p.name)}>
                            <Icon name="copy" size={12} />
                          </button>
                          <button className="chip-btn" title="Delete" onClick={() => (close(), void deletePreset(p.name))}>
                            <Icon name="trash" size={12} />
                          </button>
                        </>
                      }
                    />
                  ))}
                  <MenuSeparator />
                  {activeUser && (
                    <MenuItem
                      icon="refresh"
                      label={`Update “${activeUser}”`}
                      description="Overwrite it with the current layout"
                      disabled={!preset.modified}
                      onClick={() => (close(), updateActivePreset())}
                    />
                  )}
                  <MenuItem
                    icon="plus"
                    label="Save current layout as preset…"
                    disabled={!preset.hasPanels}
                    hint={activeUser ? '' : keyHint('savePreset')}
                    onClick={() => (close(), void savePresetAs())}
                  />
                  <MenuItem
                    icon="download"
                    label="Export presets…"
                    description="Pick which ones go into a file to share"
                    onClick={() => (close(), void exportPresets())}
                  />
                  <MenuItem icon="upload" label="Import presets…" onClick={() => (close(), void importPresets())} />
                </>
              )}
            </MenuButton>
          </ToolGroup>
        )}
        {view === 'panels' && (
          <MenuButton
            label={
              <>
                <Icon name="plus" />
                <span className="hdr-text">Add panel</span>
              </>
            }
            testId="add-panel"
            align="right"
            wide
            title="Add a panel to the grid"
          >
            {(close) => (
              <>
                <MenuLabel>Add a panel to the grid</MenuLabel>
                {PANEL_CATALOG.map((p) => (
                  <MenuItem
                    key={p.type}
                    icon={p.icon}
                    label={PANEL_TITLES[p.type]}
                    description={p.description}
                    onClick={() => (close(), grid.addPanel(p.type))}
                  />
                ))}
              </>
            )}
          </MenuButton>
        )}
        <ToolButton
          low
          icon="potato"
          text="Potato mode"
          active={potato}
          onClick={togglePotato}
          title={`Potato mode: lower detail, faster drawing (${keyHint('potato')})`}
          testId="potato-btn"
        />
        <ToolButton icon="gear" text="Settings" onClick={() => openSettings()} title={`Settings (${keyHint('settings')})`} testId="settings-btn" />
        <ToolButton
          low
          icon="help"
          text="Guide, shortcuts and tips"
          onClick={() => uiStore.set({ helpOpen: true })}
          title={`The guide, shortcuts and tips (${keyHint('help')}; the guide: ${keyHint('guide')})`}
        />
      </OverflowRow>
    </div>
  );
}
