import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  BookKey,
  BookOpen,
  ChevronLeft,
  Clock,
  Cloud,
  FileSearch,
  FlaskConical,
  Globe,
  LayoutDashboard,
  Languages,
  Map,
  MessageSquare,
  Moon,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  PenTool,
  Settings,
  Sparkles,
  Sun,
  Users,
} from 'lucide-react';
import { shouldShowNavItem } from '../../config/productSurface';
import useProjectStore from '../../stores/projectStore';
import useUIStore from '../../stores/uiStore';
import ArcNavigator from './ArcNavigator';
import './Sidebar.css';

const RAW_NAV_ITEMS = [
  { path: '/', icon: LayoutDashboard, label: 'Dashboard', id: 'dashboard', surface: 'core' },
  { path: '/story-bible', icon: BookOpen, label: 'Sổ tay truyện', id: 'story-bible', needsProject: true, surface: 'core' },
  { path: '/su-that', icon: BookKey, label: 'Sự thật', id: 'su-that', needsProject: true, surface: 'core' },
  { path: '/outline', icon: Map, label: 'Bảng dàn ý', id: 'outline', needsProject: true, surface: 'core' },
  { path: '/characters', icon: Users, label: 'Nhân vật', id: 'characters', needsProject: true, surface: 'core' },
  { path: '/world', icon: Globe, label: 'Thế giới', id: 'world', needsProject: true, surface: 'core' },
  { divider: true },
  { path: '/editor', icon: PenTool, label: 'Viết truyện', id: 'editor', needsProject: true, primary: true, surface: 'core' },
  { path: '/chat', icon: MessageSquare, label: 'Chat AI', id: 'project-chat', needsProject: true, surface: 'core' },
  { path: '/prompts', icon: Sparkles, label: 'Prompt truyện', id: 'project-prompts', needsProject: true, surface: 'core' },
  { divider: true },
  { path: '/lab', icon: FlaskConical, label: 'Narrative Lab', id: 'lab', needsProject: true, surface: 'lab' },
  { path: '/corpus-lab', icon: FlaskConical, label: 'Corpus Lab', id: 'corpus-lab', needsProject: true, surface: 'lab' },
  { divider: true },
  { path: '/timeline', icon: Clock, label: 'Timeline', id: 'timeline', needsProject: true, comingSoon: true, surface: 'roadmap' },
  { path: '/revision', icon: FileSearch, label: 'Revision & QA', id: 'revision', needsProject: true, comingSoon: true, surface: 'roadmap' },
  { path: '/style-lab', icon: Palette, label: 'Style Lab', id: 'style-lab', needsProject: true, comingSoon: true, surface: 'roadmap' },
  { divider: true },
  { path: '/ai-chat', icon: MessageSquare, label: 'Chat tự do', id: 'global-chat', surface: 'core' },
  { path: '/translator', icon: Languages, label: 'Dịch truyện', id: 'translator', surface: 'core' },
  { path: '/prompt-manager', icon: Sparkles, label: 'Prompt tổng quát', id: 'prompt-manager', surface: 'core' },
  { path: '/settings', icon: Settings, label: 'Cài đặt', id: 'settings', surface: 'core' },
];

const cloudSyncInsertIndex = RAW_NAV_ITEMS.findIndex((item) => item.id === 'settings');
if (cloudSyncInsertIndex >= 0) {
  RAW_NAV_ITEMS.splice(cloudSyncInsertIndex, 0, {
    path: '/cloud-sync',
    icon: Cloud,
    label: 'Cloud Sync',
    id: 'cloud-sync',
    surface: 'core',
  });
}

const NAV_ITEMS = RAW_NAV_ITEMS.filter((item, index, items) => {
  if (item.divider) {
    const prev = items[index - 1];
    const next = items[index + 1];
    return shouldShowNavItem(prev || {}) && shouldShowNavItem(next || {});
  }

  return shouldShowNavItem(item);
});

const SIDEBAR_COLLAPSE_QUERY = '(max-width: 1100px)';

function getNavPath(item, activeProjectId) {
  if (item.id === 'translator') {
    return '/translator';
  }

  if (item.id === 'settings' && activeProjectId) {
    return `/project/${activeProjectId}/settings`;
  }

  if (item.id === 'prompt-manager' && activeProjectId) {
    return `/project/${activeProjectId}/prompt-manager`;
  }

  if (item.id === 'cloud-sync' && activeProjectId) {
    return `/project/${activeProjectId}/cloud-sync`;
  }

  if (item.needsProject && activeProjectId) {
    return `/project/${activeProjectId}${item.path}`;
  }

  return item.path;
}

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

  const routeProjectId = projectId || null;
  const settingsScopedProjectId = location.pathname === '/settings' ? currentProject?.id || null : null;
  const activeProjectId = routeProjectId || settingsScopedProjectId;
  const baseVisibleNavItems = NAV_ITEMS.filter((item) => {
    if (item.divider) return true;
    if (item.id === 'global-chat') return !activeProjectId;
    if (item.id === 'project-chat') return !!activeProjectId;
    return true;
  }).filter((item, index, items) => {
    if (!item.divider) return true;
    const prev = items[index - 1];
    const next = items[index + 1];
    return !!prev && !!next && !prev.divider && !next.divider;
  });
  const visibleNavItems = (() => {
    if (!activeProjectId) return baseVisibleNavItems;

    const items = [...baseVisibleNavItems];
    const globalPromptIndex = items.findIndex((item) => item.id === 'prompt-manager');
    const projectPromptIndex = items.findIndex((item) => item.id === 'project-prompts');

    if (globalPromptIndex === -1 || projectPromptIndex === -1 || globalPromptIndex === projectPromptIndex + 1) {
      return items;
    }

    const [globalPromptItem] = items.splice(globalPromptIndex, 1);
    items.splice(projectPromptIndex + 1, 0, globalPromptItem);
    return items;
  })();
  const isAutoCollapsed = isNarrowViewport;
  const isCollapsed = isAutoCollapsed || sidebarCollapsed;

  const handleNav = (item) => {
    if (item.needsProject && !activeProjectId) return;
    const path = getNavPath(item, activeProjectId);
    navigate(
      path,
      item.id === 'cloud-sync'
        ? { state: { returnTo: `${location.pathname}${location.search}${location.hash}` } }
        : undefined,
    );
  };

  return (
    <aside className={`sidebar ${isCollapsed ? 'sidebar--collapsed' : ''} ${isAutoCollapsed ? 'sidebar--auto-collapsed' : ''}`}>
      <div className="sidebar-logo">
        <span className="sidebar-logo-icon" aria-hidden="true">SF</span>
        {!isCollapsed && <span className="sidebar-logo-text">StoryForge</span>}
        {!isAutoCollapsed && (
          <button className="btn btn-ghost btn-icon btn-sm sidebar-toggle" onClick={toggleSidebar} title={isCollapsed ? 'Mở menu' : 'Thu gọn menu'}>
            {isCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        )}
      </div>

      {routeProjectId && currentProject && !isCollapsed && (
        <div className="sidebar-project-container">
          <div
            className="sidebar-project"
            onClick={() => navigate('/')}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                navigate('/');
              }
            }}
          >
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
        {visibleNavItems.map((item, index) => {
          if (item.divider) {
            return <div key={`div-${index}`} className="sidebar-divider" />;
          }

          const expectedPath = getNavPath(item, activeProjectId);
          const isActive = location.pathname === expectedPath
            || (item.path !== '/' && item.path !== '/settings' && location.pathname.startsWith(expectedPath));
          const isDisabled = item.needsProject && !activeProjectId;
          const isComingSoon = item.comingSoon && !isActive;
          const Icon = item.icon;

          return (
            <button
              key={item.id}
              className={`sidebar-item ${isActive ? 'sidebar-item--active' : ''} ${isDisabled ? 'sidebar-item--disabled' : ''} ${item.primary ? 'sidebar-item--primary' : ''} ${isComingSoon ? 'sidebar-item--coming-soon' : ''}`}
              onClick={() => handleNav(item)}
              title={isCollapsed ? (item.comingSoon ? `${item.label} (Sắp có)` : item.label) : undefined}
            >
              <Icon size={18} />
              {!isCollapsed && <span>{item.label}</span>}
              {!isCollapsed && item.comingSoon && <span className="sidebar-soon-badge">Sắp có</span>}
              {isActive && <div className="sidebar-item-indicator" />}
            </button>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <button className="btn btn-ghost btn-icon btn-sm" onClick={toggleTheme} title={theme === 'dark' ? 'Chuyển sang sáng' : 'Chuyển sang tối'}>
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>
    </aside>
  );
}
