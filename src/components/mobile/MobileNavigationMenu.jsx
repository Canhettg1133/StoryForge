import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  BookKey,
  BookOpen,
  Clock,
  Cloud,
  Crown,
  FileJson,
  FileSearch,
  FlaskConical,
  Globe,
  Languages,
  LayoutDashboard,
  Map,
  MessageSquare,
  Palette,
  PenTool,
  Settings,
  Sparkles,
  Users,
} from 'lucide-react';
import { shouldShowNavItem } from '../../config/productSurface';
import './MobileNavigationMenu.css';

export const FULL_MOBILE_DRAWER_ITEMS = [
  { id: 'dashboard', title: 'Dashboard', icon: LayoutDashboard, path: '/', surface: 'core' },
  { id: 'story-bible', title: 'Sổ tay truyện', icon: BookOpen, path: '/story-bible', needsProject: true, surface: 'core' },
  { id: 'su-that', title: 'Sự thật', icon: BookKey, path: '/su-that', needsProject: true, surface: 'core' },
  { id: 'outline', title: 'Bảng dàn ý', icon: Map, path: '/outline', needsProject: true, surface: 'core' },
  { id: 'characters', title: 'Nhân vật', icon: Users, path: '/characters', needsProject: true, surface: 'core' },
  { id: 'world', title: 'Thế giới', icon: Globe, path: '/world', needsProject: true, surface: 'core' },
  { divider: true },
  { id: 'editor', title: 'Viết truyện', icon: PenTool, path: '/editor', needsProject: true, surface: 'core' },
  { id: 'project-chat', title: 'Chat AI', icon: MessageSquare, path: '/chat', needsProject: true, surface: 'core' },
  { id: 'project-prompts', title: 'Prompt truyện', icon: Sparkles, path: '/prompts', needsProject: true, surface: 'core' },
  { id: 'style-importer', title: 'Prompt Doctor', icon: Sparkles, path: '/style-importer', needsProject: true, surface: 'core' },
  { id: 'writing-debug', title: 'Test prompt viết', icon: FileJson, path: '/writing-debug', needsProject: true, surface: 'debug' },
  { divider: true },
  { id: 'lab', title: 'Narrative Lab', icon: FlaskConical, path: '/lab', needsProject: true, surface: 'lab' },
  { id: 'lab-lite', title: 'Lab Lite', icon: BookKey, path: '/lab-lite', needsProject: true, surface: 'lab-lite' },
  { id: 'corpus-lab', title: 'Corpus Lab', icon: FlaskConical, path: '/corpus-lab', needsProject: true, surface: 'lab' },
  { divider: true },
  { id: 'timeline', title: 'Timeline', icon: Clock, path: '/timeline', needsProject: true, comingSoon: true, surface: 'roadmap' },
  { id: 'revision', title: 'Revision & QA', icon: FileSearch, path: '/revision', needsProject: true, comingSoon: true, surface: 'roadmap' },
  { id: 'style-lab', title: 'Style Lab', icon: Palette, path: '/style-lab', needsProject: true, comingSoon: true, surface: 'roadmap' },
  { divider: true },
  { id: 'global-chat', title: 'Chat tự do', icon: MessageSquare, path: '/ai-chat', surface: 'core' },
  { id: 'translator', title: 'Dịch truyện', icon: Languages, path: '/translator', surface: 'core' },
  { id: 'prompt-manager', title: 'Prompt tổng quát', icon: Sparkles, path: '/prompt-manager', surface: 'core' },
  { id: 'account-vip', title: 'Tài khoản & VIP', icon: Crown, path: '/login', surface: 'core' },
  { id: 'cloud-sync', title: 'Cloud Sync', icon: Cloud, path: '/cloud-sync', surface: 'core' },
  { id: 'settings', title: 'Cài đặt', icon: Settings, path: '/settings', surface: 'core' },
];

export const VISIBLE_MOBILE_DRAWER_ITEMS = FULL_MOBILE_DRAWER_ITEMS.filter((item, index, items) => {
  if (item.divider) {
    const prev = items[index - 1];
    const next = items[index + 1];
    return shouldShowNavItem(prev || {}) && shouldShowNavItem(next || {});
  }

  return shouldShowNavItem(item);
}).filter((item, index, items) => {
  if (!item.divider) return true;
  const prev = items[index - 1];
  const next = items[index + 1];
  return !!prev && !!next && !prev.divider && !next.divider;
});

export const COMPACT_MOBILE_DRAWER_ITEMS = VISIBLE_MOBILE_DRAWER_ITEMS.filter((item) => !item.divider);

export function getMobileDrawerPath(item, activeProjectId) {
  if (item.id === 'translator') return '/translator';
  if (item.id === 'settings' && activeProjectId) return `/project/${activeProjectId}/settings`;
  if (item.id === 'prompt-manager' && activeProjectId) return `/project/${activeProjectId}/prompt-manager`;
  if (item.id === 'cloud-sync' && activeProjectId) return `/project/${activeProjectId}/cloud-sync`;
  if (item.needsProject && activeProjectId) return `/project/${activeProjectId}${item.path}`;
  return item.path;
}

export default function MobileNavigationMenu({
  activeProjectId = null,
  hasProjects = false,
  onCreateProject,
  onChooseProject,
  onNavigate,
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [projectGateItem, setProjectGateItem] = useState(null);
  const firstProjectItemId = COMPACT_MOBILE_DRAWER_ITEMS.find((item) => item.needsProject)?.id;

  const handleNavigate = (item) => {
    if (item.needsProject && !activeProjectId) {
      setProjectGateItem(item);
      return;
    }

    setProjectGateItem(null);
    const targetPath = getMobileDrawerPath(item, activeProjectId);
    navigate(
      targetPath,
      item.id === 'cloud-sync'
        ? { state: { returnTo: `${location.pathname}${location.search}${location.hash}` } }
        : undefined,
    );
    onNavigate?.(item, targetPath);
  };

  const handleProjectGateAction = () => {
    setProjectGateItem(null);
    if (hasProjects) {
      if (onChooseProject) onChooseProject();
      else navigate('/#projects');
      return;
    }
    if (onCreateProject) onCreateProject();
    else navigate('/', { state: { openNewProject: true } });
  };

  return (
    <div className="dashboard-mobile-menu-list">
      {projectGateItem && (
        <div className="dashboard-mobile-project-gate" role="status">
          <div className="dashboard-mobile-project-gate__heading">
            <strong>{hasProjects ? 'Chưa chọn truyện' : 'Chưa có truyện'}</strong>
          </div>
          <p>
            {hasProjects
              ? `Hãy chọn một truyện để sử dụng mục ${projectGateItem.title}.`
              : `Mục ${projectGateItem.title} dùng bên trong một truyện. Hãy tạo truyện trước.`}
          </p>
          <div className="dashboard-mobile-project-gate__actions">
            <button type="button" className="btn btn-primary btn-sm" onClick={handleProjectGateAction}>
              {hasProjects ? 'Chọn truyện' : 'Tạo truyện mới'}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setProjectGateItem(null)}>
              Đóng
            </button>
          </div>
        </div>
      )}
      {COMPACT_MOBILE_DRAWER_ITEMS.map((item) => {
        const Icon = item.icon;
        const targetPath = getMobileDrawerPath(item, activeProjectId);
        const active = location.pathname === targetPath
          || (targetPath !== '/' && location.pathname.startsWith(targetPath));
        const disabled = item.needsProject && !activeProjectId;
        const showProjectContext = disabled && item.id === firstProjectItemId;

        return (
          <React.Fragment key={item.id}>
            {showProjectContext && (
              <p className="dashboard-mobile-project-context">
                {hasProjects
                  ? 'Chọn một truyện để sử dụng các mục này.'
                  : 'Tạo một truyện để sử dụng các mục này.'}
              </p>
            )}
            <button
              type="button"
              data-nav-id={item.id}
              className={`dashboard-mobile-menu-item ${active ? 'dashboard-mobile-menu-item--active' : ''} ${disabled ? 'dashboard-mobile-menu-item--disabled' : ''}`}
              onClick={() => handleNavigate(item)}
              aria-disabled={disabled || undefined}
              title={disabled
                ? `${hasProjects ? 'Chọn một truyện' : 'Tạo một truyện'} để sử dụng ${item.title}`
                : undefined}
            >
              <Icon size={18} />
              <span>{item.title}</span>
              {item.comingSoon ? <span className="dashboard-mobile-menu-badge">Soon</span> : null}
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
}
