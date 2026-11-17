import React from 'react';
import { createRoot } from 'react-dom/client';
import 'dockview-react/dist/styles/dockview.css';
import './styles.css';
import { App } from './App';
import { timeStore, timeBounds } from './state/time';
import { sessionStore } from './state/session';
import { settingsStore } from './state/settings';
import { panelStore } from './state/panels';
import { presetStore } from './state/presets';
import { uiStore } from './state/ui';
import { profileStore } from './state/profiles';
import { videoStore } from './state/videos';
import { seekStats, chaseSeek } from './lib/videoSeek';

// Handle for the UI test script and for poking at state from DevTools.
(window as unknown as { __brownout: unknown }).__brownout = {
  timeStore,
  sessionStore,
  settingsStore,
  panelStore,
  presetStore,
  uiStore,
  profileStore,
  videoStore,
  /** The range the timeline covers right now (the match or the whole log). */
  timeBounds,
  /** Video seeks asked for and actually issued (lib/videoSeek.ts). */
  seekStats,
  chaseSeek,
};

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
