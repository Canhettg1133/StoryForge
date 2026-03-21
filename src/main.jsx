import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Styles
import './styles/index.css';
import './styles/animations.css';
import './styles/components.css';

// Initialize theme
const savedTheme = localStorage.getItem('sf-theme') || 'dark';
document.documentElement.setAttribute('data-theme', savedTheme);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
