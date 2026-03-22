import React from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import useUIStore from '../../stores/uiStore';
import useProjectStore from '../../stores/projectStore';
import {
  LayoutDashboard,
  BookOpen,
  Map,
  Users,
  Globe,
  PenTool,
  Clock,
  FileSearch,
  Palette,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  Moon,
  Sun,
  ChevronLeft,
} from 'lucide-react';
import './Sidebar.css';

const NAV_ITEMS = [
  { path: '/', icon: LayoutDashboard, label: 'Dashboard', id: 'dashboard' },
  { path: '/story-bible', icon: BookOpen, label: 'Story Bible', id: 'story-bible', needsProject: true },
  { path: '/outline', icon: Map, label: 'Outline Board', id: 'outline', needsProject: true },
  { path: '/characters', icon: Users, label: 'Nhân vật', id: 'characters', needsProject: true },
  { path: '/world', icon: Globe, label: 'Thế giới', id: 'world', needsProject: true },
  { divider: true },
  { path: '/editor', icon: PenTool, label: 'Viết truyện', id: 'editor', needsProject: true, primary: true },
  { divider: true },
  { path: '/timeline', icon: Clock, label: 'Timeline', id: 'timeline', needsProject: true, comingSoon: true },
  { path: '/revision', icon: FileSearch, label: 'Revision & QA', id: 'revision', needsProject: true, comingSoon: true },
  { path: '/style-lab', icon: Palette, label: 'Style Lab', id: 'style-lab', needsProject: true, comingSoon: true },
  { divider: true },
  { path: '/settings', icon: Settings, label: 'Cài đặt', id: 'settings' },
];

export default function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { projectId } = useParams();
  const { sidebarCollapsed, toggleSidebar, theme, toggleTheme } = useUIStore();
  const { currentProject } = useProjectStore();

  const activeProjectId = currentProject?.id || projectId;

  const handleNav = (item) => {
    if (item.needsProject && !activeProjectId) return;
    const path = item.needsProject ? `/project/${activeProjectId}${item.path}` : item.path;
    navigate(path);
  };

  const handleBackToDashboard = () => {
    navigate('/');
  };

  return (
    <aside className={`sidebar ${sidebarCollapsed ? 'sidebar--collapsed' : ''}`}>
      {/* Logo */}
      <div className="sidebar-logo">
        {!sidebarCollapsed && (
          <>
            <span className="sidebar-logo-icon">📖</span>
            <span className="sidebar-logo-text">StoryForge</span>
          </>
        )}
        <button className="btn btn-ghost btn-icon btn-sm sidebar-toggle" onClick={toggleSidebar}>
          {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>

      {/* Project indicator */}
      {currentProject && !sidebarCollapsed && (
        <div className="sidebar-project" onClick={handleBackToDashboard}>
          <ChevronLeft size={14} />
          <span style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>{currentProject.title}</span>
        </div>
      )}

      {/* Navigation */}
      <nav className="sidebar-nav">
        {NAV_ITEMS.map((item, i) => {
          if (item.divider) {
            return <div key={`div-${i}`} className="sidebar-divider" />;
          }

          const expectedPath = item.needsProject && activeProjectId ? `/project/${activeProjectId}${item.path}` : item.path;
          const isActive = location.pathname === expectedPath || (item.path !== '/' && item.path !== '/settings' && location.pathname.startsWith(expectedPath));
          const isDisabled = item.needsProject && !activeProjectId;
          const isComingSoon = item.comingSoon && !isActive;
          const Icon = item.icon;

          return (
            <button
              key={item.id}
              className={`sidebar-item ${isActive ? 'sidebar-item--active' : ''} ${isDisabled ? 'sidebar-item--disabled' : ''} ${item.primary ? 'sidebar-item--primary' : ''} ${isComingSoon ? 'sidebar-item--coming-soon' : ''}`}
              onClick={() => handleNav(item)}
              title={sidebarCollapsed ? (item.comingSoon ? `${item.label} (Soon)` : item.label) : undefined}
            >
              <Icon size={18} />
              {!sidebarCollapsed && <span>{item.label}</span>}
              {!sidebarCollapsed && item.comingSoon && <span className="sidebar-soon-badge">Soon</span>}
              {isActive && <div className="sidebar-item-indicator" />}
            </button>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="sidebar-footer">
        <button className="btn btn-ghost btn-icon btn-sm" onClick={toggleTheme} title={theme === 'dark' ? 'Light mode' : 'Dark mode'}>
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>
    </aside>
  );
}
