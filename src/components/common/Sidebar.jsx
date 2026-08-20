import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import {
  BookKey,
  BookOpen,
  ChevronLeft,
  Clock,
  Cloud,
  Crown,
  FileJson,
  FileSearch,
  FlaskConical,
  Globe,
  LayoutDashboard,
  Languages,
  Map,
  MessageSquare,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  PenTool,
  Settings,
  Sparkles,
  Users,
} from 'lucide-react';
import { shouldShowNavItem } from '../../config/productSurface';
import { getThemeDefinition } from '../../config/themes.js';
import { prefetchRouteFromPath } from '../../routes/routeModules.js';
import useProjectStore from '../../stores/projectStore';
import useUIStore from '../../stores/uiStore';
import ArcNavigator from './ArcNavigator';
import ThemePicker from './ThemePicker.jsx';
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
  { path: '/style-importer', icon: Sparkles, label: 'Prompt Doctor', id: 'style-importer', needsProject: true, surface: 'core' },
  { path: '/writing-debug', icon: FileJson, label: 'Test prompt viết', id: 'writing-debug', needsProject: true, surface: 'debug' },
  { divider: true },
  { path: '/lab', icon: FlaskConical, label: 'Narrative Lab', id: 'lab', needsProject: true, surface: 'lab' },
  { path: '/lab-lite', icon: BookKey, label: 'Lab Lite', id: 'lab-lite', needsProject: true, surface: 'lab-lite' },
  { path: '/corpus-lab', icon: FlaskConical, label: 'Corpus Lab', id: 'corpus-lab', needsProject: true, surface: 'lab' },
  { divider: true },
  { path: '/timeline', icon: Clock, label: 'Timeline', id: 'timeline', needsProject: true, comingSoon: true, surface: 'roadmap' },
  { path: '/revision', icon: FileSearch, label: 'Revision & QA', id: 'revision', needsProject: true, comingSoon: true, surface: 'roadmap' },
  { path: '/style-lab', icon: Palette, label: 'Style Lab', id: 'style-lab', needsProject: true, comingSoon: true, surface: 'roadmap' },
  { divider: true },
  { path: '/ai-chat', icon: MessageSquare, label: 'Chat tự do', id: 'global-chat', surface: 'core' },
  { path: '/translator', icon: Languages, label: 'Dịch truyện', id: 'translator', surface: 'core' },
  { path: '/prompt-manager', icon: Sparkles, label: 'Prompt tổng quát', id: 'prompt-manager', surface: 'core' },
  { path: '/login', icon: Crown, label: 'Tài khoản & VIP', id: 'account-vip', surface: 'core' },
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
  const { sidebarCollapsed, toggleSidebar, theme } = useUIStore(useShallow((state) => ({
    sidebarCollapsed: state.sidebarCollapsed,
    toggleSidebar: state.toggleSidebar,
    theme: state.theme,
  })));
  const {
    currentProjectId,
    currentProjectTitle,
    currentProjectTargetLength,
    currentChapterIndex,
    hasProjects,
  } = useProjectStore(useShallow((state) => ({
    currentProjectId: state.currentProject?.id || null,
    currentProjectTitle: state.currentProject?.title || '',
    currentProjectTargetLength: state.currentProject?.target_length || 0,
    currentChapterIndex: state.chapters.findIndex((chapter) => chapter.id === state.activeChapterId),
    hasProjects: state.projects.length > 0,
  })));
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const [projectGateItem, setProjectGateItem] = useState(null);
  const themeTriggerRef = useRef(null);
  const themePopoverRef = useRef(null);
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

  useEffect(() => {
    if (!themeMenuOpen) return undefined;

    const handlePointerDown = (event) => {
      if (themeTriggerRef.current?.contains(event.target)) return;
      if (themePopoverRef.current?.contains(event.target)) return;
      setThemeMenuOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      setThemeMenuOpen(false);
      themeTriggerRef.current?.focus();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [themeMenuOpen]);

  const routeProjectId = projectId || null;
  const appScopedProjectId = ['/settings', '/login'].includes(location.pathname) ? currentProjectId : null;
  const activeProjectId = routeProjectId || appScopedProjectId;
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
  const visibleNavItems = baseVisibleNavItems;
  const isAutoCollapsed = isNarrowViewport;
  const isCollapsed = isAutoCollapsed || sidebarCollapsed;
  const activeTheme = getThemeDefinition(theme);
  const firstProjectItemId = visibleNavItems.find((item) => item.needsProject)?.id;

  const handleNav = (item) => {
    if (item.needsProject && !activeProjectId) {
      setProjectGateItem(item);
      return;
    }
    setProjectGateItem(null);
    const path = getNavPath(item, activeProjectId);
    navigate(
      path,
      item.id === 'cloud-sync'
        ? { state: { returnTo: `${location.pathname}${location.search}${location.hash}` } }
        : undefined,
    );
  };

  const handleRouteIntent = (item) => {
    if (item.comingSoon || (item.needsProject && !activeProjectId)) return;
    void prefetchRouteFromPath(getNavPath(item, activeProjectId));
  };

  const handleProjectGateAction = () => {
    setProjectGateItem(null);
    navigate(
      hasProjects ? '/#projects' : '/',
      hasProjects ? undefined : { state: { openNewProject: true } },
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

      {routeProjectId && currentProjectId && !isCollapsed && (
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
            <span style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>{currentProjectTitle}</span>
          </div>
          <ArcNavigator
            projectId={currentProjectId}
            currentChapter={currentChapterIndex}
            totalChapters={currentProjectTargetLength}
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
          const showProjectContext = isDisabled && item.id === firstProjectItemId && !isCollapsed;
          const Icon = item.icon;

          return (
            <React.Fragment key={item.id}>
              {showProjectContext && (
                <p className="sidebar-project-context">
                  {hasProjects
                    ? 'Chọn một truyện để sử dụng các mục này.'
                    : 'Tạo một truyện để sử dụng các mục này.'}
                </p>
              )}
              <button
                className={`sidebar-item ${isActive ? 'sidebar-item--active' : ''} ${isDisabled ? 'sidebar-item--disabled' : ''} ${item.primary && !isDisabled ? 'sidebar-item--primary' : ''} ${isComingSoon ? 'sidebar-item--coming-soon' : ''}`}
                onClick={() => handleNav(item)}
                onPointerEnter={() => handleRouteIntent(item)}
                onFocus={() => handleRouteIntent(item)}
                onPointerDown={(event) => {
                  if (event.pointerType !== 'mouse') handleRouteIntent(item);
                }}
                aria-disabled={isDisabled || undefined}
                title={isDisabled
                  ? `${hasProjects ? 'Chọn một truyện' : 'Tạo một truyện'} để sử dụng ${item.label}`
                  : isCollapsed
                    ? (item.comingSoon ? `${item.label} (Sắp có)` : item.label)
                    : undefined}
              >
                <Icon size={18} />
                {!isCollapsed && <span>{item.label}</span>}
                {!isCollapsed && item.comingSoon && <span className="sidebar-soon-badge">Sắp có</span>}
                {isActive && <div className="sidebar-item-indicator" />}
              </button>
            </React.Fragment>
          );
        })}
      </nav>

      {projectGateItem && (
        <div
          id="sidebar-project-gate"
          className={`sidebar-project-gate ${isCollapsed ? 'sidebar-project-gate--collapsed' : ''}`}
          role="status"
        >
          <div className="sidebar-project-gate__heading">
            <strong>{hasProjects ? 'Chưa chọn truyện' : 'Chưa có truyện'}</strong>
          </div>
          <p>
            {hasProjects
              ? `Hãy chọn một truyện để sử dụng mục ${projectGateItem.label}.`
              : `Mục ${projectGateItem.label} dùng bên trong một truyện. Hãy tạo truyện trước.`}
          </p>
          <div className="sidebar-project-gate__actions">
            <button type="button" className="btn btn-primary btn-xs" onClick={handleProjectGateAction}>
              {hasProjects ? 'Chọn truyện' : 'Tạo truyện mới'}
            </button>
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => setProjectGateItem(null)}>
              Đóng
            </button>
          </div>
        </div>
      )}

      <div className="sidebar-footer">
        <button
          ref={themeTriggerRef}
          type="button"
          className={`sidebar-theme-trigger ${isCollapsed ? 'sidebar-theme-trigger--collapsed' : ''}`}
          onClick={() => setThemeMenuOpen((open) => !open)}
          title={isCollapsed ? `Giao diện: ${activeTheme.shortLabel}` : undefined}
          aria-label={`Giao diện hiện tại: ${activeTheme.label}`}
          aria-expanded={themeMenuOpen}
          aria-controls="sidebar-theme-popover"
        >
          <Palette size={17} aria-hidden="true" />
          {!isCollapsed ? (
            <span className="sidebar-theme-trigger__copy">
              <span>Giao diện</span>
              <small>{activeTheme.shortLabel}</small>
            </span>
          ) : null}
        </button>
      </div>

      {themeMenuOpen ? (
        <div
          ref={themePopoverRef}
          className={`sidebar-theme-popover ${isCollapsed ? 'sidebar-theme-popover--collapsed' : ''}`}
          id="sidebar-theme-popover"
          role="dialog"
          aria-label="Chọn giao diện StoryForge"
        >
          <div className="sidebar-theme-popover__header">
            <strong>Giao diện</strong>
            <span>{activeTheme.shortLabel}</span>
          </div>
          <ThemePicker
            variant="sidebar"
            onSelect={() => {
              setThemeMenuOpen(false);
              themeTriggerRef.current?.focus();
            }}
          />
        </div>
      ) : null}
    </aside>
  );
}
