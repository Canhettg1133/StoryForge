import React from 'react';
import ReactDOM from 'react-dom/client';
import { inject } from '@vercel/analytics';
import App from './App';
import { shouldInjectVercelAnalytics } from './services/analytics/vercelAnalytics.js';
import { initStorage } from './services/db/storage';
import { initStoryMirrorRuntime } from './services/storyMirror/runtime.js';
import {
  applyDocumentTheme,
  persistTheme,
  readStoredTheme,
} from './config/themes.js';

// Styles
import './styles/fonts.css';
import './styles/index.css';
import './styles/animations.css';
import './styles/components.css';

if (shouldInjectVercelAnalytics(window.location.hostname, import.meta.env.VITE_DEPLOYMENT_MODE)) {
  inject();
}

// Initialize theme
const savedTheme = persistTheme(readStoredTheme());
applyDocumentTheme(savedTheme);

// Initialize persistent storage for IndexedDB (200MB+ support)
initStorage().catch(() => {});
initStoryMirrorRuntime();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
