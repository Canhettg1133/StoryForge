import React, { useEffect, useState } from 'react';
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
  Sparkles,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  Moon,
  Sun,
  ChevronLeft,
  FlaskConical,
} from 'lucide-react';
import './Sidebar.css';
import ArcNavigator from './ArcNavigator';

const NAV_ITEMS = [
  { path: '/', icon: LayoutDashboard, label: 'Dashboard', id: 'dashboard' },
  { path: '/story-bible', icon: BookOpen, label: 'Story Bible', id: 'story-bible', needsProject: true },
  { path: '/outline', icon: Map, label: 'Outline Board', id: 'outline', needsProject: true },
  { path: '/characters', icon: Users, label: 'Nhân vật', id: 'characters', needsProject: true },
  { path: '/world', icon: Globe, label: 'Thế giới', id: 'world', needsProject: true },
  { divider: true },
  { path: '/editor', icon: PenTool, label: 'Viết truyện', id: 'editor', needsProject: true, primary: true },
  { divider: true },
  { path: '/lab', icon: FlaskConical, label: 'Narrative Lab', id: 'lab', needsProject: true },
  { path: '/corpus-lab', icon: FlaskConical, label: 'Corpus Lab', id: 'corpus-lab', needsProject: true },
  { divider: true },
  { path: '/timeline', icon: Clock, label: 'Timeline', id: 'timeline', needsProject: true, comingSoon: true },
  { path: '/revision', icon: FileSearch, label: 'Revision & QA', id: 'revision', needsProject: true, comingSoon: true },
  { path: '/style-lab', icon: Palette, label: 'Style Lab', id: 'style-lab', needsProject: true, comingSoon: true },
  { divider: true },
  { path: '/story-creation-settings', icon: Sparkles, label: 'Cài đặt khi tạo truyện', id: 'story-creation-settings' },
  { path: '/settings', icon: Settings, label: 'Cài đặt', id: 'settings' },
];

const SIDEBAR_COLLAPSE_QUERY = '(max-width: 1100px)';

export default function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { projectId } = useParams();
  const { sidebarCollapsed, toggleSidebar, theme, toggleTheme } = useUIStore();
  const { currentProject, chapters, activeChapterId } = useProjectStore();
  const [isNarrowViewport, setIsNarrowViewport] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(SIDEBAR_COLLAPSE_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const mediaQuery = window.matchMedia(SIDEBAR_COLLAPSE_QUERY);
    const handleChange = (event) => setIsNarrowViewport(event.matches);

    setIsNarrowViewport(mediaQuery.matches);
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }

    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);

  const activeProjectId = currentProject?.id || projectId;
  const isEditorRoute = location.pathname.includes('/editor');
  const isAutoCollapsed = isEditorRoute || isNarrowViewport;
  const isCollapsed = isAutoCollapsed || sidebarCollapsed;

  const handleNav = (item) => {
    if (item.needsProject && !activeProjectId) return;
    const path = item.needsProject ? `/project/${activeProjectId}${item.path}` : item.path;
    navigate(path);
  };

  return (
    <aside className={`sidebar ${isCollapsed ? 'sidebar--collapsed' : ''} ${isAutoCollapsed ? 'sidebar--auto-collapsed' : ''}`}>
      <div className="sidebar-logo">
        <span className="sidebar-logo-icon" aria-hidden="true">📖</span>
        {!isCollapsed && <span className="sidebar-logo-text">StoryForge</span>}
        {!isAutoCollapsed && (
          <button className="btn btn-ghost btn-icon btn-sm sidebar-toggle" onClick={toggleSidebar} title={isCollapsed ? 'Mở menu' : 'Thu gọn menu'}>
            {isCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        )}
      </div>

      {currentProject && !isCollapsed && (
        <div className="sidebar-project-container">
          <div className="sidebar-project" onClick={() => navigate('/')} role="button" tabIndex={0} onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              navigate('/');
            }
          }}>
            <ChevronLeft size={14} />
            <span style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>{currentProject.title}</span>
          </div>
          <ArcNavigator
            projectId={currentProject.id}
            currentChapter={chapters.findIndex((chapter) => chapter.id === activeChapterId)}
            totalChapters={currentProject.target_length || 0}
            compact={true}
          />
        </div>
      )}

      <nav className="sidebar-nav">
        {NAV_ITEMS.map((item, index) => {
          if (item.divider) {
            return <div key={`div-${index}`} className="sidebar-divider" />;
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
              title={isCollapsed ? (item.comingSoon ? `${item.label} (Soon)` : item.label) : undefined}
            >
              <Icon size={18} />
              {!isCollapsed && <span>{item.label}</span>}
              {!isCollapsed && item.comingSoon && <span className="sidebar-soon-badge">Soon</span>}
              {isActive && <div className="sidebar-item-indicator" />}
            </button>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <button className="btn btn-ghost btn-icon btn-sm" onClick={toggleTheme} title={theme === 'dark' ? 'Light mode' : 'Dark mode'}>
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>
    </aside>
  );
}
