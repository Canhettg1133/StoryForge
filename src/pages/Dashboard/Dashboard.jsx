import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import useProjectStore from '../../stores/projectStore';
import useMobileLayout from '../../hooks/useMobileLayout';
import { shouldShowNavItem } from '../../config/productSurface';
import { getGenreEmoji, getGenreLabel, formatDate } from '../../utils/constants';
import {
  Plus,
  BookKey,
  BookOpen,
  Trash2,
  MoreVertical,
  Download,
  Clock,
  Cloud,
  FileSearch,
  FlaskConical,
  Globe,
  LayoutDashboard,
  Languages,
  Map,
  MessageSquare,
  Menu,
  Palette,
  PenTool,
  Sparkles,
  Settings,
  Users,
} from 'lucide-react';
import NewProjectModal from './NewProjectModal';
import ExportModal from '../../components/common/ExportModal';
import MobileSheet from '../../components/mobile/MobileSheet';
import './Dashboard.css';

const UTILITY_ITEMS = [
  {
    id: 'global-chat',
    title: 'Chat tự do',
    description: 'Hỏi AI, brainstorm hoặc làm nhanh mà không cần mở dự án.',
    icon: MessageSquare,
    path: '/ai-chat',
  },
  {
    id: 'translator',
    title: 'Dịch truyện',
    description: 'Công cụ dịch độc lập, không tạo project mới và không chen vào danh sách truyện.',
    icon: Languages,
    path: '/translator',
  },
  {
    id: 'settings',
    title: 'Thiết lập API',
    description: 'Vào Cài đặt để xem hướng dẫn Gemini, dán API key và test ngay trong cùng một chỗ.',
    icon: BookKey,
    path: '/settings#gemini-guides',
  },
];

UTILITY_ITEMS.splice(2, 0, {
  id: 'cloud-sync',
  title: 'Cloud Sync',
  description: 'Sao lưu dự án, chat và prompt lên cloud trên một trang riêng.',
  icon: Cloud,
  path: '/cloud-sync',
});

const VISIBLE_UTILITY_ITEMS = UTILITY_ITEMS.filter(shouldShowNavItem);
const FULL_MOBILE_DRAWER_ITEMS = [
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
  { divider: true },
  { id: 'lab', title: 'Narrative Lab', icon: FlaskConical, path: '/lab', needsProject: true, surface: 'lab' },
  { id: 'corpus-lab', title: 'Corpus Lab', icon: FlaskConical, path: '/corpus-lab', needsProject: true, surface: 'lab' },
  { divider: true },
  { id: 'timeline', title: 'Timeline', icon: Clock, path: '/timeline', needsProject: true, comingSoon: true, surface: 'roadmap' },
  { id: 'revision', title: 'Revision & QA', icon: FileSearch, path: '/revision', needsProject: true, comingSoon: true, surface: 'roadmap' },
  { id: 'style-lab', title: 'Style Lab', icon: Palette, path: '/style-lab', needsProject: true, comingSoon: true, surface: 'roadmap' },
  { divider: true },
  { id: 'global-chat', title: 'Chat tự do', icon: MessageSquare, path: '/ai-chat', surface: 'core' },
  { id: 'translator', title: 'Dịch truyện', icon: Languages, path: '/translator', surface: 'core' },
  { id: 'prompt-manager', title: 'Prompt tổng quát', icon: Sparkles, path: '/prompt-manager', surface: 'core' },
  { id: 'cloud-sync', title: 'Cloud Sync', icon: Cloud, path: '/cloud-sync', surface: 'core' },
  { id: 'settings', title: 'Cài đặt', icon: Settings, path: '/settings', surface: 'core' },
];

const VISIBLE_MOBILE_DRAWER_ITEMS = FULL_MOBILE_DRAWER_ITEMS.filter((item, index, items) => {
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
const COMPACT_MOBILE_DRAWER_ITEMS = VISIBLE_MOBILE_DRAWER_ITEMS.filter((item) => !item.divider);

function getMobileDrawerPath(item, activeProjectId) {
  if (item.id === 'translator') return '/translator';
  if (item.id === 'settings' && activeProjectId) return `/project/${activeProjectId}/settings`;
  if (item.id === 'prompt-manager' && activeProjectId) return `/project/${activeProjectId}/prompt-manager`;
  if (item.id === 'cloud-sync' && activeProjectId) return `/project/${activeProjectId}/cloud-sync`;
  if (item.needsProject && activeProjectId) return `/project/${activeProjectId}${item.path}`;
  return item.path;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const { projects, loadProjects, loadProject, deleteProject } = useProjectStore();
  const isMobileLayout = useMobileLayout(900);
  const [showModal, setShowModal] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const [exportingProject, setExportingProject] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const activeProjectId = null;

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const handleOpenProject = async (id) => {
    await loadProject(id);
    navigate(`/project/${id}/editor`);
  };

  const handleDeleteProject = async (id, event) => {
    event.stopPropagation();
    if (window.confirm('Bạn chắc chắn muốn xóa dự án này? Tất cả dữ liệu sẽ bị mất.')) {
      await deleteProject(id);
    }
    setContextMenu(null);
  };

  const handleProjectCreated = async (id) => {
    setShowModal(false);
    await loadProject(id);
    navigate(`/project/${id}/editor`);
  };

  const filteredProjects = projects.filter((project) => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return true;
    return [project.title, project.description, getGenreLabel(project.genre_primary)]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(query);
  });

  const handleUtilityNavigate = (path, options = {}) => {
    if (options.fullReload) {
      window.location.assign(new URL(path, window.location.origin).href);
      return;
    }

    navigate(path, options.state ? { state: options.state } : undefined);
  };

  const handleMobileDrawerNavigate = (item) => {
    if (item.needsProject && !activeProjectId) return;

    handleUtilityNavigate(
      getMobileDrawerPath(item, activeProjectId),
      item.id === 'cloud-sync'
        ? { state: { returnTo: `${location.pathname}${location.search}${location.hash}` } }
        : {},
    );
    setMobileMenuOpen(false);
  };

  return (
    <div className="dashboard">
      <header className="dashboard-header animate-fade-in">
        <div className="dashboard-header__top">
          <h1 className="dashboard-title">
            <span className="dashboard-title-icon">SF</span>
            StoryForge
          </h1>
          {isMobileLayout ? (
            <button
              type="button"
              className="dashboard-mobile-menu-button btn btn-ghost"
              onClick={() => setMobileMenuOpen(true)}
              aria-expanded={mobileMenuOpen}
              aria-label="Mở menu điều hướng"
            >
              <Menu size={18} />
              <span>Menu</span>
            </button>
          ) : null}
        </div>
        <div>
          <p className="dashboard-subtitle">
            Tạo dự án để bắt đầu viết truyện, hoặc dùng nhanh Chat AI, Dịch truyện và phần thiết lập API khi chưa cần mở project.
          </p>
        </div>
      </header>

      <div className="dashboard-mobile-search">
        <input
          className="input"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Tìm truyện..."
        />
      </div>

      <div className="dashboard-content">
        <section className="dashboard-tools card animate-slide-up">
          <div className="dashboard-tools__grid">
            {VISIBLE_UTILITY_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  className="dashboard-tool-card"
                  onClick={() => handleUtilityNavigate(
                    item.path,
                    item.id === 'cloud-sync'
                      ? { state: { returnTo: `${location.pathname}${location.search}${location.hash}` } }
                      : {},
                  )}
                >
                  <div className="dashboard-tool-card__icon">
                    <Icon size={22} />
                  </div>
                  <div className="dashboard-tool-card__content">
                    <div className="dashboard-tool-card__title-row">
                      <strong>{item.title}</strong>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="dashboard-projects">
          <div className="dashboard-projects__header">
            <div>
              <h2>Dự án truyện</h2>
              <p>Nhấn tạo truyện mới ở thẻ đầu tiên bên dưới để bắt đầu viết, hoặc mở một dự án đang viết để tiếp tục.</p>
            </div>
          </div>

          <div className="project-grid">
            <button className="new-project-card animate-slide-up" onClick={() => setShowModal(true)}>
              <div className="new-project-icon">
                <Plus size={32} />
              </div>
              <div className="new-project-card__content">
                <span className="new-project-label">Tạo truyện mới</span>
                <span className="new-project-hint">Tạo một dự án mới để vào editor, viết truyện, lên dàn ý và quản lý canon.</span>
              </div>
            </button>

            {filteredProjects.map((project, index) => (
              <div
                key={project.id}
                className="project-card card-glass animate-slide-up"
                style={{ animationDelay: `${(index + 1) * 60}ms` }}
                onClick={() => handleOpenProject(project.id)}
              >
                <div className="project-card-header">
                  <span className="project-genre-emoji">{getGenreEmoji(project.genre_primary)}</span>
                  <button
                    className="btn btn-ghost btn-icon btn-sm project-card-menu"
                    onClick={(event) => {
                      event.stopPropagation();
                      setContextMenu(contextMenu === project.id ? null : project.id);
                    }}
                  >
                    <MoreVertical size={14} />
                  </button>
                  {contextMenu === project.id && (
                    <div className="context-menu project-context-menu">
                      <button
                        className="context-menu-item"
                        onClick={(event) => {
                          event.stopPropagation();
                          setContextMenu(null);
                          setExportingProject(project);
                        }}
                      >
                        <Download size={14} /> Xuất bản truyện
                      </button>
                      <button
                        className="context-menu-item danger"
                        onClick={(event) => handleDeleteProject(project.id, event)}
                      >
                        <Trash2 size={14} /> Xóa dự án
                      </button>
                    </div>
                  )}
                </div>

                <h3 className="project-card-title">{project.title}</h3>

                <div className="project-card-meta">
                  <span className="badge badge-accent">{getGenreLabel(project.genre_primary)}</span>
                </div>

                {project.description && <p className="project-card-desc">{project.description}</p>}

                <div className="project-card-footer">
                  <span className="project-card-date">{formatDate(project.updated_at)}</span>
                </div>
              </div>
            ))}
          </div>

          {projects.length === 0 && (
            <div className="empty-state animate-fade-in">
              <BookOpen size={48} />
              <h3>Chưa có dự án nào</h3>
              <p>Bắt đầu hành trình sáng tác bằng cách tạo truyện mới bên dưới, hoặc thử các công cụ nhanh ở phía trên.</p>
              <button className="btn btn-primary btn-lg" onClick={() => setShowModal(true)}>
                <Plus size={18} /> Tạo truyện mới
              </button>
            </div>
          )}
        </section>
      </div>

      <button className="dashboard-mobile-cta btn btn-primary" onClick={() => setShowModal(true)}>
        <Plus size={18} /> Tạo truyện
      </button>

      <MobileSheet
        open={mobileMenuOpen}
        title="Menu"
        kicker="StoryForge"
        size="full"
        onClose={() => setMobileMenuOpen(false)}
      >
        <div className="dashboard-mobile-menu-list">
          {COMPACT_MOBILE_DRAWER_ITEMS.map((item) => {
            const Icon = item.icon;
            const targetPath = getMobileDrawerPath(item, activeProjectId);
            const active = location.pathname === targetPath;
            const disabled = item.needsProject && !activeProjectId;
            return (
              <button
                key={item.id}
                type="button"
                className={`dashboard-mobile-menu-item ${active ? 'dashboard-mobile-menu-item--active' : ''} ${disabled ? 'dashboard-mobile-menu-item--disabled' : ''}`}
                onClick={() => handleMobileDrawerNavigate(item)}
                disabled={disabled}
                title={disabled ? 'Cần mở một project trước' : undefined}
              >
                <Icon size={18} />
                <span>{item.title}</span>
                {item.comingSoon ? <span className="dashboard-mobile-menu-badge">Soon</span> : null}
              </button>
            );
          })}
        </div>
      </MobileSheet>

      {showModal && (
        <NewProjectModal
          onClose={() => setShowModal(false)}
          onCreated={handleProjectCreated}
        />
      )}

      {exportingProject && (
        <ExportModal
          project={exportingProject}
          onClose={() => setExportingProject(null)}
        />
      )}
    </div>
  );
}
