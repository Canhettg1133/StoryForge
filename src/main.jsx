import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initStorage } from './services/db/storage';

// Styles
import './styles/index.css';
import './styles/animations.css';
import './styles/components.css';

// Initialize theme
const savedTheme = localStorage.getItem('sf-theme') || 'dark';
document.documentElement.setAttribute('data-theme', savedTheme);

// Initialize persistent storage for IndexedDB (200MB+ support)
initStorage().catch(() => {});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
