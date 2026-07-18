import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import useProjectStore from '../../stores/projectStore';
import useMobileLayout from '../../hooks/useMobileLayout';
import { PRODUCT_SURFACE, shouldShowNavItem } from '../../config/productSurface';
import { getGenreEmoji, getGenreLabel, formatDate } from '../../utils/constants';
import {
  Plus,
  BookKey,
  BookOpen,
  Trash2,
  MoreVertical,
  Download,
  Cloud,
  HeartHandshake,
  Image as ImageIcon,
  Languages,
  FileJson,
  MessageSquare,
  Menu,
  Palette,
  ArchiveRestore,
  PackageOpen,
} from 'lucide-react';
import NewProjectModal from './NewProjectModal';
import ExportModal from '../../components/common/ExportModal';
import ThemePicker from '../../components/common/ThemePicker.jsx';
import MobileSheet from '../../components/mobile/MobileSheet';
import MobileNavigationMenu from '../../components/mobile/MobileNavigationMenu.jsx';
import SupportDonateModal from '../../components/support/SupportDonateModal.jsx';
import StoryBundleModal from '../../components/storyBundle/StoryBundleModal.jsx';
import { getActiveProjectCoversForProjects } from '../../services/projectCovers/coverRepository.js';
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
    id: 'lab-lite',
    title: 'Lab Lite',
    description: 'Nạp dữ liệu fanfic và tạo Canon Pack để liên kết với dự án.',
    icon: BookOpen,
    path: '/lab-lite',
    surface: 'lab-lite',
  },
  {
    id: 'settings',
    title: 'Thiết lập API',
    description: 'Vào Cài đặt để xem hướng dẫn Gemini, dán API key và test ngay trong cùng một chỗ.',
    icon: BookKey,
    path: '/settings#gemini-guides',
  },
  {
    id: 'writing-debug',
    title: 'Test prompt viết',
    description: 'Kiểm tra prompt viết trong chế độ debug nội bộ.',
    icon: FileJson,
    path: '/writing-debug',
    surface: 'debug',
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
  const [mobileThemeOpen, setMobileThemeOpen] = useState(false);
  const [donateOpen, setDonateOpen] = useState(false);
  const [coverByProjectId, setCoverByProjectId] = useState({});
  const [bundleExportProject, setBundleExportProject] = useState(null);
  const [bundleImportOpen, setBundleImportOpen] = useState(false);
  const activeProjectId = null;

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    if (!PRODUCT_SURFACE.enableStoryBundle || !location.state?.openStoryBundleImport) return;
    setBundleImportOpen(true);
    navigate(`${location.pathname}${location.search}${location.hash}`, { replace: true, state: null });
  }, [location.hash, location.pathname, location.search, location.state, navigate]);

  useEffect(() => {
    let alive = true;
    const projectsNeedingCoverFallback = projects.filter((project) => (
      Number(project.cover_asset_id || 0) > 0
      && !String(project.cover_thumbnail_data_url || '').trim()
    ));
    if (projectsNeedingCoverFallback.length === 0) {
      setCoverByProjectId({});
      return () => {
        alive = false;
      };
    }

    getActiveProjectCoversForProjects(projectsNeedingCoverFallback)
      .then((covers) => {
        if (alive) setCoverByProjectId(covers);
      })
      .catch(() => {
        if (alive) setCoverByProjectId({});
      });

    return () => {
      alive = false;
    };
  }, [projects]);

  const handleOpenProject = async (id) => {
    await loadProject(id);
    navigate(`/project/${id}/editor`);
  };

  const handleAddCover = async (id, event) => {
    event.stopPropagation();
    await loadProject(id);
    navigate(`/project/${id}/story-bible?focus=cover`);
  };

  const handleDeleteProject = async (id, event) => {
    event.stopPropagation();
    if (window.confirm('Bạn chắc chắn muốn xóa dự án này? Tất cả dữ liệu sẽ bị mất.')) {
      await deleteProject(id);
    }
    setContextMenu(null);
  };

  const handleProjectCreated = async (id, options = {}) => {
    setShowModal(false);
    await loadProject(id);
    navigate(options.path || `/project/${id}/editor`);
  };

  const handleStoryBundleImported = async (id) => {
    setBundleImportOpen(false);
    await loadProjects();
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

  return (
    <div className="dashboard">
      <header className="dashboard-header animate-fade-in">
        <div className="dashboard-header__top">
          <h1 className="dashboard-title">
            <span className="dashboard-title-icon">SF</span>
            StoryForge
          </h1>
          {isMobileLayout ? (
            <div className="dashboard-header__mobile-actions">
              <button
                type="button"
                className="dashboard-mobile-theme-button btn btn-ghost"
                onClick={() => setMobileThemeOpen(true)}
                aria-expanded={mobileThemeOpen}
                aria-label="Đổi màu giao diện"
              >
                <Palette size={19} />
                <span>Màu</span>
              </button>
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
            </div>
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
          <button
            type="button"
            className="dashboard-support-button"
            onClick={() => setDonateOpen(true)}
          >
            <span className="dashboard-support-button__icon" aria-hidden="true">
              <HeartHandshake size={18} />
            </span>
            <span className="dashboard-support-button__copy">
              <strong>Ủng hộ dự án</strong>
              <span>Mở thông tin QR và chuyển khoản, không rời khỏi trang chủ.</span>
            </span>
          </button>
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

            {PRODUCT_SURFACE.enableStoryBundle ? (
              <button className="new-project-card new-project-card--import animate-slide-up" onClick={() => setBundleImportOpen(true)}>
                <div className="new-project-icon">
                  <ArchiveRestore size={30} />
                </div>
                <div className="new-project-card__content">
                  <span className="new-project-label">Nhập file StoryForge</span>
                  <span className="new-project-hint">Khôi phục file .storyforge hoặc backup JSON cũ ngay trên máy, không cần Cloud Sync.</span>
                </div>
              </button>
            ) : null}

            {filteredProjects.map((project, index) => {
              const cover = coverByProjectId[project.id];
              const coverUrl = project.cover_thumbnail_data_url || cover?.thumbnail_data_url || cover?.data_url || '';
              const hasCover = Boolean(coverUrl);
              return (
                <div
                  key={project.id}
                  className={`project-card card-glass animate-slide-up ${hasCover ? 'project-card--with-cover' : 'project-card--without-cover'} ${contextMenu === project.id ? 'project-card--menu-open' : ''}`}
                  style={{ animationDelay: `${(index + 1) * 60}ms` }}
                  onClick={() => handleOpenProject(project.id)}
                >
                  <div className="project-card-cover-frame">
                    {hasCover ? (
                      <img className="project-card-cover-thumb" src={coverUrl} alt="Bìa truyện" referrerPolicy="no-referrer" />
                    ) : (
                      <div className="project-card-cover-empty">
                        <span className="project-genre-emoji">{getGenreEmoji(project.genre_primary)}</span>
                        <button
                          type="button"
                          className="project-card-cover-action"
                          onClick={(event) => handleAddCover(project.id, event)}
                        >
                          <ImageIcon size={12} /> Thêm bìa
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="project-card-content">
                    <div className="project-card-topline">
                      <span className="badge badge-accent">{getGenreLabel(project.genre_primary)}</span>
                      <button
                        className="btn btn-ghost btn-icon btn-sm project-card-menu"
                        onClick={(event) => {
                          event.stopPropagation();
                          setContextMenu(contextMenu === project.id ? null : project.id);
                        }}
                        aria-label="Mở menu dự án"
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
                          {PRODUCT_SURFACE.enableStoryBundle ? (
                            <button
                              className="context-menu-item"
                              onClick={(event) => {
                                event.stopPropagation();
                                setContextMenu(null);
                                setBundleExportProject(project);
                              }}
                            >
                              <PackageOpen size={14} /> Sao lưu truyện (.storyforge)
                            </button>
                          ) : null}
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

                    {project.description && <p className="project-card-desc">{project.description}</p>}

                    <div className="project-card-footer">
                      <span className="project-card-date">{formatDate(project.updated_at)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
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
        open={mobileThemeOpen}
        title="Giao diện"
        kicker="StoryForge"
        onClose={() => setMobileThemeOpen(false)}
      >
        <ThemePicker variant="sheet" />
      </MobileSheet>

      <MobileSheet
        open={mobileMenuOpen}
        title="Menu"
        kicker="StoryForge"
        size="full"
        onClose={() => setMobileMenuOpen(false)}
      >
        <MobileNavigationMenu
          activeProjectId={activeProjectId}
          onNavigate={() => setMobileMenuOpen(false)}
        />
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

      {bundleExportProject ? (
        <StoryBundleModal
          mode="export"
          project={bundleExportProject}
          projects={projects}
          onClose={() => setBundleExportProject(null)}
        />
      ) : null}

      {bundleImportOpen ? (
        <StoryBundleModal
          mode="import"
          projects={projects}
          onClose={() => setBundleImportOpen(false)}
          onImported={handleStoryBundleImported}
        />
      ) : null}

      <SupportDonateModal open={donateOpen} onClose={() => setDonateOpen(false)} />
    </div>
  );
}
