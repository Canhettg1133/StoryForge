import React from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import './MobileBibleTabs.css';

const BIBLE_TABS = [
  { id: 'overview', label: 'Tong quan', path: (id) => `/project/${id}/story-bible` },
  { id: 'characters', label: 'Nhan vat', path: (id) => `/project/${id}/characters` },
  { id: 'world', label: 'The gioi', path: (id) => `/project/${id}/world` },
  { id: 'canon', label: 'Canon', path: (id) => `/project/${id}/su-that` },
];

function getActiveTab(pathname) {
  if (pathname.includes('/characters')) return 'characters';
  if (pathname.includes('/world')) return 'world';
  if (pathname.includes('/su-that')) return 'canon';
  return 'overview';
}

export default function MobileBibleTabs() {
  const { projectId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const activeTab = getActiveTab(location.pathname);

  if (!projectId) return null;

  return (
    <div className="mobile-bible-tabs" aria-label="Dieu huong Bible tren mobile">
      {BIBLE_TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={`mobile-bible-tab ${activeTab === tab.id ? 'mobile-bible-tab--active' : ''}`}
          onClick={() => navigate(tab.path(projectId))}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
